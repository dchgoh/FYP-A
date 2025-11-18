const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Configuration ---
const LASTOOLS_URL = "https://lastools.github.io/download/LAStools.zip";
// __dirname is backend/scripts; the tools folder lives at backend/tools
// Use a relative path up one directory to reach backend/tools reliably.
const TOOLS_DIR = path.resolve(__dirname, '..', 'tools');
const LASTOOLS_DIR = path.join(TOOLS_DIR, 'LAStools');
const LASTOOLS_DIR2 = path.join(LASTOOLS_DIR, 'LAStools');
const BIN_DIR = path.join(LASTOOLS_DIR2, 'bin');
const ZIP_PATH = path.join(TOOLS_DIR, 'LAStools.zip');

/**
 * Main function to check for tools and launch the app.
 */
async function launch() {
    console.log("--- Application Launcher ---");
    
    // 1. Check if LAStools is already downloaded and ready.
    if (!fs.existsSync(path.join(BIN_DIR, 'laszip.exe'))) {
        console.log("LAStools not found. Starting one-time setup...");
        await setupLAStools();
    } else {
        console.log("✅ LAStools is ready.");
    }

    // 2. Prepare the environment for the application
    console.log("Preparing environment...");
    
    // On Windows, the path delimiter is ';'.
    const newPath = `${BIN_DIR}${path.delimiter}${process.env.PATH}`;
    
    // Create a copy of the current environment and overwrite the PATH
    const env = {
        ...process.env,
        PATH: newPath,
    };
    
    console.log("Environment configured. Starting application...");
    console.log("====================================================\n");

    // 3. Define the command to start the actual application
    const mainCommand = 'concurrently';
    const mainArgs = [
        "--kill-others",
        "npm:server",
        "npm:client",
        "npm:backup"
    ];

    // 4. Launch the application with the modified environment
    // We use 'npx' to ensure concurrently is found
    const appProcess = spawn('npx', [mainCommand, ...mainArgs], {
        env: env,       // Inject the modified environment
        stdio: 'inherit', // Show all output from the app in this terminal
        shell: true     // Important for Windows to handle commands correctly
    });

    appProcess.on('close', (code) => {
        console.log(`\n====================================================`);
        console.log(`Application process exited with code ${code}`);
    });
}

/**
 * Downloads and unzips LAStools into the local project folder.
 */
async function setupLAStools() {
    try {
        if (!fs.existsSync(TOOLS_DIR)) {
            fs.mkdirSync(TOOLS_DIR, { recursive: true });
        }

        console.log(`Downloading LAStools from ${LASTOOLS_URL}...`);
        execSync(`powershell -Command "Invoke-WebRequest -Uri ${LASTOOLS_URL} -OutFile ${ZIP_PATH}"`, { stdio: 'inherit' });
        
        console.log(`\nUnzipping ${ZIP_PATH}...`);
        execSync(`powershell -Command "Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${LASTOOLS_DIR}' -Force"`, { stdio: 'inherit' });
        
        fs.unlinkSync(ZIP_PATH);
        console.log("\n✅ LAStools setup complete.");
    } catch (error) {
        console.error("\n❌ ERROR: Failed during LAStools setup.");
        console.error("Please check your internet connection and ensure PowerShell is available.");
        console.error(error.message);
        process.exit(1); // Stop the launch process if setup fails
    }
}

// Run the launcher
launch();