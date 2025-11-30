import argparse
import os
import time
import yaml
import warnings
import tempfile
import shutil
from collections import defaultdict
import contextlib
import struct

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

# ==============================================================================
# SCRIPT CONFIGURATION
# ==============================================================================
CHUNK_SIZE = (40.0, 40.0, 40.0)
CHUNK_OVERLAP = 0.5
STITCHING_IOU_THRESHOLD = 0.15
# ==============================================================================

def get_args():
    parser = argparse.ArgumentParser("ISBNet Final End-to-End Inference Pipeline")
    parser.add_argument("input_las", type=str, help="Path to the single, raw input .las file.")
    parser.add_argument("output_las", type=str, help="Path for the final, stitched output .las file.")
    parser.add_argument("config", type=str, help="Path to the model's config file.")
    parser.add_argument("checkpoint", type=str, help="Path to the model's .pth checkpoint file.")
    
    # ========================================================== #
    # ==================== START OF THE FIX ==================== #
    # ========================================================== #
    # Add flexible command-line arguments for filtering thresholds.
    parser.add_argument(
        "--conf-thresh", 
        type=float, 
        default=0.01, 
        help="Confidence threshold for PRE-filtering instance fragments. Default is 0.01 (permissive)."
    )
    parser.add_argument(
        "--min-points", 
        type=int, 
        default=100, 
        help="Minimum number of points for POST-filtering final instances. Default is 100."
    )
    # ======================================================== #
    # ==================== END OF THE FIX ==================== #
    # ======================================================== #

    return parser.parse_args()

def preprocess_las_to_temp_chunks_hybrid_fixed(las_path, temp_dir):
    # This is the correct, memory-safe "grid-carving" function. It is unchanged.
    print("Stage 1: Preprocessing raw LAS file with memory-safe grid-carving...")

    with laspy.open(las_path) as f:
        header = f.header
        scene_min = header.mins
        scene_max = header.maxs

    xyz_raw_min = np.array(scene_min)
    xyz_shifted_max = np.array(scene_max) - xyz_raw_min
    
    scene_dims = xyz_shifted_max
    chunk_step = np.array(CHUNK_SIZE) * (1 - CHUNK_OVERLAP)
    
    n_chunks_x = int(np.ceil((scene_dims[0] - CHUNK_SIZE[0]) / chunk_step[0])) + 1 if scene_dims[0] > CHUNK_SIZE[0] else 1
    n_chunks_y = int(np.ceil((scene_dims[1] - CHUNK_SIZE[1]) / chunk_step[1])) + 1 if scene_dims[1] > CHUNK_SIZE[1] else 1
    n_chunks_z = int(np.ceil((scene_dims[2] - CHUNK_SIZE[2]) / chunk_step[2])) + 1 if scene_dims[2] > CHUNK_SIZE[2] else 1
    total_chunks = n_chunks_x * n_chunks_y * n_chunks_z
    
    print(f"Scene dimensions imply a grid of {n_chunks_x}x{n_chunks_y}x{n_chunks_z} = {total_chunks} chunks.")
    
    original_indices_map = {}
    pbar = tqdm(total=total_chunks, desc="Grid-Carving Chunks")

    for i in range(n_chunks_x):
        for j in range(n_chunks_y):
            for k in range(n_chunks_z):
                pbar.update(1)
                chunk_name = f"chunk_{i}_{j}_{k}"
                min_bound = np.array([i, j, k]) * chunk_step
                max_bound = min_bound + np.array(CHUNK_SIZE)

                chunk_points = []
                chunk_colors = []
                chunk_indices = []
                
                point_offset = 0
                with laspy.open(las_path) as las_file:
                    for points_batch in las_file.chunk_iterator(2**16):
                        xyz_raw_batch = np.vstack((points_batch.x, points_batch.y, points_batch.z)).T
                        xyz_shifted_batch = xyz_raw_batch - xyz_raw_min
                        
                        mask = np.all((xyz_shifted_batch >= min_bound) & (xyz_shifted_batch < max_bound), axis=1)
                        
                        if np.any(mask):
                            chunk_points.append(xyz_shifted_batch[mask])
                            
                            colors_raw_batch = np.vstack((
                                (points_batch.red[mask].astype(np.float32) / 65535.0) * 2.0 - 1.0,
                                (points_batch.green[mask].astype(np.float32) / 65535.0) * 2.0 - 1.0,
                                (points_batch.blue[mask].astype(np.float32) / 65535.0) * 2.0 - 1.0
                            )).T
                            chunk_colors.append(colors_raw_batch)
                            
                            original_file_indices = np.arange(point_offset, point_offset + len(points_batch))
                            chunk_indices.append(original_file_indices[mask])

                        point_offset += len(points_batch)
                
                if not chunk_indices or len(np.concatenate(chunk_indices)) < 100:
                    continue
                
                chunk_xyz_shifted = np.vstack(chunk_points)
                if len(chunk_xyz_shifted) < 100: continue
                
                chunk_colors_final = np.vstack(chunk_colors)
                chunk_point_indices = np.concatenate(chunk_indices)

                chunk_mean = chunk_xyz_shifted.mean(0)
                chunk_xyz_final = chunk_xyz_shifted - chunk_mean
                dummy_sem = np.zeros(len(chunk_point_indices), dtype=np.int64)
                dummy_inst = np.full(len(chunk_point_indices), -100, dtype=np.int64)
                
                torch.save((chunk_xyz_final, chunk_colors_final, dummy_sem, dummy_inst), os.path.join(temp_dir, f"{chunk_name}.pth"))
                original_indices_map[chunk_name] = chunk_point_indices
    pbar.close()
    
    print(f"Created {len(original_indices_map)} temporary chunk files.")
    return original_indices_map

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

def stitch_and_save_las(output_path, input_las_path, all_chunk_results, original_indices_map, conf_threshold, min_points):
    print("\nStage 3: Stitching chunk predictions with Non-Maximum Suppression...")
    print(f"  - Using Confidence Threshold: {conf_threshold}")
    print(f"  - Using Minimum Points Threshold: {min_points}")

    with laspy.open(input_las_path) as f:
        original_las = f.read()
    
    original_xyz = np.vstack((original_las.x, original_las.y, original_las.z)).T

    instance_candidates = []
    print("  - Gathering all instance fragments from chunks...")
    for chunk_res in all_chunk_results:
        scan_id = chunk_res["scan_id"]
        if scan_id not in original_indices_map: continue
        original_indices = original_indices_map[scan_id]
        
        for instance in chunk_res["pred_instances"]:
            if instance["conf"] < conf_threshold:
                continue

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

    instance_candidates.sort(key=lambda x: x["score"], reverse=True)
    print(f"  - Found {len(instance_candidates)} high-confidence fragments to process.")

    final_instances_before_size_filter = []
    for i in range(len(instance_candidates)):
        if instance_candidates[i]["processed"]: continue
        
        current_instance = instance_candidates[i]
        final_instances_before_size_filter.append(current_instance)
        current_instance["processed"] = True
        
        for j in range(i + 1, len(instance_candidates)):
            if instance_candidates[j]["processed"]: continue
            
            iou = calculate_iou_3d(current_instance["bbox"], instance_candidates[j]["bbox"])
            if iou > STITCHING_IOU_THRESHOLD:
                instance_candidates[j]["processed"] = True
    
    print(f"  - NMS produced {len(final_instances_before_size_filter)} instances. Applying size filter...")
    final_instances = [inst for inst in final_instances_before_size_filter if len(inst["global_indices"]) >= min_points]
    
    num_total_points = len(original_las.points)
    final_instance_labels = np.full(num_total_points, -1, dtype=np.int32)
    
    print(f"  - Stitching {len(final_instances)} final merged instances...")
    for final_id, instance in enumerate(final_instances):
        valid_indices = instance["global_indices"][instance["global_indices"] < num_total_points]
        final_instance_labels[valid_indices] = final_id
        
    print("  - Creating output LAS file and replacing/adding TreeID...")
    out_las = laspy.LasData(original_las.header)
    out_las.points = original_las.points.copy()
    if "treeID" not in out_las.header.point_format.dimension_names:
        print("    - 'treeID' field not found. Adding it to the output file.")
        out_las.add_extra_dim(laspy.ExtraBytesParams(name="treeID", type=np.int32))
    else:
        print("    - 'treeID' field found. Overwriting its values.")
    out_las.treeID = final_instance_labels
    out_las.write(output_path)

def main():
    args = get_args() # This now gets the new arguments
    cfg = Munch.fromDict(yaml.safe_load(open(args.config, "r").read()))
    logger = get_root_logger()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Using device: {device}")
    cfg.dataloader.test.num_workers = 0
    temp_dir_parent = "tmp"
    os.makedirs(temp_dir_parent, exist_ok=True)
    
    with tempfile.TemporaryDirectory(dir=temp_dir_parent) as temp_dir:
        logger.info(f"Created temporary directory: {temp_dir}")
        
        original_indices_map = preprocess_las_to_temp_chunks_hybrid_fixed(args.input_las, temp_dir)
        
        cfg.data.test.data_root = temp_dir
        cfg.data.test.prefix = ""
        dataset = build_dataset(cfg.data.test, logger)
        if not dataset.filenames:
            logger.error("Preprocessing did not create any valid chunk files. Exiting.")
            return
            
        cfg.dataloader.test.batch_size = 1
        dataloader = build_dataloader(dataset, training=False, dist=False, **cfg.dataloader.test)
        
        logger.info(f"Loading checkpoint from {args.checkpoint}")
        model = ISBNet(**cfg.model, dataset_name=cfg.data.train.type)
        load_checkpoint(args.checkpoint, logger, model, map_location=device)
        model = model.to(device)
        model.eval()
        all_chunk_results = []
        logger.info(f"\nStage 2: Running inference on {len(dataset)} chunks...")
        with torch.no_grad():
            for i, batch in enumerate(tqdm(dataloader, desc="Inferring")):
                if batch is None:
                    problem_file = dataset.filenames[i]
                    logger.warning(f"SKIPPING: DataLoader returned None for batch index {i}, file: {problem_file}")
                    continue

                for key in batch:
                    if isinstance(batch[key], torch.Tensor):
                        batch[key] = batch[key].to(device)
                
                try:
                    with torch.amp.autocast('cuda', enabled=(device.type == 'cuda')):
                        res = model(batch)
                except torch.cuda.OutOfMemoryError as e:
                    problem_file = dataset.filenames[i]
                    logger.error(f"CUDA Out of Memory on batch index {i}, file: {problem_file}")
                    logger.error(f"This chunk is too large/complex for the GPU. SKIPPING.")
                    torch.cuda.empty_cache()
                    continue

                res["scan_id"] = batch["scan_ids"][0]
                for k in res:
                    if isinstance(res[k], torch.Tensor):
                        res[k] = res[k].cpu()
                all_chunk_results.append(res)
        
        # Pass the command-line arguments to the stitching function
        stitch_and_save_las(args.output_las, args.input_las, all_chunk_results, original_indices_map, 
                           args.conf_thresh, args.min_points)
        
    logger.info(f"\n✅ Pipeline complete. Final output saved to: {args.output_las}")

if __name__ == "__main__":
    main()