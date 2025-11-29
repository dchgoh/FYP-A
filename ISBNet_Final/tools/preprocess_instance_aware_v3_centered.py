# preprocess_instance_aware_v4_final_centered.py

import numpy as np
import laspy
import torch
import os
import multiprocessing as mp
from tqdm import tqdm
import pandas as pd
from sklearn.model_selection import train_test_split
import warnings

# ==============================================================================
# SCRIPT CONFIGURATION
# ==============================================================================

# --- [ACTION REQUIRED] ---
BASE_DATA_DIR = "/fred/oz419/brenda/FOR-Instance/unpreprocessed"
METADATA_FILE_PATH = os.path.join(BASE_DATA_DIR, "data_split_metadata.csv")

# =================================================================
# IMPORTANT: Use a new, definitive directory name for this final dataset.
# =================================================================
OUTPUT_PARENT_DIR = os.path.join(BASE_DATA_DIR, "processed_instance_aware_v5_final_centered")
# =================================================================

# --- CHUNKING STRATEGY ---
#SAMPLE_WINDOW_SIZE = (20.0, 20.0, 40.0) # (Width_X, Width_Y, Height_Z)
SAMPLE_WINDOW_SIZE = (40.0, 40.0, 40.0) # (Width_X, Width_Y, Height_Z)

# --- LABEL MAPPING CONFIGURATION ---
TREE_CLASSES_RAW = {4, 5, 6}
SEMANTIC_LABEL_MAP = {
    0: -100, 1: 0, 2: 0, 3: -100, 4: 1, 5: 1, 6: 1
}
MIN_POINTS_PER_TREE = 100

# ==============================================================================
# CORE PROCESSING FUNCTION
# ==============================================================================

def process_las_file(las_path, output_dir):
    """
    Reads a single large LAS file, creates multiple instance-centric chunks from it,
    and saves each chunk as a separate .pth file with robust two-stage normalization.
    """
    file_basename = os.path.basename(las_path)
    try:
        if not os.path.exists(las_path):
            return f"Skipping {file_basename}: File not found."

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            las = laspy.read(las_path)

        if 'treeID' not in las.point_format.dimension_names:
            return f"Skipping {file_basename}: 'treeID' attribute not found."

        # --- Stage 1 Normalization (Scene Level) ---
        xyz_raw = np.vstack((las.x, las.y, las.z)).T.astype(np.float32)
        # First, shift the ENTIRE scene to the origin to remove huge global offsets.
        # This makes all subsequent calculations numerically stable.
        xyz = xyz_raw - xyz_raw.min(0)

        # Color and label extraction (no changes here)
        red = (las.red.astype(np.float32) / 65535.0) * 2.0 - 1.0
        green = (las.green.astype(np.float32) / 65535.0) * 2.0 - 1.0
        blue = (las.blue.astype(np.float32) / 65535.0) * 2.0 - 1.0
        colors = np.vstack((red, green, blue)).T.astype(np.float32)
        
        semantic_labels_raw = np.array(las.classification, dtype=np.int64)
        instance_labels_raw = np.array(las.treeID, dtype=np.int64)

        # --- Instance Identification (no changes here) ---
        unique_instance_ids = np.unique(instance_labels_raw)
        valid_tree_ids_to_process = []
        for inst_id in unique_instance_ids:
            if inst_id <= 0: continue
            inst_mask = (instance_labels_raw == inst_id)
            sem_classes_for_inst = np.unique(semantic_labels_raw[inst_mask])
            is_tree = any(sem_class in TREE_CLASSES_RAW for sem_class in sem_classes_for_inst)
            if is_tree and np.sum(inst_mask) >= MIN_POINTS_PER_TREE:
                valid_tree_ids_to_process.append(inst_id)
        
        if not valid_tree_ids_to_process:
            return f"Skipping {file_basename}: No valid tree instances found."

        # --- Chunk Creation Loop ---
        chunks_created_count = 0
        for tree_id in valid_tree_ids_to_process:
            tree_points_mask = (instance_labels_raw == tree_id)
            tree_xyz = xyz[tree_points_mask] # Use the scene-shifted xyz
            
            tree_centroid = np.mean(tree_xyz, axis=0)
            min_bound = tree_centroid - np.array(SAMPLE_WINDOW_SIZE) / 2.0
            max_bound = tree_centroid + np.array(SAMPLE_WINDOW_SIZE) / 2.0
            
            chunk_mask = np.all((xyz >= min_bound) & (xyz <= max_bound), axis=1)
            
            if np.sum(chunk_mask) == 0: continue

            chunk_xyz_raw = xyz[chunk_mask]
            chunk_colors = colors[chunk_mask]
            chunk_sem_labels_raw = semantic_labels_raw[chunk_mask]
            chunk_inst_labels_raw = instance_labels_raw[chunk_mask]

            # --- Stage 2 Normalization (Chunk Level) ---
            # Now, center the smaller, numerically stable chunk around the origin.
            # This is the final format expected by the model.
            chunk_xyz_final = chunk_xyz_raw - chunk_xyz_raw.mean(0)
            
            # --- Label Processing (no changes here) ---
            map_func_sem = np.vectorize(SEMANTIC_LABEL_MAP.get)
            chunk_sem_labels_final = map_func_sem(chunk_sem_labels_raw)
            
            unique_instances_in_chunk = np.unique(chunk_inst_labels_raw)
            valid_instances = sorted([inst_id for inst_id in unique_instances_in_chunk if inst_id > 0])
            inst_map = {original_id: new_id for new_id, original_id in enumerate(valid_instances)}
            
            map_func_inst = lambda x: inst_map.get(x, -100)
            chunk_inst_labels_final = np.vectorize(map_func_inst, otypes=[np.int64])(chunk_inst_labels_raw)
            
            if np.all(chunk_inst_labels_final == -100):
                continue

            # --- Save the Final Data ---
            final_data_tuple = (
                chunk_xyz_final, # The final, centered coordinates
                chunk_colors,
                chunk_sem_labels_final,
                chunk_inst_labels_final
            )

            output_filename = f"{file_basename.replace('.las', '')}_treeID_{tree_id}.pth"
            output_path = os.path.join(output_dir, output_filename)
            
            torch.save(final_data_tuple, output_path)
            chunks_created_count += 1
            
        return f"Processed {file_basename}: Created {chunks_created_count} chunks."

    except Exception as e:
        return f"ERROR processing {file_basename}: {e}"

# ==============================================================================
# MAIN EXECUTION SCRIPT (No changes needed here)
# ==============================================================================

if __name__ == '__main__':
    # ... (This part of the script is correct and does not need changes)
    OUTPUT_TRAIN_DIR = os.path.join(OUTPUT_PARENT_DIR, "train")
    OUTPUT_VAL_DIR = os.path.join(OUTPUT_PARENT_DIR, "val")
    OUTPUT_TEST_DIR = os.path.join(OUTPUT_PARENT_DIR, "test")
    
    os.makedirs(OUTPUT_TRAIN_DIR, exist_ok=True)
    os.makedirs(OUTPUT_VAL_DIR, exist_ok=True)
    os.makedirs(OUTPUT_TEST_DIR, exist_ok=True)
    
    print(f"Reading metadata from: {METADATA_FILE_PATH}")
    try:
        df = pd.read_csv(METADATA_FILE_PATH)
    except FileNotFoundError:
        print(f"❌ CRITICAL ERROR: Metadata file not found. Exiting.")
        exit()

    dev_files_relative = df[df["split"] == "dev"]["path"].tolist()
    test_files_relative = df[df["split"] == "test"]["path"].tolist()
    
    if not dev_files_relative:
        print("⚠ Warning: No 'dev' files found in metadata. Train/Val sets will be empty.")
        train_files_relative, val_files_relative = [], []
    else:
        train_files_relative, val_files_relative = train_test_split(
            dev_files_relative, test_size=0.2, random_state=42
        )

    train_files_full = [os.path.join(BASE_DATA_DIR, p) for p in train_files_relative]
    val_files_full = [os.path.join(BASE_DATA_DIR, p) for p in val_files_relative]
    test_files_full = [os.path.join(BASE_DATA_DIR, p) for p in test_files_relative]

    print(f"\nFile split loaded:")
    print(f"  - Total training files to process: {len(train_files_full)}")
    print(f"  - Total validation files to process: {len(val_files_full)}")
    print(f"  - Total test files to process: {len(test_files_full)}")
    
    num_processes = mp.cpu_count()
    
    print(f"\n--- Starting TRAIN set preprocessing with {num_processes} processes ---")
    with mp.Pool(processes=num_processes) as pool:
        args = [(f, OUTPUT_TRAIN_DIR) for f in train_files_full]
        results = list(tqdm(pool.starmap(process_las_file, args), total=len(args)))
        
    print(f"\n--- Starting VAL set preprocessing with {num_processes} processes ---")
    with mp.Pool(processes=num_processes) as pool:
        args = [(f, OUTPUT_VAL_DIR) for f in val_files_full]
        results = list(tqdm(pool.starmap(process_las_file, args), total=len(args)))

    print(f"\n--- Starting TEST set preprocessing with {num_processes} processes ---")
    with mp.Pool(processes=num_processes) as pool:
        args = [(f, OUTPUT_TEST_DIR) for f in test_files_full]
        results = list(tqdm(pool.starmap(process_las_file, args), total=len(args)))

    print("\n✅ Preprocessing complete.")
    print(f"   Processed training chunks saved to: {OUTPUT_TRAIN_DIR}")
    print(f"   Processed validation chunks saved to: {OUTPUT_VAL_DIR}")
    print(f"   Processed test chunks saved to: {OUTPUT_TEST_DIR}")