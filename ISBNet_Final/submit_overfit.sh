#!/bin/bash

# ==============================================================================
#                               SLURM DIRECTIVES
# ==============================================================================
#SBATCH --job-name=ISBNet_OverfitTest
#SBATCH --output=logs/overfit_job_%j.log
#SBATCH --error=logs/overfit_job_%j.err
#SBATCH --account=oz419
#SBATCH --partition=milan_gpu
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G      # 64G is plenty for this small test
#SBATCH --time=01:00:00  # 1 hour is more than enough

# ==============================================================================
#                               JOB EXECUTION
# ==============================================================================

# ... (All your environment setup, paths, etc. are the same and correct) ...
PROJECT_DIR="/fred/oz419/brenda/ISBNet"
CONDA_ENV_NAME="isbnet_env"
PYTHON_EXE="/fred/oz419/brenda/.conda/envs/${CONDA_ENV_NAME}/bin/python"
CONFIG_FILE="configs/for-instance/config_overfit.yaml" # <--- Point to the new config

module load mamba; module load cuda/12.6.0; module load cudnn/9.5.0.50-cuda-12.6.0
export PYTHONPATH=${PROJECT_DIR}:$PYTHONPATH
cd "$PROJECT_DIR" || exit 1

# --- Execute the Overfitting Test ---
echo "INFO: Starting overfitting test with config: $CONFIG_FILE"

srun "$PYTHON_EXE" tools/train.py \
    "$CONFIG_FILE" \
    --seed 42 \
    --skip_validate \
    --work_dir "work_dirs/overfit_test_job_${SLURM_JOB_ID}"