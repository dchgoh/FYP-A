// backupScript.js
const { Dropbox } = require('dropbox');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// --- Environment Configuration ---
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const LOCAL_FOLDER_TO_BACKUP = './uploads';
const DROPBOX_TARGET_FOLDER = '/UAS_MAPPING_BACKUP';

// --- Cron schedule (every 15 minutes) ---
const CRON_SCHEDULE = '*/15 * * * *';

// --- Validate environment variables ---
if (!DROPBOX_APP_KEY || !DROPBOX_APP_SECRET || !DROPBOX_REFRESH_TOKEN) {
    console.error(`
ERROR: Dropbox credentials missing.
Please set the following in your .env file:
  DROPBOX_APP_KEY=your_app_key
  DROPBOX_APP_SECRET=your_app_secret
  DROPBOX_REFRESH_TOKEN=your_refresh_token
    `);
    process.exit(1);
}

// --- Generate access token from refresh token ---
async function getAccessToken() {
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: DROPBOX_REFRESH_TOKEN,
            client_id: DROPBOX_APP_KEY,
            client_secret: DROPBOX_APP_SECRET,
        }),
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Failed to get access token: ${data.error_description || JSON.stringify(data)}`);
    }
    return data.access_token;
}

// --- Create Dropbox client with fresh token ---
async function createDropboxClient() {
    const accessToken = await getAccessToken();
    return new Dropbox({ accessToken, fetch });
}

// --- Upload file to Dropbox ---
async function uploadFileToDropbox(localFilePath, dropboxFilePath) {
    const dbx = await createDropboxClient();
    try {
        const fileContents = await fs.readFile(localFilePath);
        const response = await dbx.filesUpload({
            path: dropboxFilePath,
            contents: fileContents,
            mode: 'overwrite',
        });
        console.log(`[${new Date().toISOString()}] SUCCESS: Uploaded '${localFilePath}' → '${response.result.path_display}'`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ERROR uploading file '${localFilePath}':`, error);
        throw error;
    }
}

// --- Ensure folder exists in Dropbox ---
async function createDropboxFolder(dropboxFolderPath) {
    const dbx = await createDropboxClient();
    try {
        await dbx.filesCreateFolderV2({ path: dropboxFolderPath, autorename: false });
        console.log(`[${new Date().toISOString()}] INFO: Created folder '${dropboxFolderPath}'`);
    } catch (error) {
        if (error.status === 409 && error.error.error_summary.includes('conflict/folder')) {
            console.log(`[${new Date().toISOString()}] INFO: Folder '${dropboxFolderPath}' already exists.`);
        } else {
            console.error(`[${new Date().toISOString()}] ERROR creating folder '${dropboxFolderPath}':`, error);
            throw error;
        }
    }
}

// --- Recursive folder backup ---
async function backupFolderRecursive(localFolderPath, dropboxBaseFolder) {
    console.log(`[${new Date().toISOString()}] Scanning: ${localFolderPath}`);
    const items = await fs.readdir(localFolderPath, { withFileTypes: true });

    for (const item of items) {
        const localItemPath = path.join(localFolderPath, item.name);
        const relativePath = path.relative(LOCAL_FOLDER_TO_BACKUP, localItemPath).replace(/\\/g, '/');
        const dropboxItemPath = `${dropboxBaseFolder}/${relativePath}`.replace(/\/\//g, '/');

        if (item.isDirectory()) {
            await createDropboxFolder(dropboxItemPath);
            await backupFolderRecursive(localItemPath, dropboxBaseFolder);
        } else if (item.isFile()) {
            await uploadFileToDropbox(localItemPath, dropboxItemPath);
        }
    }
}

// --- Main backup function ---
async function runBackupJob() {
    console.log(`\n--- [${new Date().toISOString()}] Starting Dropbox Backup ---`);
    console.log(`Source: '${path.resolve(LOCAL_FOLDER_TO_BACKUP)}'`);
    console.log(`Destination: '${DROPBOX_TARGET_FOLDER}'`);

    try {
        await createDropboxFolder(DROPBOX_TARGET_FOLDER);
        await backupFolderRecursive(LOCAL_FOLDER_TO_BACKUP, DROPBOX_TARGET_FOLDER);
        console.log(`--- [${new Date().toISOString()}] Backup Completed Successfully ---\n`);
    } catch (err) {
        console.error(`--- [${new Date().toISOString()}] Backup Failed ---`, err, "\n");
    }
}

// --- Scheduler ---
if (cron.validate(CRON_SCHEDULE)) {
    console.log(`[${new Date().toISOString()}] Backup scheduler initialized.`);
    console.log(`Backups will run: ${CRON_SCHEDULE}`);
    console.log(`Current server time: ${new Date().toString()}`);

    // ✅ Run immediately when the script starts
    runBackupJob();

    // Continue scheduled backups
    cron.schedule(CRON_SCHEDULE, () => {
        console.log(`\n[${new Date().toISOString()}] Cron triggered backup...`);
        runBackupJob();
    });
} else {
    console.error(`ERROR: Invalid CRON_SCHEDULE '${CRON_SCHEDULE}'. Check https://crontab.guru`);
    process.exit(1);
}
