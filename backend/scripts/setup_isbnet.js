// scripts/setup_isbnet.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function setupISBNet() {
    console.log('[ISBNet Setup] Starting ISBNet inference engine setup...');
    
    const projectRootDir = path.resolve(__dirname, '..');
    
    // Check if ISBNet files exist in the backend directory
    const requiredFiles = [
        'run_inference_local.py',
        'configs/config_forinstance.yaml',
        'configs/best.pth'
    ];
    
    const missingFiles = [];
    for (const file of requiredFiles) {
        const filePath = path.join(projectRootDir, file);
        if (!fs.existsSync(filePath)) {
            missingFiles.push(file);
        }
    }
    
    if (missingFiles.length > 0) {
        console.error('[ISBNet Setup] Missing required ISBNet files:');
        missingFiles.forEach(file => console.error(`  - ${file}`));
        console.error(`[ISBNet Setup] Expected in: ${projectRootDir}`);
        return false;
    }
    
    console.log('[ISBNet Setup] All required files found');
    
    // Check if conda/mamba is available
    try {
        await runCommand('mamba', ['--version']);
        console.log('[ISBNet Setup] Mamba found');
    } catch (error) {
        console.error('[ISBNet Setup] Mamba not found. Please install Miniconda/Anaconda with mamba.');
        return false;
    }
    
    // Check if environment exists
    try {
        await runCommand('mamba', ['env', 'list']);
        console.log('[ISBNet Setup] Checking for isbnet_env environment...');
    } catch (error) {
        console.error('[ISBNet Setup] Error checking conda environments');
        return false;
    }
    
    console.log('[ISBNet Setup] ISBNet setup verification complete');
    console.log('[ISBNet Setup] To complete setup, run the following commands in WSL/Ubuntu:');
    console.log('');
    console.log('1. Navigate to the backend directory:');
    console.log(`   cd ${projectRootDir}`);
    console.log('');
    console.log('2. Create the conda environment (if environment.yml exists):');
    console.log('   mamba env create -f environment.yml');
    console.log('');
    console.log('3. Activate the environment:');
    console.log('   mamba activate isbnet_env');
    console.log('');
    console.log('4. Set your GPU architecture (replace 8.6 with your GPU\'s compute capability):');
    console.log('   export TORCH_CUDA_ARCH_LIST="8.6"');
    console.log('');
    console.log('5. Compile the extensions:');
    console.log('   cd isbnet/pointnet2');
    console.log('   python setup.py install');
    console.log('   cd ../..');
    console.log('   python setup.py build_ext --inplace');
    console.log('');
    console.log('For CPU-only setup, skip step 4 and the GPU architecture setting.');
    
    return true;
}

function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, { stdio: 'pipe' });
        let output = '';
        let error = '';
        
        process.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        process.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        process.on('close', (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(`Command failed with code ${code}: ${error}`));
            }
        });
        
        process.on('error', (err) => {
            reject(err);
        });
    });
}

// Run setup if called directly
if (require.main === module) {
    setupISBNet().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = { setupISBNet };

