# tools/save_predictions.py
import numpy as np
import torch
import os
import argparse
from tqdm import tqdm
import laspy

# Add the project root to the Python path
import sys
sys.path.append(os.getcwd())

# The rle_decode in the authors' code is just a wrapper.
# The mask files are simple text files of indices.
# We do not need a special function for it.

def get_args():
    """Parses command-line arguments."""
    parser = argparse.ArgumentParser("LAS Prediction Formatter")
    parser.add_argument("prediction_dir", type=str, help="Path to the directory with saved predictions from test.py (e.g., work_dirs/...).")
    parser.add_argument("original_data_dir", type=str, help="Path to the ORIGINAL .pth data directory that was tested.")
    parser.add_argument("output_dir", type=str, help="Directory where the final .las files will be saved.")
    args = parser.parse_args()
    return args

def create_las_file(xyz, colors_uint16, gt_labels, pred_labels, output_path):
    """Creates and writes a LAS file with both GT and Pred instance IDs."""
    try:
        header = laspy.LasHeader(version="1.4", point_format=7)
        header.add_extra_dim(laspy.ExtraBytesParams(name="gt_instance_id", type=np.int32))
        header.add_extra_dim(laspy.ExtraBytesParams(name="pred_instance_id", type=np.int32))
        las = laspy.LasData(header)

        las.x = xyz[:, 0]
        las.y = xyz[:, 1]
        las.z = xyz[:, 2]
        las.red = colors_uint16[:, 0]
        las.green = colors_uint16[:, 1]
        las.blue = colors_uint16[:, 2]
        
        las.gt_instance_id = gt_labels
        las.pred_instance_id = pred_labels
        
        las.write(output_path)
    except Exception as e:
        print(f"--> Error creating or writing LAS file at '{output_path}': {e}")

def main():
    args = get_args()
    os.makedirs(args.output_dir, exist_ok=True)
    print(f"Starting conversion to LAS format...")
    
    pred_summary_dir = os.path.join(args.prediction_dir, "pred_instance")
    if not os.path.exists(pred_summary_dir):
        print(f"FATAL ERROR: Prediction directory not found at '{pred_summary_dir}'")
        return
        
    summary_files = [f for f in os.listdir(pred_summary_dir) if f.endswith('.txt')]
    print(f"Found {len(summary_files)} predicted scenes to process.")

    for summary_filename in tqdm(sorted(summary_files), desc="Formatting Scenes to LAS"):
        scene_name = summary_filename.replace('.txt', '')
        
        # --- a. Load original data ---
        original_data_path = os.path.join(args.original_data_dir, f"{scene_name}.pth")
        if not os.path.exists(original_data_path):
            print(f"Warning: Original data file for '{scene_name}' not found. Skipping.")
            continue
        xyz, colors, _, gt_labels = torch.load(original_data_path, weights_only=False)
        colors_uint16 = ((colors + 1.0) / 2.0 * 65535).astype(np.uint16)

        # --- b. Load predictions using the authors' exact logic ---
        summary_file_path = os.path.join(pred_summary_dir, summary_filename)
        with open(summary_file_path, 'r') as f:
            masks_info = [line.strip().split() for line in f.readlines()]
        
        num_points = xyz.shape[0]
        pred_labels_final = np.full(num_points, -1, dtype=np.int32)

        if not masks_info:
            print(f"Info: No instances predicted for scene '{scene_name}'.")
        else:
            ins_num = len(masks_info)
            # This temporary array will hold IDs from 0 to ins_num-1
            temp_inst_labels = np.full(num_points, -100, dtype=np.int32)
            
            # This will store the size of each predicted instance
            ins_pointnum = np.zeros(ins_num, dtype=np.int32)

            # Sort predictions by confidence to handle overlaps correctly
            scores = np.array([float(info[2]) for info in masks_info])
            sort_inds = np.argsort(scores)[::-1] # Indices of predictions from highest to lowest score

            # Loop and "paint" the masks using their ORIGINAL index as a temporary ID
            # This is the authors' clever trick to handle overlaps
            for i_ in range(ins_num):
                original_index = sort_inds[i_]
                mask_path = os.path.join(pred_summary_dir, masks_info[original_index][0])
                
                if not os.path.exists(mask_path): continue
                
                # Use np.loadtxt for text files and specify the data type.
                mask_indices = np.loadtxt(mask_path, dtype=np.int32) # <--- CORRECT
                
                # Paint with the ORIGINAL index 'i' from the unsorted list.
                temp_inst_labels[mask_indices] = original_index

            # Now, get the size of each uniquely painted instance
            unique_temp_ids, counts = np.unique(temp_inst_labels, return_counts=True)
            for temp_id, count in zip(unique_temp_ids, counts):
                if temp_id == -100: continue
                ins_pointnum[temp_id] = count
            
            # Sort the instance IDs by their size (number of points), from largest to smallest
            sort_idx_by_size = np.argsort(ins_pointnum)[::-1]
            
            # Finally, create the clean, final labels (0, 1, 2...) where ID 0 is the largest instance.
            for final_id, original_id_from_size_sort in enumerate(sort_idx_by_size):
                # Only paint if the instance actually has points
                if ins_pointnum[original_id_from_size_sort] > 0:
                    pred_labels_final[temp_inst_labels == original_id_from_size_sort] = final_id

        # --- c. Create and save the new LAS file ---
        output_path = os.path.join(args.output_dir, f"{scene_name}_with_predictions.las")
        create_las_file(xyz, colors_uint16, gt_labels, pred_labels_final, output_path)

    print(f"\n✅ Conversion to LAS complete.")


if __name__ == "__main__":
    main()