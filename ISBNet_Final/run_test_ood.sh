#!/bin/bash

# ==============================================================================
#                               SLURM DIRECTIVES
# ==============================================================================
# This section tells the SLURM scheduler how to run our job.

# -- Job Details --
#SBATCH --job-name=ISBNet_Test_OOD           # A clear and descriptive name for your job.
#SBATCH --output=logs/test_ood_job_%j.log    # Log file for STDOUT. %j is the Job ID.
#SBATCH --error=logs/test_ood_job_%j.err     # Log file for STDERR.

# -- Account and Partition --
#SBATCH --account=oz419                     # Your project account.
#SBATCH --partition=milan_gpu               # Use a GPU partition for inference.

# -- Resource Allocation --
#SBATCH --nodes=1                           # Request a single server node.
#SBATCH --ntasks-per-node=1                 # Run a single task (our python script).
#SBATCH --gres=gpu:1                        # Request one GPU.
#SBATCH --cpus-per-task=8                   # Request CPU cores for data loading.
#SBATCH --mem=120G                           # Request RAM for loading model and data.
#SBATCH --time=02:00:00                     # Request a walltime of 2 hours.

# ==============================================================================
#                               JOB EXECUTION
# ==============================================================================

# --- 1. Preamble and Setup ---
echo "==============================================================="
echo "SLURM Job ID:        $SLURM_JOB_ID"
echo "Job Name:            $SLURM_JOB_NAME"
echo "Running on node:     $(hostname)"
echo "Submitted from:      $SLURM_SUBMIT_HOST"
echo "Job started on:      $(date)"
echo "==============================================================="

# Create the logs directory if it doesn't exist to prevent errors
mkdir -p logs

# --- 2. Define Core Paths ---
PROJECT_DIR="/fred/oz419/brenda/ISBNet"
CONDA_ENV_NAME="isbnet_env"
PYTHON_EXE="/fred/oz419/brenda/.conda/envs/${CONDA_ENV_NAME}/bin/python"

# Define the Python script to be executed
TEST_SCRIPT="tools/test.py"

# Define paths for the model configuration and weights
CONFIG_FILE="${PROJECT_DIR}/configs/for-instance/config_test_ood.yaml"
CHECKPOINT_PATH="${PROJECT_DIR}/work_dirs/forinstance_job_6562808/best.pth"

# --- 3. Environment Activation ---
echo "INFO: Loading required modules..."
module load mamba; module load cuda/12.6.0; module load cudnn/9.5.0.50-cuda-12.6.0
echo "INFO: Activating Conda environment: $CONDA_ENV_NAME"
eval "$(mamba shell.bash hook)"
mamba activate "$CONDA_ENV_NAME"

# Check if activation was successful
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to activate Conda environment. Exiting."
    exit 1
fi

# --- 4. Set Library Paths ---
echo "INFO: Setting library paths..."
export CPLUS_INCLUDE_PATH=${PROJECT_DIR}/local/include:$CPLUS_INCLUDE_PATH
export LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LIBRARY_PATH
export LD_LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LD_LIBRARY_PATH
PYTORCH_LIB_PATH=$(python -c "import torch; import os; print(os.path.dirname(torch.__file__))")/lib
export LD_LIBRARY_PATH=$PYTORCH_LIB_PATH:$LD_LIBRARY_PATH
export PYTHONPATH=${PROJECT_DIR}:$PYTHONPATH

# --- 5. Navigate to Project Directory ---
echo "INFO: Changing directory to $PROJECT_DIR"
cd "$PROJECT_DIR" || { echo "ERROR: Could not change directory to $PROJECT_DIR. Exiting."; exit 1; }

# --- 6. Execute the Testing Script ---
echo "==============================================================="
echo "INFO: Starting Python testing script: $TEST_SCRIPT"
echo "INFO: Using config: $CONFIG_FILE"
echo "INFO: Using checkpoint: $CHECKPOINT_PATH"
echo "==============================================================="

# Define a unique output directory for this test run's predictions
OUTPUT_DIR="work_dirs/test_ood_job_${SLURM_JOB_ID}"
echo "INFO: Predictions will be saved to: $OUTPUT_DIR"

# The `srun` command ensures the process is managed correctly by the scheduler.
srun "$PYTHON_EXE" "$TEST_SCRIPT" \
    "$CONFIG_FILE" \
    "$CHECKPOINT_PATH" \
    --out "$OUTPUT_DIR"

EXIT_CODE=$?

# --- 7. Finalize ---
echo "==============================================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "INFO: Python script finished successfully."
else
    echo "ERROR: Python script exited with a non-zero code: $EXIT_CODE."
fi
echo "Job finished on:     $(date)"
echo "==============================================================="

exit $EXIT_CODE