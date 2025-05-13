// backupScript.js
const { Dropbox } = require('dropbox');
const cron = require('node-cron'); // <--- ADDED: Import node-cron
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); // Adjust path

// --- Configuration ---
// !! IMPORTANT: Set your access token as an ENVIRONMENT VARIABLE !!
// Example: export DROPBOX_ACCESS_TOKEN="your_actual_token" (Linux/macOS)
//          set DROPBOX_ACCESS_TOKEN="your_actual_token" (Windows CMD)
//          $env:DROPBOX_ACCESS_TOKEN="your_actual_token" (Windows PowerShell)
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN; // <--- CHANGED: Read from environment variable
const LOCAL_FOLDER_TO_BACKUP = './uploads';
const DROPBOX_TARGET_FOLDER = '/UAS_MAPPING_BACKUP';

// --- CRON Schedule Configuration ---
// Define how often you want the backup to run.
// Common cron patterns:
// '0 * * * *'      - Every hour at minute 0
// '0 0 * * *'      - Every day at midnight (00:00)
// '0 3 * * *'      - Every day at 3:00 AM
// '*/15 * * * *'   - Every 15 minutes
// '0 0 * * 0'      - Every Sunday at midnight
// For testing, you might use something like '*/1 * * * *' (every minute)
const CRON_SCHEDULE = '*/15 * * * *';

// --- Check for Dropbox Token ---
// <--- CHANGED: Simplified token check, DO NOT HARDCODE YOUR TOKEN HERE
if (!DROPBOX_ACCESS_TOKEN) {
    console.error(
`ERROR: Dropbox Access Token is not set.
Please set the DROPBOX_ACCESS_TOKEN environment variable.
Example:
  Linux/macOS: export DROPBOX_ACCESS_TOKEN="your_token_here"
  Windows CMD: set DROPBOX_ACCESS_TOKEN="your_token_here"
  Windows PowerShell: $env:DROPBOX_ACCESS_TOKEN="your_token_here"
Then run the script: node backupScript.js`
    );
    process.exit(1);
}

const dbx = new Dropbox({ accessToken: DROPBOX_ACCESS_TOKEN });

async function uploadFileToDropbox(localFilePath, dropboxFilePath) {
    try {
        const fileContents = await fs.readFile(localFilePath);
        const response = await dbx.filesUpload({
            path: dropboxFilePath,
            contents: fileContents,
            mode: 'overwrite',
        });
        console.log(`[${new Date().toISOString()}] SUCCESS: Uploaded '${localFilePath}' to Dropbox as '${response.result.path_display}'`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ERROR uploading file '${localFilePath}' to '${dropboxFilePath}':`, error.status ? error.error : error);
        // Propagate the error so the main job knows something went wrong if needed
        throw error;
    }
}

async function createDropboxFolder(dropboxFolderPath) {
    try {
        await dbx.filesCreateFolderV2({ path: dropboxFolderPath, autorename: false });
        console.log(`[${new Date().toISOString()}] INFO: Ensured Dropbox folder exists: '${dropboxFolderPath}'`);
    } catch (error) {
        if (error.status === 409 && error.error && error.error.error_summary && error.error.error_summary.startsWith('path/conflict/folder/')) {
            console.log(`[${new Date().toISOString()}] INFO: Dropbox folder '${dropboxFolderPath}' already exists.`);
        } else {
            console.error(`[${new Date().toISOString()}] ERROR creating Dropbox folder '${dropboxFolderPath}':`, error.status ? error.error : error);
            throw error;
        }
    }
}

async function backupFolderRecursive(localFolderPath, dropboxBaseFolder) {
    console.log(`[${new Date().toISOString()}] \nProcessing local folder: ${localFolderPath}`);
    const items = await fs.readdir(localFolderPath, { withFileTypes: true });

    for (const item of items) {
        const localItemPath = path.join(localFolderPath, item.name);
        const relativePath = path.relative(LOCAL_FOLDER_TO_BACKUP, localItemPath).replace(/\\/g, '/');
        const dropboxItemPath = `${dropboxBaseFolder}/${relativePath}`.replace(/\/\//g, '/');

        if (item.isDirectory()) {
            console.log(`[${new Date().toISOString()}] Found directory: ${localItemPath}`);
            await createDropboxFolder(dropboxItemPath);
            await backupFolderRecursive(localItemPath, dropboxBaseFolder);
        } else if (item.isFile()) {
            console.log(`[${new Date().toISOString()}] Found file: ${localItemPath}, preparing to upload to: ${dropboxItemPath}`);
            await uploadFileToDropbox(localItemPath, dropboxItemPath);
        }
    }
}

// <--- RENAMED from main to runBackupJob for clarity --->
async function runBackupJob() {
    console.log(`\n--- [${new Date().toISOString()}] Starting Scheduled Dropbox Backup ---`);
    console.log(`Local source: '${path.resolve(LOCAL_FOLDER_TO_BACKUP)}'`);
    console.log(`Dropbox destination base: '${DROPBOX_TARGET_FOLDER}'`);

    try {
        await createDropboxFolder(DROPBOX_TARGET_FOLDER);
        await backupFolderRecursive(LOCAL_FOLDER_TO_BACKUP, DROPBOX_TARGET_FOLDER);
        console.log(`\n--- [${new Date().toISOString()}] Dropbox Backup Completed Successfully ---\n`);
    } catch (err) {
        console.error(`\n--- [${new Date().toISOString()}] Dropbox Backup Failed ---`, err, "\n");
    }
}

// --- Schedule the Backup ---
// <--- ADDED: Scheduling logic using node-cron --->
if (cron.validate(CRON_SCHEDULE)) {
    console.log(`[${new Date().toISOString()}] Backup scheduler initialized.`);
    console.log(`Backups will run on the following schedule: ${CRON_SCHEDULE}`);
    console.log(`Current server time: ${new Date().toString()}`);
    console.log(`The local folder '${path.resolve(LOCAL_FOLDER_TO_BACKUP)}' will be backed up to Dropbox folder '${DROPBOX_TARGET_FOLDER}'.`);
    console.log("Waiting for the next scheduled backup time. Press Ctrl+C to stop.");

    // Optional: Run the backup once immediately when the script starts
    // console.log(`\n[${new Date().toISOString()}] Performing initial backup run...`);
    // runBackupJob().catch(err => {
    //     console.error(`[${new Date().toISOString()}] Initial backup run failed:`, err);
    // });

    cron.schedule(CRON_SCHEDULE, () => {
        console.log(`\n[${new Date().toISOString()}] Cron job triggered by schedule '${CRON_SCHEDULE}'. Executing backup...`);
        runBackupJob(); // Call the renamed main backup function
    }, {
        scheduled: true,
        // timezone: "America/New_York" // Optional: Uncomment and set your server's timezone
    });
} else {
    console.error(`ERROR: Invalid CRON_SCHEDULE string: '${CRON_SCHEDULE}'. Please check your cron pattern.`);
    console.error('Visit https://crontab.guru/ to validate your cron expression.');
    process.exit(1);
}

// The script will now stay running due to the active cron schedule.
// You no longer need a direct main() call at the end of the file,
// unless you want an immediate, non-scheduled run before the cron jobs start.