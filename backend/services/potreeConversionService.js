// src/services/potreeConversionService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db');

async function initiatePotree(fileId, inputFileAbsolutePath, projectRootDir) {
    console.log(`[PotreeService] (FileID ${fileId}): Starting for ${inputFileAbsolutePath}`);
    await pool.query("UPDATE uploaded_files SET status = 'converting_potree', processing_error = NULL WHERE id = $1", [fileId]);

    let outDir = null;
    const converterPath = path.resolve(projectRootDir, "PotreeConverter", "PotreeConverter.exe"); // Ensure this path is correct
    const outDirName = fileId.toString();
    const outBase = path.resolve(__dirname, "../..", "public", "pointclouds");
    outDir = path.join(outBase, outDirName);

    if (!fs.existsSync(inputFileAbsolutePath)) {
        await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = 'Potree input missing' WHERE id = $1", [fileId]);
        throw new Error(`[PotreeService] Input missing: ${inputFileAbsolutePath}`);
    }
    if (!fs.existsSync(converterPath)) {
        await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = 'PotreeConverter not found' WHERE id = $1", [fileId]);
        throw new Error(`[PotreeService] PotreeConverter not found: ${converterPath}`);
    }

    try {
        fs.mkdirSync(outBase, { recursive: true });
        fs.mkdirSync(outDir, { recursive: true });
    } catch (mkdirErr) {
        if (outDir && fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
        await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [`Potree dir prep err: ${mkdirErr.message.substring(0,150)}`, fileId]);
        throw new Error(`[PotreeService] Output dir prep error: ${mkdirErr.message}`);
    }

    const converterArgs = [inputFileAbsolutePath, '-o', outDir, '--output-format', 'LAS'];
    console.log(`[PotreeService] (FileID ${fileId}): Spawning: "${converterPath}" ${converterArgs.join(' ')}`);

    return new Promise(async (resolve, reject) => {
        const potreeProcess = spawn(converterPath, converterArgs, { stdio: ['inherit', 'inherit', 'pipe'] });
        let stderrData = '';
        potreeProcess.stderr.on('data', (data) => { stderrData += data.toString().trim() + '\n'; });

        potreeProcess.on('error', async (error) => {
            if (outDir && fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
            try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [`Potree Spawn Err: ${error.message.substring(0,150)}`, fileId]); } catch (dbErr) {/* log */}
            reject(new Error(`[PotreeService] Failed to start PotreeConverter: ${error.message}`));
        });

        potreeProcess.on('close', async (code) => {
            console.log(`[PotreeService] (FileID ${fileId}): PotreeConverter exited with code ${code}.`);
            let client; // Use separate client for transaction if needed, or just pool.query
            try {
                // client = await pool.connect(); await client.query('BEGIN'); // If more complex logic
                if (code === 0) {
                    const metaPath = `/pointclouds/${outDirName}/metadata.json`;
                    const fullMetaFilePath = path.join(outDir, 'metadata.json');
                    if (fs.existsSync(fullMetaFilePath)) {
                        await pool.query(
                            "UPDATE uploaded_files SET potree_metadata_path = $1, status = 'ready', processing_error = NULL WHERE id = $2",
                            [metaPath, fileId]
                        );
                        // await client.query('COMMIT');
                        resolve({ success: true, message: "[PotreeService] Conversion completed.", potreeUrl: metaPath });
                    } else {
                        const errMsg = `[PotreeService] Exited 0, metadata.json missing.`;
                        await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]);
                        if (outDir && fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
                        // await client.query('ROLLBACK');
                        reject(new Error(errMsg));
                    }
                } else {
                    const errMsg = `[PotreeService] Conversion failed (code ${code}): ${stderrData.substring(0, 200)}...`;
                    await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]);
                    if (outDir && fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
                    // await client.query('ROLLBACK');
                    reject(new Error(errMsg));
                }
            } catch (dbError) {
                // if (client) await client.query('ROLLBACK');
                console.error(`[PotreeService] (FileID ${fileId}) DB Error in 'close': ${dbError.message}`);
                reject(dbError);
            } finally {
                // if (client) client.release();
            }
        });
    });
}

module.exports = { initiatePotree };