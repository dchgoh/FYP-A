#!/bin/bash

# ==============================================================================
#                               SLURM DIRECTIVES
# ==============================================================================
# This script runs the 'assembler' to convert raw test.py predictions into .las files.

# -- Job Details --
#SBATCH --job-name=Format_LAS
#SBATCH --output=logs/format_las_job_%j.log
#SBATCH --error=logs/format_las_job_%j.err

# -- Account and Partition --
#SBATCH --account=oz419
#SBATCH --partition=milan          # *** CRITICAL: Use a CPU partition (milan). This is cheaper and faster to get.

# -- Resource Allocation --
# This is a lightweight task, so it doesn't need a lot of resources.
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=8           # 8 CPUs is plenty for the file I/O.
#SBATCH --mem=32G                   # 32GB RAM is a safe amount.
#SBATCH --time=01:00:00             # 1 hour is more than enough.

# ==============================================================================
#                               JOB EXECUTION
# ==============================================================================

echo "==============================================================="
echo "SLURM Job ID:        $SLURM_JOB_ID"
echo "Job Name:            $SLURM_JOB_NAME"
echo "Running on node:     $(hostname)"
echo "Job started on:      $(date)"
echo "==============================================================="

# --- 1. Define Core Paths ---
PROJECT_DIR="/fred/oz419/brenda/ISBNet"
CONDA_ENV_NAME="isbnet_env"
PYTHON_EXE="/fred/oz419/brenda/.conda/envs/${CONDA_ENV_NAME}/bin/python"

# --- [ACTION REQUIRED] ---
# Define the 3 paths needed by the formatting script.

# 1. The directory where test.py saved its output.
#    Replace with the actual Job ID of your test run.
PREDICTION_INPUT_DIR="${PROJECT_DIR}/work_dirs/test_job_5939789/"

# 2. The directory containing the original .pth data that was tested.
ORIGINAL_DATA_DIR="/fred/oz419/brenda/FOR-Instance/unpreprocessed/processed_instance_aware_v3_centered/test"

# 3. A NEW directory where the final .las files will be saved.
FINAL_OUTPUT_DIR="${PROJECT_DIR}/visualizations/full_results_las_${SLURM_JOB_ID}"
# --- [END ACTION REQUIRED] ---

# --- 2. Environment Setup & Path Export ---
echo "INFO: Loading modules and setting paths..."
module load mamba
export PYTHONPATH=${PROJECT_DIR}:$PYTHONPATH
cd "$PROJECT_DIR" || exit 1

# --- 3. Execute the Formatting Script ---
echo "INFO: Starting Python prediction formatting script..."
echo "  - Prediction Dir:  $PREDICTION_INPUT_DIR"
echo "  - Original Data:   $ORIGINAL_DATA_DIR"
echo "  - Final LAS Dir:   $FINAL_OUTPUT_DIR"

# Check if the Python executable exists
if [ ! -f "$PYTHON_EXE" ]; then
    echo "ERROR: Python executable not found at '$PYTHON_EXE'"
    exit 1
fi

srun "$PYTHON_EXE" tools/save_predictions.py \
    "$PREDICTION_INPUT_DIR" \
    "$ORIGINAL_DATA_DIR" \
    "$FINAL_OUTPUT_DIR"

EXIT_CODE=$?
echo "==============================================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "INFO: Script finished successfully. LAS files saved to '$FINAL_OUTPUT_DIR'."
else
    echo "ERROR: Script exited with a non-zero code: $EXIT_CODE."
fi
echo "Job finished on:     $(date)"
echo "==============================================================="

exit $EXIT_CODE