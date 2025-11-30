import argparse
import os
import time
import yaml
import warnings
import tempfile
import sys
import importlib

import laspy
import numpy as np
import torch
from munch import Munch
from tqdm import tqdm

# --- NATIVE PROJECT IMPORTS ---
from isbnet.model import ISBNet
from isbnet.util.utils import load_checkpoint
from isbnet.util import get_root_logger
from isbnet.data import build_dataset, build_dataloader

# For semantic segmentation
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models'))

# ==============================================================================
# SCRIPT CONFIGURATION
# ==============================================================================
CHUNK_SIZE = (20.0, 20.0, 40.0)
CHUNK_OVERLAP = 0.5
STITCHING_IOU_THRESHOLD = 0.25
NUM_CLASSES = 7  # Update this based on your semantic classes
classes = ['Unclassified', 'Low-vegetation', 'Terrain', 'Out-points', 'Stem', 'Live branches', 'Woody branches']
# ==============================================================================

def get_args():
    parser = argparse.ArgumentParser("Enhanced Local Inference Pipeline (Semantic + Instance)")
    parser.add_argument("input_las", type=str, help="Path to the single, raw input .las file.")
    parser.add_argument("output_las", type=str, help="Path for the final, stitched output .las file.")
    parser.add_argument("config", type=str, help="Path to the instance segmentation model's config file.")
    parser.add_argument("checkpoint", type=str, help="Path to the instance segmentation model's .pth checkpoint file.")
    parser.add_argument("--sem_model", type=str, required=True, help="Name of the semantic segmentation model (e.g., pointnet_sem_seg)")
    parser.add_argument("--sem_checkpoint", type=str, required=True, help="Path to semantic segmentation model checkpoint")
    parser.add_argument("--gpu", type=str, default='0', help='Specify gpu device [default: 0]')
    parser.add_argument("--num_point_model", type=int, default=1024, help="Points per chunk for semantic segmentation")
    parser.add_argument("--batch_size", type=int, default=16, help="Batch size for semantic segmentation")
    return parser.parse_args()

def load_semantic_model(args):
    MODEL = importlib.import_module(args.sem_model)
    device = torch.device(f"cuda:{args.gpu}" if torch.cuda.is_available() else "cpu")
    
    classifier = MODEL.get_model(NUM_CLASSES).to(device)
    checkpoint = torch.load(args.sem_checkpoint)
    classifier.load_state_dict(checkpoint['model_state_dict'])
    classifier.eval()
    return classifier, device

def process_semantic_segmentation(points, colors, classifier, device, args):
    """Run semantic segmentation on the point cloud"""
    num_points = points.shape[0]
    predictions = np.zeros(num_points, dtype=np.int64)
    
    # Normalize the point cloud
    points_mean = np.mean(points, axis=0)
    points = points - points_mean
    
    # Process in batches
    batch_size = args.batch_size
    num_batches = int(np.ceil(num_points / (batch_size * args.num_point_model)))
    
    with torch.no_grad():
        for batch_idx in tqdm(range(num_batches), desc="Semantic Segmentation"):
            start_idx = batch_idx * batch_size * args.num_point_model
            end_idx = min(start_idx + batch_size * args.num_point_model, num_points)
            
            batch_points = points[start_idx:end_idx]
            batch_colors = colors[start_idx:end_idx]
            
            # Combine points and colors
            batch_features = np.concatenate([batch_points, batch_colors], axis=1)
            batch_features = torch.as_tensor(batch_features, dtype=torch.float32, device=device)

            # PointNet expects [B, C, N]; we have [N, C] → [1, N, C] → [1, C, N]
            inputs = batch_features.unsqueeze(0).permute(0, 2, 1)

            # Get predictions (model returns (log_probs, trans_feat))
            log_probs, _ = classifier(inputs)
            # log_probs shape: [1, N, num_classes]
            pred_labels = torch.argmax(log_probs, dim=2).squeeze(0)
            predictions[start_idx:end_idx] = pred_labels.cpu().numpy()
    
    return predictions

def rle_decode(rle):
    length = rle["length"]; s = rle["counts"]
    starts, nums = [np.asarray(x, dtype=np.int32) for x in (s[0:][::2], s[1:][::2])]
    starts -= 1; ends = starts + nums; mask = np.zeros(length, dtype=np.uint8)
    for lo, hi in zip(starts, ends): mask[lo:hi] = 1
    return mask

def calculate_iou_3d(box1, box2):
    inter_xmin = max(box1[0], box2[0]); inter_ymin = max(box1[1], box2[1]); inter_zmin = max(box1[2], box2[2])
    inter_xmax = min(box1[3], box2[3]); inter_ymax = min(box1[4], box2[4]); inter_zmax = min(box1[5], box2[5])
    
    inter_vol = max(0, inter_xmax - inter_xmin) * max(0, inter_ymax - inter_ymin) * max(0, inter_zmax - inter_zmin)
    if inter_vol == 0: return 0.0

    vol1 = (box1[3] - box1[0]) * (box1[4] - box1[1]) * (box1[5] - box1[2])
    vol2 = (box2[3] - box2[0]) * (box2[4] - box2[1]) * (box2[5] - box2[2])
    union_vol = vol1 + vol2 - inter_vol
    return inter_vol / union_vol

def preprocess_las_to_temp_chunks(las_path, temp_dir, semantic_labels):
    print("Stage 1: Preprocessing raw LAS file into temporary chunk files...")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        las = laspy.read(las_path)
    xyz_raw = np.vstack((las.x, las.y, las.z)).T.astype(np.float32)
    colors_raw = np.vstack((
        (las.red.astype(np.float32) / 65535.0) * 2.0 - 1.0,
        (las.green.astype(np.float32) / 65535.0) * 2.0 - 1.0,
        (las.blue.astype(np.float32) / 65535.0) * 2.0 - 1.0
    )).T.astype(np.float32)
    scene_min = xyz_raw.min(0)
    xyz_shifted = xyz_raw - scene_min
    scene_dims = xyz_shifted.max(0)
    chunk_step = np.array(CHUNK_SIZE) * (1 - CHUNK_OVERLAP)
    n_chunks_x = int(np.ceil((scene_dims[0] - CHUNK_SIZE[0]) / chunk_step[0])) + 1 if scene_dims[0] > CHUNK_SIZE[0] else 1
    n_chunks_y = int(np.ceil((scene_dims[1] - CHUNK_SIZE[1]) / chunk_step[1])) + 1 if scene_dims[1] > CHUNK_SIZE[1] else 1
    n_chunks_z = int(np.ceil((scene_dims[2] - CHUNK_SIZE[2]) / chunk_step[2])) + 1 if scene_dims[2] > CHUNK_SIZE[2] else 1
    total_chunks = n_chunks_x * n_chunks_y * n_chunks_z
    original_indices_map = {}
    pbar = tqdm(total=total_chunks, desc="Creating Temp Chunks")
    
    for i in range(n_chunks_x):
        for j in range(n_chunks_y):
            for k in range(n_chunks_z):
                pbar.update(1)
                min_bound = np.array([i, j, k]) * chunk_step
                max_bound = min_bound + np.array(CHUNK_SIZE)
                chunk_point_indices = np.where(np.all((xyz_shifted >= min_bound) & (xyz_shifted < max_bound), axis=1))[0]
                if len(chunk_point_indices) < 100: continue
                chunk_xyz_shifted = xyz_shifted[chunk_point_indices]
                chunk_mean = chunk_xyz_shifted.mean(0)
                chunk_xyz_final = chunk_xyz_shifted - chunk_mean
                
                # Use semantic labels for the chunk
                chunk_sem = semantic_labels[chunk_point_indices]
                dummy_inst = np.full(len(chunk_point_indices), -100, dtype=np.int64)
                
                chunk_name = f"chunk_{i}_{j}_{k}"
                torch.save((chunk_xyz_final, colors_raw[chunk_point_indices], chunk_sem, dummy_inst), 
                         os.path.join(temp_dir, f"{chunk_name}.pth"))
                original_indices_map[chunk_name] = chunk_point_indices
    pbar.close()
    print(f"Created {len(original_indices_map)} temporary chunk files.")
    return las, original_indices_map

def stitch_and_save_las(output_path, original_las, all_chunk_results, original_indices_map, semantic_labels):
    print("\nStage 3: Stitching chunk predictions with Non-Maximum Suppression...")
    
    original_xyz = np.vstack((original_las.x, original_las.y, original_las.z)).T

    # 1. Gather all predicted instance fragments from all chunks
    instance_candidates = []
    print("  - Gathering all instance fragments from chunks...")
    for chunk_res in all_chunk_results:
        scan_id = chunk_res["scan_id"]
        original_indices = original_indices_map[scan_id]
        
        for instance in chunk_res["pred_instances"]:
            mask = rle_decode(instance["pred_mask"])
            local_indices = np.where(mask == 1)[0]
            if len(local_indices) == 0: continue
            
            global_indices = original_indices[local_indices]
            points = original_xyz[global_indices]
            bbox = np.concatenate([points.min(0), points.max(0)])
            
            instance_candidates.append({
                "global_indices": global_indices,
                "score": instance["conf"],
                "bbox": bbox,
                "processed": False
            })

    # 2. Sort all candidates by confidence score (highest first)
    instance_candidates.sort(key=lambda x: x["score"], reverse=True)
    print(f"  - Found {len(instance_candidates)} total instance fragments to process.")

    # 3. Perform Non-Maximum Suppression (NMS)
    final_instances = []
    for i in range(len(instance_candidates)):
        if instance_candidates[i]["processed"]:
            continue
        
        current_instance = instance_candidates[i]
        final_instances.append(current_instance)
        current_instance["processed"] = True
        
        for j in range(i + 1, len(instance_candidates)):
            if instance_candidates[j]["processed"]:
                continue
            
            iou = calculate_iou_3d(current_instance["bbox"], instance_candidates[j]["bbox"])
            if iou > STITCHING_IOU_THRESHOLD:
                instance_candidates[j]["processed"] = True
    
    # 4. Create the final labels
    num_total_points = len(original_las.points)
    final_instance_labels = np.full(num_total_points, -1, dtype=np.int32)
    
    print(f"  - Stitching {len(final_instances)} final merged instances...")
    for final_id, instance in enumerate(final_instances):
        final_instance_labels[instance["global_indices"]] = final_id
        
    # 5. Save the final LAS file with both semantic and instance labels
    header = laspy.LasHeader(version="1.4", point_format=3)
    header.add_extra_dim(laspy.ExtraBytesParams(name="semantic_label", type=np.int32))
    header.add_extra_dim(laspy.ExtraBytesParams(name="instance_label", type=np.int32))
    
    out_las = laspy.LasData(header)
    out_las.x = original_las.x
    out_las.y = original_las.y
    out_las.z = original_las.z
    out_las.red = original_las.red
    out_las.green = original_las.green
    out_las.blue = original_las.blue
    out_las.semantic_label = semantic_labels
    out_las.instance_label = final_instance_labels
    out_las.write(output_path)

def main():
    args = get_args()
    
    # 1. Load semantic segmentation model
    print("\nStage 1: Loading semantic segmentation model...")
    semantic_model, device = load_semantic_model(args)
    
    # 2. Load and preprocess input point cloud
    print("\nStage 2: Loading input point cloud...")
    input_las = laspy.read(args.input_las)
    points = np.vstack((input_las.x, input_las.y, input_las.z)).T
    colors = np.vstack((
        input_las.red / 65535.0,
        input_las.green / 65535.0,
        input_las.blue / 65535.0
    )).T
    
    # 3. Run semantic segmentation
    print("\nStage 3: Running semantic segmentation...")
    semantic_labels = process_semantic_segmentation(points, colors, semantic_model, device, args)
    
    # 4. Load instance segmentation model and process
    print("\nStage 4: Setting up instance segmentation...")
    cfg = Munch.fromDict(yaml.safe_load(open(args.config, "r").read()))
    logger = get_root_logger()
    cfg.dataloader.test.num_workers = 0
    temp_dir_parent = "tmp"
    os.makedirs(temp_dir_parent, exist_ok=True)
    
    with tempfile.TemporaryDirectory(dir=temp_dir_parent) as temp_dir:
        logger.info(f"Created temporary directory: {temp_dir}")
        
        # 5. Create chunks with semantic labels
        original_las, original_indices_map = preprocess_las_to_temp_chunks(args.input_las, temp_dir, semantic_labels)
        
        # 6. Set up instance segmentation dataloader
        cfg.data.test.data_root = temp_dir
        cfg.data.test.prefix = ""
        dataset = build_dataset(cfg.data.test, logger)
        if not dataset.filenames:
            logger.error("Preprocessing did not create any valid chunk files. Exiting.")
            return
        dataloader = build_dataloader(dataset, training=False, dist=False, **cfg.dataloader.test)
        
        # 7. Load instance segmentation model
        logger.info(f"Loading checkpoint from {args.checkpoint}")
        model = ISBNet(**cfg.model, dataset_name=cfg.data.train.type)
        load_checkpoint(args.checkpoint, logger, model, map_location=device)
        model = model.to(device)
        model.eval()
        
        # 8. Run instance segmentation
        print("\nStage 5: Running instance segmentation on chunks...")
        all_chunk_results = []
        with torch.no_grad():
            for batch in tqdm(dataloader, desc="Processing"):
                # Skip None batches (chunks with too few points are filtered out by collate_fn)
                if batch is None:
                    continue
                for key in batch:
                    if isinstance(batch[key], torch.Tensor):
                        batch[key] = batch[key].to(device)
                with torch.amp.autocast('cuda', enabled=(device.type == 'cuda')):
                    res = model(batch)
                res["scan_id"] = batch["scan_ids"][0]
                for k in res:
                    if isinstance(res[k], torch.Tensor):
                        res[k] = res[k].cpu()
                all_chunk_results.append(res)
        
        # 9. Stitch results and save
        print("\nStage 6: Stitching results and saving final output...")
        stitch_and_save_las(args.output_las, original_las, all_chunk_results, original_indices_map, semantic_labels)
        
    print(f"\n✅ Pipeline complete. Final output saved to: {args.output_las}")
    print(f"   - Contains both semantic labels and instance labels")
    print(f"   - Semantic classes: {classes}")

if __name__ == "__main__":
    main()