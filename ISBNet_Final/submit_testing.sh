#!/bin/bash

# ==============================================================================
#                               SLURM DIRECTIVES
# ==============================================================================
#SBATCH --job-name=ISBNet_Test_ForInstance
#SBATCH --output=logs/testing_job_%j.log
#SBATCH --error=logs/testing_job_%j.err
#SBATCH --account=oz419
#SBATCH --partition=milan_gpu
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --time=01:00:00

# ==============================================================================
#                               JOB EXECUTION
# ==============================================================================

echo "==============================================================="
echo "SLURM Job ID:        $SLURM_JOB_ID"
echo "Job started on:      $(date)"
echo "==============================================================="

# --- 1. Define Core Paths ---
PROJECT_DIR="/fred/oz419/brenda/ISBNet"
CONDA_ENV_NAME="isbnet_env"
PYTHON_EXE="/fred/oz419/brenda/.conda/envs/${CONDA_ENV_NAME}/bin/python"

# =================================================================
# FIX #1: Correct the path to your configuration file.
# =================================================================
CONFIG_FILE="${PROJECT_DIR}/work_dirs/forinstance_job_6562808/config_forinstance.yaml"

# Set the path to the best model checkpoint from your finished training run.
CHECKPOINT_PATH="${PROJECT_DIR}/work_dirs/forinstance_job_6562808/best.pth"

# --- 2. Environment Activation ---
echo "INFO: Activating Conda environment..."
module load mamba; module load cuda/12.6.0; module load cudnn/9.5.0.50-cuda-12.6.0
CONDA_ROOT=$(conda info --base)
source "${CONDA_ROOT}/etc/profile.d/conda.sh"
conda activate "$CONDA_ENV_NAME"

# --- 3. Set Library & Python Paths ---
export CPLUS_INCLUDE_PATH=${PROJECT_DIR}/local/include:$CPLUS_INCLUDE_PATH
export LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LIBRARY_PATH
export LD_LIBRARY_PATH=${PROJECT_DIR}/local/lib:$LD_LIBRARY_PATH
PYTORCH_LIB_PATH=$($PYTHON_EXE -c "import torch; import os; print(os.path.dirname(torch.__file__))")/lib
export LD_LIBRARY_PATH=$PYTORCH_LIB_PATH:$LD_LIBRARY_PATH
export PYTHONPATH=${PROJECT_DIR}:$PYTHONPATH

# --- 4. Navigate to Project Directory ---
cd "$PROJECT_DIR" || exit 1

# --- 5. Execute the Testing Script ---
echo "INFO: Starting testing with config: $CONFIG_FILE"
echo "INFO: Using checkpoint: $CHECKPOINT_PATH"

# Define the output directory based on the job ID
OUTPUT_DIR="work_dirs/test_job_${SLURM_JOB_ID}"
echo "INFO: Predictions will be saved to: $OUTPUT_DIR"

# =================================================================
# FIX #2: Add the missing backslash '\' for line continuation.
# =================================================================
srun "$PYTHON_EXE" tools/test.py \
    "$CONFIG_FILE" \
    "$CHECKPOINT_PATH" \
    --out "$OUTPUT_DIR"

EXIT_CODE=$? # Capture the exit code of the python script
echo "==============================================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "INFO: Testing script finished successfully."
else
    echo "ERROR: Testing script exited with a non-zero code: $EXIT_CODE."
fi
echo "Job finished on:     $(date)"
echo "==============================================================="

exit $EXIT_CODE