import laspy
import numpy as np
from pyproj import CRS, Transformer
import sys
import json
import os

# --- Configuration for Coordinate Transformation ---
SOURCE_EPSG_COORD_TRANSFORM = 29874 # Example: GDM2000 / Peninsula RSO
TARGET_EPSG_COORD_TRANSFORM = 4326  # WGS84 (Standard Latitude/Longitude, EPSG:4326)

# --- Configuration for Tree ID Extraction ---
ID_FIELD_NAME_FOR_TREES = "treeID" # The field in your LAS file containing tree IDs
VALUES_TO_IGNORE_FOR_TREES = {0}   # e.g., {0} if 0 means "not a tree"
MIN_ID_VALUE_FOR_TREES = 1         # e.g., 1 if tree IDs are positive

# --- Helper Functions ---
def extract_tree_ids_from_lidar(
    las_file_obj,
    id_field_name,
    ignore_values,
    min_id_value,
    log_to_stderr=True
):
    """Extracts unique 'tree IDs' from an opened LAS file object."""
    potential_tree_ids = set()
    def log_msg(msg):
        if log_to_stderr: print(f"Python (TreeID): {msg}", file=sys.stderr)

    try:
        available_fields = list(las_file_obj.header.point_format.dimension_names)
        log_msg(f"Available fields: {available_fields}")
        log_msg(f"Attempting to use field: '{id_field_name}' for Tree IDs.")

        if id_field_name not in available_fields:
            log_msg(f"Error: Field '{id_field_name}' NOT FOUND.")
            return set()

        log_msg(f"Proceeding to extract IDs from field: '{id_field_name}'")
        ids_per_point = None
        try:
            ids_per_point = getattr(las_file_obj, id_field_name)
            log_msg(f"Successfully accessed '{id_field_name}' via direct attribute.")
        except AttributeError:
            log_msg(f"Info: Direct attribute for '{id_field_name}' failed. Trying points array access.")
            try:
                if hasattr(las_file_obj, 'points') and id_field_name in las_file_obj.points.dtype.names:
                    ids_per_point = las_file_obj.points[id_field_name]
                else: # Fallback if points not directly on las_file_obj or field not in main points dtype (less common with laspy.read)
                    temp_points_data = las_file_obj.read_points(las_file_obj.header.point_count)
                    ids_per_point = temp_points_data[id_field_name]
                log_msg(f"Successfully accessed '{id_field_name}' after point data access.")
            except Exception as e_read:
                log_msg(f"Error: Could not access field '{id_field_name}' even after point data access: {e_read}")
                return set()

        if ids_per_point is None:
            log_msg(f"Error: Could not retrieve data for field '{id_field_name}'.")
            return set()

        unique_ids_all = np.unique(ids_per_point)
        log_msg(f"Found unique values in '{id_field_name}' (before filtering): {list(unique_ids_all)}")

        processed_ignore_values = set()
        if ignore_values is not None:
            processed_ignore_values = set(ignore_values)

        for uid_val in unique_ids_all:
            uid = int(uid_val)
            if uid in processed_ignore_values: continue
            if min_id_value is not None and uid < min_id_value: continue
            potential_tree_ids.add(uid)

        if not potential_tree_ids:
            log_msg(f"No tree IDs found after filtering.")
        else:
            log_msg(f"Extracted tree IDs (after filtering): {sorted(list(potential_tree_ids))}")
            log_msg(f"NUMBER OF TREES IDENTIFIED: {len(potential_tree_ids)}")
        return potential_tree_ids
    except Exception as e:
        log_msg(f"An error occurred during tree ID extraction: {e}")
    return set()


def calculate_tree_midpoints(
    las_file_obj,
    id_field_name,
    target_tree_ids,
    log_to_stderr=True
):
    """Calculates midpoints for target_tree_ids from an opened LAS file object."""
    tree_midpoints_dict = {}
    def log_msg(msg):
        if log_to_stderr: print(f"Python (Midpoint): {msg}", file=sys.stderr)

    if not target_tree_ids:
        log_msg("No target tree IDs for midpoint calculation.")
        return {}

    tree_data_accumulator = {
        tree_id: {'sum_x': 0.0, 'sum_y': 0.0, 'sum_z': 0.0, 'count': 0}
        for tree_id in target_tree_ids
    }

    try:
        log_msg(f"Calculating midpoints for {len(target_tree_ids)} target tree IDs...")
        x_coords, y_coords, z_coords, ids_for_calc = las_file_obj.x, las_file_obj.y, las_file_obj.z, None

        try:
            ids_for_calc = getattr(las_file_obj, id_field_name)
        except AttributeError:
            log_msg(f"Direct access for ID field '{id_field_name}' failed. Trying points array access.")
            if hasattr(las_file_obj, 'points') and id_field_name in las_file_obj.points.dtype.names:
                ids_for_calc = las_file_obj.points[id_field_name]
            else:
                temp_points_struct = las_file_obj.read_points(las_file_obj.header.point_count)
                ids_for_calc = temp_points_struct[id_field_name]

        if not all(hasattr(arr, 'shape') for arr in [x_coords, y_coords, z_coords, ids_for_calc]): # Basic check
            log_msg("Error: Could not access all necessary coordinate/ID arrays for midpoints.")
            return {}

        num_points = len(x_coords)
        for i in range(num_points):
            point_id = int(ids_for_calc[i])
            if point_id in target_tree_ids:
                tree_data_accumulator[point_id]['sum_x'] += x_coords[i]
                tree_data_accumulator[point_id]['sum_y'] += y_coords[i]
                tree_data_accumulator[point_id]['sum_z'] += z_coords[i]
                tree_data_accumulator[point_id]['count'] += 1

        for tree_id, data in tree_data_accumulator.items():
            if data['count'] > 0:
                tree_midpoints_dict[tree_id] = {
                    "x": data['sum_x'] / data['count'],
                    "y": data['sum_y'] / data['count'],
                    "z": data['sum_z'] / data['count']
                }
            else:
                log_msg(f"Warning: Tree ID {tree_id} targeted but no points found.")
        log_msg("Midpoint calculation complete.")
        return tree_midpoints_dict
    except Exception as e:
        log_msg(f"An error occurred during midpoint calculation: {e}")
    return {}

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
        "latitude": None,               # Lat of the first point in the file (WGS84)
        "longitude": None,              # Lon of the first point in the file (WGS84)
        "tree_ids": [],                 # List of unique tree IDs found
        "num_trees": 0,                 # Count of unique tree IDs
        "tree_midpoints_original_crs": {}, # Midpoints in LAS file's native CRS {tree_id: {x,y,z}}
        "tree_midpoints_wgs84": {},      # Midpoints transformed to WGS84 Lon/Lat {tree_id: {lon,lat,z_orig}}
        "warnings": [],                 # List of non-fatal warnings
        "errors": []                    # List of non-fatal errors during specific steps
    }

    try:
        print(f"Python: Reading LAS file: {las_file_path}", file=sys.stderr)
        las = laspy.read(las_file_path) # Reads all points into memory
        print(f"Python: LAS file read successfully. Point count: {len(las.points)}", file=sys.stderr)

        transformer_to_wgs84 = None
        if SOURCE_EPSG_COORD_TRANSFORM != TARGET_EPSG_COORD_TRANSFORM: # Only setup if transformation is needed
            try:
                source_crs_obj = CRS.from_epsg(SOURCE_EPSG_COORD_TRANSFORM)
                target_crs_obj = CRS.from_epsg(TARGET_EPSG_COORD_TRANSFORM)
                transformer_to_wgs84 = Transformer.from_crs(source_crs_obj, target_crs_obj, always_xy=True)
                print(f"Python: CRS Transformer initialized from EPSG:{SOURCE_EPSG_COORD_TRANSFORM} to EPSG:{TARGET_EPSG_COORD_TRANSFORM}.", file=sys.stderr)
            except Exception as e_crs:
                err_msg = f"Error setting up CRS transformer: {e_crs}"
                print(f"Python: {err_msg}", file=sys.stderr)
                output_results["errors"].append(err_msg)
        else:
            print(f"Python: Source and Target EPSG for transformation are the same (EPSG:{TARGET_EPSG_COORD_TRANSFORM}). No transformation will be applied to first point or midpoints.", file=sys.stderr)


        if len(las.points) > 0:
            first_point_x = las.x[0]
            first_point_y = las.y[0]
            if transformer_to_wgs84:
                try:
                    print(f"Python: Transforming first point coordinates...", file=sys.stderr)
                    lon, lat = transformer_to_wgs84.transform(first_point_x, first_point_y)
                    output_results["latitude"] = lat
                    output_results["longitude"] = lon
                    print(f"Python: First point Coords transformed. Lat: {lat}, Lon: {lon}", file=sys.stderr)
                except Exception as e_coord:
                    err_msg = f"Error during first point coordinate transformation: {e_coord}"
                    print(f"Python: {err_msg}", file=sys.stderr)
                    output_results["errors"].append(err_msg)
                    # If transformation fails, try to store original if target is WGS84 but source was too
                    if SOURCE_EPSG_COORD_TRANSFORM == 4326: # Assuming X is Lon, Y is Lat if already WGS84
                         output_results["longitude"] = float(first_point_x)
                         output_results["latitude"] = float(first_point_y)
                         output_results["warnings"].append("Used original X/Y as Lon/Lat for first point due to transformation error and source being EPSG:4326.")

            elif SOURCE_EPSG_COORD_TRANSFORM == 4326: # No transformer, but source is WGS84
                output_results["longitude"] = float(first_point_x) # Assuming X is Lon
                output_results["latitude"] = float(first_point_y)  # Assuming Y is Lat
                print(f"Python: Using original first point X/Y as Lon/Lat (Source EPSG:{SOURCE_EPSG_COORD_TRANSFORM}). Lon: {output_results['longitude']}, Lat: {output_results['latitude']}", file=sys.stderr)
            else: # No transformer and source is not WGS84, cannot provide Lat/Lon
                 output_results["warnings"].append(f"First point Lon/Lat not calculated (Source EPSG {SOURCE_EPSG_COORD_TRANSFORM} != WGS84 and no transformation).")


        else: # No points in file
            warn_msg = "LAS file contains no points. Skipping coordinate transformation."
            print(f"Python: {warn_msg}", file=sys.stderr)
            output_results["warnings"].append(warn_msg)

        print(f"Python: Extracting tree IDs...", file=sys.stderr)
        extracted_ids = extract_tree_ids_from_lidar(
            las,
            ID_FIELD_NAME_FOR_TREES,
            VALUES_TO_IGNORE_FOR_TREES,
            MIN_ID_VALUE_FOR_TREES
        )
        if extracted_ids:
            output_results["tree_ids"] = sorted(list(extracted_ids))
            output_results["num_trees"] = len(extracted_ids)
            print(f"Python: Tree IDs extracted: {output_results['num_trees']} trees.", file=sys.stderr)

            print(f"Python: Calculating tree midpoints (original CRS)...", file=sys.stderr)
            midpoints_original_crs = calculate_tree_midpoints(
                las,
                ID_FIELD_NAME_FOR_TREES,
                extracted_ids
            )
            output_results["tree_midpoints_original_crs"] = midpoints_original_crs
            print(f"Python: Midpoints (original CRS) calculated for {len(midpoints_original_crs)} trees.", file=sys.stderr)

            if midpoints_original_crs:
                print(f"Python: Transforming tree midpoints to WGS84 Lon/Lat...", file=sys.stderr)
                for tree_id_key, coords_dict in midpoints_original_crs.items():
                    # tree_id_key might be int or string from dict keys, ensure it's consistent for output
                    tree_id_str = str(tree_id_key) 
                    mid_x_orig = coords_dict["x"]
                    mid_y_orig = coords_dict["y"]
                    mid_z_orig = coords_dict["z"]

                    if transformer_to_wgs84:
                        try:
                            mp_lon, mp_lat = transformer_to_wgs84.transform(mid_x_orig, mid_y_orig)
                            output_results["tree_midpoints_wgs84"][tree_id_str] = {
                                "longitude": mp_lon,
                                "latitude": mp_lat,
                                "z_original": mid_z_orig
                            }
                        except Exception as e_mp_transform:
                            err_msg = f"Error transforming midpoint for tree ID {tree_id_str}: {e_mp_transform}"
                            print(f"Python: {err_msg}", file=sys.stderr)
                            output_results["errors"].append(err_msg)
                            output_results["tree_midpoints_wgs84"][tree_id_str] = {
                                "longitude": None, "latitude": None, "z_original": mid_z_orig,
                                "error": "Transformation failed"
                            }
                    elif SOURCE_EPSG_COORD_TRANSFORM == 4326: # No transformer, but source is WGS84
                        output_results["tree_midpoints_wgs84"][tree_id_str] = {
                            "longitude": float(mid_x_orig), # Assuming X is Lon
                            "latitude": float(mid_y_orig),  # Assuming Y is Lat
                            "z_original": mid_z_orig
                        }
                    else: # No transformer and source is not WGS84
                        output_results["tree_midpoints_wgs84"][tree_id_str] = {
                            "longitude": None, "latitude": None, "z_original": mid_z_orig,
                            "error": f"Lon/Lat not calculated (Source EPSG {SOURCE_EPSG_COORD_TRANSFORM} != WGS84 and no transformation)."
                        }
                print(f"Python: Tree midpoints transformation to WGS84 Lon/Lat complete.", file=sys.stderr)
        else:
            warn_msg = "No tree IDs extracted, skipping midpoint calculation and transformation."
            print(f"Python: {warn_msg}", file=sys.stderr)
            output_results["warnings"].append(warn_msg)

        print(json.dumps(output_results)) # Primary output to stdout for Node.js
        sys.exit(0)

    except laspy.errors.LaspyException as e:
        print(json.dumps({"error": f"Python Error: Critical error reading/processing LAS file ({las_file_path}): {e}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Python Error: An unexpected critical error occurred in main processing of {las_file_path}: {e}"}), file=sys.stderr)
        sys.exit(1)