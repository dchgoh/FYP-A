import argparse
import os
import subprocess
import sys
import shutil
import tempfile
import yaml
import numpy as np
import laspy
import torch
from tqdm import tqdm
import pickle

# ==============================================================================
# CONFIGURATION
# ==============================================================================
CHUNK_SIZE = (40.0, 40.0, 40.0)
CHUNK_OVERLAP = 0.5
STITCHING_IOU_THRESHOLD = 0.2
CONF_THRESHOLD = 0.15
MIN_POINTS = 200

def get_args():
    parser = argparse.ArgumentParser("ISBNet Pipeline Wrapper")
    parser.add_argument("input_las", type=str, help="Path to raw input .las file")
    parser.add_argument("output_las", type=str, help="Path to output .las file")
    parser.add_argument("config", type=str, help="Path to ISBNet config file")
    parser.add_argument("checkpoint", type=str, help="Path to .pth checkpoint")
    return parser.parse_args()

def preprocess_and_save_maps(las_path, temp_data_dir, map_dir):
    print(f"[Stage 1] Slicing {las_path}...")
    
    with laspy.open(las_path) as f:
        header = f.header
        las = f.read()

    xyz_full = np.vstack((las.x, las.y, las.z)).T
    
    xyz_min = np.min(xyz_full, axis=0)
    xyz_max = np.max(xyz_full, axis=0)
    xyz_shifted = xyz_full - xyz_min
    
    chunk_step = np.array(CHUNK_SIZE) * (1 - CHUNK_OVERLAP)
    n_dims = np.ceil((xyz_max - xyz_min - np.array(CHUNK_SIZE)) / chunk_step).astype(int) + 1
    n_dims = np.maximum(n_dims, 1)
    
    print(f"  - Grid dims: {n_dims}")
    
    if hasattr(las, 'red'):
        red = (las.red.astype(np.float32) / 65535.0) * 2.0 - 1.0
        green = (las.green.astype(np.float32) / 65535.0) * 2.0 - 1.0
        blue = (las.blue.astype(np.float32) / 65535.0) * 2.0 - 1.0
        colors_full = np.vstack((red, green, blue)).T
    else:
        colors_full = np.zeros_like(xyz_full)

    chunk_list = []
    
    for i in tqdm(range(n_dims[0])):
        for j in range(n_dims[1]):
            for k in range(n_dims[2]):
                chunk_name = f"chunk_{i}_{j}_{k}"
                min_bound = np.array([i, j, k]) * chunk_step
                max_bound = min_bound + np.array(CHUNK_SIZE)
                
                mask = np.all((xyz_shifted >= min_bound) & (xyz_shifted < max_bound), axis=1)
                
                if np.count_nonzero(mask) < 100: continue
                
                chunk_xyz = xyz_shifted[mask]
                chunk_colors = colors_full[mask]
                
                chunk_center = chunk_xyz.mean(0)
                chunk_xyz_centered = chunk_xyz - chunk_center
                
                dummy_sem = np.zeros(len(chunk_xyz), dtype=np.int64)
                dummy_inst = np.full(len(chunk_xyz), -100, dtype=np.int64)
                
                save_path = os.path.join(temp_data_dir, f"{chunk_name}.pth")
                torch.save((chunk_xyz_centered, chunk_colors, dummy_sem, dummy_inst), 
                           save_path, pickle_protocol=5)
                
                global_indices = np.where(mask)[0]
                map_path = os.path.join(map_dir, f"{chunk_name}.npy")
                np.save(map_path, global_indices)
                
                chunk_list.append(chunk_name)
                
    return chunk_list, xyz_full, las

def create_temp_config(base_config_path, temp_data_dir, temp_config_path, chunk_names):
    """
    Modified to NOT pass 'ann_file' since ForInstanceDataset doesn't accept it.
    """
    with open(base_config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    # 1. Update data paths
    config['data']['test']['data_root'] = temp_data_dir
    config['data']['test']['prefix'] = "" 
    
    # 2. FIX: Remove 'ann_file' if it exists, to avoid TypeError
    if 'ann_file' in config['data']['test']:
        del config['data']['test']['ann_file']

    # 3. Create a dummy list file anyway, just in case the dataset logic 
    # falls back to looking for "test.txt" or "val.txt" in data_root
    # even if ann_file arg isn't passed.
    with open(os.path.join(temp_data_dir, "test.txt"), "w") as f:
        for name in chunk_names:
            f.write(name + "\n")
            
    # 4. Disable workers
    config['dataloader']['test']['num_workers'] = 0 
    
    with open(temp_config_path, 'w') as f:
        yaml.dump(config, f)

def stitch_and_save(xyz_full, las_header, results_dir, map_dir, output_path):
    print(f"[Stage 3] Stitching results...")
    
    instance_candidates = []
    chunk_files = [f for f in os.listdir(map_dir) if f.endswith(".npy")]
    
    for chunk_file in tqdm(chunk_files, desc="Loading Fragments"):
        chunk_name = chunk_file.replace(".npy", "")
        global_indices_map = np.load(os.path.join(map_dir, chunk_file))
        
        summary_file = os.path.join(results_dir, "pred_instance", f"{chunk_name}.txt")
        if not os.path.exists(summary_file): continue
        
        with open(summary_file, 'r') as f:
            lines = f.readlines()
            
        for line in lines:
            parts = line.strip().split()
            mask_rel_path = parts[0]
            conf = float(parts[2])
            
            if conf < CONF_THRESHOLD: continue
            
            mask_full_path = os.path.join(results_dir, "pred_instance", mask_rel_path)
            if not os.path.exists(mask_full_path): continue
            
            local_indices = np.loadtxt(mask_full_path, dtype=int)
            if local_indices.size < 50: continue
            
            global_indices = global_indices_map[local_indices]
            
            instance_candidates.append({
                "indices": global_indices,
                "score": conf,
                "processed": False
            })
            
    instance_candidates.sort(key=lambda x: x["score"], reverse=True)
    print(f"  - Processing {len(instance_candidates)} candidates...")
    
    final_instances = []
    occupied_mask = np.zeros(len(xyz_full), dtype=bool)
    
    for i, curr in enumerate(tqdm(instance_candidates)):
        if curr["processed"]: continue
        
        curr_indices = curr["indices"]
        
        if np.sum(occupied_mask[curr_indices]) / len(curr_indices) > 0.5:
            curr["processed"] = True
            continue
            
        merged_indices = [curr_indices]
        curr["processed"] = True
        curr_set = set(curr_indices)
        
        for j in range(i + 1, len(instance_candidates)):
            other = instance_candidates[j]
            if other["processed"]: continue
            
            other_set = set(other["indices"])
            intersect = len(curr_set.intersection(other_set))
            if intersect == 0: continue
            
            union = len(curr_set.union(other_set))
            iou = intersect / union
            
            if iou > STITCHING_IOU_THRESHOLD:
                merged_indices.append(other["indices"])
                other["processed"] = True
                
        final_indices = np.unique(np.concatenate(merged_indices))
        if len(final_indices) >= MIN_POINTS:
            final_instances.append(final_indices)
            occupied_mask[final_indices] = True
            
    print(f"  - Saving {len(final_instances)} instances to {output_path}")
    
    final_ids = np.zeros(len(xyz_full), dtype=np.int32)
    for idx, indices in enumerate(final_instances):
        final_ids[indices] = idx + 1
        
    out_las = laspy.LasData(las_header)
    # Re-read points from source to ensure clean state
    out_las.points = laspy.read(sys.argv[1]).points 
    
    if "treeID" not in out_las.header.point_format.dimension_names:
        out_las.add_extra_dim(laspy.ExtraBytesParams(name="treeID", type=np.int32))
    
    out_las.treeID = final_ids
    out_las.write(output_path)

def main():
    args = get_args()
    
    with tempfile.TemporaryDirectory(dir=".") as tmp_root:
        print(f"Created temp workspace: {tmp_root}")
        
        tmp_data = os.path.join(tmp_root, "data")
        tmp_maps = os.path.join(tmp_root, "maps")
        tmp_results = os.path.join(tmp_root, "results")
        tmp_config = os.path.join(tmp_root, "config.yaml")
        
        os.makedirs(tmp_data)
        os.makedirs(tmp_maps)
        os.makedirs(tmp_results)
        
        # 1. Preprocess
        chunks, xyz_full, _ = preprocess_and_save_maps(args.input_las, tmp_data, tmp_maps)
        if not chunks:
            print("Error: No chunks created.")
            sys.exit(1)

        # 2. Config
        create_temp_config(args.config, tmp_data, tmp_config, chunks)
        
        # 3. Inference
        print("[Stage 2] Running ISBNet test.py...")
        cmd = [
            "python", "tools/test.py",
            tmp_config,
            args.checkpoint,
            "--out", tmp_results
        ]
        
        try:
            subprocess.run(cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"❌ Error running test.py: {e}")
            sys.exit(1)

        # 4. Stitch
        with laspy.open(args.input_las) as f:
            header = f.header
        stitch_and_save(xyz_full, header, tmp_results, tmp_maps, args.output_las)
        
    print("\n✅ Pipeline Complete.")

if __name__ == "__main__":
    main()