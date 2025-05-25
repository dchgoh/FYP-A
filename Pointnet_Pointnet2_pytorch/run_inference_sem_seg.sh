#!/bin/bash

# --- SLURM Directives ---
#SBATCH --job-name=pointnet_full_cloud_inference
#SBATCH --output=_inference_pointnet_job_%j.log # Log file for inference (%j = Job ID)
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=4                 # Can be lower for inference if not I/O bound by dataloading
#SBATCH --time=24:00:00                   # !!! ADJUST: Depends on input file size and chunking complexity !!!
#SBATCH --mem=64G                         # !!! ADJUST: Depends on input file size loaded into memory !!!

# --- Environment Setup ---
echo "========================================================"
echo "Job started on $(hostname) at $(date)"
echo "Job Name: $SLURM_JOB_NAME"
echo "Job ID: $SLURM_JOB_ID"
echo "Node List: $SLURM_JOB_NODELIST"
echo "Number of Tasks: $SLURM_NTASKS"
echo "CPUs per Task: $SLURM_CPUS_PER_TASK"
echo "Memory requested: ${SLURM_MEM_PER_TASK:-$SLURM_MEM_PER_NODE} MB per task/node"
echo "GPUs requested: $SLURM_GPUS_ON_NODE"
echo "========================================================"

echo "Loading modules..."
module load mamba
module load cuda/12.6.0                 # <<< Ensure this matches your PyTorch CUDA version
module load cudnn/9.5.0.50-cuda-12.6.0  # <<< Ensure this matches your PyTorch cuDNN version
echo "Modules loaded."
module list

echo "--------------------------------------------------------"
echo "Activating Conda environment..."
CONDA_ENV_PATH="/fred/oz419/brenda/.conda/envs/py3.11" # <<< UPDATE THIS PATH if different
eval "$(mamba shell.bash hook)"
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to initialize mamba shell hook."
    exit 1
fi
mamba activate $CONDA_ENV_PATH
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to activate Conda environment using 'mamba activate $CONDA_ENV_PATH'"
    exit 1
fi
echo "Activated environment: $(conda info --envs | grep '*' | awk '{print $1}') at $CONDA_DEFAULT_ENV"
echo "Python executable: $(which python)"
echo "PyTorch path: $(python -c 'import torch; print(torch.__file__)' 2>/dev/null || echo 'ERROR: Torch not found')"
echo "PyTorch version: $(python -c 'import torch; print(torch.__version__)' 2>/dev/null || echo 'N/A')"
echo "CUDA available: $(python -c 'import torch; print(torch.cuda.is_available())' 2>/dev/null || echo 'N/A')"
echo "CUDA version (PyTorch): $(python -c 'import torch; print(torch.version.cuda)' 2>/dev/null || echo 'N/A')"
echo "CuDNN version (PyTorch): $(python -c 'import torch; print(torch.backends.cudnn.version())' 2>/dev/null || echo 'N/A')"
echo "Device Count: $(python -c 'import torch; print(torch.cuda.device_count())' 2>/dev/null || echo 'N/A')"
nvidia-smi || echo "nvidia-smi command not found or failed"
echo "--------------------------------------------------------"

# --- Define Directories and File Paths ---
# --- !!! IMPORTANT: REPLACE with YOUR actual paths !!! ---
PROJECT_DIR="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch"
TRAINING_LOG_DIR="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch/log/sem_seg/pointnet2_msg_training_run_98499" # <<< Path to the SPECIFIC training run's log dir
CHECKPOINT_NAME="best_model.pth" # Or another specific checkpoint
MODEL_PYTHON_NAME="pointnet2_sem_seg_msg" # The Python module name of your model (e.g., pointnet_sem_seg if models/pointnet_sem_seg.py)
CHECKPOINT_PATH="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch/log/sem_seg/pointnet2_msg_training_run_98499/checkpoints/best_model.pth" # <<< Path to the SPECIFIC checkpoint filE

# --- !!! Path to the SINGLE large point cloud file you want to process !!! ---
INPUT_FILE_PATH="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch/SarawakInput/plot_31_annotated.las" # <<< UPDATE THIS
# Or for one of your 100k HDF5 files:
# INPUT_FILE_PATH="/fred/oz419/brenda/FOR-Instance/preprocessed_chunks_100k/test_chunks/some_large_chunk_00.h5"

# Base directory where inference outputs for this job will be saved
OUTPUT_DIR_BASE="/fred/oz419/brenda/Pointnet_Pointnet2_pytorch/inference_results"
# Create a unique output directory for this job's results
JOB_OUTPUT_DIR="${OUTPUT_DIR_BASE}/inference_${SLURM_JOB_ID}_${SLURM_JOB_NAME}"
mkdir -p $JOB_OUTPUT_DIR # Create the directory if it doesn't exist

# Model and data specific parameters (MUST MATCH TRAINING CONFIGURATION AND INPUT DATA)
NUM_POINT_MODEL=1024    # Number of points model was trained with
NUM_FEATURES_MODEL=6   # Number of input features (e.g., 3 for XYZ, 6 for XYZRGB) - MUST MATCH TRAINING AND INPUT FILE

echo "Project Directory: $PROJECT_DIR"
echo "Training Log Directory (for checkpoint): $TRAINING_LOG_DIR"
echo "Input File for Inference: $INPUT_FILE_PATH"
echo "Output Directory for this Job: $JOB_OUTPUT_DIR"
echo "Model Python Name: $MODEL_PYTHON_NAME"
echo "Num Points per Chunk (Model Input): $NUM_POINT_MODEL"
echo "Num Features per Point (Model Input): $NUM_FEATURES_MODEL"
echo "--------------------------------------------------------"

# --- Navigate to Project Directory (Recommended) ---
cd $PROJECT_DIR
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to change directory to $PROJECT_DIR"
    exit 1
fi
echo "Current working directory: $(pwd)"
echo "--------------------------------------------------------"

# --- Execute Python Full Cloud Inference Script ---
echo "Starting Python full cloud inference script (inference_full_cloud.py)..."
python $PROJECT_DIR/inference_full_cloud.py \
    --model "$MODEL_PYTHON_NAME" \
    --checkpoint_path "$CHECKPOINT_PATH" \
    --input_file "$INPUT_FILE_PATH" \
    --output_dir "$JOB_OUTPUT_DIR" \
    --num_point_model "$NUM_POINT_MODEL" \
    --num_features "$NUM_FEATURES_MODEL" \
    --batch_size_inference 4 \
    --stride_ratio 0.8 \
    --gpu 0

# --- Capture Exit Code ---
EXIT_CODE=$?
echo "--------------------------------------------------------"
if [ $EXIT_CODE -eq 0 ]; then
    echo "Python script (inference_full_cloud.py) finished successfully."
    echo "Results saved in: $JOB_OUTPUT_DIR"
else
    echo "ERROR: Python script (inference_full_cloud.py) exited with code $EXIT_CODE."
fi
echo "Job finished at $(date)"
echo "========================================================"
exit $EXIT_CODE
