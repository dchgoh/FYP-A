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

// --- Upload file to Dropbox (skip if same file already exists) ---
async function uploadFileToDropbox(localFilePath, dropboxFilePath) {
    const dbx = await createDropboxClient();
    try {
        // Check if the file already exists on Dropbox
        let exists = false;
        let dropboxMetadata = null;

        try {
            const meta = await dbx.filesGetMetadata({ path: dropboxFilePath });
            if (meta.result && meta.result['.tag'] === 'file') {
                exists = true;
                dropboxMetadata = meta.result;
            }
        } catch (err) {
            if (err.status !== 409) throw err; // ignore "not found" errors
        }

        // Compare file sizes — if same, skip upload
        const localStat = await fs.stat(localFilePath);
        if (exists && dropboxMetadata.size === localStat.size) {
            console.log(`[${new Date().toISOString()}] SKIP: '${localFilePath}' already exists with same size.`);
            return; // skip upload
        }

        // Otherwise, upload file
        const MAX_SIMPLE_UPLOAD = 150 * 1024 * 1024; // 150 MB - Dropbox /files/upload limit
        const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per chunk for upload sessions

        if (localStat.size <= MAX_SIMPLE_UPLOAD) {
            // Small file - single upload (still reads into memory but within safe limit)
            const fileContents = await fs.readFile(localFilePath);
            const response = await dbx.filesUpload({
                path: dropboxFilePath,
                contents: fileContents,
                mode: 'overwrite',
            });
            console.log(`[${new Date().toISOString()}] SUCCESS: Uploaded '${localFilePath}' → '${response.result.path_display}'`);
        } else {
            // Large file - use upload session (chunked upload)
            console.log(`[${new Date().toISOString()}] INFO: Large file detected (${localStat.size} bytes). Using upload session for '${localFilePath}'.`);
            const fh = await fs.open(localFilePath, 'r');
            try {
                let offset = 0;
                let sessionId = null;

                while (offset < localStat.size) {
                    const chunkSize = Math.min(CHUNK_SIZE, localStat.size - offset);
                    const buffer = Buffer.alloc(chunkSize);
                    const { bytesRead } = await fh.read(buffer, 0, chunkSize, offset);
                    if (bytesRead === 0) break;

                    if (offset === 0) {
                        // start session
                        const startRes = await dbx.filesUploadSessionStart({ close: false, contents: buffer.slice(0, bytesRead) });
                        sessionId = startRes.result.session_id;
                    } else {
                        // append
                        await dbx.filesUploadSessionAppendV2({
                            cursor: { session_id: sessionId, offset },
                            close: false,
                            contents: buffer.slice(0, bytesRead),
                        });
                    }

                    offset += bytesRead;
                }

                // finish session and commit file
                await dbx.filesUploadSessionFinish({
                    cursor: { session_id: sessionId, offset: localStat.size },
                    commit: { path: dropboxFilePath, mode: 'overwrite' },
                });

                console.log(`[${new Date().toISOString()}] SUCCESS: Uploaded large file '${localFilePath}' → '${dropboxFilePath}'`);
            } finally {
                await fh.close();
            }
        }
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

// --- Recursive folder backup (skip same files) ---
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
