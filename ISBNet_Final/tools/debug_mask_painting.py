# tools/debug_mask_painting.py
import numpy as np
import torch
import os
import argparse
import sys
sys.path.append(os.getcwd())
from isbnet.util import rle_decode

def get_args():
    parser = argparse.ArgumentParser("Mask Painting Debugger")
    parser.add_argument("prediction_dir")
    parser.add_argument("original_data_dir")
    parser.add_argument("output_dir")
    args = parser.parse_args()
    return args

def main():
    args = get_args()
    os.makedirs(args.output_dir, exist_ok=True)
    
    pred_summary_dir = os.path.join(args.prediction_dir, "pred_instance")
    summary_files = [f for f in os.listdir(pred_summary_dir) if f.endswith('.txt')]
    
    summary_filename = summary_files[0] # Just do the first file
    scene_name = summary_filename.replace('.txt', '')
    print(f"--- DEBUGGING SCENE: {scene_name} ---")

    # Load original data to get total point count
    original_data_path = os.path.join(args.original_data_dir, f"{scene_name}.pth")
    xyz, _, _, _ = torch.load(original_data_path, weights_only=False)
    num_points = xyz.shape[0]
    print(f"Original point cloud has {num_points} points.")

    # Create the label canvas
    pred_labels = np.full(num_points, -1, dtype=np.int32)
    print(f"Created pred_labels array of shape {pred_labels.shape} filled with -1.")

    # Load predictions
    summary_file_path = os.path.join(pred_summary_dir, summary_filename)
    with open(summary_file_path, 'r') as f:
        predictions = [line.strip().split() for line in f.readlines()]
    print(f"Found {len(predictions)} predicted instances in summary file.")

    # The painting loop
    for new_id, pred_info in enumerate(predictions):
        mask_filename = pred_info[0]
        mask_filepath = os.path.join(pred_summary_dir, mask_filename)
        print(f"\nProcessing instance {new_id} from mask file: {mask_filename}")
        
        mask_indices = np.load(mask_filepath)
        print(f"  -> Loaded {len(mask_indices)} indices from the file.")
        
        # Check for out-of-bounds indices
        if np.any(mask_indices >= num_points) or np.any(mask_indices < 0):
            print("  !!!!!! FATAL ERROR: Mask contains indices that are out of bounds for the point cloud!")
            max_idx = np.max(mask_indices)
            print(f"  Max index in mask: {max_idx}, but point cloud size is only {num_points}.")
            return
            
        print(f"  -> Painting {len(mask_indices)} points with new ID: {new_id}")
        pred_labels[mask_indices] = new_id
        
        # Verification step
        unique_vals, counts = np.unique(pred_labels, return_counts=True)
        print(f"  -> Verification: Unique labels in array are now: {unique_vals}")
        print(f"  -> Counts for each label: {counts}")

    output_path = os.path.join(args.output_dir, f"{scene_name}_debug_pred_labels.txt")
    np.savetxt(output_path, pred_labels, fmt="%d")
    print(f"\n--- Saved final debug labels to {output_path} ---")
    final_unique, final_counts = np.unique(pred_labels, return_counts=True)
    print(f"Final unique labels in saved file: {final_unique}")
    print(f"Final counts: {final_counts}")

if __name__ == "__main__":
    main()