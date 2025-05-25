#!/bin/bash

# --- SLURM Directives ---
#SBATCH --job-name=pointnet_test_1gpu
#SBATCH --output=pointnet_test_job%j.log
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --gres=gpu:1               # !!! IMPORTANT: Request 1 GPU of specific type !!!
#SBATCH --cpus-per-task=4
#SBATCH --time=01:00:00                   # Evaluation is usually faster than training
#SBATCH --mem=16G                         # Memory might be less critical than training

# --- Environment Setup (Same as training script) ---
echo "========================================================"
# ... (echo job info) ...
echo "========================================================"
echo "Loading modules..."
module load mamba
module load cuda/12.6.0
module load cudnn/9.5.0.50-cuda-12.6.0
module list
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

# --- Define Directories ---
# !!! IMPORTANT: REPLACE with YOUR actual paths !!!
PROJECT_DIR="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch" # <<< Path to test_semseg.py
DATA_DIR="/fred/oz419/brenda/FOR-Instance/preprocessed_folders/test_chunks/SCION"       # <<< Path to folder containing test_blocks
# !!! CRUCIAL: Set this to the specific training run directory you want to evaluate !!!
TRAINING_LOG_DIR="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch/log/sem_seg/pointnet2_msg_training_run_98499" # <<< UPDATE THIS PATH (where XXXXXX is the Slurm Job ID of the training run)

echo "Project Directory: $PROJECT_DIR"
echo "Data Directory:    $DATA_DIR"
echo "Training Log Dir (for checkpoint): $TRAINING_LOG_DIR"
echo "--------------------------------------------------------"

# --- Navigate to Project Directory ---
cd $PROJECT_DIR
# ... (check cd success) ...
echo "Current working directory: $(pwd)"
echo "--------------------------------------------------------"

# --- Execute Python Evaluation Script ---
echo "Starting Python evaluation script..."
python $PROJECT_DIR/test_semseg.py \
    --model pointnet2_sem_seg_msg \
    --data_path $DATA_DIR \
    --log_dir $TRAINING_LOG_DIR \
    --checkpoint best_model.pth \
    --num_point 1024 \
    --batch_size 64 \
    --num_workers $SLURM_CPUS_PER_TASK \
    --gpu 0 \
    --visual # Uncomment this line if you want visualization files

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
