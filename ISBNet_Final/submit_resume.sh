#!/bin/bash

# ==============================================================================
#                               SLURM DIRECTIVES
# ==============================================================================
# This section tells the SLURM scheduler how to run our GPU training job.

# -- Job Details --
#SBATCH --job-name=ISBNet_Train_ForInstance  # A descriptive name for your training job.
#SBATCH --output=logs/training_job_%j.log    # Log file for STDOUT. %j is the Job ID.
#SBATCH --error=logs/training_job_%j.err     # Log file for STDERR.

# -- Account and Partition --
#SBATCH --account=oz419                     # Your project account.
#SBATCH --partition=milan_gpu               # The correct GPU partition on OzSTAR.

# -- Resource Allocation --
#SBATCH --nodes=1                           # Request one server node.
#SBATCH --ntasks-per-node=1                 # Run one main task (the python script) on this node.
#SBATCH --gres=gpu:1                        # Request exactly one GPU.
#SBATCH --cpus-per-task=16                  # Request CPU cores for data loading (matches num_workers).
#SBATCH --mem=80G                           # Request a generous amount of system RAM.
#SBATCH --time=2-00:00:00                   # Request a walltime of 2 days (48 hours).

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
CONFIG_FILE="configs/for-instance/config_resume_lowlr.yaml"

# Define the absolute path to the Python executable within your Conda environment.
# This is the most robust way to ensure the correct interpreter and packages are used.
PYTHON_EXE="/fred/oz419/brenda/.conda/envs/${CONDA_ENV_NAME}/bin/python"

# --- 3. Environment Setup ---
# We still load modules to make sure CUDA/CUDNN libraries are available to the script.
echo "INFO: Loading required modules for CUDA libraries..."
module load mamba
module load cuda/12.6.0
module load cudnn/9.5.0.50-cuda-12.6.0

# --- 4. Set Library Paths & PYTHONPATH ---
# This ensures that both locally compiled libraries and your project's Python modules are found.
echo "INFO: Setting library and Python paths..."
export CPLUS_INCLUDE_PATH=${PROJECT_DIR}/local/include:$CPLUS_INCLUDE_PATH
export LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LIBRARY_PATH
export LD_LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LD_LIBRARY_PATH

# This next line is CRITICAL. It tells Python where to find the 'isbnet' module.
export PYTHONPATH=${PROJECT_DIR}:$PYTHONPATH

# --- 5. Navigate to Project Directory ---
echo "INFO: Changing directory to $PROJECT_DIR"
cd "$PROJECT_DIR" || { echo "ERROR: Could not change directory to $PROJECT_DIR. Exiting."; exit 1; }
echo "INFO: Current working directory: $(pwd)"

# --- 6. Final Sanity Checks ---
echo "==============================================================="
echo "INFO: Final Sanity Checks..."
# Check that our specified Python executable actually exists
if [ ! -f "$PYTHON_EXE" ]; then
    echo "ERROR: Python executable not found at '$PYTHON_EXE'"
    echo "Please verify the CONDA_ENV_NAME and the path."
    exit 1
fi
echo "      - Python executable to be used: $PYTHON_EXE"
echo "      - PYTHONPATH:                   $PYTHONPATH"
echo "      - GPU Status:"
nvidia-smi
echo "==============================================================="

# --- 7. Execute the Training Script ---
echo "INFO: Starting training with config: $CONFIG_FILE"

# --- Define the specific paths for this resume job ---
RESUME_CHECKPOINT="work_dirs/forinstance_job_4810191/latest.pth"
RESUME_WORKDIR="work_dirs/forinstance_job_4810191"
RESUME_CONFIG="config/config_finetune_low_lr.yaml" # Make sure this is the correct config file

# --- Final check that the files exist ---
if [ ! -f "$RESUME_CHECKPOINT" ]; then
    echo "ERROR: Resume checkpoint not found at '$RESUME_CHECKPOINT'"
    exit 1
fi
if [ ! -f "$RESUME_CONFIG" ]; then
    echo "ERROR: Config file not found at '$RESUME_CONFIG'"
    exit 1
fi

# We call the Python executable using its full, absolute path to avoid any ambiguity.
# The --seed flag is added for reproducibility.
srun "$PYTHON_EXE" tools/train.py \
    "$CONFIG_FILE" \
    --seed 42 \
    --resume "$RESUME_CHECKPOINT" \
    --work_dir "$RESUME_WORKDIR"

# --- 8. Finalize ---
EXIT_CODE=$? # Capture the exit code of the python script
echo "==============================================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "INFO: Training script finished successfully."
else
    echo "ERROR: Training script exited with a non-zero code: $EXIT_CODE."
fi
echo "Job finished on:     $(date)"
echo "==============================================================="

exit $EXIT_CODE