# process_las.py
import laspy
from pyproj import CRS, Transformer
import sys
import json # Import json module
import os  # Import os module for path checking

# --- Configuration ---
# !!! IMPORTANT: Change this if your LAS files use a different source CRS !!!
# Consider making this dynamic (e.g., pass as sys.argv[2] or read from LAS header)
# If the source CRS is WGS84 already (EPSG:4326), transformation is not needed.
SOURCE_EPSG = 29874 # Example: Replace if needed
TARGET_EPSG = 4326  # WGS84 (Standard Latitude/Longitude)

# --- Get File Path from Command Line Argument ---
if len(sys.argv) < 2:
    print(json.dumps({"error": "Python Error: No LAS file path provided."}), file=sys.stderr)
    sys.exit(1)

las_file_path = sys.argv[1]

# --- Check if file exists ---
if not os.path.exists(las_file_path):
     print(json.dumps({"error": f"Python Error: File not found at path: {las_file_path}"}), file=sys.stderr)
     sys.exit(1)


# --- Main Processing Logic ---
try:
    # Define the source and target CRS
    source_crs = CRS.from_epsg(SOURCE_EPSG)
    target_crs = CRS.from_epsg(TARGET_EPSG)
    transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)

    # Read LAS file
    # print(f"Python: Reading LAS file: {las_file_path}", file=sys.stderr) # Optional debug logging
    las = laspy.read(las_file_path)

    # Check if points exist
    if len(las.points) == 0:
        # It's better to succeed with nulls than fail if file is valid but empty
        print(json.dumps({"latitude": None, "longitude": None, "warning": "LAS file contains no points."}))
        # print(json.dumps({"error": "Python Error: LAS file contains no points."}), file=sys.stderr) # Alternative: treat as error
        sys.exit(0) # Exit successfully even if empty

    # Read the first point (index 0)
    # laspy automatically applies scale/offset when accessing las.x, las.y
    x = las.x[0]
    y = las.y[0]
    # z = las.z[0] # Not strictly needed for lat/lon

    # Transform the single coordinate
    lon, lat = transformer.transform(x, y)

    # --- Output Result as JSON to Standard Output ---
    result = {"latitude": lat, "longitude": lon}
    print(json.dumps(result)) # Print JSON to stdout
    # print(f"Python: Processed {las_file_path}. Lat: {lat}, Lon: {lon}", file=sys.stderr) # Optional debug logging
    sys.exit(0) # Exit with success code

# --- Error Handling ---
except FileNotFoundError:
    # This case is technically handled by the os.path.exists check earlier,
    # but kept for robustness in case of race conditions or other issues.
    print(json.dumps({"error": f"Python Error: LAS file disappeared or unreadable: {las_file_path}"}), file=sys.stderr)
    sys.exit(1)
except laspy.errors.LaspyException as e:
    print(json.dumps({"error": f"Python Error: Error reading LAS file ({las_file_path}): {e}"}), file=sys.stderr)
    sys.exit(1)
except Exception as e:
    # Catch potential errors during CRS creation or transformation
    print(json.dumps({"error": f"Python Error: An unexpected error occurred processing {las_file_path}: {e}"}), file=sys.stderr)
    sys.exit(1)