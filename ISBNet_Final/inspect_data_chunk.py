# inspect_data_chunk.py

import torch
import numpy as np
import os
import open3d as o3d  # You may need to install this: pip install open3d

# --- [ACTION REQUIRED] ---
# Set the path to the directory containing your 5 overfitting samples.
OVERFIT_DIR = r"C:\Users\Brenda\Documents\COS40007_FYPA\ISBNet\overfit_test_v5\train"
# --- [END ACTION REQUIRED] ---

def inspect_chunk(file_path):
    """
    Loads a single .pth chunk and prints detailed diagnostics.
    Also provides 3D visualizations.
    """
    print(f"\n========================================================")
    print(f"INSPECTING FILE: {os.path.basename(file_path)}")
    print(f"========================================================")

    if not os.path.exists(file_path):
        print("!!!!!! ERROR: FILE NOT FOUND !!!!!!")
        return

    # --- 1. Load the Data ---
    # We use weights_only=False because the file contains NumPy arrays
    try:
        xyz, colors, semantic_label, instance_label = torch.load(file_path, weights_only=False)
        print("✅ File loaded successfully.")
    except Exception as e:
        print(f"!!!!!! ERROR LOADING FILE: {e} !!!!!!")
        return

    # --- 2. Check Shapes and Data Types ---
    print("\n---------- 1. Shapes and Data Types ----------")
    print(f"  XYZ Coords:    shape={xyz.shape}, dtype={xyz.dtype}")
    print(f"  Colors:        shape={colors.shape}, dtype={colors.dtype}")
    print(f"  Semantic Label:shape={semantic_label.shape}, dtype={semantic_label.dtype}")
    print(f"  Instance Label:shape={instance_label.shape}, dtype={instance_label.dtype}")

    # --- 3. Check Coordinate Range and Distribution ---
    print("\n---------- 2. Coordinate Sanity Check ----------")
    # This check is for the v2 "shifted to origin" data
    min_coords = np.min(xyz, axis=0)
    max_coords = np.max(xyz, axis=0)
    mean_coords = np.mean(xyz, axis=0)
    print(f"  Min Coords (X,Y,Z): [{min_coords[0]:.2f}, {min_coords[1]:.2f}, {min_coords[2]:.2f}]")
    print(f"  Max Coords (X,Y,Z): [{max_coords[0]:.2f}, {max_coords[1]:.2f}, {max_coords[2]:.2f}]")
    print(f"  Mean Coords (X,Y,Z):[{mean_coords[0]:.2f}, {mean_coords[1]:.2f}, {mean_coords[2]:.2f}]")
    if np.any(min_coords < -0.001):
        print("  🚨 WARNING: Negative coordinates found! This should be a 'shifted-to-origin' dataset.")
    if np.any(max_coords > 40.0): # Your window is 20x20x40
        print("  🚨 WARNING: A coordinate value is very large, could be an outlier.")


    # --- 4. Check Label Sanity ---
    print("\n---------- 3. Label Sanity Check ----------")
    unique_sem = np.unique(semantic_label)
    unique_inst = np.unique(instance_label)
    print(f"  Unique Semantic Labels found: {unique_sem}")
    print(f"  Unique Instance Labels found: {unique_inst[:15]} ... (showing first 15)")

    if not np.all(np.isin(unique_sem, [-100, 0, 1])):
        print("  🚨 WARNING: Unexpected semantic labels found! Should only be -100, 0, 1.")
    
    inst_points_count = np.sum(instance_label > -100)
    print(f"\n  Total points belonging to an instance: {inst_points_count}")
    if inst_points_count == 0:
        print("  🚨 WARNING: This chunk contains NO valid instance points!")


    # --- 5. Visualization ---
    print("\n---------- 4. Visualization ----------")
    print("  Close the 3D window to proceed to the next visualization.")

    # Create Open3D point cloud object
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(xyz)

    # --- Visualization A: Natural Colors ---
    # Rescale colors from [-1, 1] to [0, 1] for visualization
    vis_colors = (colors + 1.0) / 2.0
    pcd.colors = o3d.utility.Vector3dVector(vis_colors)
    print("\n  Displaying point cloud with NATURAL colors...")
    o3d.visualization.draw_geometries([pcd], window_name="Natural Colors")

    # --- Visualization B: Instance ID Colors ---
    instance_colors = np.zeros_like(xyz)
    # Assign gray to background points
    instance_colors[instance_label == -100] = [0.5, 0.5, 0.5]
    
    # Assign a unique random color to each instance
    for inst_id in unique_inst:
        if inst_id == -100:
            continue
        mask = (instance_label == inst_id)
        # Generate a bright random color
        instance_colors[mask] = np.random.rand(3) * 0.8 + 0.2

    pcd.colors = o3d.utility.Vector3dVector(instance_colors)
    print("\n  Displaying point cloud with INSTANCE colors (background is gray)...")
    o3d.visualization.draw_geometries([pcd], window_name="Instance Colors")


if __name__ == "__main__":
    # Get the list of the 5 files
    file_list = sorted([os.path.join(OVERFIT_DIR, f) for f in os.listdir(OVERFIT_DIR) if f.endswith('.pth')])
    
    if not file_list:
        print(f"!!!!!! ERROR: No .pth files found in {OVERFIT_DIR} !!!!!!")
    else:
        # Inspect the first file in the list
        inspect_chunk(file_list[0])