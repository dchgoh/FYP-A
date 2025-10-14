// services/gpuResourceManager.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class GPUResourceManager {
    constructor() {
        this.availableGPUs = [];
        this.allocatedGPUs = new Map(); // jobId -> gpuId
        this.gpuMemoryUsage = new Map(); // gpuId -> memory usage in MB
        this.maxGpuMemory = parseInt(process.env.MAX_GPU_MEMORY_MB) || 8000; // Default 8GB
        this.checkInterval = null;
        this.initializeGPUs();
    }

    async initializeGPUs() {
        try {
            // Detect available GPUs using nvidia-smi
            const gpuInfo = await this.detectGPUs();
            this.availableGPUs = gpuInfo;
            console.log(`[GPU Manager] Detected ${this.availableGPUs.length} GPUs:`, this.availableGPUs);
            
            // Start monitoring GPU memory usage
            this.startMemoryMonitoring();
        } catch (error) {
            console.warn('[GPU Manager] Failed to detect GPUs, falling back to CPU mode:', error.message);
            this.availableGPUs = [];
        }
    }

    async detectGPUs() {
        return new Promise((resolve, reject) => {
            const nvidiaSmi = spawn('nvidia-smi', ['--query-gpu=index,name,memory.total', '--format=csv,noheader,nounits']);
            let output = '';
            
            nvidiaSmi.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            nvidiaSmi.on('close', (code) => {
                if (code === 0) {
                    const gpus = output.trim().split('\n').map((line, index) => {
                        const [gpuIndex, name, memoryTotal] = line.split(', ');
                        return {
                            id: parseInt(gpuIndex),
                            name: name.trim(),
                            totalMemory: parseInt(memoryTotal),
                            available: true
                        };
                    });
                    resolve(gpus);
                } else {
                    reject(new Error('nvidia-smi command failed'));
                }
            });
            
            nvidiaSmi.on('error', (error) => {
                reject(error);
            });
        });
    }

    startMemoryMonitoring() {
        if (this.availableGPUs.length === 0) return;
        
        this.checkInterval = setInterval(async () => {
            try {
                await this.updateGpuMemoryUsage();
            } catch (error) {
                console.error('[GPU Manager] Error updating GPU memory usage:', error);
            }
        }, 5000); // Check every 5 seconds
    }

    async updateGpuMemoryUsage() {
        if (this.availableGPUs.length === 0) return;
        
        return new Promise((resolve, reject) => {
            const nvidiaSmi = spawn('nvidia-smi', ['--query-gpu=index,memory.used', '--format=csv,noheader,nounits']);
            let output = '';
            
            nvidiaSmi.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            nvidiaSmi.on('close', (code) => {
                if (code === 0) {
                    const lines = output.trim().split('\n');
                    lines.forEach(line => {
                        const [gpuIndex, memoryUsed] = line.split(', ');
                        const gpuId = parseInt(gpuIndex);
                        const usedMemory = parseInt(memoryUsed);
                        this.gpuMemoryUsage.set(gpuId, usedMemory);
                    });
                    resolve();
                } else {
                    reject(new Error('Failed to get GPU memory usage'));
                }
            });
            
            nvidiaSmi.on('error', (error) => {
                reject(error);
            });
        });
    }

    async allocateGPU(jobId, requiredMemory = 2000) {
        if (this.availableGPUs.length === 0) {
            return null; // No GPUs available, use CPU
        }

        // Find available GPU with sufficient memory
        for (const gpu of this.availableGPUs) {
            if (!gpu.available) continue;
            
            const currentUsage = this.gpuMemoryUsage.get(gpu.id) || 0;
            const availableMemory = gpu.totalMemory - currentUsage;
            
            if (availableMemory >= requiredMemory) {
                // Allocate this GPU
                gpu.available = false;
                this.allocatedGPUs.set(jobId, gpu.id);
                console.log(`[GPU Manager] Allocated GPU ${gpu.id} to job ${jobId} (${availableMemory}MB available)`);
                return gpu.id;
            }
        }

        console.warn(`[GPU Manager] No GPU available with ${requiredMemory}MB memory for job ${jobId}`);
        return null;
    }

    releaseGPU(jobId) {
        const gpuId = this.allocatedGPUs.get(jobId);
        if (gpuId !== undefined) {
            // Find and mark GPU as available
            const gpu = this.availableGPUs.find(g => g.id === gpuId);
            if (gpu) {
                gpu.available = true;
                console.log(`[GPU Manager] Released GPU ${gpuId} from job ${jobId}`);
            }
            this.allocatedGPUs.delete(jobId);
        }
    }

    getGpuStatus() {
        return {
            totalGPUs: this.availableGPUs.length,
            availableGPUs: this.availableGPUs.filter(g => g.available).length,
            allocatedGPUs: this.allocatedGPUs.size,
            gpuDetails: this.availableGPUs.map(gpu => ({
                id: gpu.id,
                name: gpu.name,
                totalMemory: gpu.totalMemory,
                usedMemory: this.gpuMemoryUsage.get(gpu.id) || 0,
                available: gpu.available,
                allocatedTo: Array.from(this.allocatedGPUs.entries())
                    .filter(([jobId, gpuId]) => gpuId === gpu.id)
                    .map(([jobId]) => jobId)
            }))
        };
    }

    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}

// Create singleton instance
const gpuManager = new GPUResourceManager();

module.exports = gpuManager;
