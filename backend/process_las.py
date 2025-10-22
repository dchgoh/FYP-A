import laspy
import numpy as np
from pyproj import CRS, Transformer
import sys
import json
import os
import traceback
import torch
import importlib
from scipy.optimize import least_squares
from pathlib import Path
import yaml
from munch import Munch

# Add the models directory to Python path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(BASE_DIR, 'models'))

# --- Configuration ---
SOURCE_EPSG_COORD_TRANSFORM = 29874
TARGET_EPSG_COORD_TRANSFORM = 4326
ID_FIELD_NAME_FOR_TREES = "treeID"
VALUES_TO_IGNORE_FOR_TREES = {0}
MIN_ID_VALUE_FOR_TREES = 1
HEIGHT_ADJUSTMENT_VALUE_FOR_L = 1.3
DBH_HEIGHT_ABOVE_GROUND = 1.3
DBH_VERTICAL_SLICE_THICKNESS = 0.20
DBH_MIN_POINTS_FOR_FIT = 5
ASSUMED_SMALL_END_DIAMETER_D2_CM = 0.0

# --- Segmentation Configuration ---
SEMANTIC_MODEL_NAME = "pointnet_sem_seg"  # Change this based on your model
SEMANTIC_CHECKPOINT = os.path.join(BASE_DIR, "checkpoints", "pointnet_sem_seg.pth")
INSTANCE_CONFIG = os.path.join(BASE_DIR, "configs", "config_forinstance.yaml")
INSTANCE_CHECKPOINT = os.path.join(BASE_DIR, "checkpoints", "pointnet2_msg_best_model.pth")
NUM_CLASSES = 7
CHUNK_SIZE = (20.0, 20.0, 40.0)
CHUNK_OVERLAP = 0.5
STITCHING_IOU_THRESHOLD = 0.25


# --- Helper Functions ---
def log_stderr(module_name, msg):
    print(f"Python ({module_name}): {msg}", file=sys.stderr)

def load_semantic_model():
    try:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        MODEL = importlib.import_module(SEMANTIC_MODEL_NAME)
        classifier = MODEL.get_model(NUM_CLASSES).to(device)
        checkpoint = torch.load(SEMANTIC_CHECKPOINT, map_location=device)
        classifier.load_state_dict(checkpoint['model_state_dict'])
        classifier.eval()
        return classifier, device
    except Exception as e:
        log_stderr("Semantic Model", f"Failed to load semantic model: {e}")
        raise

def process_semantic_segmentation(points, colors, classifier, device):
    """Run semantic segmentation on the point cloud"""
    try:
        num_points = points.shape[0]
        predictions = np.zeros(num_points, dtype=np.int64)
        points_mean = np.mean(points, axis=0)
        points = points - points_mean
        
        # Process in batches
        batch_size = 16
        num_point_model = 1024
        num_batches = int(np.ceil(num_points / (batch_size * num_point_model)))
        
        with torch.no_grad():
            for batch_idx in range(num_batches):
                start_idx = batch_idx * batch_size * num_point_model
                end_idx = min(start_idx + batch_size * num_point_model, num_points)
                
                batch_points = points[start_idx:end_idx]
                batch_colors = colors[start_idx:end_idx]
                batch_features = np.concatenate([batch_points, batch_colors], axis=1)
                batch_features = torch.FloatTensor(batch_features).to(device)
                
                batch_predictions = classifier(batch_features.unsqueeze(0))
                pred_val = batch_predictions.max(dim=1)[1]
                predictions[start_idx:end_idx] = pred_val.cpu().numpy()
        
        return predictions
    except Exception as e:
        log_stderr("Semantic Segmentation", f"Failed to process semantic segmentation: {e}")
        raise

def process_instance_segmentation(input_path, semantic_labels):
    """Run instance segmentation using the enhanced pipeline"""
    try:
        from run_inference_local_enhanced import main as instance_main
        output_path = input_path.replace('.las', '_instance.las')
        
        # Prepare arguments for instance segmentation
        class Args:
            def __init__(self):
                self.input_las = input_path
                self.output_las = output_path
                self.config = INSTANCE_CONFIG
                self.checkpoint = INSTANCE_CHECKPOINT
                self.sem_model = SEMANTIC_MODEL_NAME
                self.sem_checkpoint = SEMANTIC_CHECKPOINT
                self.gpu = '0'
                self.num_point_model = 1024
                self.batch_size = 16
        
        args = Args()
        instance_main(args, semantic_labels)
        return output_path
    except Exception as e:
        log_stderr("Instance Segmentation", f"Failed to process instance segmentation: {e}")
        raise

def extract_tree_ids_from_extra_bytes(las_file_obj, id_field_name, ignore_values, min_id_value):
    """Extract tree IDs directly from extra bytes data"""
    try:
        if hasattr(las_file_obj, 'points') and hasattr(las_file_obj.points, 'ExtraBytes'):
            extra_bytes_data = las_file_obj.points.ExtraBytes
            if extra_bytes_data.size > 0:
                # Convert uint8 array to float32 values (first 4 bytes = treeID)
                tree_ids_raw = extra_bytes_data[:, 0:4].view(np.float32).flatten()
                return tree_ids_raw
        return None
    except Exception as e:
        log_stderr("ExtraBytes", f"Failed to extract tree IDs from extra bytes: {e}")
        return None

def extract_tree_ids_from_lidar(
    las_file_obj,
    id_field_name,
    ignore_values,
    min_id_value
):
    potential_tree_ids = set()
    log_stderr("TreeID", f"Attempting to use field: '{id_field_name}' for Tree IDs.")
    
    # Debug: Check VLRs
    try:
        log_stderr("TreeID", f"Number of VLRs: {len(las_file_obj.header.vlrs)}")
        for i, vlr in enumerate(las_file_obj.header.vlrs):
            log_stderr("TreeID", f"VLR {i}: user_id='{vlr.user_id}', record_id={vlr.record_id}")
            if hasattr(vlr, 'record_length_after_header'):
                log_stderr("TreeID", f"VLR {i} length: {vlr.record_length_after_header}")
            elif hasattr(vlr, 'length_after_header'):
                log_stderr("TreeID", f"VLR {i} length: {vlr.length_after_header}")
            else:
                log_stderr("TreeID", f"VLR {i} length: {len(vlr.string)}")
    except Exception as e:
        log_stderr("TreeID", f"VLR debug failed: {e}")
        import traceback
        log_stderr("TreeID", f"VLR traceback: {traceback.format_exc()}")
    
    try:
        # Check if treeID field exists using safer methods
        has_tree_id_direct = hasattr(las_file_obj, id_field_name)
        has_tree_id_in_points = False
        has_tree_id_in_extra_bytes = False
        
        # Try to access points structure safely
        try:
            if hasattr(las_file_obj, 'points'):
                # Try to access the field directly from points
                try:
                    test_access = las_file_obj.points[id_field_name]
                    has_tree_id_in_points = True
                except (KeyError, AttributeError):
                    has_tree_id_in_points = False
        except Exception:
            has_tree_id_in_points = False
        
        # Try to access from extra bytes if available
        if not has_tree_id_direct and not has_tree_id_in_points:
            try:
                log_stderr("TreeID", f"Checking extra_bytes attribute...")
                if hasattr(las_file_obj, 'extra_bytes'):
                    log_stderr("TreeID", f"extra_bytes exists: {type(las_file_obj.extra_bytes)}")
                    log_stderr("TreeID", f"extra_bytes dir: {dir(las_file_obj.extra_bytes)}")
                    if hasattr(las_file_obj.extra_bytes, id_field_name):
                        test_access = las_file_obj.extra_bytes[id_field_name]
                        has_tree_id_in_extra_bytes = True
                        log_stderr("TreeID", f"Found '{id_field_name}' in extra_bytes.")
                    else:
                        log_stderr("TreeID", f"'{id_field_name}' not found in extra_bytes.")
                else:
                    log_stderr("TreeID", f"extra_bytes attribute does not exist.")
            except Exception as e:
                log_stderr("TreeID", f"Extra bytes access failed: {e}")
                import traceback
                log_stderr("TreeID", f"Traceback: {traceback.format_exc()}")
        
        # Try to access extra bytes data directly from point records
        if not has_tree_id_direct and not has_tree_id_in_points and not has_tree_id_in_extra_bytes:
            try:
                log_stderr("TreeID", f"Trying to access extra bytes data directly...")
                # Check if we can access the raw extra bytes data
                if hasattr(las_file_obj, 'points') and hasattr(las_file_obj.points, 'ExtraBytes'):
                    extra_bytes_data = las_file_obj.points.ExtraBytes
                    log_stderr("TreeID", f"ExtraBytes shape: {extra_bytes_data.shape}")
                    log_stderr("TreeID", f"ExtraBytes dtype: {extra_bytes_data.dtype}")
                    log_stderr("TreeID", f"ExtraBytes first few values: {extra_bytes_data[:5]}")
                    
                    # Try to interpret the extra bytes as treeID (assuming it's the first 4 bytes)
                    if extra_bytes_data.size > 0:
                        # For LAS format 3 with 2 extra bytes (8 bytes total), treeID should be first 4 bytes
                        # Convert uint8 array to float32 values
                        tree_ids_raw = extra_bytes_data[:, 0:4].view(np.float32).flatten()
                        log_stderr("TreeID", f"Raw treeID values (first 10): {tree_ids_raw[:10]}")
                        
                        # Convert to numpy array and find unique values
                        ids_per_point_np = np.array(tree_ids_raw)
                        unique_ids_all = np.unique(ids_per_point_np)
                        processed_ignore_values = set(ignore_values) if ignore_values is not None else set()

                        for uid_val in unique_ids_all:
                            try: uid = int(uid_val)
                            except ValueError: continue
                            if uid in processed_ignore_values: continue
                            if min_id_value is not None and uid < min_id_value: continue
                            potential_tree_ids.add(uid)

                        if potential_tree_ids:
                            log_stderr("TreeID", f"Found {len(potential_tree_ids)} tree IDs from raw extra bytes data")
                            return potential_tree_ids
                        else:
                            log_stderr("TreeID", f"No valid tree IDs found in raw extra bytes data")
                            log_stderr("TreeID", f"Unique values found: {unique_ids_all[:20]}")
                else:
                    log_stderr("TreeID", f"No ExtraBytes field found in points")
            except Exception as e:
                log_stderr("TreeID", f"Direct extra bytes access failed: {e}")
                import traceback
                log_stderr("TreeID", f"Direct access traceback: {traceback.format_exc()}")
        
        # Final fallback - return empty set if all methods failed
        if not has_tree_id_direct and not has_tree_id_in_points and not has_tree_id_in_extra_bytes:
            log_stderr("TreeID", f"Error: Field '{id_field_name}' NOT FOUND. Header Standard: {list(las_file_obj.header.point_format.dimension_names)}, Header Extra: {list(getattr(las_file_obj.header.point_format, 'extra_dimension_names', []))}")
            return set()

        ids_per_point_view = None
        try:
            ids_per_point_view = getattr(las_file_obj, id_field_name)
            log_stderr("TreeID", f"Accessed '{id_field_name}' as direct dimension.")
        except AttributeError:
            if has_tree_id_in_points:
                ids_per_point_view = las_file_obj.points[id_field_name]
                log_stderr("TreeID", f"Accessed '{id_field_name}' from las.points structure.")
            elif has_tree_id_in_extra_bytes:
                ids_per_point_view = las_file_obj.extra_bytes[id_field_name]
                log_stderr("TreeID", f"Accessed '{id_field_name}' from extra_bytes.")
            else:
                log_stderr("TreeID", f"Critical Error: Field '{id_field_name}' still not accessible.")
                return set()

        ids_per_point_np = np.array(ids_per_point_view)
        unique_ids_all = np.unique(ids_per_point_np)
        processed_ignore_values = set(ignore_values) if ignore_values is not None else set()

        for uid_val in unique_ids_all:
            try: uid = int(uid_val)
            except ValueError: continue
            if uid in processed_ignore_values: continue
            if min_id_value is not None and uid < min_id_value: continue
            potential_tree_ids.add(uid)

        if not potential_tree_ids:
            log_stderr("TreeID", f"No tree IDs found after filtering.")
        else:
            log_stderr("TreeID", f"NUMBER OF TREES IDENTIFIED: {len(potential_tree_ids)}")
        return potential_tree_ids
    except Exception as e:
        log_stderr("TreeID", f"An error occurred during tree ID extraction: {e}\n{traceback.format_exc()}")
    return set()


def calculate_tree_midpoints(
    las_file_obj,
    id_field_name,
    target_tree_ids
):
    tree_midpoints_dict = {}
    if not target_tree_ids:
        log_stderr("Midpoint", "No target tree IDs for midpoint calculation.")
        return {}
    try:
        x_coords_np = np.array(las_file_obj.x)
        y_coords_np = np.array(las_file_obj.y)
        z_coords_np = np.array(las_file_obj.z)
        ids_for_calc_np = None
        try:
            ids_for_calc_np = np.array(getattr(las_file_obj, id_field_name))
        except AttributeError:
            # Try to get tree IDs from extra bytes
            ids_for_calc_np = extract_tree_ids_from_extra_bytes(las_file_obj, id_field_name, None, None)
            if ids_for_calc_np is None:
                try:
                    if hasattr(las_file_obj, 'points'):
                        ids_for_calc_np = np.array(las_file_obj.points[id_field_name])
                    elif hasattr(las_file_obj, 'extra_bytes') and hasattr(las_file_obj.extra_bytes, id_field_name):
                        ids_for_calc_np = np.array(las_file_obj.extra_bytes[id_field_name])
                    else:
                        log_stderr("Midpoint", f"Error: ID field '{id_field_name}' not accessible for midpoints.")
                        return {str(tid): None for tid in target_tree_ids}
                except (KeyError, AttributeError):
                    log_stderr("Midpoint", f"Error: ID field '{id_field_name}' not accessible for midpoints.")
                    return {str(tid): None for tid in target_tree_ids}

        ids_for_calc_np = ids_for_calc_np.astype(int)

        for tree_id in target_tree_ids: # target_tree_ids is a set of ints
            mask = (ids_for_calc_np == tree_id)
            if np.sum(mask) > 0:
                tree_midpoints_dict[str(tree_id)] = {
                    "x": np.mean(x_coords_np[mask]),
                    "y": np.mean(y_coords_np[mask]),
                    "z": np.mean(z_coords_np[mask])
                }
            else:
                tree_midpoints_dict[str(tree_id)] = None # Explicitly None if no points
        log_stderr("Midpoint", "Midpoint calculation complete.")
        return tree_midpoints_dict
    except Exception as e:
        log_stderr("Midpoint", f"An error occurred during midpoint calculation: {e}\n{traceback.format_exc()}")
    return {str(tid): None for tid in target_tree_ids} # Default to None for all on error

def calculate_tree_heights_adjusted(
    las_file_obj,
    id_field_name,
    target_tree_ids,
    adjustment_value
):
    tree_adjusted_heights = {}
    if not target_tree_ids:
        log_stderr("LengthL", "No target tree IDs for Length (L) calculation.")
        return {}
    try:
        z_coords_np = np.array(las_file_obj.z)
        ids_all_np = None
        try:
            ids_all_np = np.array(getattr(las_file_obj, id_field_name))
        except AttributeError:
            # Try to get tree IDs from extra bytes
            ids_all_np = extract_tree_ids_from_extra_bytes(las_file_obj, id_field_name, None, None)
            if ids_all_np is None:
                try:
                    if hasattr(las_file_obj, 'points'):
                        ids_all_np = np.array(las_file_obj.points[id_field_name])
                    elif hasattr(las_file_obj, 'extra_bytes') and hasattr(las_file_obj.extra_bytes, id_field_name):
                        ids_all_np = np.array(las_file_obj.extra_bytes[id_field_name])
                    else:
                        log_stderr("LengthL", f"Error: ID field '{id_field_name}' not accessible for Length (L).")
                        return {str(tid): None for tid in target_tree_ids}
                except (KeyError, AttributeError):
                    log_stderr("LengthL", f"Error: ID field '{id_field_name}' not accessible for Length (L).")
                    return {str(tid): None for tid in target_tree_ids}

        ids_all_np = ids_all_np.astype(int)
        log_stderr("LengthL_Debug", f"Shape of ids_all_np in LengthL: {ids_all_np.shape if ids_all_np is not None else 'None'}, First 5: {ids_all_np[:5] if ids_all_np is not None and ids_all_np.size > 0 else 'N/A'}")


        for tree_id in target_tree_ids:
            mask = (ids_all_np == tree_id)
            log_stderr("LengthL_Debug", f"Tree ID {tree_id} in LengthL: Number of points found: {np.sum(mask)}")
            tree_z_points = z_coords_np[mask]

            if tree_z_points.size == 0:
                tree_adjusted_heights[str(tree_id)] = None
                continue

            min_z_tree = np.min(tree_z_points)
            max_z_tree = np.max(tree_z_points)
            total_height = max_z_tree - min_z_tree
            adjusted_total_height = total_height - adjustment_value

            tree_adjusted_heights[str(tree_id)] = float(max(0, adjusted_total_height)) if not np.isnan(adjusted_total_height) else None

        log_stderr("LengthL", "Segment Length (L) calculation complete.")
        return tree_adjusted_heights
    except Exception as e:
        log_stderr("LengthL", f"An error occurred during Length (L) calculation: {e}\n{traceback.format_exc()}")
    return {str(tid): None for tid in target_tree_ids}

def _circle_residuals(params, x, y):
    xc, yc, R = params
    return np.sqrt((x - xc)**2 + (y - yc)**2) - R

def calculate_tree_dbh(
    las_file_obj,
    id_field_name,
    target_tree_ids,
    height_above_ground,
    vertical_slice_thickness,
    min_points_for_dbh_fit
):
    tree_dbh_values = {}
    if not target_tree_ids:
        log_stderr("DBH_D1", "No target tree IDs for DBH (D1) calculation.")
        return {}
    try:
        x_all = np.array(las_file_obj.x)
        y_all = np.array(las_file_obj.y)
        z_all = np.array(las_file_obj.z)
        ids_all = None
        try:
            ids_all = np.array(getattr(las_file_obj, id_field_name))
        except AttributeError:
            # Try to get tree IDs from extra bytes
            ids_all = extract_tree_ids_from_extra_bytes(las_file_obj, id_field_name, None, None)
            if ids_all is None:
                try:
                    if hasattr(las_file_obj, 'points'):
                        ids_all = np.array(las_file_obj.points[id_field_name])
                    elif hasattr(las_file_obj, 'extra_bytes') and hasattr(las_file_obj.extra_bytes, id_field_name):
                        ids_all = np.array(las_file_obj.extra_bytes[id_field_name])
                    else:
                        log_stderr("DBH_D1", f"Error: ID field '{id_field_name}' not accessible for DBH (D1).")
                        return {str(tid): None for tid in target_tree_ids}
                except (KeyError, AttributeError):
                    log_stderr("DBH_D1", f"Error: ID field '{id_field_name}' not accessible for DBH (D1).")
                    return {str(tid): None for tid in target_tree_ids}

        ids_all = ids_all.astype(int)
        log_stderr("DBH_D1_Debug", f"Shape of ids_all in DBH: {ids_all.shape if ids_all is not None else 'None'}, First 5: {ids_all[:5] if ids_all is not None and ids_all.size > 0 else 'N/A'}")


        for tree_id in target_tree_ids:
            tree_mask = (ids_all == tree_id)
            log_stderr("DBH_D1_Debug", f"Tree ID {tree_id} in DBH: Number of points found: {np.sum(tree_mask)}")

            if not np.any(tree_mask):
                tree_dbh_values[str(tree_id)] = None
                continue

            x_tree = x_all[tree_mask]
            y_tree = y_all[tree_mask]
            z_tree = z_all[tree_mask]

            min_z_tree = np.min(z_tree)
            z_slice_center = min_z_tree + height_above_ground
            z_slice_min = z_slice_center - (vertical_slice_thickness / 2)
            z_slice_max = z_slice_center + (vertical_slice_thickness / 2)
            slice_mask = (z_tree >= z_slice_min) & (z_tree <= z_slice_max)
            x_slice = x_tree[slice_mask]
            y_slice = y_tree[slice_mask]

            if len(x_slice) < min_points_for_dbh_fit:
                log_stderr("DBH_D1_Debug", f"Tree ID {tree_id}: Insufficient points ({len(x_slice)}) in DBH slice. Min required: {min_points_for_dbh_fit}")
                tree_dbh_values[str(tree_id)] = None
                continue

            xc_init = np.mean(x_slice)
            yc_init = np.mean(y_slice)
            r_init_variance = np.sqrt(np.var(x_slice) + np.var(y_slice))
            if r_init_variance < 1e-4:
                 max_x_spread = np.max(x_slice) - np.min(x_slice)
                 max_y_spread = np.max(y_slice) - np.min(y_slice)
                 r_init_spread = max(max_x_spread, max_y_spread) / 2.0
                 r_init = r_init_spread if r_init_spread > 0.001 else 0.01
            else:
                 r_init = r_init_variance

            initial_params = [xc_init, yc_init, r_init if r_init > 0.001 else 0.01]

            try:
                result = least_squares(_circle_residuals, initial_params, args=(x_slice, y_slice), method='lm', ftol=1e-5, xtol=1e-5)
                if result.success:
                    _xc_fit, _yc_fit, r_fit = result.x
                    if r_fit > 0.001 :
                        tree_dbh_values[str(tree_id)] = float(2 * r_fit)
                    else:
                        log_stderr("DBH_D1_Debug", f"Tree ID {tree_id}: Circle fit radius too small or non-positive: {r_fit}")
                        tree_dbh_values[str(tree_id)] = None
                else:
                    log_stderr("DBH_D1_Debug", f"Tree ID {tree_id}: Circle fit optimization failed. Status: {result.status}")
                    tree_dbh_values[str(tree_id)] = None
            except Exception as e_fit:
                log_stderr("DBH_D1", f"Tree ID {tree_id}: Error during circle fitting: {e_fit}\n{traceback.format_exc()}")
                tree_dbh_values[str(tree_id)] = None

        log_stderr("DBH_D1", "DBH (D1) calculation attempt complete.")
        return tree_dbh_values
    except Exception as e:
        log_stderr("DBH_D1", f"An error occurred during overall DBH (D1) calculation: {e}\n{traceback.format_exc()}")
    return {str(tid): None for tid in target_tree_ids}

def calculate_smalians_volume(d1_cm, d2_cm, length_m):
    if d1_cm is None or d2_cm is None or length_m is None or \
       np.isnan(d1_cm) or np.isnan(d2_cm) or np.isnan(length_m) or \
       length_m <= 0 or d1_cm < 0 or d2_cm < 0:
        return None
    smalian_constant = 0.00003927 # (pi / (4 * 10000)) for d in cm, length in m -> m^3
    try:
        volume_m3 = smalian_constant * (float(d1_cm)**2 + float(d2_cm)**2) * float(length_m)
        return volume_m3 if not np.isnan(volume_m3) else None
    except (ValueError, TypeError):
        return None

# --- Main Script Execution ---
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Python Error: No LAS file path provided."}), file=sys.stderr)
        sys.exit(1)
    las_file_path = sys.argv[1]

    if not os.path.exists(las_file_path):
        print(json.dumps({"error": f"Python Error: File not found at path: {las_file_path}"}), file=sys.stderr)
        sys.exit(1)

    output_results = {
        "latitude": None,
        "longitude": None,
        "tree_ids": [],
        "num_trees": 0,
        "tree_midpoints_original_crs": {},
        "tree_midpoints_wgs84": {},
        "tree_segment_lengths_L_m": {},
        "tree_dbhs_d1_cm": {},
        "tree_stem_volumes_m3": {},          # Renamed for clarity, this is the "Generic stem volume"
        "tree_above_ground_volumes_m3": {}, # New
        "tree_total_volumes_m3": {},        # New
        "tree_biomass_tonnes": {},          # New
        "tree_carbon_tonnes": {},           # New
        "tree_co2_equivalent_tonnes": {},   # New
        "assumed_d2_cm_for_volume": ASSUMED_SMALL_END_DIAMETER_D2_CM,
        "conversion_factors_used": {
            "above_ground_expansion": 1.25,
            "root_to_shoot_ratio_for_total_volume": 1.25,
            "basic_density_t_per_m3": 0.5,
            "biomass_to_carbon_fraction": 0.5,
            "carbon_to_co2_expansion": 3.67
        },
        "warnings": [],
        "errors": []
    }

    try:
        log_stderr("Main", f"Reading LAS file: {las_file_path}")
        # Try reading with strict validation first
        try:
            las = laspy.read(las_file_path)
        except laspy.errors.LaspyException as e_strict:
            # If strict validation fails due to point size mismatch, try lax mode
            log_stderr("Main", f"Strict validation failed: {e_strict}. Attempting lax validation...")
            las = laspy.read(las_file_path, lax=True)
            output_results["warnings"].append(f"LAS file read with lax validation due to format inconsistencies: {e_strict}")
        
        log_stderr("Main", f"LAS file read successfully. Point count: {len(las.points)}")

        transformer_to_wgs84 = None
        if SOURCE_EPSG_COORD_TRANSFORM != TARGET_EPSG_COORD_TRANSFORM:
            try:
                source_crs_obj = CRS.from_epsg(SOURCE_EPSG_COORD_TRANSFORM)
                target_crs_obj = CRS.from_epsg(TARGET_EPSG_COORD_TRANSFORM)
                transformer_to_wgs84 = Transformer.from_crs(source_crs_obj, target_crs_obj, always_xy=True)
            except Exception as e_crs:
                err_msg = f"Error setting up CRS transformer: {e_crs}"
                log_stderr("Main", err_msg)
                output_results["errors"].append(err_msg)

        if len(las.points) > 0:
            first_point_x, first_point_y = las.x[0], las.y[0]
            if transformer_to_wgs84:
                try:
                    lon, lat = transformer_to_wgs84.transform(first_point_x, first_point_y)
                    output_results["latitude"], output_results["longitude"] = lat, lon
                except Exception as e_coord:
                    err_msg = f"Error transforming first point: {e_coord}"
                    log_stderr("Main", err_msg); output_results["errors"].append(err_msg)
                    if SOURCE_EPSG_COORD_TRANSFORM == 4326:
                         output_results["longitude"], output_results["latitude"] = float(first_point_x), float(first_point_y)
                         output_results["warnings"].append("Used original X/Y as Lon/Lat (transform error, source EPSG:4326).")
            elif SOURCE_EPSG_COORD_TRANSFORM == 4326: # If source is already WGS84
                output_results["longitude"], output_results["latitude"] = float(first_point_x), float(first_point_y)
            else:
                 output_results["warnings"].append(f"First point Lon/Lat not calc (Source EPSG {SOURCE_EPSG_COORD_TRANSFORM} != WGS84, no transform).")
        else:
            output_results["warnings"].append("LAS file has no points. Skipping first point transform.")

        extracted_ids_set = extract_tree_ids_from_lidar(las, ID_FIELD_NAME_FOR_TREES, VALUES_TO_IGNORE_FOR_TREES, MIN_ID_VALUE_FOR_TREES)
        extracted_ids_list_str = sorted([str(tid) for tid in extracted_ids_set])

        output_results["tree_ids"] = extracted_ids_list_str
        output_results["num_trees"] = len(extracted_ids_list_str)

        if extracted_ids_set:
            midpoints_original_crs = calculate_tree_midpoints(las, ID_FIELD_NAME_FOR_TREES, extracted_ids_set)
            output_results["tree_midpoints_original_crs"] = midpoints_original_crs if midpoints_original_crs else {}

            if midpoints_original_crs and transformer_to_wgs84:
                for tree_id_str, coords_dict in midpoints_original_crs.items():
                    if coords_dict:
                        try:
                            mp_lon, mp_lat = transformer_to_wgs84.transform(coords_dict["x"], coords_dict["y"])
                            output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": mp_lon, "latitude": mp_lat, "z_original": coords_dict["z"]}
                        except Exception as e_mp_transform:
                            err_msg = f"Error transforming midpoint for tree ID {tree_id_str}: {e_mp_transform}"
                            log_stderr("Main", err_msg); output_results["errors"].append(err_msg)
                            output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": None, "latitude": None, "z_original": coords_dict.get("z"), "error": "Transformation failed"}
                    elif SOURCE_EPSG_COORD_TRANSFORM == 4326 and coords_dict: # If source is already WGS84
                        output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": float(coords_dict["x"]), "latitude": float(coords_dict["y"]), "z_original": coords_dict["z"]}


            segment_lengths_L_m_dict = calculate_tree_heights_adjusted(las, ID_FIELD_NAME_FOR_TREES, extracted_ids_set, HEIGHT_ADJUSTMENT_VALUE_FOR_L)
            output_results["tree_segment_lengths_L_m"] = segment_lengths_L_m_dict if segment_lengths_L_m_dict else {}

            tree_dbhs_d1_meters_dict = calculate_tree_dbh(las, ID_FIELD_NAME_FOR_TREES, extracted_ids_set, DBH_HEIGHT_ABOVE_GROUND, DBH_VERTICAL_SLICE_THICKNESS, DBH_MIN_POINTS_FOR_FIT)

            temp_dbhs_d1_cm = {}
            if tree_dbhs_d1_meters_dict:
                for tree_id_str, dbh_m in tree_dbhs_d1_meters_dict.items():
                    if dbh_m is not None and not np.isnan(dbh_m):
                        temp_dbhs_d1_cm[tree_id_str] = round(dbh_m * 100, 2) # Convert m to cm
                    else:
                        temp_dbhs_d1_cm[tree_id_str] = None
            output_results["tree_dbhs_d1_cm"] = temp_dbhs_d1_cm

            # Initialize dictionaries for all derived metrics
            temp_stem_volumes_m3 = {}
            temp_above_ground_volumes_m3 = {}
            temp_total_volumes_m3 = {}
            temp_biomass_tonnes = {}
            temp_carbon_tonnes = {}
            temp_co2_tonnes = {}

            d2_for_volume_cm = ASSUMED_SMALL_END_DIAMETER_D2_CM
            factors = output_results["conversion_factors_used"]

            for tree_id_str_key in extracted_ids_list_str:
                d1_cm = output_results["tree_dbhs_d1_cm"].get(tree_id_str_key)
                length_m = output_results["tree_segment_lengths_L_m"].get(tree_id_str_key)

                log_stderr("VolumeCalcInput", f"Tree ID: {tree_id_str_key} -> D1_cm: {d1_cm}, D2_cm: {d2_for_volume_cm}, L_m: {length_m}")

                # Step 0: Calculate Generic Stem Volume (using Smalian's in this script)
                stem_volume_m3 = calculate_smalians_volume(d1_cm, d2_for_volume_cm, length_m)
                log_stderr("VolumeCalcOutput", f"Tree ID: {tree_id_str_key} -> Calculated Stem Volume (m³): {stem_volume_m3}")
                temp_stem_volumes_m3[tree_id_str_key] = round(stem_volume_m3, 6) if stem_volume_m3 is not None else None

                # Initialize derived values for this tree
                above_ground_volume_m3 = None
                total_volume_m3 = None
                biomass_t = None
                carbon_t = None
                co2_t = None

                if stem_volume_m3 is not None:
                    # Step 1: Above ground volume (m³) = 1.25 × stem volume
                    above_ground_volume_m3 = stem_volume_m3 * factors["above_ground_expansion"]
                    temp_above_ground_volumes_m3[tree_id_str_key] = round(above_ground_volume_m3, 6)

                    # Step 2: Total volume (m³) = 1.25 × above ground volume
                    total_volume_m3 = above_ground_volume_m3 * factors["root_to_shoot_ratio_for_total_volume"]
                    temp_total_volumes_m3[tree_id_str_key] = round(total_volume_m3, 6)

                    # Step 3: Biomass (t) = total volume × 0.5 t/m³
                    biomass_t = total_volume_m3 * factors["basic_density_t_per_m3"]
                    temp_biomass_tonnes[tree_id_str_key] = round(biomass_t, 6)

                    # Step 4: C(t) = biomass × 0.5
                    carbon_t = biomass_t * factors["biomass_to_carbon_fraction"]
                    temp_carbon_tonnes[tree_id_str_key] = round(carbon_t, 6)

                    # Step 5: CO₂ (t) = C × 3.67
                    co2_t = carbon_t * factors["carbon_to_co2_expansion"]
                    temp_co2_tonnes[tree_id_str_key] = round(co2_t, 6)
                else:
                    # If stem volume is None, all subsequent values are also None
                    temp_above_ground_volumes_m3[tree_id_str_key] = None
                    temp_total_volumes_m3[tree_id_str_key] = None
                    temp_biomass_tonnes[tree_id_str_key] = None
                    temp_carbon_tonnes[tree_id_str_key] = None
                    temp_co2_tonnes[tree_id_str_key] = None

            # Assign all calculated values to the output results
            output_results["tree_stem_volumes_m3"] = temp_stem_volumes_m3
            output_results["tree_above_ground_volumes_m3"] = temp_above_ground_volumes_m3
            output_results["tree_total_volumes_m3"] = temp_total_volumes_m3
            output_results["tree_biomass_tonnes"] = temp_biomass_tonnes
            output_results["tree_carbon_tonnes"] = temp_carbon_tonnes
            output_results["tree_co2_equivalent_tonnes"] = temp_co2_tonnes
        else:
            output_results["warnings"].append("No tree IDs extracted. Skipping calculations.")

        print(json.dumps(output_results, indent=2))
        sys.exit(0)

    except laspy.errors.LaspyException as e_las:
        err_msg = f"Python Error: Critical LAS file error ({las_file_path}): {e_las}"
        log_stderr("MainCRITICAL", err_msg); output_results["errors"].append(err_msg)
        print(json.dumps(output_results, indent=2)) # Still print results gathered so far + errors
        sys.exit(1)
    except Exception as e_main:
        err_msg = f"Python Error: Unexpected critical error ({las_file_path}): {e_main}\n{traceback.format_exc()}"
        log_stderr("MainCRITICAL", err_msg); output_results["errors"].append(err_msg)
        print(json.dumps(output_results, indent=2)) # Still print results gathered so far + errors
        sys.exit(1)