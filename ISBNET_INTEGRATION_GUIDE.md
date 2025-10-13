# ISBNet Instance Segmentation Integration Guide

## Overview

This guide explains how to integrate the ISBNet instance segmentation engine into your UAS website, providing both semantic and instance segmentation capabilities.

## What's New

### 🚀 **Instance Segmentation Support**
- **ISBNet Integration**: Full integration with the ISBNet inference engine
- **Dual Segmentation**: Support for both semantic and instance segmentation
- **Queue Management**: Instance segmentation jobs are properly queued and managed
- **Resource Allocation**: GPU resources are intelligently allocated for instance segmentation
- **Progress Tracking**: Real-time progress updates during instance segmentation

### 🎛 **User Interface Updates**
- **Segmentation Options**: Users can choose between semantic and instance segmentation
- **Smart UI**: Instance segmentation option only appears when segmentation is enabled
- **Status Updates**: Clear status messages for different segmentation types

## Setup Instructions

### 1. **ISBNet Engine Setup**

#### Prerequisites
- Windows with WSL2 installed
- NVIDIA GPU (recommended) or CPU-only setup
- Miniconda/Anaconda with mamba

#### Step 1: Place ISBNet Engine
1. Download or clone the ISBNet inference engine
2. Place it in your backend directory:
   ```
   backend/
   ├── isbnet_inference_engine/
   │   ├── run_inference_local.py
   │   ├── configs/
   │   │   ├── config_forinstance.yaml
   │   │   └── best.pth
   │   ├── environment.yml
   │   └── ... (other ISBNet files)
   ```

#### Step 2: WSL2 Setup (Windows Users)

**For NVIDIA GPU Users:**
1. Install WSL2 and Ubuntu
2. Install NVIDIA drivers on Windows
3. Install system prerequisites in Ubuntu:
   ```bash
   sudo apt-get update
   sudo apt-get install build-essential libsparsehash-dev mamba -y
   sudo apt-get install cuda-toolkit -y
   ```
4. Verify setup:
   ```bash
   nvidia-smi
   nvcc --version
   ```

**For CPU-Only Users:**
1. Install WSL2 and Ubuntu
2. Install system prerequisites:
   ```bash
   sudo apt-get update
   sudo apt-get install build-essential libsparsehash-dev mamba -y
   ```

#### Step 3: Python Environment Setup
1. Navigate to ISBNet directory in WSL:
   ```bash
   cd /mnt/c/Users/yourusername/Desktop/UAS/backend/isbnet_inference_engine
   ```

2. Create conda environment:
   ```bash
   mamba env create -f environment.yml
   ```

3. Activate environment:
   ```bash
   mamba activate isbnet_env
   ```

4. **For GPU users only** - Set GPU architecture:
   ```bash
   export TORCH_CUDA_ARCH_LIST="8.6"  # Replace with your GPU's compute capability
   ```

5. Compile extensions:
   ```bash
   # Compile PointNet++ extensions
   cd isbnet/pointnet2
   python setup.py install
   cd ../..
   
   # Compile other extensions
   python setup.py build_ext --inplace
   ```

### 2. **Backend Integration**

The backend has been updated with:

#### New Services
- `isbnetInstanceSegmentationService.js` - Handles ISBNet inference
- Updated `queueService.js` - Supports instance segmentation jobs
- Updated `fileController.js` - Accepts instance segmentation parameter

#### New API Endpoints
- File upload now accepts `useInstanceSegmentation` parameter
- Queue management supports instance segmentation jobs

#### Database Updates
- New status: `instance_segmenting` and `instance_segmented_ready`
- Proper status tracking for instance segmentation pipeline

### 3. **Frontend Integration**

#### Updated Components
- `FileUploadModal.jsx` - Added instance segmentation toggle
- `useFileManagement.js` - Added instance segmentation state management
- Status handling for instance segmentation progress

#### User Experience
- **Segmentation Options**:
  - Skip Tree Segmentation (no processing)
  - Semantic Segmentation (PointNet2 - existing)
  - Instance Segmentation (ISBNet - new)

## Usage

### For Users

1. **Upload File**: Click "Upload New File"
2. **Choose Segmentation**: 
   - Uncheck "Skip Tree Segmentation" to enable segmentation options
   - Check "Use Instance Segmentation (ISBNet)" for instance segmentation
3. **Submit**: File will be queued for processing

### For Administrators

1. **Queue Management**: Monitor instance segmentation jobs in the queue
2. **System Health**: Check GPU usage for instance segmentation
3. **Resource Monitoring**: Instance segmentation uses more GPU memory (3GB vs 2GB)

## Technical Details

### Processing Pipeline

#### Instance Segmentation Flow
1. **File Upload** → Queue with `useInstanceSegmentation: true`
2. **LAS Processing** → Extract tree data and coordinates
3. **Instance Segmentation** → Run ISBNet inference
4. **File Encryption** → Encrypt processed file
5. **Status Update** → Mark as ready for viewer

#### Resource Management
- **GPU Memory**: 3GB allocated per instance segmentation job
- **Priority**: Instance segmentation has lower priority than semantic segmentation
- **Fallback**: Automatic CPU fallback if GPU unavailable

### File Structure
```
backend/
├── services/
│   ├── isbnetInstanceSegmentationService.js  # New ISBNet service
│   ├── queueService.js                       # Updated for instance segmentation
│   └── ...
├── controllers/
│   └── fileController.js                     # Updated for instance segmentation
├── isbnet_inference_engine/                  # ISBNet engine directory
│   ├── run_inference_local.py
│   ├── configs/
│   └── ...
└── scripts/
    └── setup_isbnet.js                       # ISBNet setup verification
```

### Configuration

#### Environment Variables
```env
# Existing variables
MAX_CONCURRENT_JOBS=2
MAX_GPU_MEMORY_MB=8000

# ISBNet-specific (handled automatically)
# GPU allocation is managed by the system
```

#### Queue Priorities
- **Priority 2**: Skip segmentation (highest)
- **Priority 1**: Semantic segmentation
- **Priority 0**: Instance segmentation (lowest)

## Troubleshooting

### Common Issues

1. **ISBNet Engine Not Found**
   - Ensure `isbnet_inference_engine` directory exists in backend
   - Check that `run_inference_local.py` is present
   - Verify config and checkpoint files exist

2. **WSL/Conda Issues**
   - Ensure WSL2 is properly installed
   - Check that mamba/conda is available in WSL
   - Verify Python environment is activated

3. **GPU Memory Issues**
   - Instance segmentation requires more GPU memory
   - Reduce `MAX_CONCURRENT_JOBS` if running out of memory
   - System will automatically fall back to CPU if needed

4. **Compilation Errors**
   - Check GPU compute capability setting
   - Ensure CUDA toolkit is properly installed
   - Try CPU-only compilation if GPU issues persist

### Verification Commands

```bash
# Check ISBNet setup
cd backend
node scripts/setup_isbnet.js

# Check system health
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:5000/api/files/system/health

# Check queue status
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:5000/api/files/queue/status
```

## Performance Characteristics

### Instance Segmentation vs Semantic Segmentation

| Aspect | Semantic Segmentation | Instance Segmentation |
|--------|----------------------|----------------------|
| **Model** | PointNet2 | ISBNet |
| **GPU Memory** | 2GB | 3GB |
| **Processing Time** | Faster | Slower |
| **Output** | Class labels per point | Individual tree instances |
| **Use Case** | Tree classification | Individual tree detection |

### Resource Usage
- **CPU**: Instance segmentation is more CPU-intensive
- **GPU**: Requires more VRAM but provides better accuracy
- **Memory**: Higher system memory usage during processing
- **Storage**: Similar output file sizes

## Future Enhancements

1. **Batch Processing**: Process multiple files simultaneously
2. **Model Selection**: Allow users to choose different ISBNet models
3. **Custom Configurations**: User-configurable ISBNet parameters
4. **Result Visualization**: Enhanced point cloud viewer for instance results
5. **Performance Optimization**: GPU memory optimization for larger files

## Support

For issues with ISBNet integration:
1. Check the system health dashboard
2. Review ISBNet setup logs
3. Verify WSL and conda environment
4. Check GPU memory usage
5. Review queue status for failed jobs

The system now provides comprehensive instance segmentation capabilities while maintaining all existing semantic segmentation functionality.
