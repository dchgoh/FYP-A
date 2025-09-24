import argparse
import os
# <<< ENSURE CORRECT LOADER IMPORT >>>
# This should point to the file containing the FORInstanceDataset class
# that reads the preprocessed chunks.
from data_utils.FORInstanceDataLoader import FORInstanceDataset
import torch
import logging
from pathlib import Path
import sys
import importlib
from tqdm import tqdm
import numpy as np
import time
import torch.nn as nn # Import nn if needed

# Determine project directories relative to this script file
try:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    BASE_DIR = os.getcwd()
    print(f"Warning: __file__ not defined. Using CWD as BASE_DIR: {BASE_DIR}")
ROOT_DIR = BASE_DIR
sys.path.append(os.path.join(ROOT_DIR, 'models')) # Add models directory

# --- Define YOUR FOR-Instance class mapping ---
# !!! CHECK THIS LIST CAREFULLY to match your data labels !!!
classes = ['Unclassified', 'Low-vegetation', 'Terrain', 'Out-points', 'Stem', 'Live branches', 'Woody branches']
class2label = {cls: i for i, cls in enumerate(classes)}
NUM_CLASSES = len(classes)
seg_classes = class2label
seg_label_to_cat = {i: cat for i, cat in enumerate(classes)} # Reverse mapping

# --- Define Label ID to Ignore in Metrics ---
OUTPOINTS_LABEL_ID = class2label.get('Out-points', -1) # Get ID, default to -1 if not found
if OUTPOINTS_LABEL_ID == -1: print("Warning: 'Out-points' class not found in mapping!")
# Class 0 ('Unclassified') should have been filtered during preprocessing.

# ============================================================================
#                            Argument Parser
# ============================================================================
def parse_args():
    '''PARAMETERS'''
    parser = argparse.ArgumentParser('FOR-Instance Evaluation')
    parser.add_argument('--gpu', type=str, default='0', help='Specify gpu device [default: 0]')
    # --- Arguments specific to loading your model and data ---
    parser.add_argument('--model', type=str, required=True, help='Name of the model file (e.g., pointnet_sem_seg)')
    parser.add_argument('--log_dir', type=str, required=True, help='Path to the training log directory containing checkpoints')
    parser.add_argument('--checkpoint', type=str, default='best_model.pth', help='Checkpoint file name to evaluate [default: best_model.pth]')
    parser.add_argument('--num_point', type=int, default=1024, help='Point Number per sample, MUST match training [default: 1024]')
    parser.add_argument('--batch_size', type=int, default=16, help='Batch size during evaluation [default: 16, smaller often ok for eval]') # Reduced default eval BS
    parser.add_argument('--num_workers', type=int, default=4, help='Number of workers for DataLoader [default: 4]') # Default reasonable for eval
    # <<< CHANGE: Clarify this is the path containing the PREPROCESSED CHUNKS >>>
    parser.add_argument('--data_path', type=str, required=True, help='Path to the root directory containing test_chunks (e.g., /path/to/preprocessed_chunks)')
    # --- Arguments for visualization output ---
    parser.add_argument('--visual', action='store_true', default=False, help='Save results for visualization (.npy files)')
    parser.add_argument('--vis_batches', type=int, default=5, help='Number of batches to save for visualization [default: 5]')

    # Handle potential parsing issues in non-script environments
    if 'google.colab' in sys.modules or 'ipykernel' in sys.modules:
        print("Detected Colab/IPython environment. Parsing known args.")
        args, unknown = parser.parse_known_args()
        if unknown: print(f"Warning: Unknown arguments passed: {unknown}")
        if not args.model: raise ValueError("--model argument is required")
        if not args.log_dir: raise ValueError("--log_dir argument is required")
        if not args.data_path: raise ValueError("--data_path argument is required")
        return args
    else:
        return parser.parse_args()

# ============================================================================
#                            Evaluation Function
# ============================================================================
def evaluate_model(loader, model, num_classes, device, experiment_dir, phase_name="Evaluation",
                   ignore_label_id_metric=-1, # Label ID to ignore for metric calculation (e.g., Outpoints)
                   save_visuals=False, max_vis_batches=3):
    """
    Runs evaluation on a given DataLoader.
    Handles 3 items from loader: points, sem_target, inst_target.
    Calculates metrics excluding ignore_label_id_metric.
    Optionally saves visualization data.
    """
    model.eval() # Set model to evaluation mode

    # Initialize accumulators for metrics
    total_correct_sem_masked = 0 # Correct semantic predictions (masked)
    total_seen_masked = 0        # Total points seen (masked)
    total_seen_class_masked = np.zeros(num_classes, dtype=np.int64) # Seen count per class (masked)
    total_correct_class_masked = np.zeros(num_classes, dtype=np.int64) # Intersection per class (masked)
    total_iou_deno_class_masked = np.zeros(num_classes, dtype=np.int64) # Union denominator per class (masked)

    # --- Setup visualization directory ---
    visual_dir = None
    if save_visuals:
        vis_output_name = f'visual_{phase_name.lower().replace(" ", "_")}_{time.strftime("%Y%m%d_%H%M%S")}'
        # <<< CHANGE: Save visuals inside the *original* log_dir (experiment_dir) passed >>>
        visual_dir = Path(experiment_dir) / vis_output_name
        visual_dir.mkdir(exist_ok=True)
        print(f"Saving visualization files to: {visual_dir}")

    iterator = tqdm(loader, desc=f"{phase_name}", unit="batch", leave=True) # leave=True for final eval
    with torch.no_grad():
        for i, batch_data in enumerate(iterator):
            if batch_data is None:
                print(f"W: Skipped None batch {i} in {phase_name}"); continue
            try:
                # === UNPACK THREE ITEMS from DataLoader ===
                points, target_semantic, target_instance = batch_data
                # points shape (B, N, C=6), target_semantic/instance shape (B, N)
            except ValueError:
                print(f"E: Failed unpack batch {i} in {phase_name}, expected 3 items. Skipping."); continue

            points_dev = points.float().to(device, non_blocking=True)
            target_semantic_dev = target_semantic.long().to(device, non_blocking=True)

            # Transpose points for model: B, N, C -> B, C, N
            points_dev_t = points_dev.transpose(2, 1) # Shape: (B, 6, N)

            try: # Forward pass
                output = model(points_dev_t)
                if isinstance(output, tuple) and len(output) == 2: seg_pred, trans_feat = output
                else: seg_pred = output; trans_feat = None
                # seg_pred shape is expected to be (B, N, NUM_CLASSES) after model's final transpose/softmax
                # If model returns (B, NUM_CLASSES, N), adjust prediction logic below
            except Exception as e:
                 print(f"E: Forward pass failed on batch {i}: {e}"); continue

            # --- Calculate Semantic Metrics (Masking Ignored Label) ---
            # Check shape of seg_pred - it should be (B, N, K) after softmax in the model provided
            if seg_pred.shape[1] != args.num_point or seg_pred.shape[2] != num_classes:
                 # If shape is (B, K, N) adjust argmax dim
                 if seg_pred.shape[1] == num_classes and seg_pred.shape[2] == args.num_point:
                      pred_val = seg_pred.contiguous().argmax(dim=1) # Argmax over dim 1 (NUM_CLASSES)
                 else:
                      print(f"E: Unexpected prediction shape {seg_pred.shape} in batch {i}. Skipping metrics.")
                      continue
            else: # Expected shape (B, N, K)
                 pred_val = seg_pred.contiguous().argmax(dim=2) # Argmax over dim 2 (NUM_CLASSES)

            target_semantic_np = target_semantic.cpu().numpy().flatten() # (B*N,)
            pred_val_np = pred_val.cpu().numpy().flatten()           # (B*N,)

            eval_mask = target_semantic_np != ignore_label_id_metric

            target_semantic_masked_np = target_semantic_np[eval_mask]
            pred_val_masked_np = pred_val_np[eval_mask]

            if target_semantic_masked_np.size == 0: continue

            correct_masked = np.sum(pred_val_masked_np == target_semantic_masked_np)
            total_correct_sem_masked += correct_masked
            total_seen_masked += target_semantic_masked_np.size

            for l in range(num_classes):
                 if l == ignore_label_id_metric: continue
                 iou_deno_mask = (pred_val_masked_np == l) | (target_semantic_masked_np == l)
                 iou_inter_mask = (pred_val_masked_np == l) & (target_semantic_masked_np == l)
                 seen_mask = (target_semantic_masked_np == l)
                 total_iou_deno_class_masked[l] += np.sum(iou_deno_mask)
                 total_correct_class_masked[l] += np.sum(iou_inter_mask)
                 total_seen_class_masked[l] += np.sum(seen_mask)

            # --- Save visualization data ---
            if save_visuals and i < max_vis_batches:
                points_to_save = points.cpu().numpy() # B, N, C
                target_sem_to_save = target_semantic.cpu().numpy() # B, N
                pred_to_save = pred_val.cpu().numpy()   # B, N

                for sample_idx in range(points.shape[0]):
                    base_filename = f'batch_{i}_sample_{sample_idx}'
                    points_filename = visual_dir / f'{base_filename}_points.npy'
                    gt_sem_filename = visual_dir / f'{base_filename}_gt_sem.npy'
                    pred_sem_filename = visual_dir / f'{base_filename}_pred_sem.npy'
                    try:
                        np.save(str(points_filename), points_to_save[sample_idx][:, :3]) # Save XYZ only
                        np.save(str(gt_sem_filename), target_sem_to_save[sample_idx])
                        np.save(str(pred_sem_filename), pred_to_save[sample_idx])
                    except Exception as e: print(f"W: Failed save vis files batch {i}, sample {sample_idx}: {e}")


    # --- Calculate Final Metrics ---
    print("\nCalculating final metrics (excluding ignored label where specified)...")
    overall_acc_masked = total_correct_sem_masked / float(total_seen_masked) if total_seen_masked > 0 else 0.0
    with np.errstate(divide='ignore', invalid='ignore'):
        iou_per_class = total_correct_class_masked / total_iou_deno_class_masked.astype(float)
        acc_per_class = total_correct_class_masked / total_seen_class_masked.astype(float)
    iou_per_class = np.nan_to_num(iou_per_class)
    acc_per_class = np.nan_to_num(acc_per_class)
    valid_class_indices = [l for l in range(num_classes) if l != ignore_label_id_metric]
    if not valid_class_indices: mIoU = 0.0; mAcc = 0.0
    else: mIoU = np.mean(iou_per_class[valid_class_indices]); mAcc = np.mean(acc_per_class[valid_class_indices])
    label_weights_masked = total_seen_class_masked.astype(np.float32)
    total_masked_seen_count = np.sum(label_weights_masked)
    if total_masked_seen_count > 0: label_weights_masked /= total_masked_seen_count

    return (overall_acc_masked, mAcc, mIoU,
            iou_per_class, acc_per_class,
            label_weights_masked, total_seen_class_masked,
            visual_dir)

# ============================================================================
#                                Main Function
# ============================================================================
def main(args):
    # --- Basic Setup & Logging ---
    # <<< CHANGE: Log directory is passed via args, visuals saved within it >>>
    experiment_dir = Path(args.log_dir)
    if not experiment_dir.is_dir():
         print(f"ERROR: Log directory specified (--log_dir) not found: {args.log_dir}")
         sys.exit(1)

    # Setup logger to log to file within the *existing* log_dir
    log_dir_path = experiment_dir / 'logs/' # Log within the specified log_dir
    log_dir_path.mkdir(exist_ok=True)
    logger = logging.getLogger("Evaluation")
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    eval_log_file = log_dir_path / f'evaluation_{args.model}_{Path(args.checkpoint).stem}_{time.strftime("%Y%m%d_%H%M%S")}.txt'
    file_handler = logging.FileHandler(str(eval_log_file))
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    if not logger.handlers:
        logger.addHandler(file_handler)
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    def log_string(str_msg): logger.info(str_msg)

    log_string('---------------- EVALUATION PARAMETERS ----------------')
    log_string(f"Command: {' '.join(sys.argv)}")
    log_string(f"Args: {args}")
    log_string('-------------------------------------------------------')

    '''GPU SETUP'''
    os.environ["CUDA_VISIBLE_DEVICES"] = args.gpu
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log_string(f"Using device: {device}")
    if str(device) == "cpu": log_string("WARNING: CUDA not available, running on CPU.")
    log_string(f"Number of semantic classes: {NUM_CLASSES}")
    log_string(f"Ignoring label ID in metrics: {OUTPOINTS_LABEL_ID} ('{seg_label_to_cat.get(OUTPOINTS_LABEL_ID, 'Unknown')}')")


    '''DATA LOADING (Test Set Only using Chunked Loader)'''
    log_string("\nLoading TEST dataset using Chunked Loader...")
    # <<< CHANGE: Use the provided data_path, assuming it points to the root of chunk dirs >>>
    chunk_data_path = Path(args.data_path)
    log_string(f"Looking for test chunks in subdirectories of: {chunk_data_path}")

    if not chunk_data_path.is_dir():
        log_string(f"ERROR: Chunk data directory specified by --data_path not found: '{chunk_data_path}'")
        sys.exit(1)

    test_transforms = None # Add transforms if needed
    try:
        # --- Instantiate the MODIFIED FORInstanceDataset for CHUNKS ---
        TEST_DATASET = FORInstanceDataset(
            split='test', # Use 'test' split
            data_root=str(chunk_data_path), # Pass the path containing test_chunks
            num_point=args.num_point,
            transform=test_transforms,
            unclassified_label_id=0, # Needed for weight calculation consistency
            # chunk_subdir_pattern="{}_chunks" # Assuming default name
            )
    except FileNotFoundError as e:
        log_string(f"ERROR: Test chunks directory not found: {e}")
        log_string(f"Ensure '{chunk_data_path / 'test_chunks'}' exists and contains valid HDF5 files.")
        sys.exit(1)
    except Exception as e:
        log_string(f"ERROR loading test dataset from chunks in {chunk_data_path}: {e}"); sys.exit(1)

    testDataLoader = torch.utils.data.DataLoader(
        TEST_DATASET, batch_size=args.batch_size, shuffle=False, num_workers=args.num_workers,
        pin_memory=True, drop_last=False
    )
    log_string(f"Test samples (based on total points / num_point): {len(TEST_DATASET)}")
    log_string(f"Test batches: {len(testDataLoader)}")


    '''MODEL LOADING'''
    model_name = args.model
    log_string(f"\nLoading model architecture: {model_name}")
    try: MODEL = importlib.import_module(model_name)
    except ImportError: log_string(f"ERROR: Could not import model '{model_name}'."); sys.exit(1)

    try: # Instantiate model
        # <<< MAKE SURE this matches the channel change made for training >>>
        classifier = MODEL.get_model(num_classes=NUM_CLASSES).to(device)
    except AttributeError as e: log_string(f"ERROR: Model missing get_model(): {e}"); sys.exit(1)
    except Exception as e: log_string(f"ERROR: Failed init model '{model_name}': {e}"); sys.exit(1)

    '''LOAD CHECKPOINT'''
    checkpoint_filename = args.checkpoint
    checkpoint_path = Path(args.log_dir) / 'checkpoints' / checkpoint_filename # Path based on log_dir arg
    if not checkpoint_path.exists():
        log_string(f"ERROR: Checkpoint file not found: {checkpoint_path}"); sys.exit(1)

    log_string(f"Loading model state from checkpoint: {checkpoint_path}")
    try:
        checkpoint = torch.load(str(checkpoint_path), map_location=device, weights_only=False)
        classifier.load_state_dict(checkpoint['model_state_dict'])
        log_string("Model state loaded successfully.")
        trained_epoch = checkpoint.get('epoch', -1)
        log_string(f"(Checkpoint saved at end of epoch {trained_epoch + 1})")
    except Exception as e:
        log_string(f"ERROR loading checkpoint state from {checkpoint_path}: {e}"); sys.exit(1)


    '''RUN EVALUATION'''
    log_string("\n--- Starting Evaluation on TEST set ---")
    (test_acc_masked, test_mAcc_masked, test_mIoU_masked,
     test_iou_per_class, test_acc_per_class,
     test_label_weights_masked, test_seen_per_class_masked,
     visual_dir) = evaluate_model(
        testDataLoader, classifier, NUM_CLASSES, device,
        experiment_dir=Path(args.log_dir), # Pass the log_dir Path object
        phase_name="Final Test",
        ignore_label_id_metric=OUTPOINTS_LABEL_ID,
        save_visuals=args.visual,
        max_vis_batches=args.vis_batches
    )

    # --- Log Final Results ---
    log_string(f'\n------- FINAL TEST RESULTS (Metrics exclude Class {OUTPOINTS_LABEL_ID}) -------')
    log_string(f'  Overall Accuracy (masked):  {test_acc_masked:.6f}')
    log_string(f'  Mean Class Acc (masked):    {test_mAcc_masked:.6f}')
    log_string(f'  Mean IoU (mIoU) (masked):   {test_mIoU_masked:.6f}')
    log_string('------- IoU Per Class --------')
    for l in range(NUM_CLASSES):
        class_name = seg_label_to_cat.get(l, f'Class {l}')
        iou_val = test_iou_per_class[l]
        acc_val = test_acc_per_class[l]
        seen_val = test_seen_per_class_masked[l]
        weight_val = test_label_weights_masked[l]
        ignored_str = "(Ignored in mIoU)" if l == OUTPOINTS_LABEL_ID else ""
        log_string(f'  {l}: {class_name:<15}: IoU={iou_val:.4f}, Acc={acc_val:.4f} (Seen={seen_val}, Weight={weight_val:.3f}) {ignored_str}')
    log_string('--------------------------------')

    if args.visual and visual_dir:
        log_string(f"Visualization files saved in: {visual_dir}")

    log_string("--- Evaluation Finished ---")


if __name__ == '__main__':
    args = parse_args()
    try: main(args)
    except FileNotFoundError as e: 
        print(f"\nERROR: File/Dir not found: {e}")
        if logging.getLogger("Evaluation").hasHandlers(): logging.exception("FNF Error:")
    except Exception as e: 
        print(f"\nCRITICAL ERROR: {type(e).__name__}: {e}")
        if logging.getLogger("Evaluation").hasHandlers(): logging.exception("Critical error:") 
        else: import traceback; traceback.print_exc()