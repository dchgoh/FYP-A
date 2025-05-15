import laspy
import numpy as np
from pyproj import CRS, Transformer
import sys
import json
import os
from scipy.optimize import least_squares # For DBH calculation

# --- Configuration for Coordinate Transformation ---
SOURCE_EPSG_COORD_TRANSFORM = 29874 # Example: GDM2000 / Peninsula RSO
TARGET_EPSG_COORD_TRANSFORM = 4326  # WGS84 (Standard Latitude/Longitude, EPSG:4326)

# --- Configuration for Tree ID Extraction ---
ID_FIELD_NAME_FOR_TREES = "treeID" # The field in your LAS file containing tree IDs
VALUES_TO_IGNORE_FOR_TREES = {0}   # e.g., {0} if 0 means "not a tree"
MIN_ID_VALUE_FOR_TREES = 1         # e.g., 1 if tree IDs are positive

# --- Configuration for Adjusted Height Calculation ---
HEIGHT_ADJUSTMENT_VALUE = 1.3      # Value to subtract from the total tree height

# --- Configuration for DBH Calculation ---
DBH_HEIGHT_ABOVE_GROUND = 1.3      # Standard breast height in meters
DBH_VERTICAL_SLICE_THICKNESS = 0.20 # Thickness of the vertical slice (e.g., 1.3m +/- 10cm)
DBH_MIN_POINTS_FOR_FIT = 5         # Minimum points in the slice to attempt DBH calculation

# --- Helper Functions ---
def log_stderr(module_name, msg):
    """Helper to print messages to stderr with a module prefix."""
    print(f"Python ({module_name}): {msg}", file=sys.stderr)

def extract_tree_ids_from_lidar(
    las_file_obj, # Expects an already read laspy.LasData object
    id_field_name,
    ignore_values,
    min_id_value
):
    """Extracts unique 'tree IDs' from an opened LAS file object."""
    potential_tree_ids = set()
    log_stderr("TreeID", f"Attempting to use field: '{id_field_name}' for Tree IDs.")

    try:
        if not hasattr(las_file_obj, id_field_name) and \
           (not hasattr(las_file_obj, 'points') or id_field_name not in las_file_obj.points.dtype.names):
            log_stderr("TreeID", f"Error: Field '{id_field_name}' NOT FOUND as direct attribute or in points structure.")
            if hasattr(las_file_obj, 'points'):
                log_stderr("TreeID", f"Available fields in las.points.dtype.names: {list(las_file_obj.points.dtype.names)}")
            standard_dims = list(las_file_obj.header.point_format.dimension_names)
            log_stderr("TreeID", f"Standard dimensions in header: {standard_dims}")
            if hasattr(las_file_obj.header.point_format, 'extra_dimension_names'):
                 log_stderr("TreeID", f"Extra dimensions in header: {list(las_file_obj.header.point_format.extra_dimension_names)}")
            return set()

        ids_per_point_view = None
        try:
            ids_per_point_view = getattr(las_file_obj, id_field_name)
            # log_stderr("TreeID", f"Successfully accessed '{id_field_name}' as a dimension.") # Less verbose
        except AttributeError:
            if hasattr(las_file_obj, 'points') and id_field_name in las_file_obj.points.dtype.names:
                ids_per_point_view = las_file_obj.points[id_field_name]
                # log_stderr("TreeID", f"Successfully accessed '{id_field_name}' from las.points structure.") # Less verbose
            else:
                log_stderr("TreeID", f"Critical Error: Field '{id_field_name}' still not accessible.")
                return set()
        
        ids_per_point_np = np.array(ids_per_point_view)
        unique_ids_all = np.unique(ids_per_point_np)
        processed_ignore_values = set(ignore_values) if ignore_values is not None else set()

        for uid_val in unique_ids_all:
            try: uid = int(uid_val)
            except ValueError:
                # log_stderr("TreeID", f"Warning: Could not convert value '{uid_val}' from field '{id_field_name}' to int. Skipping.")
                continue
            if uid in processed_ignore_values: continue
            if min_id_value is not None and uid < min_id_value: continue
            potential_tree_ids.add(uid)

        if not potential_tree_ids:
            log_stderr("TreeID", f"No tree IDs found after filtering.")
        else:
            log_stderr("TreeID", f"Extracted tree IDs (after filtering): {sorted(list(potential_tree_ids))}")
            log_stderr("TreeID", f"NUMBER OF TREES IDENTIFIED: {len(potential_tree_ids)}")
        return potential_tree_ids
    except Exception as e:
        log_stderr("TreeID", f"An error occurred during tree ID extraction: {e}")
    return set()


def calculate_tree_midpoints(
    las_file_obj,
    id_field_name,
    target_tree_ids
):
    """Calculates midpoints for target_tree_ids from an opened LAS file object."""
    tree_midpoints_dict = {}
    if not target_tree_ids:
        log_stderr("Midpoint", "No target tree IDs for midpoint calculation.")
        return {}

    tree_data_accumulator = {
        tree_id: {'sum_x': 0.0, 'sum_y': 0.0, 'sum_z': 0.0, 'count': 0}
        for tree_id in target_tree_ids # target_tree_ids is a set of ints
    }

    try:
        log_stderr("Midpoint", f"Calculating midpoints for {len(target_tree_ids)} target tree IDs...")
        x_coords_np = np.array(las_file_obj.x)
        y_coords_np = np.array(las_file_obj.y)
        z_coords_np = np.array(las_file_obj.z)
        ids_for_calc_np = None
        try:
            ids_for_calc_np = np.array(getattr(las_file_obj, id_field_name))
        except AttributeError:
            if hasattr(las_file_obj, 'points') and id_field_name in las_file_obj.points.dtype.names:
                 ids_for_calc_np = np.array(las_file_obj.points[id_field_name])
            else:
                log_stderr("Midpoint", f"Error: ID field '{id_field_name}' not accessible for midpoints.")
                return {}
        
        ids_for_calc_np = ids_for_calc_np.astype(int)

        num_points = len(x_coords_np)
        for i in range(num_points):
            point_id = ids_for_calc_np[i] # This is an int
            if point_id in target_tree_ids: # target_tree_ids is a set of ints
                tree_data_accumulator[point_id]['sum_x'] += x_coords_np[i]
                tree_data_accumulator[point_id]['sum_y'] += y_coords_np[i]
                tree_data_accumulator[point_id]['sum_z'] += z_coords_np[i]
                tree_data_accumulator[point_id]['count'] += 1

        for tree_id, data in tree_data_accumulator.items(): # tree_id here is an int
            if data['count'] > 0:
                tree_midpoints_dict[str(tree_id)] = {
                    "x": data['sum_x'] / data['count'],
                    "y": data['sum_y'] / data['count'],
                    "z": data['sum_z'] / data['count']
                }
            else:
                log_stderr("Midpoint", f"Warning: Tree ID {tree_id} targeted but no points found.")
        log_stderr("Midpoint", "Midpoint calculation complete.")
        return tree_midpoints_dict
    except Exception as e:
        log_stderr("Midpoint", f"An error occurred during midpoint calculation: {e}")
    return {}


def calculate_tree_heights_adjusted(
    las_file_obj,
    id_field_name,
    target_tree_ids,
    adjustment_value
):
    """
    Calculates total height (max_z - min_z) for each tree ID and then subtracts adjustment_value.
    Returns a dictionary: tree_id (str) -> adjusted_total_height (float or None if error)
    """
    tree_adjusted_heights = {}
    if not target_tree_ids:
        log_stderr("AdjHeight", "No target tree IDs for adjusted height calculation.")
        return {}

    log_stderr("AdjHeight", f"Calculating adjusted total heights for {len(target_tree_ids)} trees (Total Height - {adjustment_value}m)...")
    
    try:
        z_coords_np = np.array(las_file_obj.z)
        ids_all_np = None
        try:
            ids_all_np = np.array(getattr(las_file_obj, id_field_name))
        except AttributeError:
            if hasattr(las_file_obj, 'points') and id_field_name in las_file_obj.points.dtype.names:
                 ids_all_np = np.array(las_file_obj.points[id_field_name])
            else:
                log_stderr("AdjHeight", f"Error: ID field '{id_field_name}' not accessible for adjusted heights.")
                return {str(tid): None for tid in target_tree_ids}
        
        ids_all_np = ids_all_np.astype(int)

        for tree_id in target_tree_ids: # target_tree_ids is a set of ints
            mask = (ids_all_np == tree_id)
            tree_z_points = z_coords_np[mask]

            if tree_z_points.size == 0:
                # log_stderr("AdjHeight", f"Warning: Tree ID {tree_id} has no points. Cannot calculate adjusted height.")
                tree_adjusted_heights[str(tree_id)] = None
                continue

            min_z_tree = np.min(tree_z_points)
            max_z_tree = np.max(tree_z_points)
            total_height = max_z_tree - min_z_tree
            adjusted_total_height = total_height - adjustment_value
            
            tree_adjusted_heights[str(tree_id)] = float(max(0, adjusted_total_height)) if not np.isnan(adjusted_total_height) else None
            
        log_stderr("AdjHeight", "Adjusted total tree height calculation complete.")
        return tree_adjusted_heights
    except Exception as e:
        log_stderr("AdjHeight", f"An error occurred during adjusted height calculation: {e}")
        return {str(tid): None for tid in target_tree_ids}

# --- Helper function for DBH circle fitting ---
def _circle_residuals(params, x, y):
    """
    Calculates the residuals for circle fitting.
    params: [xc, yc, R] - circle center (xc, yc) and radius R.
    x, y: coordinates of the points.
    """
    xc, yc, R = params
    return np.sqrt((x - xc)**2 + (y - yc)**2) - R

# --- NEW FUNCTION FOR DBH CALCULATION ---
def calculate_tree_dbh(
    las_file_obj, # Expects an already read laspy.LasData object
    id_field_name,
    target_tree_ids, # Expects a set of integer tree IDs
    height_above_ground,
    vertical_slice_thickness,
    min_points_for_dbh
):
    """
    Calculates the Diameter at Breast Height (DBH) for each tree.
    Returns a dictionary: tree_id (str) -> DBH (float in meters or None if error/not calculable)
    """
    tree_dbh_values = {}
    if not target_tree_ids:
        log_stderr("DBH", "No target tree IDs for DBH calculation.")
        return {}

    log_stderr("DBH", f"Calculating DBH for {len(target_tree_ids)} trees (H={height_above_ground}m, Slice={vertical_slice_thickness*100:.0f}cm, MinPts={min_points_for_dbh})...")

    try:
        # Get dimensions as numpy arrays
        x_all = np.array(las_file_obj.x)
        y_all = np.array(las_file_obj.y)
        z_all = np.array(las_file_obj.z)
        ids_all = None
        try:
            ids_all = np.array(getattr(las_file_obj, id_field_name))
        except AttributeError:
            if hasattr(las_file_obj, 'points') and id_field_name in las_file_obj.points.dtype.names:
                 ids_all = np.array(las_file_obj.points[id_field_name])
            else:
                log_stderr("DBH", f"Error: ID field '{id_field_name}' not accessible for DBH.")
                return {str(tid): None for tid in target_tree_ids}

        ids_all = ids_all.astype(int)

        for tree_id in target_tree_ids: # Iterate over the set of integer tree IDs
            tree_mask = (ids_all == tree_id)
            if not np.any(tree_mask):
                # log_stderr("DBH", f"Warning: Tree ID {tree_id} has no points in full dataset for DBH.") # Can be verbose
                tree_dbh_values[str(tree_id)] = None
                continue

            x_tree = x_all[tree_mask]
            y_tree = y_all[tree_mask]
            z_tree = z_all[tree_mask]

            # z_tree.size check is implicitly covered by np.any(tree_mask) if tree_mask filters anything
            min_z_tree = np.min(z_tree)
            
            z_slice_center = min_z_tree + height_above_ground
            z_slice_min = z_slice_center - (vertical_slice_thickness / 2)
            z_slice_max = z_slice_center + (vertical_slice_thickness / 2)

            slice_mask = (z_tree >= z_slice_min) & (z_tree <= z_slice_max)
            x_slice = x_tree[slice_mask]
            y_slice = y_tree[slice_mask]

            if len(x_slice) < min_points_for_dbh:
                # log_stderr("DBH", f"Tree ID {tree_id}: Insufficient points ({len(x_slice)}) in slice for DBH.") # Can be verbose
                tree_dbh_values[str(tree_id)] = None
                continue

            xc_init = np.mean(x_slice)
            yc_init = np.mean(y_slice)
            
            # Initial radius guess based on variance or spread
            r_init_variance = np.sqrt(np.var(x_slice) + np.var(y_slice))
            # If all points are co-incident, variance is 0. Use spread then.
            if r_init_variance < 1e-4: # Check if variance is practically zero
                 max_x_spread = np.max(x_slice) - np.min(x_slice)
                 max_y_spread = np.max(y_slice) - np.min(y_slice)
                 r_init_spread = max(max_x_spread, max_y_spread) / 2.0
                 r_init = r_init_spread
            else:
                 r_init = r_init_variance
            
            # Ensure r_init is a small positive number if it ended up zero or very small
            initial_params = [xc_init, yc_init, r_init if r_init > 0.001 else 0.01] # Min 1mm radius, default to 1cm

            try:
                result = least_squares(_circle_residuals, initial_params, args=(x_slice, y_slice), method='lm', ftol=1e-5, xtol=1e-5)
                
                if result.success:
                    _xc_fit, _yc_fit, r_fit = result.x
                    if r_fit > 0.001 : # Diameter must be > 2mm
                        tree_dbh_values[str(tree_id)] = float(2 * r_fit) # Diameter in meters
                    else:
                        # log_stderr("DBH", f"Tree ID {tree_id}: Circle fit resulted in non-positive or too small radius ({r_fit:.4f}m).")
                        tree_dbh_values[str(tree_id)] = None
                else:
                    # log_stderr("DBH", f"Tree ID {tree_id}: Circle fit optimization failed (Status: {result.status}).")
                    tree_dbh_values[str(tree_id)] = None
            except Exception as e_fit:
                log_stderr("DBH", f"Tree ID {tree_id}: Error during circle fitting: {e_fit}")
                tree_dbh_values[str(tree_id)] = None
        
        log_stderr("DBH", "DBH calculation attempt complete.")
        return tree_dbh_values

    except Exception as e:
        log_stderr("DBH", f"An error occurred during overall DBH calculation: {e}")
        return {str(tid): None for tid in target_tree_ids}

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
        "tree_heights_adjusted": {},
        "tree_dbhs_cm": {}, # New key for DBH in cm
        "warnings": [],
        "errors": []
    }

    try:
        log_stderr("Main", f"Reading LAS file: {las_file_path}")
        las = laspy.read(las_file_path)
        log_stderr("Main", f"LAS file read successfully. Point count: {len(las.points)}")

        transformer_to_wgs84 = None
        if SOURCE_EPSG_COORD_TRANSFORM != TARGET_EPSG_COORD_TRANSFORM:
            try:
                source_crs_obj = CRS.from_epsg(SOURCE_EPSG_COORD_TRANSFORM)
                target_crs_obj = CRS.from_epsg(TARGET_EPSG_COORD_TRANSFORM)
                transformer_to_wgs84 = Transformer.from_crs(source_crs_obj, target_crs_obj, always_xy=True)
                log_stderr("Main", f"CRS Transformer initialized from EPSG:{SOURCE_EPSG_COORD_TRANSFORM} to EPSG:{TARGET_EPSG_COORD_TRANSFORM}.")
            except Exception as e_crs:
                err_msg = f"Error setting up CRS transformer: {e_crs}"
                log_stderr("Main", err_msg)
                output_results["errors"].append(err_msg)
        else:
            log_stderr("Main", f"Source and Target EPSG are the same (EPSG:{TARGET_EPSG_COORD_TRANSFORM}). No transformation for first point/midpoints.")

        if len(las.points) > 0:
            first_point_x = las.x[0]
            first_point_y = las.y[0]
            if transformer_to_wgs84:
                try:
                    lon, lat = transformer_to_wgs84.transform(first_point_x, first_point_y)
                    output_results["latitude"] = lat
                    output_results["longitude"] = lon
                    log_stderr("Main", f"First point transformed. Lat: {lat}, Lon: {lon}")
                except Exception as e_coord:
                    err_msg = f"Error transforming first point: {e_coord}"
                    log_stderr("Main", err_msg)
                    output_results["errors"].append(err_msg)
                    if SOURCE_EPSG_COORD_TRANSFORM == 4326: # If it failed but source was WGS84, use original
                         output_results["longitude"] = float(first_point_x)
                         output_results["latitude"] = float(first_point_y)
                         output_results["warnings"].append("Used original X/Y as Lon/Lat for first point (transform error, source was EPSG:4326).")
            elif SOURCE_EPSG_COORD_TRANSFORM == 4326: # No transformer needed, source is WGS84
                output_results["longitude"] = float(first_point_x)
                output_results["latitude"] = float(first_point_y)
                log_stderr("Main", f"Used original X/Y for first point (Source EPSG:4326). Lon: {output_results['longitude']}, Lat: {output_results['latitude']}")
            else:
                 output_results["warnings"].append(f"First point Lon/Lat not calculated (Source EPSG {SOURCE_EPSG_COORD_TRANSFORM} != WGS84, no transformation).")
        else:
            warn_msg = "LAS file contains no points. Skipping first point transformation."
            log_stderr("Main", warn_msg)
            output_results["warnings"].append(warn_msg)

        log_stderr("Main", "Extracting tree IDs...")
        extracted_ids_set = extract_tree_ids_from_lidar(
            las,
            ID_FIELD_NAME_FOR_TREES,
            VALUES_TO_IGNORE_FOR_TREES,
            MIN_ID_VALUE_FOR_TREES
        )
        extracted_ids_list = sorted(list(extracted_ids_set)) # For JSON output

        if extracted_ids_list: # Check if any IDs were extracted
            output_results["tree_ids"] = extracted_ids_list
            output_results["num_trees"] = len(extracted_ids_list)
            log_stderr("Main", f"Tree IDs extracted: {output_results['num_trees']} trees.")

            log_stderr("Main", "Calculating tree midpoints (original CRS)...")
            midpoints_original_crs = calculate_tree_midpoints(
                las,
                ID_FIELD_NAME_FOR_TREES,
                extracted_ids_set # Pass the set of integer IDs
            )
            output_results["tree_midpoints_original_crs"] = midpoints_original_crs
            log_stderr("Main", f"Midpoints (original CRS) calculated for {len(midpoints_original_crs)} trees.")

            if midpoints_original_crs:
                log_stderr("Main", "Transforming tree midpoints to WGS84 Lon/Lat...")
                for tree_id_str, coords_dict in midpoints_original_crs.items():
                    mid_x_orig, mid_y_orig, mid_z_orig = coords_dict["x"], coords_dict["y"], coords_dict["z"]
                    if transformer_to_wgs84:
                        try:
                            mp_lon, mp_lat = transformer_to_wgs84.transform(mid_x_orig, mid_y_orig)
                            output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": mp_lon, "latitude": mp_lat, "z_original": mid_z_orig}
                        except Exception as e_mp_transform:
                            err_msg = f"Error transforming midpoint for tree ID {tree_id_str}: {e_mp_transform}"
                            # log_stderr("Main", err_msg) # Can be verbose
                            output_results["errors"].append(err_msg)
                            output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": None, "latitude": None, "z_original": mid_z_orig, "error": "Transformation failed"}
                    elif SOURCE_EPSG_COORD_TRANSFORM == 4326:
                        output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": float(mid_x_orig), "latitude": float(mid_y_orig), "z_original": mid_z_orig}
                    else:
                        output_results["tree_midpoints_wgs84"][tree_id_str] = {"longitude": None, "latitude": None, "z_original": mid_z_orig, "error": f"Lon/Lat not calc (EPSG {SOURCE_EPSG_COORD_TRANSFORM} != WGS84, no transform)."}
                log_stderr("Main", "Tree midpoints transformation to WGS84 complete.")

            log_stderr("Main", "Calculating adjusted tree heights...")
            adjusted_heights = calculate_tree_heights_adjusted(
                las,
                ID_FIELD_NAME_FOR_TREES,
                extracted_ids_set, # Pass the set of integer IDs
                HEIGHT_ADJUSTMENT_VALUE
            )
            output_results["tree_heights_adjusted"] = adjusted_heights
            log_stderr("Main", f"Adjusted tree heights calculated for {len(adjusted_heights)} trees.")

            # --- Calculate and store DBH ---
            log_stderr("Main", "Calculating tree DBH...")
            tree_dbhs_meters = calculate_tree_dbh(
                las,
                ID_FIELD_NAME_FOR_TREES,
                extracted_ids_set, # Pass the set of integer IDs
                DBH_HEIGHT_ABOVE_GROUND,
                DBH_VERTICAL_SLICE_THICKNESS,
                DBH_MIN_POINTS_FOR_FIT
            )

            for tree_id_str, dbh_m in tree_dbhs_meters.items():
                if dbh_m is not None and not np.isnan(dbh_m): # Check for valid float
                    output_results["tree_dbhs_cm"][tree_id_str] = round(dbh_m * 100, 2) # Store as cm, rounded
                else:
                    output_results["tree_dbhs_cm"][tree_id_str] = None
            log_stderr("Main", f"DBH calculated (or attempted) for {len(tree_dbhs_meters)} trees.")

        else:
            warn_msg = "No tree IDs extracted. Skipping midpoints, transformation, height, and DBH calculations."
            log_stderr("Main", warn_msg)
            output_results["warnings"].append(warn_msg)

        print(json.dumps(output_results, indent=2))
        sys.exit(0)

    except laspy.errors.LaspyException as e:
        err_msg_critical = f"Python Error: Critical LAS file error ({las_file_path}): {e}"
        log_stderr("MainCRITICAL", err_msg_critical)
        print(json.dumps({"error": err_msg_critical, "details": str(e)}), file=sys.stderr)
        print(json.dumps({"error": err_msg_critical}))
        sys.exit(1)
    except Exception as e:
        err_msg_critical = f"Python Error: Unexpected critical error ({las_file_path}): {e}"
        log_stderr("MainCRITICAL", err_msg_critical)
        print(json.dumps({"error": err_msg_critical, "details": str(e)}), file=sys.stderr)
        print(json.dumps({"error": err_msg_critical}))
        sys.exit(1)