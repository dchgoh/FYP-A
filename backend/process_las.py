import laspy
import numpy as np
from pyproj import CRS, Transformer
import sys
import json
import os
import traceback
from scipy.optimize import least_squares

# --- Configuration ---
# SOURCE_EPSG_COORD_TRANSFORM is now detected automatically
TARGET_EPSG_COORD_TRANSFORM = 4326
ID_FIELD_NAME_FOR_TREES = "treeID"
VALUES_TO_IGNORE_FOR_TREES = {-1}
MIN_ID_VALUE_FOR_TREES = 0
HEIGHT_ADJUSTMENT_VALUE_FOR_L = 1.3
DBH_HEIGHT_ABOVE_GROUND = 1.3
DBH_VERTICAL_SLICE_THICKNESS = 0.20
DBH_MIN_POINTS_FOR_FIT = 5
ASSUMED_SMALL_END_DIAMETER_D2_CM = 0.0
# New configuration value to cap the maximum DBH
MAX_DBH_CM_THRESHOLD = 1000.0


# --- Helper Functions ---
def log_stderr(module_name, msg):
    print(f"Python ({module_name}): {msg}", file=sys.stderr)

def detect_effective_epsg(las):
    """
    Intelligently detects the most likely EPSG code from the LAS file header or coordinate values.
    """
    log_stderr("CRS_Detect", "Attempting to detect effective EPSG...")
    crs = las.header.parse_crs()
    epsg = None
    if crs:
        auth = crs.to_authority()
        if auth:
            try:
                epsg = int(auth[1])
                log_stderr("CRS_Detect", f"Found EPSG:{epsg} in LAS header.")
            except (ValueError, TypeError):
                log_stderr("CRS_Detect", f"Could not parse authority from header: {auth}")

    # Compute coordinate ranges and averages if points exist
    if len(las.points) > 0:
        x_mean, y_mean = np.mean(las.x), np.mean(las.y)
    else:
        x_mean, y_mean = 0, 0 # Default if no points

    # --- Logic to choose effective EPSG ---
    if epsg is not None and epsg not in [0, 4298]:
        log_stderr("CRS_Detect", f"Using detected CRS from header: EPSG:{epsg}")
        return epsg

    # If coordinates look like degrees (common for WGS84)
    if -180 < x_mean < 180 and -90 < y_mean < 90:
        log_stderr("CRS_Detect", "Coordinates appear to be in geographic degrees. Assuming EPSG:4326 (WGS84).")
        return 4326

    # If coordinates look like projected meters but CRS is unknown/invalid
    if x_mean > 10000 and y_mean > 10000:
        log_stderr("CRS_Detect", "No valid CRS found but coordinates look projected. Assuming default of EPSG:29874 (RSO Sarawak).")
        return 29874

    # If header specified EPSG:4298 (Timbalai 1948), it needs transformation
    if epsg == 4298:
        log_stderr("CRS_Detect", "CRS is Timbalai 1948 (EPSG:4298). Will proceed with transformation to WGS84.")
        return 4298

    log_stderr("CRS_Detect", "Could not confidently determine CRS. Defaulting to EPSG:29874 (RSO Sarawak).")
    return 29874

def extract_tree_ids_from_extra_bytes(las_file_obj):
    """Extract tree IDs directly from extra bytes data"""
    try:
        if hasattr(las_file_obj, 'points') and hasattr(las_file_obj.points, 'ExtraBytes'):
            extra_bytes_data = las_file_obj.points.ExtraBytes
            if extra_bytes_data.size > 0:
                # Frontend writes treeID as int32 (little-endian) in first 4 bytes of extra bytes for each point
                # extra_bytes_data shape is (n_points, n_extra_bytes_per_point)
                n_points = extra_bytes_data.shape[0] if len(extra_bytes_data.shape) > 0 else 0
                if n_points > 0 and extra_bytes_data.shape[1] >= 4:
                    # Extract first 4 bytes from each point
                    first_4_bytes = extra_bytes_data[:, 0:4]
                    # Convert to contiguous byte array and interpret as little-endian int32
                    # Each row of 4 bytes becomes one int32 value
                    tree_ids_raw = np.frombuffer(first_4_bytes.tobytes(), dtype='<i4')  # '<i4' = little-endian int32
                    log_stderr("ExtraBytes", f"Extracted {len(tree_ids_raw)} tree IDs from extra bytes (unique: {len(np.unique(tree_ids_raw))})")
                    return tree_ids_raw
                else:
                    log_stderr("ExtraBytes", f"Extra bytes shape insufficient: {extra_bytes_data.shape if hasattr(extra_bytes_data, 'shape') else 'unknown'}")
        return None
    except Exception as e:
        log_stderr("ExtraBytes", f"Failed to extract tree IDs from extra bytes: {e}\n{traceback.format_exc()}")
        return None

def extract_tree_ids_from_lidar(
    las_file_obj,
    id_field_name,
    ignore_values,
    min_id_value
):
    potential_tree_ids = set()
    log_stderr("TreeID", f"Attempting to use field: '{id_field_name}' for Tree IDs.")
    
    # Debug: Check VLRs (This section is now fixed)
    try:
        log_stderr("TreeID", f"Number of VLRs: {len(las_file_obj.header.vlrs)}")
        for i, vlr in enumerate(las_file_obj.header.vlrs):
            # Print basic info and the object type for better debugging
            log_stderr("TreeID", f"VLR {i}: user_id='{vlr.user_id}', record_id={vlr.record_id}, type={type(vlr).__name__}")
            
            # --- ROBUST LENGTH CHECKING ---
            length_info = "N/A"
            if hasattr(vlr, 'record_length_after_header'):
                length_info = vlr.record_length_after_header
            elif hasattr(vlr, 'length_after_header'):
                length_info = vlr.length_after_header
            elif hasattr(vlr, 'record_data'): # Most reliable fallback
                length_info = len(vlr.record_data)
            elif hasattr(vlr, 'string'): # Least reliable, checked last
                length_info = len(vlr.string)
            log_stderr("TreeID", f"VLR {i} data length: {length_info}")

    except Exception as e:
        log_stderr("TreeID", f"VLR debug failed: {e}")
        log_stderr("TreeID", f"VLR traceback: {traceback.format_exc()}")
    
    try:
        ids_per_point_np = None
        # Primary method: Check if the field is a standard dimension
        if id_field_name in las_file_obj.point_format.dimension_names:
            ids_per_point_np = las_file_obj[id_field_name]
            log_stderr("TreeID", f"Found '{id_field_name}' as a standard dimension.")
        # Secondary method: Check extra bytes
        elif id_field_name in las_file_obj.point_format.extra_dimension_names:
            ids_per_point_np = las_file_obj[id_field_name]
            log_stderr("TreeID", f"Found '{id_field_name}' in extra dimensions.")
        # Fallback method: try interpreting raw extra bytes data
        else:
            log_stderr("TreeID", f"Field '{id_field_name}' not found directly. Attempting to parse raw ExtraBytes.")
            ids_per_point_np = extract_tree_ids_from_extra_bytes(las_file_obj)
            if ids_per_point_np is not None:
                log_stderr("TreeID", "Successfully parsed tree IDs from raw ExtraBytes.")
            else:
                log_stderr("TreeID", f"Error: Field '{id_field_name}' NOT FOUND in any known location.")
                return set()

        unique_ids_all = np.unique(ids_per_point_np)
        processed_ignore_values = set(ignore_values) if ignore_values is not None else set()

        for uid_val in unique_ids_all:
            try: uid = int(uid_val)
            except (ValueError, TypeError): continue
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

def get_tree_id_array(las_file_obj, id_field_name):
    """A centralized function to get the tree ID array, regardless of its location."""
    if id_field_name in las_file_obj.point_format.dimension_names:
        return las_file_obj[id_field_name]
    elif id_field_name in las_file_obj.point_format.extra_dimension_names:
        return las_file_obj[id_field_name]
    else:
        # Fallback to raw extra bytes parsing
        return extract_tree_ids_from_extra_bytes(las_file_obj)

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
        ids_for_calc_np = get_tree_id_array(las_file_obj, id_field_name)
        if ids_for_calc_np is None:
            log_stderr("Midpoint", f"Error: ID field '{id_field_name}' not accessible for midpoints.")
            return {str(tid): None for tid in target_tree_ids}
        
        x_coords_np = np.array(las_file_obj.x)
        y_coords_np = np.array(las_file_obj.y)
        z_coords_np = np.array(las_file_obj.z)
        ids_for_calc_np = ids_for_calc_np.astype(int)

        log_stderr("Midpoint", f"Calculating midpoints for {len(target_tree_ids)} tree IDs. Tree ID array shape: {ids_for_calc_np.shape}, unique IDs in array: {len(np.unique(ids_for_calc_np))}")
        
        for tree_id in target_tree_ids:
            mask = (ids_for_calc_np == tree_id)
            point_count = np.sum(mask)
            if np.any(mask):
                tree_midpoints_dict[str(tree_id)] = {
                    "x": np.mean(x_coords_np[mask]),
                    "y": np.mean(y_coords_np[mask]),
                    "z": np.mean(z_coords_np[mask])
                }
                log_stderr("Midpoint", f"Tree ID {tree_id}: Found {point_count} points, midpoint at ({tree_midpoints_dict[str(tree_id)]['x']:.2f}, {tree_midpoints_dict[str(tree_id)]['y']:.2f})")
            else:
                tree_midpoints_dict[str(tree_id)] = None
                log_stderr("Midpoint", f"Tree ID {tree_id}: No points found (mask sum: {point_count})")
        
        successful_midpoints = sum(1 for v in tree_midpoints_dict.values() if v is not None)
        log_stderr("Midpoint", f"Midpoint calculation complete. {successful_midpoints}/{len(target_tree_ids)} trees have valid midpoints.")
        return tree_midpoints_dict
    except Exception as e:
        log_stderr("Midpoint", f"An error occurred during midpoint calculation: {e}\n{traceback.format_exc()}")
    return {str(tid): None for tid in target_tree_ids}

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
        ids_all_np = get_tree_id_array(las_file_obj, id_field_name)
        if ids_all_np is None:
            log_stderr("LengthL", f"Error: ID field '{id_field_name}' not accessible for Length (L).")
            return {str(tid): None for tid in target_tree_ids}

        z_coords_np = np.array(las_file_obj.z)
        ids_all_np = ids_all_np.astype(int)

        for tree_id in target_tree_ids:
            mask = (ids_all_np == tree_id)
            tree_z_points = z_coords_np[mask]

            if tree_z_points.size == 0:
                tree_adjusted_heights[str(tree_id)] = None
                continue

            min_z_tree = np.min(tree_z_points)
            max_z_tree = np.max(tree_z_points)
            total_height = max_z_tree - min_z_tree
            adjusted_total_height = total_height - adjustment_value

            tree_adjusted_heights[str(tree_id)] = float(max(0, adjusted_total_height))

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
        ids_all = get_tree_id_array(las_file_obj, id_field_name)
        if ids_all is None:
            log_stderr("DBH_D1", f"Error: ID field '{id_field_name}' not accessible for DBH (D1).")
            return {str(tid): None for tid in target_tree_ids}

        x_all = np.array(las_file_obj.x)
        y_all = np.array(las_file_obj.y)
        z_all = np.array(las_file_obj.z)
        ids_all = ids_all.astype(int)

        for tree_id in target_tree_ids:
            tree_mask = (ids_all == tree_id)
            if not np.any(tree_mask):
                tree_dbh_values[str(tree_id)] = None
                continue

            z_tree = z_all[tree_mask]
            min_z_tree = np.min(z_tree)
            z_slice_center = min_z_tree + height_above_ground
            z_slice_min = z_slice_center - (vertical_slice_thickness / 2)
            z_slice_max = z_slice_center + (vertical_slice_thickness / 2)
            
            slice_mask = (z_tree >= z_slice_min) & (z_tree <= z_slice_max)
            
            # Get x and y points for the entire tree first, then apply the slice mask
            x_tree = x_all[tree_mask]
            y_tree = y_all[tree_mask]
            x_slice = x_tree[slice_mask]
            y_slice = y_tree[slice_mask]

            if len(x_slice) < min_points_for_dbh_fit:
                tree_dbh_values[str(tree_id)] = None
                continue

            xc_init = np.mean(x_slice)
            yc_init = np.mean(y_slice)
            r_init = np.sqrt(np.mean((x_slice - xc_init)**2 + (y_slice - yc_init)**2))
            
            initial_params = [xc_init, yc_init, r_init if r_init > 0.001 else 0.01]

            try:
                result = least_squares(_circle_residuals, initial_params, args=(x_slice, y_slice), method='lm')
                if result.success:
                    _xc_fit, _yc_fit, r_fit = result.x
                    tree_dbh_values[str(tree_id)] = float(2 * r_fit) if r_fit > 0 else None
                else:
                    tree_dbh_values[str(tree_id)] = None
            except Exception as e_fit:
                log_stderr("DBH_D1", f"Tree ID {tree_id}: Error during circle fitting: {e_fit}")
                tree_dbh_values[str(tree_id)] = None

        log_stderr("DBH_D1", "DBH (D1) calculation attempt complete.")
        return tree_dbh_values
    except Exception as e:
        log_stderr("DBH_D1", f"An error occurred during overall DBH (D1) calculation: {e}\n{traceback.format_exc()}")
    return {str(tid): None for tid in target_tree_ids}

def calculate_smalians_volume(d1_cm, d2_cm, length_m):
    if d1_cm is None or length_m is None or length_m <= 0 or d1_cm <= 0:
        return None
    smalian_constant = np.pi / 40000
    try:
        d1_m = d1_cm / 100.0
        d2_m = d2_cm / 100.0
        base_area1 = smalian_constant * (d1_cm**2)
        base_area2 = smalian_constant * (d2_cm**2)
        volume_m3 = ((base_area1 + base_area2) / 2) * length_m
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
        "detected_source_epsg": None,
        "tree_ids": [],
        "num_trees": 0,
        "tree_midpoints_original_crs": {},
        "tree_midpoints_wgs84": {},
        "tree_segment_lengths_L_m": {},
        "tree_dbhs_d1_cm": {},
        "tree_stem_volumes_m3": {},
        "tree_above_ground_volumes_m3": {},
        "tree_total_volumes_m3": {},
        "tree_biomass_tonnes": {},
        "tree_carbon_tonnes": {},
        "tree_co2_equivalent_tonnes": {},
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
        try:
            las = laspy.read(las_file_path)
        except laspy.errors.LaspyException as e_strict:
            log_stderr("Main", f"Strict validation failed: {e_strict}. Attempting lax validation...")
            las = laspy.read(las_file_path, lax=True)
            output_results["warnings"].append(f"LAS file read with lax validation due to format inconsistencies: {e_strict}")
        
        log_stderr("Main", f"LAS file read successfully. Point count: {len(las.points)}")

        transformer_to_wgs84 = None
        source_epsg = detect_effective_epsg(las)
        output_results["detected_source_epsg"] = source_epsg
        
        if source_epsg != TARGET_EPSG_COORD_TRANSFORM:
            try:
                transformer_to_wgs84 = Transformer.from_crs(
                    CRS.from_epsg(source_epsg), 
                    CRS.from_epsg(TARGET_EPSG_COORD_TRANSFORM), 
                    always_xy=True
                )
                log_stderr("Main", f"CRS Transformer created for EPSG:{source_epsg} -> EPSG:{TARGET_EPSG_COORD_TRANSFORM}")
            except Exception as e_crs:
                err_msg = f"Error setting up CRS transformer for EPSG:{source_epsg}: {e_crs}"
                log_stderr("Main", err_msg)
                output_results["errors"].append(err_msg)
        else:
            log_stderr("Main", f"Source CRS (EPSG:{source_epsg}) is already target WGS84. No transformation needed.")

        if len(las.points) > 0:
            # laspy automatically converts stored integers to absolute coordinates using scale and offset
            # So las.x[0] is already the absolute coordinate, not the stored integer
            first_point_x, first_point_y = las.x[0], las.y[0]
            first_point_z = las.z[0] if len(las.points) > 0 else 0
            
            # Also get the stored raw integer values and offsets for debugging
            x_offset = las.header.x_offset
            y_offset = las.header.y_offset
            z_offset = las.header.z_offset
            x_scale = las.header.x_scale
            y_scale = las.header.y_scale
            z_scale = las.header.z_scale
            
            log_stderr("Main", f"First point absolute coords (from laspy): ({first_point_x:.6f}, {first_point_y:.6f}, {first_point_z:.6f})")
            log_stderr("Main", f"LAS header offsets: ({x_offset:.6f}, {y_offset:.6f}, {z_offset:.6f})")
            log_stderr("Main", f"LAS header scales: ({x_scale}, {y_scale}, {z_scale})")
            
            if transformer_to_wgs84:
                try:
                    lon, lat = transformer_to_wgs84.transform(first_point_x, first_point_y)
                    output_results["latitude"], output_results["longitude"] = lat, lon
                    log_stderr("Main", f"Transformed to WGS84: ({lon:.6f}, {lat:.6f})")
                except Exception as e_coord:
                    err_msg = f"Error transforming first point: {e_coord}"
                    log_stderr("Main", err_msg); output_results["errors"].append(err_msg)
            elif source_epsg == TARGET_EPSG_COORD_TRANSFORM:
                output_results["longitude"], output_results["latitude"] = float(first_point_x), float(first_point_y)
                log_stderr("Main", f"Already WGS84, using first point: ({first_point_x:.6f}, {first_point_y:.6f})")
        else:
            output_results["warnings"].append("LAS file has no points. Skipping first point transform.")

        extracted_ids_set = extract_tree_ids_from_lidar(las, ID_FIELD_NAME_FOR_TREES, VALUES_TO_IGNORE_FOR_TREES, MIN_ID_VALUE_FOR_TREES)
        extracted_ids_list_str = sorted([str(tid) for tid in extracted_ids_set])

        log_stderr("Main", f"Extracted {len(extracted_ids_set)} unique tree IDs: {extracted_ids_list_str[:10]}{'...' if len(extracted_ids_list_str) > 10 else ''}")
        
        output_results["tree_ids"] = extracted_ids_list_str
        output_results["num_trees"] = len(extracted_ids_list_str)

        if extracted_ids_set:
            midpoints_original_crs = calculate_tree_midpoints(las, ID_FIELD_NAME_FOR_TREES, extracted_ids_set)
            output_results["tree_midpoints_original_crs"] = midpoints_original_crs

            for tree_id_str, coords_dict in midpoints_original_crs.items():
                if coords_dict:
                    if transformer_to_wgs84:
                        try:
                            mp_lon, mp_lat = transformer_to_wgs84.transform(coords_dict["x"], coords_dict["y"])
                            output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": mp_lon, "latitude": mp_lat, "z_original": coords_dict["z"]}
                        except Exception as e_mp_transform:
                            output_results["tree_midpoints_wgs84"][tree_id_str] = {"error": f"Transformation failed: {e_mp_transform}"}
                    elif source_epsg == TARGET_EPSG_COORD_TRANSFORM:
                        output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": float(coords_dict["x"]), "latitude": float(coords_dict["y"]), "z_original": coords_dict["z"]}

            output_results["tree_segment_lengths_L_m"] = calculate_tree_heights_adjusted(las, ID_FIELD_NAME_FOR_TREES, extracted_ids_set, HEIGHT_ADJUSTMENT_VALUE_FOR_L)

            tree_dbhs_d1_meters_dict = calculate_tree_dbh(las, ID_FIELD_NAME_FOR_TREES, extracted_ids_set, DBH_HEIGHT_ABOVE_GROUND, DBH_VERTICAL_SLICE_THICKNESS, DBH_MIN_POINTS_FOR_FIT)
            output_results["tree_dbhs_d1_cm"] = {tid: round(dbh_m * 100, 2) if dbh_m is not None else None for tid, dbh_m in tree_dbhs_d1_meters_dict.items()}

            factors = output_results["conversion_factors_used"]
            for tree_id in extracted_ids_list_str:
                d1_cm = output_results["tree_dbhs_d1_cm"].get(tree_id)
                length_m = output_results["tree_segment_lengths_L_m"].get(tree_id)
                d2_cm = ASSUMED_SMALL_END_DIAMETER_D2_CM

                # If DBH is above the threshold, nullify all subsequent calculations for this tree
                if d1_cm is not None and d1_cm > MAX_DBH_CM_THRESHOLD:
                    log_stderr("Main", f"Tree ID {tree_id} DBH ({d1_cm} cm) exceeds threshold of {MAX_DBH_CM_THRESHOLD} cm. Nullifying all metrics for this tree.")
                    output_results["tree_dbhs_d1_cm"][tree_id] = None
                    output_results["tree_stem_volumes_m3"][tree_id] = None
                    output_results["tree_above_ground_volumes_m3"][tree_id] = None
                    output_results["tree_total_volumes_m3"][tree_id] = None
                    output_results["tree_biomass_tonnes"][tree_id] = None
                    output_results["tree_carbon_tonnes"][tree_id] = None
                    output_results["tree_co2_equivalent_tonnes"][tree_id] = None
                    # Add a warning for the specific tree
                    output_results["warnings"].append(f"Tree {tree_id} DBH was unusually large ({d1_cm} cm) and was discarded.")
                    continue # Skip to the next tree

                stem_volume_m3 = calculate_smalians_volume(d1_cm, d2_cm, length_m)
                output_results["tree_stem_volumes_m3"][tree_id] = round(stem_volume_m3, 6) if stem_volume_m3 is not None else None

                if stem_volume_m3 is not None:
                    above_ground_volume_m3 = stem_volume_m3 * factors["above_ground_expansion"]
                    total_volume_m3 = above_ground_volume_m3 * factors["root_to_shoot_ratio_for_total_volume"]
                    biomass_t = total_volume_m3 * factors["basic_density_t_per_m3"]
                    carbon_t = biomass_t * factors["biomass_to_carbon_fraction"]
                    co2_t = carbon_t * factors["carbon_to_co2_expansion"]
                    
                    output_results["tree_above_ground_volumes_m3"][tree_id] = round(above_ground_volume_m3, 6)
                    output_results["tree_total_volumes_m3"][tree_id] = round(total_volume_m3, 6)
                    output_results["tree_biomass_tonnes"][tree_id] = round(biomass_t, 6)
                    output_results["tree_carbon_tonnes"][tree_id] = round(carbon_t, 6)
                    output_results["tree_co2_equivalent_tonnes"][tree_id] = round(co2_t, 6)
                else:
                    output_results["tree_above_ground_volumes_m3"][tree_id] = None
                    output_results["tree_total_volumes_m3"][tree_id] = None
                    output_results["tree_biomass_tonnes"][tree_id] = None
                    output_results["tree_carbon_tonnes"][tree_id] = None
                    output_results["tree_co2_equivalent_tonnes"][tree_id] = None
        else:
            output_results["warnings"].append("No tree IDs extracted. Skipping calculations.")

        print(json.dumps(output_results, indent=2))
        sys.exit(0)

    except laspy.errors.LaspyException as e_las:
        err_msg = f"Python Error: Critical LAS file error ({las_file_path}): {e_las}"
        log_stderr("MainCRITICAL", err_msg); output_results["errors"].append(err_msg)
        print(json.dumps(output_results, indent=2))
        sys.exit(1)
    except Exception as e_main:
        err_msg = f"Python Error: Unexpected critical error ({las_file_path}): {e_main}\n{traceback.format_exc()}"
        log_stderr("MainCRITICAL", err_msg); output_results["errors"].append(err_msg)
        print(json.dumps(output_results, indent=2))
        sys.exit(1)