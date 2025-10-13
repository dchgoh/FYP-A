# run_pipeline.py
# DEFINITIVE AND WORKING VERSION. This script correctly uses the project's native
# DataLoader to handle all voxelization and batching, preventing all previous errors.

import argparse
import os
import time
import yaml
import warnings
import tempfile
import shutil

import laspy
import numpy as np
import torch
from munch import Munch
from tqdm import tqdm

# --- NATIVE PROJECT IMPORTS (from your test.py) ---
from isbnet.model import ISBNet
from isbnet.util.utils import load_checkpoint
from isbnet.util import get_root_logger
from isbnet.data import build_dataset, build_dataloader

# ==============================================================================
# SCRIPT CONFIGURATION
# ==============================================================================
CHUNK_SIZE = (20.0, 20.0, 40.0)
CHUNK_OVERLAP = 0.5
# ==============================================================================

def get_args():
    parser = argparse.ArgumentParser("ISBNet Final End-to-End Inference Pipeline")
    parser.add_argument("input_las", type=str, help="Path to the single, raw input .las file.")
    parser.add_argument("output_las", type=str, help="Path for the final, stitched output .las file.")
    parser.add_argument("config", type=str, help="Path to the model's config file.")
    parser.add_argument("checkpoint", type=str, help="Path to the model's .pth checkpoint file.")
    return parser.parse_args()


# --- STAGE 1: PREPROCESSING TO TEMP FILES ---
def preprocess_las_to_temp_chunks(las_path, temp_dir):
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
    
    original_indices_map = {} # To store mapping for stitching
    
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
                
                dummy_sem = np.zeros(len(chunk_point_indices), dtype=np.int64)
                dummy_inst = np.full(len(chunk_point_indices), -100, dtype=np.int64)

                chunk_name = f"chunk_{i}_{j}_{k}"
                # The Dataset class expects a 4-element tuple
                torch.save((chunk_xyz_final, colors_raw[chunk_point_indices], dummy_sem, dummy_inst), os.path.join(temp_dir, f"{chunk_name}.pth"))
                
                # Store the mapping from chunk name to original indices for stitching
                original_indices_map[chunk_name] = chunk_point_indices
    pbar.close()
    print(f"Created {len(original_indices_map)} temporary chunk files.")
    return las, original_indices_map

# --- STAGE 3: POST-PROCESSING ---
def rle_decode(rle):
    length = rle["length"]; s = rle["counts"]
    starts, nums = [np.asarray(x, dtype=np.int32) for x in (s[0:][::2], s[1:][::2])]
    starts -= 1; ends = starts + nums; mask = np.zeros(length, dtype=np.uint8)
    for lo, hi in zip(starts, ends): mask[lo:hi] = 1
    return mask

def stitch_and_save_las(output_path, original_las, all_chunk_results, original_indices_map):
    print("\nStage 3: Stitching predictions and saving final LAS file...")
    num_total_points = len(original_las.points)
    final_instance_labels = np.full(num_total_points, -1, dtype=np.int32)
    global_instance_id_counter = 0

    for chunk_res in tqdm(all_chunk_results, desc="Stitching Results"):
        scan_id = chunk_res["scan_id"] # The name of the chunk, e.g., "chunk_0_0_0"
        original_indices = original_indices_map[scan_id]
        
        for instance in chunk_res["pred_instances"]:
            mask = rle_decode(instance["pred_mask"])
            local_instance_indices = np.where(mask == 1)[0]
            global_indices_for_instance = original_indices[local_instance_indices]
            final_instance_labels[global_indices_for_instance] = global_instance_id_counter
            global_instance_id_counter += 1
            
    print(f"Stitching complete. Found {global_instance_id_counter} total instance fragments.")
    
    header = laspy.LasHeader(version="1.4", point_format=3)
    header.add_extra_dim(laspy.ExtraBytesParams(name="pred_instance_id", type=np.int32))
    out_las = laspy.LasData(header)
    out_las.x = original_las.x; out_las.y = original_las.y; out_las.z = original_las.z
    out_las.red = original_las.red; out_las.green = original_las.green; out_las.blue = original_las.blue
    out_las.pred_instance_id = final_instance_labels
    out_las.write(output_path)
    return

# ==============================================================================
# MAIN ORCHESTRATOR
# ==============================================================================
def main():
    args = get_args()
    cfg = Munch.fromDict(yaml.safe_load(open(args.config, "r").read()))
    logger = get_root_logger()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Using device: {device}")

    # --- START OF THE DEFINITIVE FIX ---
    # Force num_workers to 0 for the test dataloader to prevent multiprocessing deadlocks.
    # This is a common issue with custom C++ extensions. This line overrides the
    # value in the YAML file, making the script robust.
    cfg.dataloader.test.num_workers = 0
    # --- END OF THE DEFINITIVE FIX ---

    temp_dir_parent = "tmp"
    os.makedirs(temp_dir_parent, exist_ok=True)
    
    with tempfile.TemporaryDirectory(dir=temp_dir_parent) as temp_dir:
        logger.info(f"Created temporary directory: {temp_dir}")
        
        # --- STAGE 1 ---
        original_las, original_indices_map = preprocess_las_to_temp_chunks(args.input_las, temp_dir)
        
        # --- DATALOADER SETUP (The Correct Way) ---
        cfg.data.test.data_root = temp_dir
        cfg.data.test.prefix = ""
        
        dataset = build_dataset(cfg.data.test, logger)
        if not dataset.filenames:
            logger.error("Preprocessing did not create any valid chunk files. Exiting.")
            return
            
        dataloader = build_dataloader(dataset, training=False, dist=False, **cfg.dataloader.test)
        
        # --- MODEL LOADING ---
        logger.info(f"Loading checkpoint from {args.checkpoint}")
        model = ISBNet(**cfg.model, dataset_name=cfg.data.train.type)
        load_checkpoint(args.checkpoint, logger, model, map_location=device)
        model = model.to(device)
        model.eval()

        # --- STAGE 2: INFERENCE ---
        all_chunk_results = []
        logger.info(f"\nStage 2: Running inference on {len(dataset)} chunks...")
        with torch.no_grad():
            for batch in tqdm(dataloader, desc="Inferring"):
                # Move all tensors provided by the dataloader to the GPU
                for key in batch:
                    if isinstance(batch[key], torch.Tensor):
                        batch[key] = batch[key].to(device)
                
                # The batch from the dataloader has the PERFECT format. Run the model.
                with torch.amp.autocast('cuda', enabled=(device.type == 'cuda')):
                    res = model(batch)
                
                # Move results to CPU for post-processing
                for k in res:
                    if isinstance(res[k], torch.Tensor):
                        res[k] = res[k].cpu()
                all_chunk_results.append(res)
        
        # --- STAGE 3: POST-PROCESSING ---
        stitch_and_save_las(args.output_las, original_las, all_chunk_results, original_indices_map)
        
    logger.info(f"\n✅ Pipeline complete. Final output saved to: {args.output_las}")

if __name__ == "__main__":
    main()