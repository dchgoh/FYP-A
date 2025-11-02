# run_pipeline_final_stitched.py
# DEFINITIVE AND WORKING VERSION. This script includes a proper stitching algorithm
# using Non-Maximum Suppression to merge instance fragments from different chunks.

import argparse
import os
import time
import yaml
import warnings
import tempfile

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
# === MODIFIED TO MATCH V4 TRAINING DATA ===
CHUNK_SIZE = (40.0, 40.0, 40.0) # This now matches SAMPLE_WINDOW_SIZE in v4
# ==========================================
CHUNK_OVERLAP = 0.5
# NEW: Threshold for merging instances. If two bounding boxes overlap more than this,
# they are considered the same object. 0.15 is a reasonable starting value.
STITCHING_IOU_THRESHOLD = 0.15
# ==============================================================================

def get_args():
    parser = argparse.ArgumentParser("ISBNet Final End-to-End Inference Pipeline")
    parser.add_argument("input_las", type=str, help="Path to the single, raw input .las file.")
    parser.add_argument("output_las", type=str, help="Path for the final, stitched output .las file.")
    parser.add_argument("config", type=str, help="Path to the model's config file.")
    parser.add_argument("checkpoint", type=str, help="Path to the model's .pth checkpoint file.")
    return parser.parse_args()

def preprocess_las_to_temp_chunks(las_path, temp_dir):
    # This function is correct and remains unchanged. Its normalization logic
    # (scene-shift then chunk-center) correctly matches the v4 script.
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
    xyz_shifted = xyz_raw - scene_min # <-- Stage 1 Normalization (Correct)
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
                chunk_xyz_final = chunk_xyz_shifted - chunk_mean # <-- Stage 2 Normalization (Correct)
                dummy_sem = np.zeros(len(chunk_point_indices), dtype=np.int64)
                dummy_inst = np.full(len(chunk_point_indices), -100, dtype=np.int64)
                chunk_name = f"chunk_{i}_{j}_{k}"
                torch.save((chunk_xyz_final, colors_raw[chunk_point_indices], dummy_sem, dummy_inst), os.path.join(temp_dir, f"{chunk_name}.pth"))
                original_indices_map[chunk_name] = chunk_point_indices
    pbar.close()
    print(f"Created {len(original_indices_map)} temporary chunk files.")
    return las, original_indices_map

# --- START OF THE NEW, CORRECT STITCHING LOGIC ---
def rle_decode(rle):
    length = rle["length"]; s = rle["counts"]
    starts, nums = [np.asarray(x, dtype=np.int32) for x in (s[0:][::2], s[1:][::2])]
    starts -= 1; ends = starts + nums; mask = np.zeros(length, dtype=np.uint8)
    for lo, hi in zip(starts, ends): mask[lo:hi] = 1
    return mask

def calculate_iou_3d(box1, box2):
    # box format: [xmin, ymin, zmin, xmax, ymax, zmax]
    inter_xmin = max(box1[0], box2[0]); inter_ymin = max(box1[1], box2[1]); inter_zmin = max(box1[2], box2[2])
    inter_xmax = min(box1[3], box2[3]); inter_ymax = min(box1[4], box2[4]); inter_zmax = min(box1[5], box2[5])
    
    inter_vol = max(0, inter_xmax - inter_xmin) * max(0, inter_ymax - inter_ymin) * max(0, inter_zmax - inter_zmin)
    if inter_vol == 0: return 0.0

    vol1 = (box1[3] - box1[0]) * (box1[4] - box1[1]) * (box1[5] - box1[2])
    vol2 = (box2[3] - box2[0]) * (box2[4] - box2[1]) * (box2[5] - box2[2])
    union_vol = vol1 + vol2 - inter_vol
    return inter_vol / union_vol

def stitch_and_save_las(output_path, original_las, all_chunk_results, original_indices_map):
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
        
        # This is a final instance. Keep it.
        current_instance = instance_candidates[i]
        final_instances.append(current_instance)
        current_instance["processed"] = True
        
        # Check all subsequent candidates for overlap
        for j in range(i + 1, len(instance_candidates)):
            if instance_candidates[j]["processed"]:
                continue
            
            iou = calculate_iou_3d(current_instance["bbox"], instance_candidates[j]["bbox"])
            if iou > STITCHING_IOU_THRESHOLD:
                # This is a duplicate. Mark it to be suppressed.
                instance_candidates[j]["processed"] = True
    
    # 4. Create the final labels by "painting" the surviving instances
    num_total_points = len(original_las.points)
    final_instance_labels = np.full(num_total_points, -1, dtype=np.int32)
    
    print(f"  - Stitching {len(final_instances)} final merged instances...")
    for final_id, instance in enumerate(final_instances):
        final_instance_labels[instance["global_indices"]] = final_id
        
    # 5. Save the final LAS file
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
# --- END OF THE NEW, CORRECT STITCHING LOGIC ---

def main():
    # This main function is correct and uses the DataLoader with num_workers=0
    args = get_args()
    cfg = Munch.fromDict(yaml.safe_load(open(args.config, "r").read()))
    logger = get_root_logger()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Using device: {device}")
    cfg.dataloader.test.num_workers = 0
    temp_dir_parent = "tmp"
    os.makedirs(temp_dir_parent, exist_ok=True)
    
    with tempfile.TemporaryDirectory(dir=temp_dir_parent) as temp_dir:
        logger.info(f"Created temporary directory: {temp_dir}")
        original_las, original_indices_map = preprocess_las_to_temp_chunks(args.input_las, temp_dir)
        cfg.data.test.data_root = temp_dir
        cfg.data.test.prefix = ""
        dataset = build_dataset(cfg.data.test, logger)
        if not dataset.filenames:
            logger.error("Preprocessing did not create any valid chunk files. Exiting.")
            return
        dataloader = build_dataloader(dataset, training=False, dist=False, **cfg.dataloader.test)
        logger.info(f"Loading checkpoint from {args.checkpoint}")
        model = ISBNet(**cfg.model, dataset_name=cfg.data.train.type)
        load_checkpoint(args.checkpoint, logger, model, map_location=device)
        model = model.to(device)
        model.eval()
        all_chunk_results = []
        logger.info(f"\nStage 2: Running inference on {len(dataset)} chunks...")
        with torch.no_grad():
            for batch in tqdm(dataloader, desc="Inferring"):
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
        
        stitch_and_save_las(args.output_las, original_las, all_chunk_results, original_indices_map)
        
    logger.info(f"\n✅ Pipeline complete. Final output saved to: {args.output_las}")

if __name__ == "__main__":
    main()