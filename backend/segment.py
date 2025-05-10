import torch
import numpy as np
import laspy # Or from pylas import read
import argparse
import os

# Import your model definition
from models.pointnet_sem_seg import get_model as PointNetSemSeg

# --- Configuration ---
DEFAULT_NUM_CLASSES = 7 # IMPORTANT: Change if your model was trained with a different number
DEFAULT_NUM_POINTS = 1024 # Number of points the model expects per sample
DEFAULT_INPUT_CHANNELS = 6 # IMPORTANT: Matches the 'channel=6' in your get_model -> PointNetEncoder
                           # Typically XYZ + RGB or XYZ + Normals. Adjust based on your model and data.

def load_las_data(las_file_path):
    """Loads XYZ and potentially other features from a LAS file."""
    # Using laspy
    try:
        with laspy.open(las_file_path) as f:
            las = f.read()
        print(f"LAS file loaded. Header: {las.header}")
        print(f"Available point format fields: {list(las.point_format.dimension_names)}")

        points = np.vstack((las.x, las.y, las.z)).transpose()

        # --- Feature Extraction (Crucial Step) ---
        # Attempt to get the required features (Defaulting to 6: XYZ + RGB)
        # Modify this based on your actual LAS data and model requirements!
        features = points # Start with XYZ

        if DEFAULT_INPUT_CHANNELS > 3:
             # Try common additional features
            has_rgb = all(dim in las.point_format.dimension_names for dim in ['red', 'green', 'blue'])
            has_intensity = 'intensity' in las.point_format.dimension_names
            # has_normals = False # Add logic if you have normals

            add_features = []
            required_additional = DEFAULT_INPUT_CHANNELS - 3

            if has_rgb and required_additional >= 3:
                 # Normalize RGB to 0-1 (assuming 16-bit color)
                 print("Using RGB features.")
                 rgb = np.vstack((las.red / 65535.0, las.green / 65535.0, las.blue / 65535.0)).transpose()
                 add_features.append(rgb)
                 required_additional -= 3
            # elif has_normals and required_additional >= 3: # Add if needed
            #     print("Using Normal features.")
            #     normals = np.vstack((las.nx, las.ny, las.nz)).transpose() # Adjust field names if necessary
            #     add_features.append(normals)
            #     required_additional -= 3

            if has_intensity and required_additional >= 1:
                print("Using Intensity feature.")
                 # Normalize intensity if needed (range varies)
                intensity = las.intensity.reshape(-1, 1) # .astype(np.float32) / 65535.0 # Example normalization
                add_features.append(intensity)
                required_additional -= 1

            # Add dummy features if still needed (Not recommended, but possible)
            if required_additional > 0:
                 print(f"Warning: Adding {required_additional} dummy features (zeros). Model performance may be affected.")
                 dummy = np.zeros((points.shape[0], required_additional), dtype=np.float32)
                 add_features.append(dummy)

            if add_features:
                 features = np.hstack([features] + add_features)


        if features.shape[1] != DEFAULT_INPUT_CHANNELS:
             raise ValueError(f"Error: Extracted {features.shape[1]} features, but model expects {DEFAULT_INPUT_CHANNELS}. Check LAS fields and DEFAULT_INPUT_CHANNELS.")

        print(f"Loaded {points.shape[0]} points with {features.shape[1]} features each.")
        return points, features.astype(np.float32)

    except FileNotFoundError:
        print(f"Error: LAS file not found at {las_file_path}")
        exit()
    except Exception as e:
        print(f"Error loading LAS file: {e}")
        exit()


def preprocess_points(points, features, num_points_target):
    """Normalizes, samples/repeats points, and formats for the model."""
    n_pts_original = points.shape[0]

    # --- 1. Normalization (Example: Center the point cloud) ---
    # More sophisticated normalization might be needed depending on training
    centroid = np.mean(points, axis=0)
    points_normalized = points - centroid
    # features_normalized = features # Normalize features if needed (e.g., scale RGB)
    # For simplicity here, only normalizing XYZ in 'points_normalized'
    # The 'features' array still holds original/scaled features for input
    features_normalized = features.copy()
    features_normalized[:, :3] = points_normalized # Put normalized XYZ into features array

    print(f"Points centered around centroid: {centroid}")

    # --- 2. Sampling or Repeating Points ---
    if n_pts_original == num_points_target:
        print(f"Using all {n_pts_original} points.")
        choice = np.arange(n_pts_original) # Keep original order
    elif n_pts_original > num_points_target:
        print(f"Sampling {num_points_target} points from {n_pts_original}...")
        choice = np.random.choice(n_pts_original, num_points_target, replace=False)
    else: # n_pts_original < num_points_target
        print(f"Repeating points to reach {num_points_target} from {n_pts_original}...")
        # Sample with replacement, ensuring all original points are included at least once
        choice = np.random.choice(n_pts_original, num_points_target, replace=True)
        # Ensure original points are included (might slightly exceed target, then trim)
        # A simpler approach for smaller deficits: just repeat existing points randomly
        # choice = np.random.choice(n_pts_original, num_points_target - n_pts_original, replace=True)
        # choice = np.concatenate([np.arange(n_pts_original), choice])[:num_points_target]


    sampled_features = features_normalized[choice, :]

    # --- 3. Formatting for PyTorch ---
    # Model expects (batch_size, num_channels, num_points)
    # Transpose features: (num_points, num_channels) -> (num_channels, num_points)
    # Add batch dimension: (num_channels, num_points) -> (1, num_channels, num_points)
    tensor_data = torch.from_numpy(sampled_features).transpose(0, 1).unsqueeze(0)

    print(f"Data shape ready for model: {tensor_data.shape}")
    return tensor_data, choice # Return choice to map predictions back

def save_segmented_las(original_las_path, output_las_path, points, features, predictions, choice_indices, full_cloud_preds=None):
    """Saves a new LAS file with predicted classification labels."""
    try:
        # Read the header and point data from the original file
        with laspy.open(original_las_path) as infile:
            header = infile.header
            # Create a new LAS file with the same header, but adding classification
            outfile = laspy.create(point_format=header.point_format, file_version=header.version)
            outfile.header = header # Copy header info

            # Check if classification field exists, add if not standard
            if 'classification' not in outfile.point_format.dimension_names:
                 # This might require adjusting point format ID if not standard
                 print("Warning: 'classification' field not standard in source format. Adding it.")
                 # A common approach is to upgrade the format if possible, e.g., to 6
                 # Or add it as an extra dimension if format allows
                 # For simplicity, we'll just try to add it. This might fail for some formats.
                 try:
                      outfile.add_dimension('classification', 'uint8')
                 except Exception as e:
                      print(f"Could not add classification dimension: {e}. Saving without classifications.")
                      outfile.points = infile.read().points # Save original points only
                      outfile.write(output_las_path)
                      return


            # Get original points to write
            las_data = infile.read()
            outfile.points = las_data.points # Copy all original point data

            # Assign predictions back to the correct points
            # Create a full prediction array for all original points, default to 0 (unclassified)
            full_predictions = np.zeros(len(las_data.points), dtype=np.uint8)

            if full_cloud_preds is not None:
                # If predictions for the full cloud were generated (e.g. via tiling)
                if len(full_cloud_preds) == len(las_data.points):
                     full_predictions = full_cloud_preds.astype(np.uint8)
                else:
                     print(f"Warning: Full cloud predictions length ({len(full_cloud_preds)}) doesn't match original points ({len(las_data.points)}). Using sampled predictions.")
                     # Fallback to sampled predictions if length mismatch
                     full_predictions[choice_indices] = predictions.astype(np.uint8)
            else:
                 # Map predictions from the sampled points back to their original indices
                if choice_indices is not None:
                     # Handle potential duplicate indices from sampling with replacement
                     # Assign the prediction to the *first* occurrence of an index if duplicated
                    unique_indices, first_occurrence_map = np.unique(choice_indices, return_index=True)
                    unique_preds = predictions[first_occurrence_map]
                    # Ensure we don't try to write out of bounds if original cloud was smaller
                    valid_mask = unique_indices < len(full_predictions)
                    full_predictions[unique_indices[valid_mask]] = unique_preds[valid_mask].astype(np.uint8)
                    print(f"Mapped predictions for {len(unique_indices)} unique points.")
                else:
                     print("Warning: No index mapping provided. Cannot map sampled predictions back. Saving without classifications.")


            # Write the classification values
            outfile.classification = full_predictions

            outfile.write(output_las_path)
            print(f"Segmented LAS file saved to: {output_las_path}")

    except Exception as e:
        print(f"Error saving segmented LAS file: {e}")


def main(args):
    # --- Device Setup ---
    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    print(f"Using device: {device}")

    # --- Load Data ---
    print(f"Loading LAS file: {args.input_las}")
    points_xyz, features_all = load_las_data(args.input_las)
    original_num_points = points_xyz.shape[0]

    # --- Model Initialization ---
    print(f"Initializing PointNet model for {args.num_classes} classes...")
    model = PointNetSemSeg(num_classes=args.num_classes)
    # Ensure the model's internal channel count matches expectations
    # (This check is indirect, relying on DEFAULT_INPUT_CHANNELS used in data loading)
    if model.feat.conv1.in_channels != DEFAULT_INPUT_CHANNELS:
         print(f"Warning: Model's first layer expects {model.feat.conv1.in_channels} channels, but data was loaded with {DEFAULT_INPUT_CHANNELS}. Mismatch may cause errors or poor results.")


    # --- Load Pre-trained Weights ---
    try:
        print(f"Loading weights from: {args.model_path}")
        # Load checkpoint onto the correct device
        checkpoint = torch.load(args.model_path, map_location=device,  weights_only=False)
        model.load_state_dict(checkpoint, strict=False)
        # Adjust based on how the weights were saved (e.g., 'model_state_dict', 'state_dict', or direct)
        state_dict = checkpoint
        if 'model_state_dict' in checkpoint:
            state_dict = checkpoint['model_state_dict']
        elif 'state_dict' in checkpoint:
             state_dict = checkpoint['state_dict']

        # Handle potential DataParallel prefix 'module.'
        if all(k.startswith('module.') for k in state_dict.keys()):
            print("Removing 'module.' prefix from state dict keys.")
            state_dict = {k.replace('module.', ''): v for k, v in state_dict.items()}

        model.load_state_dict(state_dict)
        print("Weights loaded successfully.")
    except FileNotFoundError:
        print(f"Error: Model file not found at {args.model_path}")
        exit()
    except Exception as e:
        print(f"Error loading model weights: {e}")
        print("Ensure the model architecture in pointnet_sem_seg.py matches the saved weights.")
        exit()

    model.to(device)
    model.eval() # Set model to evaluation mode

    # --- Preprocessing ---
    # Note: If the point cloud is very large, you might need to process it in tiles/batches.
    # This basic script processes the whole (sampled) cloud at once.
    print(f"Preprocessing data for {args.num_points} points...")
    input_tensor, choice_indices = preprocess_points(points_xyz, features_all, args.num_points)
    input_tensor = input_tensor.to(device)

    # --- Inference ---
    print("Running inference...")
    with torch.no_grad(): # Disable gradient calculation
        # pred, _ = model(input_tensor) # Original model returns trans_feat too
        outputs = model(input_tensor)
        # Handle tuple output if necessary (check return signature of your model)
        if isinstance(outputs, tuple):
             pred = outputs[0] # Assuming first element is the prediction scores
             # trans_feat = outputs[1] # You might not need this for inference
        else:
             pred = outputs # Assuming direct output

    # pred shape: (batch_size, num_points, num_classes), e.g., (1, 2048, 13)
    pred = pred.squeeze(0) # Remove batch dimension -> (num_points, num_classes)
    predictions = torch.argmax(pred, dim=1) # Get class index with highest score for each point
    predictions_np = predictions.cpu().numpy() # Move to CPU and convert to NumPy array

    print(f"Inference complete. Predicted classes shape: {predictions_np.shape}")

    # --- Save Results ---
    if args.output_las:
        print("Saving predictions to new LAS file...")
        # Use the choice_indices to map the predictions back to the original point indices
        save_segmented_las(args.input_las, args.output_las,
                           points_xyz, features_all, predictions_np, choice_indices)
    else:
        print("No output LAS file specified. Predictions:")
        # Print some example predictions
        for i in range(min(10, len(predictions_np))):
             print(f"  Point {choice_indices[i]} (sampled index {i}): Predicted class {predictions_np[i]}")

    print("Processing finished.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Segment a LAS point cloud using a pre-trained PointNet model.")
    parser.add_argument("input_las", help="Path to the input LAS file.")
    parser.add_argument("model_path", help="Path to the pre-trained model (.pth file).")
    parser.add_argument("-o", "--output_las", help="Path to save the output segmented LAS file.", default=None)
    parser.add_argument("--num_classes", type=int, default=DEFAULT_NUM_CLASSES,
                        help=f"Number of classes the model was trained for (default: {DEFAULT_NUM_CLASSES}). MUST match the model!")
    parser.add_argument("--num_points", type=int, default=DEFAULT_NUM_POINTS,
                        help=f"Number of points per sample the model expects (default: {DEFAULT_NUM_POINTS}).")
    # Add argument for channel count if it needs to be flexible, though it's tied to the model arch
    # parser.add_argument("--channels", type=int, default=DEFAULT_INPUT_CHANNELS, help="Number of input features per point.")
    parser.add_argument("--cpu", action="store_true", help="Force CPU usage even if CUDA is available.")

    args = parser.parse_args()

    # Basic validation
    if not os.path.exists(args.input_las):
        print(f"Error: Input LAS file not found: {args.input_las}")
        exit()
    if not os.path.exists(args.model_path):
        print(f"Error: Model file not found: {args.model_path}")
        exit()

    main(args)