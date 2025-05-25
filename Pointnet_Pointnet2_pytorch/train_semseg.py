import argparse
import os
# <<< MAKE SURE THIS IMPORTS THE *CHUNKED* DATALOADER VERSION >>>
from data_utils.FORInstanceDataLoader import FORInstanceDataset # Assumes this file contains the chunked loader
import torch
import datetime
import logging
from pathlib import Path
import sys
import importlib
import shutil
from tqdm import tqdm
import provider # Assuming provider.py contains necessary functions like rotate_point_cloud_z
import numpy as np
import time
import torch.nn as nn # Import nn for checking loss base class potentially

# <<< ADD TENSORBOARD IMPORT >>>
from torch.utils.tensorboard import SummaryWriter

# Determine project directories relative to this script file
# Check if running in a standard environment or Colab/notebook
try:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    # __file__ is not defined, likely running in an interactive environment (Colab, Jupyter)
    BASE_DIR = os.getcwd() # Use current working directory
    print(f"Warning: __file__ not defined. Using current working directory as BASE_DIR: {BASE_DIR}")

ROOT_DIR = BASE_DIR
sys.path.append(os.path.join(ROOT_DIR, 'models')) # Add models directory to Python path

# Define class mapping (Ensure this matches your dataset's labels)
# !!! CHECK THIS LIST CAREFULLY !!!
classes = ['Unclassified', 'Low-vegetation', 'Terrain', 'Out-points', 'Stem', 'Live branches', 'Woody branches']
class2label = {cls: i for i, cls in enumerate(classes)}
NUM_CLASSES = len(classes) # Should be 7
seg_classes = class2label
seg_label_to_cat = {i: cat for i, cat in enumerate(classes)} # Reverse mapping for logging

# --- Define Labels to Ignore ---
# Class 0 ('Unclassified') is filtered in the DataLoader
OUTPOINTS_LABEL_ID = class2label['Out-points'] # Should be 3
print(f"Configuration: Number of semantic classes: {NUM_CLASSES}")
print(f"Configuration: 'Out-points' label ID to ignore in loss: {OUTPOINTS_LABEL_ID}")

def inplace_relu(m):
    """Applies inplace ReLU to compatible layers."""
    classname = m.__class__.__name__
    if classname.find('ReLU') != -1:
        m.inplace=True

def parse_args():
    # Set default log_dir to None
    parser = argparse.ArgumentParser('PointNet Semantic Segmentation')
    parser.add_argument('--model', type=str, default='pointnet_sem_seg', help='model name [default: pointnet_sem_seg]')
    parser.add_argument('--batch_size', type=int, default=8, help='Batch Size during training [default: 8]')
    parser.add_argument('--epoch', default=32, type=int, help='Epoch to run [default: 32]')
    parser.add_argument('--learning_rate', default=0.001, type=float, help='Initial learning rate [default: 0.001]')
    parser.add_argument('--gpu', type=str, default='0', help='GPU to use [default: GPU 0]')
    parser.add_argument('--optimizer', type=str, default='Adam', help='Adam or SGD [default: Adam]')
    parser.add_argument('--log_dir', type=str, default=None, help='Log path relative to ./log/sem_seg/ [default: timestamp based]')
    parser.add_argument('--decay_rate', type=float, default=1e-4, help='weight decay [default: 1e-4]')
    parser.add_argument('--npoint', type=int, default=1024, help='Point Number per sample [default: 1024]')
    parser.add_argument('--step_size', type=int, default=10, help='Decay step for lr decay [default: every 10 epochs]')
    parser.add_argument('--lr_decay', type=float, default=0.7, help='Decay rate for lr decay [default: 0.7]')
    parser.add_argument('--debug_single_block', type=str, default=None,
                        help='Path (or filename in train_blocks) of a single HDF5 block for debugging.') # <<< Less relevant now >>>
    parser.add_argument('--num_workers', type=int, default=2, help='Number of workers for DataLoader [default: 2, adjust based on system]') # Reduced default
    parser.add_argument('--save_period', type=int, default=5, help='Save periodic checkpoint every N epochs [default: 5]')
    # <<< CHANGE: Description clarifies this path >>>
    parser.add_argument('--data_path', type=str, required=True,
                        help='Path to the BASE directory containing original LAS/metadata AND the preprocessed_chunks subdir.')

    # Detect if running in Colab/IPython and adjust default arguments if needed
    if 'google.colab' in sys.modules or 'ipykernel' in sys.modules:
        print("Detected Colab/IPython environment. Overriding args to use defaults or Colab specifics.")
        args, unknown = parser.parse_known_args()
        if unknown: print(f"Warning: Unknown arguments passed: {unknown}")
        return args
    else:
        return parser.parse_args()


# --- Evaluation Function (Unchanged from previous version) ---
def evaluate_model(loader, model, criterion, weights, num_classes, device, args, phase_name="Evaluation"):
    """Runs evaluation on a given DataLoader (Handles 3 items: points, sem_target, inst_target)."""
    model.eval() # Set model to evaluation mode
    total_sem_loss = 0.0
    total_correct_sem = 0
    total_seen = 0
    total_seen_class = np.zeros(num_classes, dtype=np.int64)
    total_correct_class = np.zeros(num_classes, dtype=np.int64) # Intersection (semantic)
    total_iou_deno_class = np.zeros(num_classes, dtype=np.int64) # Union (semantic)
    report_loss = criterion is not None

    ignore_label_id_eval = OUTPOINTS_LABEL_ID

    iterator = tqdm(loader, desc=f"{phase_name}", unit="batch", leave=False)
    with torch.no_grad():
        for i, batch_data in enumerate(iterator):
            if batch_data is None: continue
            try:
                points, target_semantic, target_instance = batch_data
            except ValueError:
                print(f"ERROR: {phase_name} loader yielded unexpected number of items (expected 3). Skipping batch {i}.")
                continue

            points = points.float().to(device, non_blocking=True)
            target_semantic = target_semantic.long().to(device, non_blocking=True)

            points = points.transpose(2, 1)

            try:
                output = model(points)
                if isinstance(output, tuple) and len(output) == 2: seg_pred, trans_feat = output
                else: seg_pred = output; trans_feat = None
            except Exception as e:
                 print(f"ERROR during {phase_name} forward pass (batch {i}): {e}"); continue

            if report_loss:
                seg_pred_flat = seg_pred.contiguous().view(-1, num_classes)
                target_semantic_flat = target_semantic.view(-1)
                try:
                    loss_mask_eval = target_semantic_flat != ignore_label_id_eval
                    if loss_mask_eval.sum() > 0:
                         # Ensure criterion handles weights argument if provided
                         if isinstance(criterion, nn.NLLLoss): # NLLLoss uses 'weight' argument
                             loss = criterion(seg_pred_flat[loss_mask_eval], target_semantic_flat[loss_mask_eval], weight=weights)
                         else: # Assume custom loss function handles weights internally or via trans_feat
                             loss = criterion(seg_pred_flat[loss_mask_eval], target_semantic_flat[loss_mask_eval], trans_feat, weights)
                         total_sem_loss += loss.item()
                except Exception as e: print(f"W: Could not calculate {phase_name} loss (batch {i}): {e}")

            # Check shape of seg_pred - it should be (B, N, K) after softmax in the model provided
            if seg_pred.shape[1] != args.npoint or seg_pred.shape[2] != num_classes:
                # If shape is (B, K, N) adjust argmax dim
                if seg_pred.shape[1] == num_classes and seg_pred.shape[2] == args.num_point:
                     pred_val = seg_pred.contiguous().argmax(dim=1) # Argmax over dim 1 (NUM_CLASSES)
                else:
                     print(f"E: Unexpected prediction shape {seg_pred.shape} in batch {i}. Skipping metrics.")
                     continue
            else: # Expected shape (B, N, K)
                 pred_val = seg_pred.contiguous().argmax(dim=2) # Argmax over dim 2 (NUM_CLASSES)

            target_semantic_np = target_semantic.cpu().numpy().flatten()
            pred_val_np = pred_val.cpu().numpy().flatten()
            eval_mask = target_semantic_np != ignore_label_id_eval
            target_semantic_masked_np = target_semantic_np[eval_mask]
            pred_val_masked_np = pred_val_np[eval_mask]

            if target_semantic_masked_np.size == 0: continue

            correct_masked = np.sum(pred_val_masked_np == target_semantic_masked_np)
            total_correct_sem += correct_masked
            total_seen += target_semantic_masked_np.size

            for l in range(num_classes):
                 if l == ignore_label_id_eval: continue
                 iou_deno_mask = (pred_val_masked_np == l) | (target_semantic_masked_np == l)
                 iou_inter_mask = (pred_val_masked_np == l) & (target_semantic_masked_np == l)
                 seen_mask = (target_semantic_masked_np == l)
                 total_iou_deno_class[l] += np.sum(iou_deno_mask)
                 total_correct_class[l] += np.sum(iou_inter_mask)
                 total_seen_class[l] += np.sum(seen_mask)

    avg_loss = total_sem_loss / len(loader) if report_loss and len(loader) > 0 else -1.0
    overall_acc = total_correct_sem / float(total_seen) if total_seen > 0 else 0.0

    with np.errstate(divide='ignore', invalid='ignore'):
        iou_per_class = total_correct_class / total_iou_deno_class.astype(float)
        acc_per_class = total_correct_class / total_seen_class.astype(float)

    iou_per_class = np.nan_to_num(iou_per_class)
    acc_per_class = np.nan_to_num(acc_per_class)

    valid_class_indices = [l for l in range(num_classes) if l != ignore_label_id_eval]
    if not valid_class_indices: mIoU = 0.0; mAcc = 0.0
    else: mIoU = np.mean(iou_per_class[valid_class_indices]); mAcc = np.mean(acc_per_class[valid_class_indices])

    label_weights = total_seen_class.astype(np.float32)

    return avg_loss, overall_acc, mAcc, mIoU, iou_per_class, label_weights, total_seen_class

# ============================================================================

def main(args):

    # --- Directory Creation ---
    timestr = str(datetime.datetime.now().strftime('%Y-%m-%d_%H-%M'))
    experiment_dir = Path('./log/')
    experiment_dir.mkdir(exist_ok=True)
    experiment_dir = experiment_dir.joinpath('sem_seg')
    experiment_dir.mkdir(exist_ok=True)
    if args.log_dir is None:
        exp_name = timestr
        experiment_dir = experiment_dir.joinpath(exp_name)
    else:
        exp_name = args.log_dir.replace(" ", "_").strip()
        if not exp_name: exp_name = timestr
        experiment_dir = experiment_dir.joinpath(exp_name)
    experiment_dir.mkdir(exist_ok=True) # Create experiment dir

    checkpoints_dir = experiment_dir.joinpath('checkpoints/')
    checkpoints_dir.mkdir(exist_ok=True)
    log_dir_path = experiment_dir.joinpath('logs/')
    log_dir_path.mkdir(exist_ok=True)

    # --- Logging Setup ---
    logger = logging.getLogger("Model")
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    log_file = log_dir_path / f'{args.model}_{experiment_dir.name}.txt'
    file_handler = logging.FileHandler(str(log_file))
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    if not logger.handlers:
        logger.addHandler(file_handler)
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    def log_string(str_msg): logger.info(str_msg)

    # <<< INITIALIZE TENSORBOARD WRITER >>>
    tb_log_dir = experiment_dir / 'runs' # Changed from 'tensorboard_logs' to 'runs' (conventional)
    tb_log_dir.mkdir(exist_ok=True) # Ensure the directory exists
    writer = SummaryWriter(log_dir=str(tb_log_dir))
    log_string(f"TensorBoard logs will be saved to: {tb_log_dir}")
    # <<< END INITIALIZATION >>>


    # <<< CHANGE: Construct and Validate CHUNK Data Path >>>
    log_string(f"Base data path provided: {args.data_path}")
    chunk_data_path = Path(args.data_path) / "preprocessed_chunks" # Adjust if needed
    log_string(f"Attempting to use chunk data from: {chunk_data_path}")
    if not chunk_data_path.is_dir():
        log_string(f"ERROR: Preprocessed chunk directory not found at: '{chunk_data_path}'"); sys.exit(1)
    train_chunks_dir = chunk_data_path / 'train_chunks'
    if not train_chunks_dir.is_dir(): log_string(f"WARNING: 'train_chunks' dir not found under '{chunk_data_path}'.")
    # -------------------------------------------------------------

    # --- Device Setup ---
    os.environ["CUDA_VISIBLE_DEVICES"] = args.gpu
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log_string(f"Using device: {device}")
    if str(device) == "cpu": log_string("WARNING: CUDA not available, running on CPU.")

    log_string('---------------- PARAMETERS ----------------')
    log_string(f"Args: {args}")
    log_string('--------------------------------------------')
    log_string(f"Number of semantic classes: {NUM_CLASSES}")
    log_string(f"Class mapping: {class2label}")
    log_string(f"'Outpoints' label ID (ignored in train loss): {OUTPOINTS_LABEL_ID}")

    # --- Data Loading ---
    log_string('Loading datasets...')
    train_transforms = None; val_transforms = None

    # --- Initialize Training Dataset ---
    if args.debug_single_block: log_string("--- WARNING: Debug single block mode ignored when using chunked data loader ---")
    log_string(f"--- NORMAL MODE: Loading 'train' chunks ---")
    try:
        TRAIN_DATASET = FORInstanceDataset(data_root=str(chunk_data_path), split='train', num_point=args.npoint, transform=train_transforms, unclassified_label_id=0)
    except Exception as e: log_string(f"ERROR loading training dataset from chunks: {e}"); sys.exit(1)

    log_string("Loading validation data...")
    try:
        VAL_DATASET = FORInstanceDataset(data_root=str(chunk_data_path), split='val', num_point=args.npoint, transform=val_transforms, unclassified_label_id=0)
    except FileNotFoundError as e: log_string(f"ERROR: Validation chunks not found: {e}. Ensure '{chunk_data_path / 'val_chunks'}' exists."); sys.exit(1)
    except Exception as e: log_string(f"Error loading validation dataset from chunks: {e}"); sys.exit(1)

    log_string("Skipping Test dataset loading in training script.")

    # --- Create DataLoaders ---
    trainDataLoader = torch.utils.data.DataLoader(TRAIN_DATASET, batch_size=args.batch_size, shuffle=True, num_workers=args.num_workers, pin_memory=True, drop_last=True, worker_init_fn=lambda x: np.random.seed(x + int(time.time())))
    valDataLoader = torch.utils.data.DataLoader(VAL_DATASET, batch_size=args.batch_size, shuffle=False, num_workers=args.num_workers, pin_memory=True, drop_last=False)

    log_string(f"Training samples per epoch (dataset len): {len(TRAIN_DATASET)}")
    log_string(f"Training batches per epoch (loader len): {len(trainDataLoader)}")
    log_string(f"Validation samples (dataset len): {len(VAL_DATASET)}")
    log_string(f"Validation batches (loader len): {len(valDataLoader)}")

    # --- Get Weights, Model Loading, Checkpointing (Mostly Unchanged) ---
    try: weights = TRAIN_DATASET.class_weights.to(device); log_string(f"Using class weights: {weights.cpu().numpy()}"); assert len(weights) == NUM_CLASSES
    except Exception as e: log_string(f"WARN/ERROR getting class weights: {e}. Using equal weights."); weights = torch.ones(NUM_CLASSES, device=device, dtype=torch.float)

    log_string(f"Loading model: {args.model}")
    try: MODEL = importlib.import_module(args.model); model_source_path = Path(MODEL.__file__); shutil.copy(str(model_source_path), str(experiment_dir)); log_string(f"Copied model definition from {model_source_path}")
    except Exception as e: log_string(f"Warning: Could not copy model/utils files: {e}")
    try: classifier = MODEL.get_model(num_classes=NUM_CLASSES).to(device); criterion = MODEL.get_loss().to(device); log_string(f"Model '{args.model}' loaded.")
    except Exception as e: log_string(f"ERROR: Failed init model/loss: {e}"); sys.exit(1)
    try: classifier.apply(inplace_relu)
    except Exception as e: log_string(f"Warning: Could not apply inplace ReLU: {e}")

    def weights_init(m): # (Unchanged)
        classname = m.__class__.__name__; is_conv = classname.find('Conv') != -1; is_linear = classname.find('Linear') != -1; is_batchnorm = classname.find('BatchNorm') != -1
        if hasattr(m, 'weight') and m.weight is not None:
            if is_conv or is_linear: torch.nn.init.xavier_normal_(m.weight.data)
            elif is_batchnorm: torch.nn.init.constant_(m.weight.data, 1.0)
        if hasattr(m, 'bias') and m.bias is not None: torch.nn.init.constant_(m.bias.data, 0.0)

    start_epoch = 0; best_val_iou = 0.0; optimizer = None; scheduler = None
    last_periodic_checkpoint_path = checkpoints_dir / 'model.pth'
    best_checkpoint_path = checkpoints_dir / 'best_model.pth'
    checkpoint_to_load = None
    if last_periodic_checkpoint_path.exists(): checkpoint_to_load = last_periodic_checkpoint_path; log_string(f"Found last periodic ckpt: {checkpoint_to_load}")
    if best_checkpoint_path.exists():
        if checkpoint_to_load is None or best_checkpoint_path.stat().st_mtime > checkpoint_to_load.stat().st_mtime:
             checkpoint_to_load = best_checkpoint_path; log_string(f"Found newer/only best ckpt: {checkpoint_to_load}")
    if not checkpoint_to_load: log_string("No checkpoints found.")

    if checkpoint_to_load:
        try:
            log_string(f"Loading checkpoint: {checkpoint_to_load}")
            checkpoint = torch.load(str(checkpoint_to_load), map_location=device, weights_only=False)
            saved_epoch_index = checkpoint.get('epoch', -1); start_epoch = saved_epoch_index + 1
            log_string(f"  Attempting resume from epoch: {start_epoch + 1}")
            classifier.load_state_dict(checkpoint['model_state_dict']); log_string(f"  Model state loaded.")
            if args.optimizer.lower() == 'adam': optimizer = torch.optim.Adam(classifier.parameters(), lr=args.learning_rate, weight_decay=args.decay_rate)
            else: optimizer = torch.optim.SGD(classifier.parameters(), lr=args.learning_rate, momentum=0.9, weight_decay=args.decay_rate)
            if 'optimizer_state_dict' in checkpoint: optimizer.load_state_dict(checkpoint['optimizer_state_dict']); log_string("  Optimizer state loaded.")
            else: log_string("  WARNING: Optimizer state not found in checkpoint.")
            scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=args.step_size, gamma=args.lr_decay)
            if 'scheduler_state_dict' in checkpoint: scheduler.load_state_dict(checkpoint['scheduler_state_dict']); log_string("  Scheduler state loaded.")
            else: log_string("  WARNING: Scheduler state not found in checkpoint.")
            best_val_iou = checkpoint.get('class_avg_iou', 0.0); log_string(f"  Best Val mIoU from ckpt: {best_val_iou:.6f}")
        except Exception as e: log_string(f'ERROR loading ckpt {checkpoint_to_load}: {e}. Starting fresh.'); start_epoch = 0; best_val_iou = 0.0; classifier.apply(weights_init); optimizer = None; scheduler = None
    else: log_string('No existing checkpoint found. Starting fresh.'); classifier.apply(weights_init)

    if optimizer is None:
        log_string("Initializing optimizer (final check)...")
        if args.optimizer.lower() == 'adam': optimizer = torch.optim.Adam(classifier.parameters(), lr=args.learning_rate, weight_decay=args.decay_rate)
        else: optimizer = torch.optim.SGD(classifier.parameters(), lr=args.learning_rate, momentum=0.9, weight_decay=args.decay_rate)
    if scheduler is None:
        log_string("Initializing scheduler (final check)...")
        scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=args.step_size, gamma=args.lr_decay)
    if start_epoch > 0 and checkpoint_to_load and ('scheduler_state_dict' not in checkpoint):
        log_string(f"Manually adjusting LR scheduler to epoch {start_epoch}."); [scheduler.step() for _ in range(start_epoch)]; log_string(f"Current LR: {scheduler.get_last_lr()[0]:.6f}")
    elif start_epoch > 0: log_string(f"Current LR from scheduler: {scheduler.get_last_lr()[0]:.6f}")

    def bn_momentum_adjust(m, momentum): # (Unchanged)
        if isinstance(m, (torch.nn.BatchNorm1d, torch.nn.BatchNorm2d, torch.nn.BatchNorm3d)): m.momentum = momentum
    LEARNING_RATE_CLIP = 1e-5; MOMENTUM_ORIGINAL = 0.1; MOMENTUM_DECAY = 0.5; MOMENTUM_DECAY_STEP = args.step_size

    # =========================== TRAINING LOOP ==========================
    log_string(f"--- Starting Training from Epoch {start_epoch + 1} ---")
    for epoch in range(start_epoch, args.epoch):
        epoch_num = epoch + 1
        log_string(f'**** Epoch {epoch_num} ({epoch_num}/{args.epoch}) ****')

        # --- Log LR & Update BN Momentum ---
        current_lr = optimizer.param_groups[0]['lr'] # Get LR before scheduler.step()
        log_string(f'Current Learning rate: {current_lr:.6f}')
        # <<< TENSORBOARD: Log LR >>>
        writer.add_scalar('LearningRate', current_lr, global_step=epoch_num)
        momentum = max(MOMENTUM_ORIGINAL * (MOMENTUM_DECAY ** (epoch // MOMENTUM_DECAY_STEP)), 0.01)
        log_string(f'BN momentum updated to: {momentum:.6f}')
        classifier.apply(lambda x: bn_momentum_adjust(x, momentum))

        # --- Training Step ---
        epoch_train_loss = 0.0; epoch_train_correct_sem = 0; epoch_train_seen = 0
        num_train_batches = len(trainDataLoader)
        classifier.train()
        train_iterator = tqdm(trainDataLoader, desc=f"Epoch {epoch_num} Train", unit="batch", leave=False)

        for i, batch_data in enumerate(train_iterator):
            # --- Training Batch Loop (Keep your optimized logic here) ---
            if batch_data is None: log_string(f"W: Skipped None train batch {i}"); continue
            try: points, target_semantic, target_instance = batch_data
            except ValueError: log_string(f"W: Failed unpack train batch {i}. Skip."); continue

            points = points.float().to(device, non_blocking=True)
            target_semantic = target_semantic.long().to(device, non_blocking=True)

            points_np = points.cpu().numpy()
            if 'provider' in sys.modules and hasattr(provider, 'rotate_point_cloud_z'):
                 points_np = provider.rotate_point_cloud_z(points_np)
            points = torch.from_numpy(points_np).to(device, non_blocking=True)
            points = points.transpose(2, 1)

            optimizer.zero_grad()
            try:
                output = classifier(points)
                if isinstance(output, tuple) and len(output) == 2: seg_pred, trans_feat = output
                else: seg_pred = output; trans_feat = None
            except Exception as e: log_string(f"E: Fwd pass fail batch {i}: {e}"); continue

            seg_pred_flat = seg_pred.contiguous().view(-1, NUM_CLASSES)
            target_semantic_flat = target_semantic.view(-1)

            try:
                loss_mask = target_semantic_flat != OUTPOINTS_LABEL_ID
                if loss_mask.sum() == 0: semantic_loss = torch.tensor(0.0, device=device, requires_grad=True)
                else:
                     # Pass weights based on criterion type
                     if isinstance(criterion, nn.NLLLoss): # Check if it's standard NLLLoss
                          semantic_loss = criterion(seg_pred_flat[loss_mask], target_semantic_flat[loss_mask], weight=weights)
                     else: # Assume custom loss handles weights differently
                          semantic_loss = criterion(seg_pred_flat[loss_mask], target_semantic_flat[loss_mask], trans_feat, weights)

                instance_loss = torch.tensor(0.0, device=device) # Placeholder
                total_loss = semantic_loss + instance_loss
            except Exception as e: log_string(f"E: Loss calc fail batch {i}: {e}"); continue

            try: total_loss.backward(); optimizer.step()
            except Exception as e: log_string(f"E: Bwd/step fail batch {i}: {e}"); continue

            pred_choice = seg_pred_flat.argmax(dim=1); correct_sem = (pred_choice == target_semantic_flat).sum().item()
            epoch_train_correct_sem += correct_sem; epoch_train_seen += target_semantic_flat.size(0)
            current_batch_loss = total_loss.item(); epoch_train_loss += current_batch_loss
            train_iterator.set_postfix(loss=f"{current_batch_loss:.4f}", sem_loss=f"{semantic_loss.item():.4f}", acc=f"{correct_sem / target_semantic_flat.size(0):.3f}")
            # -----------------------------------------------------------

        # --- End of Training Epoch ---
        scheduler.step() # Step LR scheduler

        avg_train_loss = epoch_train_loss / num_train_batches if num_train_batches > 0 else 0.0
        train_overall_accuracy = epoch_train_correct_sem / float(epoch_train_seen) if epoch_train_seen > 0 else 0.0
        log_string(f'Epoch {epoch_num} Training Summary: Mean Loss: {avg_train_loss:.6f}, Overall Accuracy: {train_overall_accuracy:.6f}')

        # <<< TENSORBOARD: Log Training Metrics >>>
        writer.add_scalar('Loss/train', avg_train_loss, global_step=epoch_num)
        writer.add_scalar('Accuracy/train_overall', train_overall_accuracy, global_step=epoch_num)
        # <<< END LOGGING >>>

        # --- Validation Step ---
        if valDataLoader is not None:
             log_string(f'---- EPOCH {epoch_num} VALIDATION ----')
             val_loss, val_acc, val_mAcc, val_mIoU, val_iou_per_class, _, val_seen_per_class = evaluate_model(valDataLoader, classifier, criterion, weights, NUM_CLASSES, device, args, phase_name="Validation")
             log_string(f'Validation Summary (Epoch {epoch_num}): Loss:{val_loss:.6f} Acc:{val_acc:.6f} mAcc:{val_mAcc:.6f} mIoU:{val_mIoU:.6f}')

             # <<< TENSORBOARD: Log Validation Metrics >>>
             writer.add_scalar('Loss/validation', val_loss, global_step=epoch_num)
             writer.add_scalar('Accuracy/validation_overall', val_acc, global_step=epoch_num)
             writer.add_scalar('Accuracy/validation_mean_class', val_mAcc, global_step=epoch_num)
             writer.add_scalar('mIoU/validation', val_mIoU, global_step=epoch_num)
             # Optional: Log IoU for each class
             for cls_idx in range(NUM_CLASSES):
                 if cls_idx == OUTPOINTS_LABEL_ID: continue
                 cls_name = seg_label_to_cat.get(cls_idx, f'Class_{cls_idx}')
                 writer.add_scalar(f'IoU_Class/val_{cls_name}', val_iou_per_class[cls_idx], global_step=epoch_num)
             # <<< END LOGGING >>>

             # --- Save Best Model ---
             is_best = val_mIoU > best_val_iou
             if is_best:
                 previous_best_iou = best_val_iou; best_val_iou = val_mIoU
                 log_string(f'** New Best Val mIoU: {best_val_iou:.6f} (Improved from {previous_best_iou:.6f}) **')
                 savepath_overall_best = best_checkpoint_path
                 unique_best_filename = f'best_epoch_{epoch_num}_mIoU_{best_val_iou:.4f}.pth'
                 savepath_this_epoch_best = checkpoints_dir / unique_best_filename
                 logger.info(f'Saving new best ckpt: {unique_best_filename} & {savepath_overall_best.name}')
                 state = {'epoch': epoch, 'class_avg_iou': best_val_iou, 'overall_accuracy': val_acc, 'model_state_dict': classifier.state_dict(), 'optimizer_state_dict': optimizer.state_dict(), 'scheduler_state_dict': scheduler.state_dict()}
                 try: torch.save(state, str(savepath_this_epoch_best)); torch.save(state, str(savepath_overall_best)); log_string(f'Saved best model ckpts.')
                 except Exception as e: log_string(f"ERROR saving best model ckpts: {e}")
        else: log_string("Val data loader N/A."); is_best = False

        # --- Save Periodic Checkpoint ---
        save_now = (epoch_num % args.save_period == 0) or (epoch_num == args.epoch)
        if save_now:
             logger.info(f'Saving periodic ckpt for epoch {epoch_num}...')
             savepath_epoch_specific = checkpoints_dir / f'model_epoch_{epoch_num}.pth'; last_savepath_generic = last_periodic_checkpoint_path
             current_val_iou = val_mIoU if valDataLoader is not None else -1.0; current_val_acc = val_acc if valDataLoader is not None else -1.0
             state = {'epoch': epoch, 'class_avg_iou': current_val_iou, 'overall_accuracy': current_val_acc, 'train_loss': avg_train_loss, 'train_acc': train_overall_accuracy, 'model_state_dict': classifier.state_dict(), 'optimizer_state_dict': optimizer.state_dict(), 'scheduler_state_dict': scheduler.state_dict()}
             try: torch.save(state, str(savepath_epoch_specific)); torch.save(state, str(last_savepath_generic)); log_string(f'Periodic model saved ({savepath_epoch_specific.name} & {last_savepath_generic.name})')
             except Exception as e: log_string(f"ERROR saving periodic model: {e}")

    # =========================== END TRAINING LOOP ============================

    log_string("--- Training Finished ---")
    log_string(f'Best Validation mIoU (excl. Outpoints) achieved during this run: {best_val_iou:.6f}')

    # <<< TENSORBOARD: Close the writer >>>
    writer.close()
    log_string("TensorBoard writer closed.")
    # <<< END CLOSE >>>

    log_string("\n--- Recommend running separate test script for final evaluation ---")
    log_string(f"--- Best checkpoint saved at: {best_checkpoint_path} ---")

if __name__ == '__main__':
    # --- Argument Parsing ---
    args = parse_args()

    # --- Basic Setup ---
    # Ensure log directory exists before logger setup potentially fails
    try:
        log_parent_dir = Path('./log/sem_seg/')
        log_parent_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        print(f"Error creating base log directory {log_parent_dir}: {e}")
        # Decide if execution should stop
        sys.exit(1)
        
    try: 
        main(args)
    except FileNotFoundError as e: 
        print(f"\nERROR: File/Dir not found: {e}")
        if 'logger' in locals(): logging.exception("FNF Error:")
    except Exception as e: 
        print(f"\nCRITICAL ERROR: {type(e).__name__}: {e}")
        if 'logger' in locals(): logging.exception("Critical error:") 
        else: import traceback; traceback.print_exc()