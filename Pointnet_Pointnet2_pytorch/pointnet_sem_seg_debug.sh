#!/bin/bash

# --- SLURM Directives ---
#SBATCH --job-name=pointnet_train_1gpu  # Specific name for single GPU training
#SBATCH --output=pointnet_train_job%j.log # Specific log file with Job ID (%j = Job ID)
#SBATCH --partition=gpuq                  # !!! VERIFY PARTITION NAME !!!
#SBATCH --nodes=1                         # Run on a single node
#SBATCH --ntasks=1                        # Run a single task (your Python script)
#SBATCH --gres=gpu:1             # Number of GPU per nodes
#SBATCH --cpus-per-task=4                 # Request CPU cores (adjust based on DataLoader needs, >= num_workers)
#SBATCH --time=00:30:00                   # !!! ADJUST: Request sufficient walltime (e.g., 4 hours) !!!
#SBATCH --mem=8G                         # !!! ADJUST: Request sufficient memory (e.g., 32 GB) !!!

# --- Environment Setup ---
echo "========================================================"
echo "Job started on $(hostname) at $(date)"
echo "Job Name: $SLURM_JOB_NAME"
echo "Job ID: $SLURM_JOB_ID"
echo "Partition: $SLURM_JOB_PARTITION"
echo "Node List: $SLURM_JOB_NODELIST"
echo "Number of Tasks: $SLURM_NTASKS"
echo "CPUs per Task: $SLURM_CPUS_PER_TASK"
echo "Memory per Node: $SLURM_MEM_PER_NODE MB"
echo "GPUs requested: $SLURM_GPUS_ON_NODE"
echo "========================================================"

echo "Loading modules..."
module load mamba
module load cuda/12.6.0                 # Match your PyTorch install
module load cudnn/9.5.0.50-cuda-12.6.0  # Match your PyTorch install
echo "Modules loaded."
module list # List loaded modules to the log file

echo "--------------------------------------------------------"
echo "Activating Conda environment..."
# --- !!! IMPORTANT: VERIFY AND REPLACE with YOUR actual Conda env path !!! ---
# Find using 'conda info --envs' after activating py3.11 on the login node
CONDA_ENV_PATH="/fred/oz419/brenda/.conda/envs/py3.11" # <<< UPDATE THIS PATH
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
echo "PyTorch path: $(python -c 'import torch; print(torch.__file__)')"
echo "PyTorch version: $(python -c 'import torch; print(torch.__version__)')"
echo "CUDA available: $(python -c 'import torch; print(torch.cuda.is_available())')"
echo "CUDA version (PyTorch): $(python -c 'import torch; print(torch.version.cuda)')"
echo "CuDNN version (PyTorch): $(python -c 'import torch; print(torch.backends.cudnn.version())')"
echo "Device Count: $(python -c 'import torch; print(torch.cuda.device_count())')"
nvidia-smi # Print GPU status from nvidia-smi
echo "--------------------------------------------------------"

# --- Define Directories ---
# --- !!! IMPORTANT: REPLACE with YOUR actual paths !!! ---
PROJECT_DIR="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch" # <<< Path to your train_semseg.py script
DATA_DIR="/fred/oz419/brenda/FOR-Instance"       # <<< Path to folder containing train_blocks, val_blocks
DEBUG_BLOCK_FILE="/fred/oz419/brenda/FOR-Instance/train_blocks/train_block_0.h5" 

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

# --- Execute Python Training Script with Arguments ---
echo "Starting Python training script..."
python $PROJECT_DIR/train_semseg.py \
    --model pointnet_sem_seg \
    --data_path $DATA_DIR \
    --log_dir "pointnet_training_run_${SLURM_JOB_ID}" \
    --batch_size 8 \
    --epoch 1 \
    --learning_rate 0.001 \
    --npoint 1024 \
    --num_workers $SLURM_CPUS_PER_TASK \
    --save_period 5 \
    --gpu 0 \
    --debug_single_block "$DEBUG_BLOCK_FILE" # <<< ADDED THIS LINE
    # --- Add any other arguments needed by your script ---

# --- Capture Exit Code ---
EXIT_CODE=$?
echo "--------------------------------------------------------"
if [ $EXIT_CODE -eq 0 ]; then
    echo "Python script finished successfully."
else
    echo "ERROR: Python script exited with code $EXIT_CODE."
fi
echo "Job finished at $(date)"
echo "========================================================"
exit $EXIT_CODE
