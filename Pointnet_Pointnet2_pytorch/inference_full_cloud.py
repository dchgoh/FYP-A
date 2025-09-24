#!/usr/bin/env python

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
import laspy # Import laspy here

# Determine project directories relative to this script file
try:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    BASE_DIR = os.getcwd()
    # print(f"Warning: __file__ not defined. Using CWD as BASE_DIR: {BASE_DIR}") # Too verbose
ROOT_DIR = BASE_DIR
# Add models directory to sys.path if it's not already there
models_dir = os.path.join(ROOT_DIR, 'models')
if models_dir not in sys.path:
    sys.path.append(models_dir)

# --- Define YOUR FOR-Instance class mapping (MUST MATCH TRAINING) ---
# Ensure this matches the classification scheme your model was trained on.
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
    parser.add_argument('--input_file', type=str, required=True, help='Path to the large input point cloud file (e.g., .las, .laz)')
    parser.add_argument('--output_dir', type=str, default='./inference_output', help='Directory to save prediction results [default: ./inference_output]')
    parser.add_argument('--stride_ratio', type=float, default=0.5, help='Stride ratio for overlapping chunks (0.5 means 50% overlap) [default: 0.5]')
    parser.add_argument('--num_features', type=int, default=6, help='Number of input features per point for the model [default: 6, MUST match training and model architecture]')

    args = parser.parse_args() # Standard parsing for non-interactive mode

    # Validate checkpoint arguments
    if args.checkpoint_path is None:
        if args.log_dir is None:
            parser.error("If --checkpoint_path is not provided, --log_dir is required.")
    else:
        if args.log_dir is not None or args.checkpoint != 'best_model.pth':
            # print("Warning: --checkpoint_path is provided. --log_dir and --checkpoint (if also set) will be ignored for constructing the checkpoint file path.") # Too verbose
            pass # Validation passed, just don't print warning if it's expected default behavior

    return args

# ============================================================================
#                            Helper Functions
# ============================================================================

def pc_normalize(pc):
    """ Normalize point cloud coordinates to unit sphere centered at origin. """
    if pc.ndim != 2 or pc.shape[0] == 0 or pc.shape[1] < 3:
        # Handle empty or incorrectly shaped input
        return pc if pc is not None else np.empty((0, 3), dtype=np.float32) # Ensure something is returned
    centroid = np.mean(pc[:, :3], axis=0)
    pc_copy = pc.copy() # Work on a copy to avoid modifying original data outside function
    pc_copy[:, :3] = pc_copy[:, :3] - centroid
    max_dist = np.max(np.sqrt(np.sum(pc_copy[:, :3] ** 2, axis=1)))
    if max_dist < 1e-6: # Avoid division by zero or very small numbers
        return pc_copy # Return centered if all points are at the centroid
    pc_copy[:, :3] = pc_copy[:, :3] / max_dist
    return pc_copy

def extract_features_from_laspy_points(las_points, num_features_expected, logger=None):
    """
    Extracts features from a laspy PointRecords object.
    Supports XYZ and attempts to extract RGB if num_features_expected is 6.
    Returns numpy array of shape (N, num_features_expected).
    """
    if las_points is None or len(las_points) == 0:
        # Return empty array with expected number of columns
        return np.empty((0, num_features_expected), dtype=np.float32)

    try:
        # Get XYZ (laspy's xyz property handles scale/offset automatically)
        xyz = las_points.xyz.astype(np.float32)

        if xyz.shape[0] != len(las_points):
             # Should not happen with laspy, but as a sanity check
             if logger: logger.warning(f"Mismatch between las_points count ({len(las_points)}) and extracted XYZ points ({xyz.shape[0]})")
             return np.empty((0, num_features_expected), dtype=np.float32)

        # Handle feature extraction based on expected count
        if num_features_expected == 3:
            return xyz
        elif num_features_expected == 6:
            # Attempt to get RGB (laspy reads uint16 for RGB 0-65535 by default)
            if all(c in las_points.point_format.dimension_names for c in ['red', 'green', 'blue']):
                try:
                    r = (las_points.red / 65535.0).astype(np.float32)[:, np.newaxis]
                    g = (las_points.green / 65535.0).astype(np.float32)[:, np.newaxis]
                    b = (las_points.blue / 65535.0).astype(np.float32)[:, np.newaxis]
                    points = np.hstack((xyz, r, g, b))
                except Exception as rgb_e:
                     if logger: logger.warning(f"Error extracting/scaling RGB: {rgb_e}. Padding with zeros.")
                     padding = np.zeros((xyz.shape[0], 3), dtype=np.float32)
                     points = np.hstack((xyz, padding))
            else:
                # Fallback if RGB is missing
                if logger: logger.warning("RGB dimensions (red, green, blue) not found in LAS points. Padding with 3 zero features.")
                padding = np.zeros((xyz.shape[0], 3), dtype=np.float32)
                points = np.hstack((xyz, padding))
            return points
        else:
            # Handle other feature counts (padding or truncation)
            if logger: logger.warning(f"extract_features_from_laspy_points called with num_features_expected={num_features_expected}. Defaulting to XYZ and padding/truncating.")
            if xyz.shape[1] == num_features_expected:
                return xyz
            elif xyz.shape[1] > num_features_expected:
                return xyz[:, :num_features_expected]
            else: # xyz.shape[1] < num_features_expected
                padding = np.zeros((xyz.shape[0], num_features_expected - xyz.shape[1]), dtype=np.float32)
                return np.hstack((xyz, padding))

    except Exception as e:
        if logger: logger.error(f"Error during feature extraction from laspy points: {e}")
        # import traceback # Uncomment for detailed debugging
        # if logger: logger.error(traceback.format_exc())
        return np.empty((0, num_features_expected), dtype=np.float32) # Return empty array on error


def save_prediction_results(output_dir, input_file_path, original_xyz_points, final_predictions, log_string):
    """
    Saves the final predictions and potentially the original XYZ points.
    original_xyz_points is expected to be a numpy array (N, 3).
    final_predictions is expected to be a numpy array (N,).
    """
    sanitized_input_stem = Path(input_file_path).stem.replace(" ", "_")
    output_predictions_file_npy = output_dir / f"{sanitized_input_stem}_predictions.npy"
    output_points_file_xyz_npy = output_dir / f"{sanitized_input_stem}_original_xyz.npy" # Renamed for clarity
    output_colored_txt_file = output_dir / f"{sanitized_input_stem}_predicted_colored.txt"

    num_total_points = final_predictions.shape[0]

    if original_xyz_points is None or original_xyz_points.shape[0] != num_total_points or original_xyz_points.shape[1] != 3:
        log_string("Warning: Cannot save original XYZ points or colored text due to missing or incorrect original_xyz_points data.")
        # Attempt to save just the predictions file
        try:
            np.save(str(output_predictions_file_npy), final_predictions)
            log_string(f"Saved final predictions to: {output_predictions_file_npy}")
        except Exception as e:
            log_string(f"Error saving *only* prediction NPY: {e}")
        return # Exit the save function

    try:
        # Save predictions array
        np.save(str(output_predictions_file_npy), final_predictions)
        log_string(f"Saved final predictions to: {output_predictions_file_npy}")

        # Save original XYZ points array
        np.save(str(output_points_file_xyz_npy), original_xyz_points)
        log_string(f"Saved original XYZ points to: {output_points_file_xyz_npy}")

        # Save XYZ + predicted label to text file (useful for visualization)
        log_string(f"Saving XYZ + predicted label to text file: {output_colored_txt_file}")
        with open(output_colored_txt_file, 'w') as f:
            # Use a smaller precision for text output to save space/time
            for i in range(num_total_points):
                 pt = original_xyz_points[i]
                 label = final_predictions[i]
                 f.write(f"{pt[0]:.3f} {pt[1]:.3f} {pt[2]:.3f} {label}\n")
        log_string(f"Saved XYZ + predicted label text file.")

    except Exception as e:
        log_string(f"Error saving prediction results: {e}")


# ============================================================================
#                                Main Logic
# ============================================================================
def predict_full_cloud(args):
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # --- Setup Logger ---
    logger = logging.getLogger("FullCloudInference")
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    sanitized_input_stem = Path(args.input_file).stem.replace(" ", "_")
    log_file = output_dir / f'inference_{sanitized_input_stem}_{time.strftime("%Y%m%d_%H%M%S")}.log' # Changed extension to .log
    # Prevent adding multiple handlers if run multiple times in interactive session
    if not logger.handlers:
        file_handler = logging.FileHandler(str(log_file))
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
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
        # Assuming get_model takes num_classes and num_features as args
        # You might need to adjust this based on your specific model's get_model signature
        if hasattr(MODEL_MODULE, 'get_model'):
            # Try to get model with num_features first, fallback to just num_classes
            try:
                model = MODEL_MODULE.get_model(num_classes=NUM_CLASSES, num_features=args.num_features).to(device)
                log_string(f"Initialized model with {NUM_CLASSES} classes and {args.num_features} features.")
            except TypeError:
                 model = MODEL_MODULE.get_model(num_classes=NUM_CLASSES).to(device)
                 log_string(f"Initialized model with {NUM_CLASSES} classes (num_features not supported by get_model).")
        else:
             raise AttributeError(f"Model module '{args.model}' does not have a 'get_model' function.")

    except Exception as e:
        log_string(f"ERROR: Failed to initialize model '{args.model}': {type(e).__name__}: {e}")
        # import traceback; log_string(traceback.format_exc()) # Uncomment for debug
        sys.exit(1)

    '''LOAD CHECKPOINT'''
    # --- CHECKPOINT PATH LOGIC ---
    if args.checkpoint_path:
        checkpoint_full_path = Path(args.checkpoint_path)
        log_string(f"Using direct checkpoint path: {checkpoint_full_path}")
    elif args.log_dir: # Fallback to log_dir and checkpoint name
        checkpoint_full_path = Path(args.log_dir) / 'checkpoints' / args.checkpoint
        log_string(f"Constructing checkpoint path from log_dir: {checkpoint_full_path}")
    else:
        # This case should be caught by parse_args validation, but added here for safety
        log_string("ERROR: No valid checkpoint path source provided (--checkpoint_path or --log_dir).")
        sys.exit(1)

    if not checkpoint_full_path.exists():
        log_string(f"ERROR: Checkpoint file not found: {checkpoint_full_path}")
        sys.exit(1)

    log_string(f"Loading model state from checkpoint: {checkpoint_full_path}")
    try:
        # Use map_location=device to load directly onto the target device
        checkpoint = torch.load(str(checkpoint_full_path), map_location=device)
        # Check if the checkpoint is nested (e.g., has 'model_state_dict')
        if 'model_state_dict' in checkpoint:
             model.load_state_dict(checkpoint['model_state_dict'])
             log_string("Loaded 'model_state_dict' from checkpoint.")
             trained_epoch = checkpoint.get('epoch', -1)
             if trained_epoch != -1: log_string(f"(Checkpoint saved at end of epoch {trained_epoch + 1})")
        else:
             # Assume the checkpoint file directly contains the state dict
             model.load_state_dict(checkpoint)
             log_string("Loaded state dict directly from checkpoint file.")
             log_string("(Epoch information not found in checkpoint structure)")

        log_string("Model state loaded successfully.")

    except Exception as e:
        log_string(f"ERROR loading checkpoint state from {checkpoint_full_path}: {type(e).__name__}: {e}")
        # import traceback; log_string(traceback.format_exc()) # Uncomment for debug
        sys.exit(1)

    model.eval() # Set model to evaluation mode

    # --- Define chunking parameters ---
    num_point_model = args.num_point_model
    batch_size_inference = args.batch_size_inference
    stride_ratio = args.stride_ratio
    step = int(num_point_model * stride_ratio)
    if step <= 0:
         step = 1 # Ensure step is at least 1 point

    # --- Open the LAS file and get total points ---
    # Use 'with' statement to ensure the file is closed properly
    try:
        log_string(f"Opening input file: {args.input_file}")
        with laspy.open(str(args.input_file), mode='r') as las_file_handle:
            # Get total points based on LAS version
            if las_file_handle.header.version >= "1.4":
                 total_points_large = las_file_handle.header.extended_number_of_point_records
            else:
                 total_points_large = las_file_handle.header.point_count

            log_string(f"Total points in file: {total_points_large}")

            if total_points_large == 0:
                log_string("Input point cloud is empty. Nothing to predict.")
                sys.exit(0)

            # --- Initialize accumulation arrays ---
            # These arrays need to be large enough for the *entire* point cloud
            log_string(f"Initializing accumulation arrays ({total_points_large} points, {NUM_CLASSES} classes)... This may require significant RAM.")
            # Check if total_points_large * NUM_CLASSES * sizeof(float32) + total_points_large * sizeof(int32) fits in memory
            # This is where OOM *might* still occur if the *accumulation* arrays are too large.
            # For 900M points and 7 classes: ~900M * 7 * 4 bytes + ~900M * 4 bytes = ~25.2GB + ~3.6GB = ~28.8 GB
            # This fits within 64GB or 96GB, but could be an issue with less memory.
            try:
                sum_logits_large = np.zeros((total_points_large, NUM_CLASSES), dtype=np.float32)
                counts_large = np.zeros((total_points_large,), dtype=np.int32)
                # Also load original XYZ for saving later (this part still loads XYZ fully)
                # If *this* line causes OOM, you'd need to stream/re-read XYZ for saving.
                log_string("Loading original XYZ coordinates for saving results...")
                original_xyz_points = las_file_handle.read().xyz.astype(np.float32) # Loads all XYZ
                if original_xyz_points.shape[0] != total_points_large:
                    log_string(f"Warning: Mismatch in total points vs XYZ points loaded ({total_points_large} vs {original_xyz_points.shape[0]}). XYZ saving may be incorrect.")
                    original_xyz_points = None # Invalidate XYZ if load failed/mismatched
            except Exception as mem_e:
                log_string(f"CRITICAL ERROR: Could not allocate memory for accumulation arrays or load original XYZ: {type(mem_e).__name__}: {mem_e}")
                log_string("This likely means the full point cloud (or its prediction results/XYZ) does not fit in RAM.")
                log_string("Consider reducing the input file size or implementing a more advanced streaming approach that doesn't store all logits/counts in memory.")
                sys.exit(1)


            log_string(f"Inference chunk size (model input): {num_point_model}")
            log_string(f"Inference stride ratio: {stride_ratio} (step: {step})")
            log_string(f"Inference batch size: {batch_size_inference}")

            # --- Iterate through the point cloud using index windows ---
            # Calculate the start indices for all overlapping chunks
            # Ensure the last chunk is always included if total_points_large > num_point_model
            chunk_start_indices = list(range(0, total_points_large - num_point_model + 1, step))
            if total_points_large > num_point_model and (total_points_large - num_point_model) % step != 0:
                # Add the last chunk starting exactly at the end minus chunk size
                chunk_start_indices.append(total_points_large - num_point_model)
            # Remove potential duplicates if total_points_large - num_point_model was a multiple of step
            chunk_start_indices = sorted(list(set(chunk_start_indices)))

            num_chunks_total = len(chunk_start_indices)
            log_string(f"Calculated {num_chunks_total} chunks to process.")

            batch_points_list = []      # Collects normalized chunk data for the current batch (shape M, C)
            batch_global_indices_list = [] # Collects original global indices for the current batch (shape M,)

            # Use tqdm to show progress over the chunks
            for i, start_idx in enumerate(tqdm(chunk_start_indices, desc="Inferring Chunks")):
                end_idx = start_idx + num_point_model # Exclusive end index for laspy.read_points

                # Read the specific range of points from the LAS file
                try:
                    # read_points(start, end) reads points from start index up to (but not including) end index.
                    # To get num_point_model points starting at start_idx, we read up to start_idx + num_point_model.
                    las_points_chunk = las_file_handle.read_points(start_idx, end_idx)
                except Exception as e:
                    log_string(f"Warning: Error reading points from index {start_idx} to {end_idx}: {e}. Skipping chunk.")
                    continue # Skip this chunk if reading fails

                if len(las_points_chunk) != num_point_model:
                    log_string(f"Warning: Read chunk size mismatch. Expected {num_point_model}, got {len(las_points_chunk)} from {start_idx} to {end_idx}. Skipping chunk.")
                    continue # Skip if the read didn't return the expected number of points

                # Extract features (XYZ, potentially RGB) from the laspy PointRecords object
                chunk_data = extract_features_from_laspy_points(las_points_chunk, args.num_features, logger=logger)
                if chunk_data.shape[0] != num_point_model or chunk_data.shape[1] != args.num_features:
                    log_string(f"Warning: Feature extraction failed or returned incorrect features for chunk starting at {start_idx}. Shape {chunk_data.shape}. Skipping chunk.")
                    continue # Skip if feature extraction failed/incorrect

                # Get the original global indices for this chunk
                chunk_global_indices = np.arange(start_idx, end_idx) # These are the original file indices (0-based)

                # Normalize the chunk coordinates
                normalized_chunk_data = pc_normalize(chunk_data.copy()) # Apply normalization (only to XYZ typically, pc_normalize handles this)

                # Add to batch lists
                batch_points_list.append(normalized_chunk_data)
                batch_global_indices_list.append(chunk_global_indices)

                # If batch is full or it's the last chunk to be added
                is_last_chunk_to_process = (i == num_chunks_total - 1)
                if len(batch_points_list) == batch_size_inference or (is_last_chunk_to_process and batch_points_list):
                    # Process the batch
                    # Stack list of (M, C) arrays into (Batch, M, C) numpy array
                    batch_np = np.array(batch_points_list)
                    batch_tensor = torch.from_numpy(batch_np).float().to(device)
                    # The model expects shape (B, C, N) -> (batch_size, num_features, num_point_model)
                    # Our batch_np is (B, N, C), so permute:
                    batch_tensor = batch_tensor.permute(0, 2, 1) # Shape becomes (B, C, N)

                    with torch.no_grad():
                        # Model output shape is typically (B, num_classes, N)
                        output_tuple = model(batch_tensor)
                        # Handle potential multiple outputs from model (e.g., features, logits)
                        if isinstance(output_tuple, tuple) and len(output_tuple) > 0:
                            pred_logits_batch = output_tuple[0]
                        else:
                            pred_logits_batch = output_tuple

                        # Transpose back to (B, N, num_classes) before converting to numpy
                        pred_logits_batch_np = pred_logits_batch.permute(0, 2, 1).cpu().numpy() # Shape (Batch, Num_points, Num_classes)

                    # Accumulate results for each chunk in the batch
                    for j in range(pred_logits_batch_np.shape[0]):
                        # logits for one model chunk from the batch
                        logits_for_one_model_chunk = pred_logits_batch_np[j] # Shape (num_point_model, NUM_CLASSES)

                        # global indices for the points in this model chunk
                        global_indices_for_this_model_chunk = batch_global_indices_list[j] # Shape (num_point_model,)

                        # Ensure shapes match before accumulation
                        if logits_for_one_model_chunk.shape[0] != num_point_model or global_indices_for_this_model_chunk.shape[0] != num_point_model:
                             log_string(f"Warning: Shape mismatch during accumulation for batch element {j}. Logits shape {logits_for_one_model_chunk.shape}, indices shape {global_indices_for_this_model_chunk.shape}. Skipping.")
                             continue

                        # Accumulate logits and counts using the global indices
                        # This is safe because points in overlapping chunks will just add their logits/counts
                        sum_logits_large[global_indices_for_this_model_chunk] += logits_for_one_model_chunk
                        counts_large[global_indices_for_this_model_chunk] += 1

                    # Clear batch lists for the next batch
                    batch_points_list = []
                    batch_global_indices_list = []

        # Ensure the laspy file handle is closed upon exiting the 'with' block

    except FileNotFoundError:
        log_string(f"ERROR: Input file not found at {args.input_file}")
        sys.exit(1)
    except ImportError as e:
        log_string(f"ERROR: Required library not found: {e}. Please install it.")
        sys.exit(1)
    except Exception as e:
        log_string(f"CRITICAL ERROR during LAS file processing loop: {type(e).__name__}: {e}")
        import traceback
        log_string(traceback.format_exc()) # Log traceback
        sys.exit(1)

    # --- Finalize predictions ---
    log_string("Finalizing predictions by averaging logits...")
    # Find points that were processed at least once
    mask_predicted_at_least_once = counts_large > 0

    # Initialize final predictions array with a placeholder for unpredicted points (-1)
    final_predictions_large = np.full(total_points_large, -1, dtype=np.int32)

    # Calculate predictions only for points that were processed
    if np.sum(mask_predicted_at_least_once) > 0:
        # Get logits and counts only for the points that were processed
        valid_logits = sum_logits_large[mask_predicted_at_least_once]
        valid_counts = counts_large[mask_predicted_at_least_once, np.newaxis] # Add axis for broadcasting

        # Avoid division by zero if somehow a count remained 0 (should not happen with the mask)
        valid_counts[valid_counts == 0] = 1

        # Average the logits and get the predicted class index
        averaged_logits_for_predicted = valid_logits / valid_counts
        predicted_labels_for_processed = np.argmax(averaged_logits_for_predicted, axis=1)

        # Place the predicted labels back into the final predictions array using the mask
        final_predictions_large[mask_predicted_at_least_once] = predicted_labels_for_processed

    unpredicted_count = total_points_large - np.sum(mask_predicted_at_least_once)
    if unpredicted_count > 0:
        log_string(f"Warning: {unpredicted_count} points were not included in any chunk and have no prediction (label -1). This can happen with large strides or edge cases in chunk calculation.")
        # You might want to assign a default label (like 'Unclassified' or a specific 'unpredicted' label)
        # For now, keeping them as -1 is a clear indicator.

    # --- Save results ---
    log_string("Saving prediction results...")
    # Pass the loaded original_xyz_points (which might be None if loading failed)
    save_prediction_results(output_dir, args.input_file, original_xyz_points, final_predictions_large, log_string)


    log_string("--- Full Cloud Inference Finished ---")

if __name__ == '__main__':
    args = parse_args()
    try:
        predict_full_cloud(args)
    except FileNotFoundError as e:
        # Specific handling for file not found during script execution (less likely now with 'with')
        print(f"\nERROR: File/Dir not found during main execution: {e}")
        if logging.getLogger("FullCloudInference").hasHandlers(): logging.exception("FNF Error during main loop:")
    except Exception as e:
        # Catch any other exceptions not handled within the function
        print(f"\nCRITICAL ERROR during script execution: {type(e).__name__}: {e}")
        if logging.getLogger("FullCloudInference").hasHandlers():
             logging.exception("Critical error during main script execution:")
        else:
             # If logger wasn't set up, print traceback to console
             import traceback; traceback.print_exc()
        sys.exit(1) # Exit with a non-zero code to indicate failure