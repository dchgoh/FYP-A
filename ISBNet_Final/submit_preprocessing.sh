#!/bin/bash

# ==============================================================================
#                               SLURM DIRECTIVES
# ==============================================================================
# This section tells the SLURM scheduler how to run our job.

# -- Job Details --
#SBATCH --job-name=InstanceAwarePreprocess   # A clear and descriptive name for your job.
#SBATCH --output=logs/preprocess_job_%j.log  # Log file for STDOUT. %j is the Job ID. Creates 'logs' dir if it doesn't exist.
#SBATCH --error=logs/preprocess_job_%j.err   # Log file for STDERR.

# -- Account and Partition --
#SBATCH --account=oz419                     # Your project account.
#SBATCH --partition=milan                   # Use a CPU partition. Preprocessing doesn't need a GPU and this is more available.

# -- Resource Allocation --
#SBATCH --nodes=1                           # Request a single server node.
#SBATCH --ntasks=1                          # Run a single task (our python script).
#SBATCH --cpus-per-task=24                  # Request a good number of CPU cores. Your Python script uses multiprocessing, so more CPUs = faster processing.
#SBATCH --mem=80G                           # Request a generous amount of RAM for loading large LAS files. Adjust if one file is exceptionally large.
#SBATCH --time=2-00:00:00                   # Request a walltime of 2 days. It's better to request more and have the job finish early.

# ==============================================================================
#                               JOB EXECUTION
# ==============================================================================

# --- 1. Preamble and Setup ---
# This section sets up the environment and prints useful information to the log file.
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
# Using variables makes the script cleaner and easier to modify later.
PROJECT_DIR="/fred/oz419/brenda/ISBNet"
CONDA_ENV_NAME="isbnet_env"
# IMPORTANT: Update this path to point to your new preprocessing script.
PREPROCESS_SCRIPT="tools/preprocess_instance_aware_v3_centered.py" # Or whatever you named it

# --- 3. Environment Activation ---
# This section loads the necessary modules and activates your Conda environment.
echo "INFO: Loading required modules..."
module load mamba
module load cuda/12.6.0
module load cudnn/9.5.0.50-cuda-12.6.0
echo "INFO: Activating Conda environment: $CONDA_ENV_NAME"
eval "$(mamba shell.bash hook)"
mamba activate "$CONDA_ENV_NAME"

# Check if activation was successful
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to activate Conda environment. Exiting."
    exit 1
fi

# --- 4. Set Library Paths ---
# This ensures that any compiled libraries can be found.
echo "INFO: Setting library paths..."
export CPLUS_INCLUDE_PATH=${PROJECT_DIR}/local/include:$CPLUS_INCLUDE_PATH
export LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LIBRARY_PATH
export LD_LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LD_LIBRARY_PATH

# Add PyTorch's internal library path (good practice)
PYTORCH_LIB_PATH=$(python -c "import torch; import os; print(os.path.dirname(torch.__file__))")/lib
export LD_LIBRARY_PATH=$PYTORCH_LIB_PATH:$LD_LIBRARY_PATH

# --- 5. Navigate to Project Directory ---
echo "INFO: Changing directory to $PROJECT_DIR"
cd "$PROJECT_DIR" || { echo "ERROR: Could not change directory to $PROJECT_DIR. Exiting."; exit 1; }

# --- 6. Execute the Preprocessing Script ---
echo "==============================================================="
echo "INFO: Starting Python preprocessing script: $PREPROCESS_SCRIPT"
echo "==============================================================="

# The `srun` command is often used within SLURM scripts to launch the main task.
# It ensures the process is managed correctly by the scheduler.
srun python "$PREPROCESS_SCRIPT"

# --- 7. Finalize ---
echo "==============================================================="
echo "INFO: Python script finished."
echo "Job finished on:     $(date)"
echo "==============================================================="