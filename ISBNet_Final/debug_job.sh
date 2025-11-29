#!/bin/bash
#SBATCH --job-name=ISBNet_DEBUG
#SBATCH --output=logs/debug_run_%j.log
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=00:30:00  # 30 minutes is enough for the debug run
#SBATCH --gres=gpu:1

# --- Create a directory for logs ---
mkdir -p logs

# --- Load the mamba module ---
echo "Loading Mamba module..."
module load mamba

# --- Activate Environment ---
echo "Activating Conda environment..."
mamba activate isbnet_env

# --- START OF THE DEBUG COMMAND ---
# This is the most important line. It makes CUDA errors synchronous.
export CUDA_LAUNCH_BLOCKING=1
# --- END OF THE DEBUG COMMAND ---

# --- Run the Training Script ---
echo "Starting training in DEBUG mode..."
python tools/train.py --config configs/for-instance/config_forinstance.yaml

echo "Debug run finished."