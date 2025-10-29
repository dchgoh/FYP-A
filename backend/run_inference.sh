#!/bin/bash
#SBATCH --job-name=ISBNet_Inference
#SBATCH --output=logs/isbnet_inference_%j.log
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=02:00:00
#SBATCH --gres=gpu:1

mkdir -p logs

# --- START OF FIX ---
# Load the mamba module so the shell knows what 'mamba' is
echo "Loading Mamba module..."
module load mamba
# --- END OF FIX ---

# --- Activate Environment ---
echo "Activating Conda environment..."
mamba activate isbnet_env

# --- Run the Inference Script ---
echo "Starting end-to-end inference..."
python run_inference_local.py \
    /fred/oz419/brenda/isbnet_inference_engine/test_samples/plot_10_annotated.las \
    /fred/oz419/brenda/isbnet_inference_engine/output/plot_10_annotated_prediction.las \
    /fred/oz419/brenda/isbnet_inference_engine/configs/config_forinstance.yaml \
    /fred/oz419/brenda/isbnet_inference_engine/configs/best.pth

echo "Inference job finished."