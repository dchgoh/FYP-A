#!/bin/bash

# ==============================================================================
#                               SLURM DIRECTIVES
# ==============================================================================
# This section tells the SLURM scheduler how to run our MEMORY DIAGNOSIS job.

# -- Job Details --
#SBATCH --job-name=ISBNet_Memory_Diag       # A descriptive name for the diagnosis job.
#SBATCH --output=logs/diag_job_%j.log       # Log file for STDOUT. %j is the Job ID.
#SBATCH --error=logs/diag_job_%j.err        # Log file for STDERR.

# -- Account and Partition --
#SBATCH --account=oz419                     # Your project account.
#SBATCH --partition=milan_gpu               # The correct GPU partition on OzSTAR.

# -- Resource Allocation --
#SBATCH --nodes=1                           # Request one server node.
#SBATCH --ntasks-per-node=1                 # Run one main task on this node.
#SBATCH --gres=gpu:1                        # Request exactly one GPU.
#SBATCH --cpus-per-task=16                  # Request CPU cores for data loading.
#SBATCH --mem=80G                           # Request the same RAM as a real training run.
#SBATCH --time=02:00:00                     # Request a walltime of 2 hours (should be plenty).

# ==============================================================================
#                               JOB EXECUTION
# ==============================================================================

# --- 1. Preamble and Setup ---
echo "==============================================================="
echo "SLURM Job ID:        $SLURM_JOB_ID"
echo "Job Name:            $SLURM_JOB_NAME"
echo "Running on node:     $(hostname)"
echo "Allocated GPUs:      $CUDA_VISIBLE_DEVICES"
echo "Job started on:      $(date)"
echo "==============================================================="

# Create the logs directory if it doesn't exist
mkdir -p logs

# --- 2. Define Core Paths ---
PROJECT_DIR="/fred/oz419/brenda/ISBNet"
CONDA_ENV_NAME="isbnet_env"
CONFIG_FILE="configs/for-instance/config_forinstance.yaml"

# Define the absolute path to the Python executable within your Conda environment.
PYTHON_EXE="/fred/oz419/brenda/.conda/envs/${CONDA_ENV_NAME}/bin/python"

# --- 3. Environment Setup ---
echo "INFO: Loading required modules for CUDA libraries..."
module load mamba
module load cuda/12.6.0
module load cudnn/9.5.0.50-cuda-12.6.0

# --- 4. Set Library Paths & PYTHONPATH ---
echo "INFO: Setting library and Python paths..."
export CPLUS_INCLUDE_PATH=${PROJECT_DIR}/local/include:$CPLUS_INCLUDE_PATH
export LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LIBRARY_PATH
export LD_LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LD_LIBRARY_PATH
export PYTHONPATH=${PROJECT_DIR}:$PYTHONPATH

# Using CUDA_LAUNCH_BLOCKING is not necessary for this diagnosis.
# export CUDA_LAUNCH_BLOCKING=1

# --- 5. Navigate to Project Directory ---
echo "INFO: Changing directory to $PROJECT_DIR"
cd "$PROJECT_DIR" || { echo "ERROR: Could not change directory to $PROJECT_DIR. Exiting."; exit 1; }
echo "INFO: Current working directory: $(pwd)"

# --- 6. Final Sanity Checks ---
echo "==============================================================="
echo "INFO: Final Sanity Checks..."
if [ ! -f "$PYTHON_EXE" ]; then
    echo "ERROR: Python executable not found at '$PYTHON_EXE'"
    exit 1
fi
echo "      - Python executable to be used: $PYTHON_EXE"
echo "      - PYTHONPATH:                   $PYTHONPATH"
echo "      - GPU Status:"
nvidia-smi
echo "==============================================================="

# --- 7. Execute the DIAGNOSTIC Script ---
echo "INFO: Starting memory diagnosis with config: $CONFIG_FILE"

# Set the PyTorch memory management flag
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# We call the DIAGNOSTIC script instead of the training script.
# NOTE: We are NOT running this with 'srun' because we are not doing parallel processing.
# We are also NOT running it with '-m' because we have manually set the PYTHONPATH.
"$PYTHON_EXE" tools/diagnose_memory.py \
    "$CONFIG_FILE"

# --- 8. Finalize ---
EXIT_CODE=$?
echo "==============================================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "INFO: Diagnostic script finished successfully."
    echo "INFO: Check 'work_dirs/.../problematic_files.txt' for results."
else
    echo "ERROR: Diagnostic script exited with a non-zero code: $EXIT_CODE."
fi
echo "Job finished on:     $(date)"
echo "==============================================================="

exit $EXIT_CODE