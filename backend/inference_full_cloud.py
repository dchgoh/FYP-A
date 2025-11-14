# --- START OF FILE inference_full_cloud.py ---

import argparse
import os
import torch
import logging
from pathlib import Path
import sys
import importlib
from tqdm import tqdm
import numpy as np
import time
import laspy # <<< **** ADD THIS IF NOT ALREADY GLOBALLY ACCESSIBLE ****
             # (Though it's imported within load_large_point_cloud, good practice to have it here too
             # if we use it directly in predict_full_cloud)

print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"PyTorch CUDA version: {torch.version.cuda}") # Should output 12.1
    print(f"Number of GPUs: {torch.cuda.device_count()}")
    print(f"Current GPU name: {torch.cuda.get_device_name(0)}")


# Determine project directories relative to this script file
try:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    BASE_DIR = os.getcwd()
    print(f"Warning: __file__ not defined. Using CWD as BASE_DIR: {BASE_DIR}")
ROOT_DIR = BASE_DIR
sys.path.append(os.path.join(ROOT_DIR, 'models'))


# --- Define YOUR FOR-Instance class mapping (MUST MATCH TRAINING) ---
classes = ['Unclassified', 'Low-vegetation', 'Terrain', 'Out-points', 'Stem', 'Live branches', 'Woody branches']
class2label = {cls: i for i, cls in enumerate(classes)}
NUM_CLASSES = len(classes)
seg_label_to_cat = {i: cat for i, cat in enumerate(classes)} # Reverse mapping

# ============================================================================
#                            Argument Parser
# ============================================================================
def parse_args():
    parser = argparse.ArgumentParser('Full Point Cloud Semantic Segmentation Inference')
    parser.add_argument('--gpu', type=str, default='0', help='Specify gpu device [default: 0]')
    parser.add_argument('--model', type=str, required=True, help='Name of the model file (e.g., pointnet_sem_seg)')
    
    # --- Checkpoint Loading Arguments ---
    parser.add_argument('--checkpoint_path', type=str, default=None, help='(Option 1) Full direct path to the .pth model checkpoint file. Overrides --log_dir and --checkpoint for path construction.')
    parser.add_argument('--log_dir', type=str, default=None, help='(Option 2) Path to the training log directory. Used if --checkpoint_path is NOT provided.')
    parser.add_argument('--checkpoint', type=str, default='best_model.pth', help='(Option 2) Checkpoint file name within log_dir/checkpoints/. Used if --checkpoint_path is NOT provided.')
    
    parser.add_argument('--num_point_model', type=int, default=1024, help='Number of points the model expects per chunk [default: 1024, MUST match training]')
    parser.add_argument('--batch_size_inference', type=int, default=16, help='Batch size for processing chunks during inference [default: 16]')
    parser.add_argument('--input_file', type=str, required=True, help='Path to the large input point cloud file (e.g., .h5, .las, .npy)')
    parser.add_argument('--output_dir', type=str, default='./inference_output', help='Directory to save prediction results [default: ./inference_output]')
    parser.add_argument('--stride_ratio', type=float, default=0.5, help='Stride ratio for overlapping chunks (0.5 means 50% overlap) [default: 0.5]')
    parser.add_argument('--num_features', type=int, default=6, help='Number of input features per point for the model [default: 6, MUST match training and model architecture]')
    parser.add_argument('--output_format', type=str, default='all', choices=['las', 'npy', 'txt', 'all'], help='Output format for predictions [default: all, options: las, npy, txt, all]')


    # --- Argument Validation Logic will be added after parsing ---
    
    if 'google.colab' in sys.modules or 'ipykernel' in sys.modules:
        print("Detected Colab/IPython environment. Parsing known args.")
        args, unknown = parser.parse_known_args() # Default parsing
        if unknown: print(f"Warning: Unknown arguments passed: {unknown}")
        if not args.model: raise ValueError("--model argument is required")
        if not args.input_file: raise ValueError("--input_file argument is required")
    else:
        args = parser.parse_args()

    # Validate checkpoint arguments
    if args.checkpoint_path is None:
        if args.log_dir is None:
            parser.error("If --checkpoint_path is not provided, --log_dir is required.")
    else:
        if args.log_dir is not None or args.checkpoint != 'best_model.pth':
            print("Warning: --checkpoint_path is provided. --log_dir and --checkpoint (if also set) will be ignored for constructing the checkpoint file path, but --log_dir might still be used for other logging if implemented.")
    return args

# ============================================================================
#                            Helper Functions
# ============================================================================
def load_large_point_cloud(filepath, num_features_expected):
    """
    Loads a large point cloud from a file.
    Attempts to extract `num_features_expected` features.
    For LAS, prioritizes XYZ+RGB if num_features_expected is 6.
    Returns points array and a flag indicating if input was LAS with RGB.
    """
    print(f"Attempting to load large point cloud from: {filepath} (expecting {num_features_expected} features)")
    file_ext = Path(filepath).suffix.lower()
    points = None
    has_rgb = False # Flag to indicate if RGB was successfully loaded from LAS

    if file_ext == '.npy':
        try:
            data = np.load(filepath)
            if data.ndim == 2 and data.shape[1] >= num_features_expected:
                points = data[:, :num_features_expected].astype(np.float32)
            elif data.ndim == 2 and data.shape[1] < num_features_expected:
                print(f"Warning: NPY file has {data.shape[1]} features, expecting {num_features_expected}. Padding with zeros.")
                padding = np.zeros((data.shape[0], num_features_expected - data.shape[1]), dtype=np.float32)
                points = np.hstack((data, padding))
            else:
                raise ValueError(f"NPY file data shape {data.shape} not compatible.")
        except Exception as e:
            print(f"Error loading .npy file '{filepath}': {e}")
            return None, False
            
    elif file_ext == '.h5' or file_ext == '.hdf5':
        try:
            import h5py
            with h5py.File(filepath, 'r') as f:
                if 'data' in f: data_cloud = f['data'][:]
                elif 'points' in f: data_cloud = f['points'][:]
                else: raise ValueError("HDF5 file missing 'data' or 'points' key.")

                if data_cloud.ndim == 3: 
                    print(f"Warning: HDF5 file seems to contain sub-chunks. Reshaping. Original shape: {data_cloud.shape}")
                    data_cloud = data_cloud.reshape(-1, data_cloud.shape[-1])
                
                if data_cloud.shape[1] == num_features_expected:
                    points = data_cloud.astype(np.float32)
                elif data_cloud.shape[1] > num_features_expected:
                    print(f"Warning: HDF5 has {data_cloud.shape[1]} features, taking first {num_features_expected}.")
                    points = data_cloud[:, :num_features_expected].astype(np.float32)
                else: 
                    print(f"Warning: HDF5 has {data_cloud.shape[1]} features, expecting {num_features_expected}. Padding with zeros.")
                    padding = np.zeros((data_cloud.shape[0], num_features_expected - data_cloud.shape[1]), dtype=np.float32)
                    points = np.hstack((data_cloud.astype(np.float32), padding))
        except ImportError:
            print("h5py library not installed. Please install it: pip install h5py")
            return None, False
        except Exception as e:
            print(f"Error loading HDF5 file '{filepath}': {e}")
            return None, False

    elif file_ext == '.las' or file_ext == '.laz':
        try:
            # import laspy # Already imported globally or handled by caller
            with laspy.open(str(filepath)) as f:
                las = f.read()
                xyz = np.vstack((las.x, las.y, las.z)).transpose().astype(np.float32)

                if num_features_expected == 6:
                    print("Attempting to load XYZ + RGB (normalized to 0-1) for 6 features.")
                    if all(c in las.point_format.dimension_names for c in ['red', 'green', 'blue']):
                        r = (las.red / 65535.0).astype(np.float32)[:, np.newaxis]
                        g = (las.green / 65535.0).astype(np.float32)[:, np.newaxis]
                        b = (las.blue / 65535.0).astype(np.float32)[:, np.newaxis]
                        points = np.hstack((xyz, r, g, b))
                        has_rgb = True # RGB successfully loaded
                        print("Loaded XYZRGB.")
                    else:
                        print(f"Warning: LAS file missing R,G,B dimensions for 6-feature XYZRGB. Using XYZ and padding with 3 zero features.")
                        padding = np.zeros((xyz.shape[0], 3), dtype=np.float32)
                        points = np.hstack((xyz, padding))
                elif num_features_expected == 3:
                    print("Loading XYZ for 3 features.")
                    points = xyz
                else: 
                    print(f"Warning: num_features_expected is {num_features_expected}. Defaulting to XYZ and padding/truncating if necessary.")
                    if xyz.shape[1] == num_features_expected:
                        points = xyz
                    elif xyz.shape[1] > num_features_expected: # e.g. XYZ input, num_features_expected = 1
                        points = xyz[:, :num_features_expected]
                    else: # xyz.shape[1] < num_features_expected (likely 3 < expected)
                        padding = np.zeros((xyz.shape[0], num_features_expected - xyz.shape[1]), dtype=np.float32)
                        points = np.hstack((xyz, padding))
                
                if points.shape[1] != num_features_expected:
                    print(f"Critical Error: Final points array has {points.shape[1]} features, but expected {num_features_expected}. Check LAS loading logic for num_features={num_features_expected}.")
                    return None, False 

        except ImportError:
            print("laspy library not installed. Please install it: pip install laspy")
            return None, False
        except Exception as e:
            print(f"!!! DETAILED ERROR loading LAS/LAZ file '{filepath}' !!!")
            import traceback
            traceback.print_exc()
            print(f"Error object: {e}")
            return None, False
            
    else:
        print(f"Unsupported file extension: {file_ext}. Please adapt 'load_large_point_cloud'.")
        return None, False

    if points is not None:
        print(f"Successfully loaded and processed {points.shape[0]} points with {points.shape[1]} features.")
    else:
        print(f"Failed to load points from {filepath}")
        
    return points, has_rgb


def create_overlapping_chunks_by_indices(points_large, num_point_model, stride_ratio):
    num_total_points = points_large.shape[0]
    chunks_with_indices = []

    if num_total_points == 0:
        print("Warning: Input point cloud is empty for chunking.")
        return chunks_with_indices
        
    if num_total_points <= num_point_model:
        if num_total_points == num_point_model:
             indices_chosen = np.arange(num_total_points)
        else: 
             # If fewer points than model expects, duplicate points to fill the chunk
             # This is often preferred over random sampling if the goal is to process all original points
             # and the model can handle repeated points.
             # If random sampling with replacement is truly desired, uncomment next line:
             # indices_chosen = np.random.choice(num_total_points, num_point_model, replace=True)
             
             # Pad by repeating points from the beginning
             indices_chosen = np.pad(np.arange(num_total_points),
                                   (0, num_point_model - num_total_points),
                                   'wrap')

        chunk_pts = points_large[indices_chosen]
        original_indices = indices_chosen 
        chunks_with_indices.append((chunk_pts, original_indices))
        print(f"Point cloud ({num_total_points} pts) <= num_point_model ({num_point_model} pts). Created 1 chunk by sampling/padding.")
        return chunks_with_indices

    stride = int(num_point_model * stride_ratio)
    if stride <= 0: stride = 1 

    for i in range(0, num_total_points - num_point_model + 1, stride):
        chunk_points = points_large[i : i + num_point_model]
        original_indices_for_chunk = np.arange(i, i + num_point_model)
        chunks_with_indices.append((chunk_points, original_indices_for_chunk))

    # Check if the very last part of the point cloud was covered
    # This condition ensures that if the last stride stop didn't perfectly align with num_total_points - num_point_model,
    # a final chunk is created starting from num_total_points - num_point_model.
    last_potential_start = num_total_points - num_point_model
    if num_total_points > num_point_model: # Only if cloud is larger than one chunk
        # Find the start index of the last chunk added by the loop
        if chunks_with_indices:
            last_added_chunk_start_idx = chunks_with_indices[-1][1][0]
        else: # This case should ideally not happen if num_total_points > num_point_model
            last_added_chunk_start_idx = -1 # sentinel to ensure the tail chunk is added

        # If the last_potential_start is not the same as the start of the last added chunk,
        # it means the end of the cloud was not fully covered by a chunk ending at the last point.
        if last_potential_start != last_added_chunk_start_idx:
            chunk_points_tail = points_large[last_potential_start:]
            original_indices_tail = np.arange(last_potential_start, num_total_points)
            chunks_with_indices.append((chunk_points_tail, original_indices_tail))
            print(f"Added a tail chunk for full coverage, starting at index {last_potential_start}.")
    
    print(f"Created {len(chunks_with_indices)} chunks of {num_point_model} points each from {num_total_points} total points.")
    return chunks_with_indices

def pc_normalize(pc):
    if pc.ndim != 2 or pc.shape[0] == 0 or pc.shape[1] < 3:
        return pc
    centroid = np.mean(pc[:, :3], axis=0)
    pc_copy = pc.copy()
    pc_copy[:, :3] = pc_copy[:, :3] - centroid
    max_dist = np.max(np.sqrt(np.sum(pc_copy[:, :3] ** 2, axis=1)))
    if max_dist < 1e-6: # Avoid division by zero for very small clouds
        return pc_copy
    pc_copy[:, :3] = pc_copy[:, :3] / max_dist
    return pc_copy
# ============================================================================
#                                Main Logic
# ============================================================================
def predict_full_cloud(args):
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("FullCloudInference")
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    sanitized_input_stem = Path(args.input_file).stem.replace(" ", "_")
    if not logger.handlers: 
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
    def log_string(str_msg): logger.info(str_msg)

    log_string('---------------- INFERENCE PARAMETERS ----------------')
    log_string(f"Command: {' '.join(sys.argv)}")
    log_string(f"Args: {args}")
    log_string('------------------------------------------------------')

    os.environ["CUDA_VISIBLE_DEVICES"] = args.gpu
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log_string(f"Using device: {device}")
    if str(device) == "cpu": log_string("WARNING: CUDA not available, running on CPU.")

    log_string(f"Loading model architecture: {args.model}")
    try:
        MODEL_MODULE = importlib.import_module(args.model)
        # Ensure the model is loaded with the correct number of classes
        model = MODEL_MODULE.get_model(num_classes=NUM_CLASSES, num_features=args.num_features).to(device)
    except TypeError: # Fallback for models not expecting num_channel
        log_string(f"Warning: Model {args.model} does not accept 'num_channel' argument. Assuming it matches num_features={args.num_features}.")
        model = MODEL_MODULE.get_model(num_classes=NUM_CLASSES).to(device)
    except Exception as e:
        log_string(f"ERROR: Failed to initialize model '{args.model}': {e}")
        sys.exit(1)


    if args.checkpoint_path:
        checkpoint_full_path = Path(args.checkpoint_path)
        log_string(f"Using direct checkpoint path: {checkpoint_full_path}")
    elif args.log_dir: 
        checkpoint_full_path = Path(args.log_dir) / 'checkpoints' / args.checkpoint
        log_string(f"Constructing checkpoint path from log_dir: {checkpoint_full_path}")
    else: 
        log_string("ERROR: No valid checkpoint path source provided (--checkpoint_path or --log_dir).")
        sys.exit(1)

    if not checkpoint_full_path.exists():
        log_string(f"ERROR: Checkpoint file not found: {checkpoint_full_path}")
        sys.exit(1)
    log_string(f"Loading model state from checkpoint: {checkpoint_full_path}")
    try:
        checkpoint = torch.load(str(checkpoint_full_path), map_location=device, weights_only=False)
        model.load_state_dict(checkpoint['model_state_dict'])
        log_string("Model state loaded successfully.")
        trained_epoch = checkpoint.get('epoch', -1)
        if trained_epoch != -1: log_string(f"(Checkpoint saved at end of epoch {trained_epoch + 1})")
    except Exception as e:
        log_string(f"ERROR loading checkpoint state from {checkpoint_full_path}: {e}")
        sys.exit(1)
    model.eval()
        
    # Modified: load_large_point_cloud now returns has_rgb
    points_large_raw, input_has_rgb = load_large_point_cloud(args.input_file, args.num_features)
    
    # Preserve original LAS header (including CRS/EPSG) if input is LAS/LAZ
    original_las_header = None
    original_las_crs = None
    if Path(args.input_file).suffix.lower() in ['.las', '.laz']:
        try:
            with laspy.open(str(args.input_file)) as f:
                original_las = f.read()
                original_las_header = original_las.header
                log_string(f"Read original LAS header with {len(original_las_header.vlrs)} VLR(s)")
                # Try to extract CRS information (requires pyproj, but VLRs will preserve CRS even without it)
                try:
                    crs = original_las_header.parse_crs()
                    if crs:
                        original_las_crs = crs
                        log_string(f"Parsed original CRS from input file: {crs}")
                except ImportError as e_import:
                    # pyproj not available - that's okay, we'll preserve CRS via VLRs
                    log_string(f"Note: pyproj not available, will preserve CRS via VLRs: {e_import}")
                except Exception as e_crs:
                    # Other errors - still okay, VLRs should preserve CRS
                    log_string(f"Note: Could not parse CRS (will preserve via VLRs): {e_crs}")
        except Exception as e_header:
            log_string(f"Warning: Could not read original LAS header: {e_header}")
    
    if points_large_raw is None:
        log_string(f"Failed to load point cloud from {args.input_file}. Exiting.")
        sys.exit(1)
    if points_large_raw.shape[1] != args.num_features:
        log_string(f"CRITICAL ERROR: Loaded data has {points_large_raw.shape[1]} features, but script expected {args.num_features} based on --num_features. Check load_large_point_cloud & --num_features.")
        sys.exit(1)

    num_total_points_large = points_large_raw.shape[0]
    if num_total_points_large == 0:
        log_string("Input point cloud is empty. Nothing to predict.")
        sys.exit(0)

    log_string("Creating chunks for inference...")
    chunk_data_with_indices = create_overlapping_chunks_by_indices(
        points_large_raw, args.num_point_model, args.stride_ratio
    )
    if not chunk_data_with_indices:
        log_string("No chunks were created.")
        sys.exit(1)

    log_string("Starting prediction on chunks...")
    sum_logits_large = np.zeros((num_total_points_large, NUM_CLASSES), dtype=np.float32)
    counts_large = np.zeros((num_total_points_large,), dtype=np.int32)

    num_chunks_total = len(chunk_data_with_indices)
    for batch_start_idx in tqdm(range(0, num_chunks_total, args.batch_size_inference), desc="Inferring Chunks"):
        batch_end_idx = min(batch_start_idx + args.batch_size_inference, num_chunks_total)
        current_batch_chunk_info = chunk_data_with_indices[batch_start_idx:batch_end_idx]
        batch_points_for_model_list = []
        batch_original_indices_list = []
        for chunk_pts_array, orig_indices_array in current_batch_chunk_info:
            normalized_chunk_pts_array = pc_normalize(chunk_pts_array.copy()) 
            batch_points_for_model_list.append(normalized_chunk_pts_array.T) # Model expects (B, C, N)
            batch_original_indices_list.append(orig_indices_array)
        
        # (B, C, N) where C = num_features, N = num_point_model
        batch_tensor = torch.from_numpy(np.array(batch_points_for_model_list)).float().to(device)

        with torch.no_grad():
            output_tuple = model(batch_tensor) # Model output: (B, N_points_in_chunk, N_classes)
            if isinstance(output_tuple, tuple) and len(output_tuple) == 2: # e.g. (pred, feat_transform_reg_loss)
                pred_logits_batch = output_tuple[0] 
            else: 
                pred_logits_batch = output_tuple
            # pred_logits_batch is (B, N_points_in_chunk, N_classes)
            # For PointNet sem_seg it is (B, N_points_in_chunk, num_classes)
            # For DGCNN sem_seg it is (B, N_points_in_chunk, num_classes)
            # The original script might have assumed (B, num_classes, N_points_in_chunk) then permuted.
            # Let's ensure it's (B, N, C_classes) for consistency before numpy conversion
            # Assuming model output is (Batch, Num_Points_per_Chunk, Num_Classes)
            # If model output is (Batch, Num_Classes, Num_Points_per_Chunk), then:
            # pred_logits_batch = pred_logits_batch.permute(0, 2, 1)

            pred_logits_batch_np = pred_logits_batch.cpu().numpy() # Shape (B, N_points, N_classes)

        for i in range(pred_logits_batch_np.shape[0]): # Iterate through batch
            logits_for_one_chunk = pred_logits_batch_np[i] # (N_points, N_classes)
            original_indices_for_this_chunk = batch_original_indices_list[i] # (N_points,)
            
            # We need to handle the case where points were padded to fill a chunk
            # Only use predictions for original points, not padded ones
            # In create_overlapping_chunks_by_indices, if num_total_points <= num_point_model,
            # original_indices might contain wrapped indices.
            # We only want to update sum_logits_large for unique original points.
            
            # If padding was done by repeating points (e.g. with 'wrap' or choice with replacement)
            # and original_indices reflects the *target* indices in the large cloud, this is fine.
            # The current create_overlapping_chunks handles this.
            
            sum_logits_large[original_indices_for_this_chunk] += logits_for_one_chunk
            counts_large[original_indices_for_this_chunk] += 1
    
    log_string("Finalizing predictions by averaging logits...")
    mask_predicted_at_least_once = counts_large > 0
    final_predictions_large = np.full(num_total_points_large, class2label.get('Unclassified', 0), dtype=np.int32) # Default to Unclassified
    
    if np.sum(mask_predicted_at_least_once) > 0:
        valid_counts = counts_large[mask_predicted_at_least_once, np.newaxis]
        valid_counts[valid_counts == 0] = 1 
        averaged_logits_for_predicted = sum_logits_large[mask_predicted_at_least_once] / valid_counts
        final_predictions_large[mask_predicted_at_least_once] = np.argmax(averaged_logits_for_predicted, axis=1)
    
    unpredicted_count = num_total_points_large - np.sum(mask_predicted_at_least_once)
    if unpredicted_count > 0:
        log_string(f"Warning: {unpredicted_count} points were not included in any chunk and are set to 'Unclassified'.")

    # --- MODIFIED/NEW SAVING SECTION ---
    try:
        if args.output_format in ['npy', 'all']:
            output_predictions_file = output_dir / f"{sanitized_input_stem}_predictions.npy"
            np.save(str(output_predictions_file), final_predictions_large)
            log_string(f"Saved final predictions to: {output_predictions_file}")

            output_points_file = output_dir / f"{sanitized_input_stem}_points_xyz.npy"
            np.save(str(output_points_file), points_large_raw[:, :3]) 
            log_string(f"Saved original XYZ points to: {output_points_file}")

        if args.output_format in ['txt', 'all']:
            output_colored_txt_file = output_dir / f"{sanitized_input_stem}_predicted_colored.txt"
            with open(output_colored_txt_file, 'w') as f:
                for i in range(num_total_points_large):
                    pt = points_large_raw[i, :3]
                    label = final_predictions_large[i]
                    f.write(f"{pt[0]:.3f} {pt[1]:.3f} {pt[2]:.3f} {label}\n")
            log_string(f"Saved XYZ + predicted label to: {output_colored_txt_file}")
        
        if args.output_format in ['las', 'all']:
            if Path(args.input_file).suffix.lower() not in ['.las', '.laz'] and not input_has_rgb:
                log_string("Warning: Input was not LAS/LAZ. RGB data might not be available for LAS output. Saving XYZ + Classification.")
            
            output_las_file = output_dir / f"{sanitized_input_stem}.las"
            log_string(f"Attempting to save predictions to LAS file: {output_las_file}")

            try:
                # Determine point format based on available features
                # Point Format 2: XYZ, RGB, Classification (if RGB is available)
                # Point Format 0 or 1: XYZ, Classification (if RGB not available)
                # We will use 1.4 LAS version.
                # If input_has_rgb is True, it means points_large_raw[:, 3:6] are normalized R,G,B.
                
                if input_has_rgb and points_large_raw.shape[1] >= 6:
                    # We have RGB, use point format 2 or 3. PF 2 is XYZ+RGB. PF 3 is XYZ+RGB+GPSTime.
                    # laspy will add 'classification' if it's assigned and not standard.
                    # PF 2 supports classification via Extra Bytes or if it's a standard field.
                    # PF 3 has classification as a standard field.
                    # Let's use PF 3, as 'classification' is standard.
                    header = laspy.LasHeader(version="1.4", point_format=3)
                else:
                    # No RGB, use point format 1 (XYZ + GPSTime - GPSTime will be 0)
                    # PF 1 has classification as a standard field.
                    header = laspy.LasHeader(version="1.4", point_format=1)

                # Set scales and offsets (important for precision)
                # Try to preserve original scales/offsets if available, otherwise use min of coords
                if original_las_header is not None:
                    try:
                        header.offsets = original_las_header.offsets
                        header.scales = original_las_header.scales
                        log_string(f"Preserved original offsets: {header.offsets}, scales: {header.scales}")
                    except Exception as e_offsets:
                        log_string(f"Warning: Could not preserve original offsets/scales: {e_offsets}. Using computed values.")
                        min_coords = np.min(points_large_raw[:, :3], axis=0)
                        header.offsets = min_coords
                        header.scales = np.array([0.001, 0.001, 0.001])
                else:
                    min_coords = np.min(points_large_raw[:, :3], axis=0)
                    header.offsets = min_coords
                    header.scales = np.array([0.001, 0.001, 0.001]) # Adjust if higher precision needed

                las = laspy.LasData(header)
                las.x = points_large_raw[:, 0]
                las.y = points_large_raw[:, 1]
                las.z = points_large_raw[:, 2]
                
                # Preserve CRS/EPSG and all VLRs from original file
                # The most reliable way is to copy all VLRs, especially GeoTIFF VLRs which contain CRS info
                if original_las_header is not None:
                    try:
                        # Copy ALL VLRs from original header to preserve CRS and other metadata
                        # This is the most reliable method to preserve coordinate system information
                        vlrs_copied = 0
                        for vlr in original_las_header.vlrs:
                            try:
                                las.header.vlrs.append(vlr)
                                vlrs_copied += 1
                            except Exception as e_vlr_copy:
                                log_string(f"Warning: Could not copy VLR {vlr.user_id}:{vlr.record_id}: {e_vlr_copy}")
                        
                        if vlrs_copied > 0:
                            log_string(f"Copied {vlrs_copied} VLR(s) from original file (including CRS information)")
                        
                        # Also try to log CRS info if we have the CRS object (optional, for logging only)
                        if original_las_crs is not None:
                            try:
                                # Try to get EPSG code for logging (requires pyproj)
                                try:
                                    from pyproj import CRS as PyprojCRS
                                    epsg_code = None
                                    if hasattr(original_las_crs, 'to_epsg'):
                                        epsg_code = original_las_crs.to_epsg()
                                    elif hasattr(original_las_crs, 'to_authority'):
                                        auth = original_las_crs.to_authority()
                                        if auth and auth[0].upper() == 'EPSG':
                                            epsg_code = int(auth[1])
                                    
                                    if epsg_code:
                                        log_string(f"Original file CRS: EPSG:{epsg_code} (preserved via VLRs)")
                                except ImportError:
                                    # pyproj not available - that's fine, VLRs are already copied
                                    log_string(f"CRS object found (EPSG info requires pyproj, but VLRs preserve CRS)")
                            except Exception as e_crs_verify:
                                log_string(f"Note: Could not verify CRS (VLRs already copied): {e_crs_verify}")
                    except Exception as e_vlr_all:
                        log_string(f"Warning: Could not copy VLRs from original file: {e_vlr_all}")
                
                # Add classification (labels should be uint8 for standard LAS classification)
                # Ensure labels are within valid range for uint8 (0-255)
                las.classification = final_predictions_large.astype(np.uint8)

                if input_has_rgb and points_large_raw.shape[1] >= 6:
                    log_string("Adding RGB data to output LAS file.")
                    # RGB in points_large_raw is normalized (0-1). Scale to uint16 (0-65535)
                    las.red = (points_large_raw[:, 3] * 65535).astype(np.uint16)
                    las.green = (points_large_raw[:, 4] * 65535).astype(np.uint16)
                    las.blue = (points_large_raw[:, 5] * 65535).astype(np.uint16)
                
                las.write(str(output_las_file))
                log_string(f"Successfully saved predictions to LAS file: {output_las_file}")

            except ImportError:
                log_string("Error: laspy library not found. Cannot save to .las format. Please install it: pip install laspy")
            except Exception as e_las:
                log_string(f"Error saving to .las file: {e_las}")
                import traceback
                log_string(traceback.format_exc())

    except Exception as e:
        log_string(f"Error during general saving of prediction results: {e}")
        import traceback
        log_string(traceback.format_exc())


    log_string("--- Full Cloud Inference Finished ---")

if __name__ == '__main__':
    args = parse_args()
    try:
        predict_full_cloud(args)
    except FileNotFoundError as e:
        print(f"\nERROR: File/Dir not found: {e}")
        if logging.getLogger("FullCloudInference").hasHandlers(): logging.exception("FNF Error:")
    except Exception as e:
        print(f"\nCRITICAL ERROR: {type(e).__name__}: {e}")
        if logging.getLogger("FullCloudInference").hasHandlers(): logging.exception("Critical error:")
        else: import traceback; traceback.print_exc()

# --- END OF FILE inference_full_cloud.py ---