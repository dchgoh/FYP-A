#!/bin/bash

# --- SLURM Directives ---
#SBATCH --job-name=pointnet2_inst_train_1gpu  # Specific name for INSTANCE training
#SBATCH --output=pointnet2_inst_train_job%j.log # Specific log file for INSTANCE training (%j = Job ID)
#SBATCH --nodes=1                         # Run on a single node
#SBATCH --ntasks=1                        # Run a single task (your Python script)
#SBATCH --gres=gpu:1                      # Number of GPUs per node
#SBATCH --cpus-per-task=8                 # Request CPU cores (>= num_workers)
#SBATCH --time=24:00:00                   # !!! ADJUST: May need more time for instance seg? !!!
#SBATCH --mem=32G                         # !!! ADJUST: May need more memory if num_trees is large !!!

# --- Environment Setup ---
echo "========================================================"
echo "Job started on $(hostname) at $(date)"
echo "Job Name: $SLURM_JOB_NAME"
echo "Job ID: $SLURM_JOB_ID"
echo "Node List: $SLURM_JOB_NODELIST"
echo "Number of Tasks: $SLURM_NTASKS"
echo "CPUs per Task: $SLURM_CPUS_PER_TASK"
echo "Memory requested: ${SLURM_MEM_PER_TASK:-$SLURM_MEM_PER_NODE} MB per task/node" # Handles both mem and mem-per-cpu requests
echo "GPUs requested: $SLURM_GPUS_ON_NODE"
echo "========================================================"

echo "Loading modules..."
module load mamba
module load cuda/12.6.0                 # <<< Ensure this matches your PyTorch CUDA version
module load cudnn/9.5.0.50-cuda-12.6.0  # <<< Ensure this matches your PyTorch cuDNN version
echo "Modules loaded."
module list # List loaded modules to the log file

echo "--------------------------------------------------------"
echo "Activating Conda environment..."
# --- !!! IMPORTANT: VERIFY AND REPLACE with YOUR actual Conda env path !!! ---
CONDA_ENV_PATH="/fred/oz419/brenda/.conda/envs/py3.11" # <<< UPDATE THIS PATH if different
# --- Initialize Mamba for the script's shell ---
eval "$(mamba shell.bash hook)"
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to initialize mamba shell hook."
    exit 1
fi
echo "Mamba shell hook initialized."

# --- Activate using 'mamba activate' ---
mamba activate $CONDA_ENV_PATH
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to activate Conda environment using 'mamba activate $CONDA_ENV_PATH'"
    exit 1
fi

echo "Activated environment: $(conda info --envs | grep '*' | awk '{print $1}') at $CONDA_DEFAULT_ENV"
echo "Python executable: $(which python)"
# --- Verify PyTorch and CUDA Setup ---
echo "PyTorch path: $(python -c 'import torch; print(torch.__file__)' 2>/dev/null || echo 'ERROR: Torch not found')"
echo "PyTorch version: $(python -c 'import torch; print(torch.__version__)' 2>/dev/null || echo 'N/A')"
echo "CUDA available: $(python -c 'import torch; print(torch.cuda.is_available())' 2>/dev/null || echo 'N/A')"
echo "CUDA version (PyTorch): $(python -c 'import torch; print(torch.version.cuda)' 2>/dev/null || echo 'N/A')"
echo "CuDNN version (PyTorch): $(python -c 'import torch; print(torch.backends.cudnn.version())' 2>/dev/null || echo 'N/A')"
echo "Device Count: $(python -c 'import torch; print(torch.cuda.device_count())' 2>/dev/null || echo 'N/A')"
nvidia-smi || echo "nvidia-smi command not found or failed" # Print GPU status
echo "--------------------------------------------------------"

# --- Define Directories ---
# --- !!! IMPORTANT: REPLACE with YOUR actual paths !!! ---
PROJECT_DIR="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch" # <<< Path to your train_inst.py script
DATA_DIR="/fred/oz419/brenda/FOR-Instance"       # <<< Path to folder containing train_blocks, val_blocks

echo "Project Directory: $PROJECT_DIR"
echo "Data Directory:    $DATA_DIR"
echo "--------------------------------------------------------"

# --- Navigate to Project Directory (Recommended) ---
cd $PROJECT_DIR
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to change directory to $PROJECT_DIR"
    exit 1
fi
echo "Current working directory: $(pwd)"
echo "--------------------------------------------------------"

# --- Execute Python Instance Segmentation Training Script ---
echo "Starting Python INSTANCE segmentation training script (train_inst.py)..."
python $PROJECT_DIR/train_inst.py \
    --model pointnet2_sem_seg \
    --data_path $DATA_DIR \
    --log_dir "pointnet2_inst_training_run_${SLURM_JOB_ID}" \
    --batch_size 64 \
    --epoch 32 \
    --learning_rate 0.001 \
    --npoint 1024 \
    --num_workers $SLURM_CPUS_PER_TASK \
    --save_period 4 \
    --gpu 0 \
    # --- Add any other arguments SPECIFICALLY needed by train_inst.py ---
    # --- e.g., --ignore_tree_id 0 (if train_inst.py needs it explicitly) ---
    # Note: --num_trees and --weights_path are NOT needed here if the DataLoader provides them.

# --- Capture Exit Code ---
EXIT_CODE=$?
echo "--------------------------------------------------------"
if [ $EXIT_CODE -eq 0 ]; then
    echo "Python script (train_inst.py) finished successfully."
else
    echo "ERROR: Python script (train_inst.py) exited with code $EXIT_CODE."
fi
echo "Job finished at $(date)"
echo "========================================================"
exit $EXIT_CODE