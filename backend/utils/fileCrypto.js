const crypto = require('crypto');
const fs = require('fs');

// AES-256-GCM streaming file encryption/decryption utilities
// Requires: FILE_ENCRYPTION_KEY (64 hex chars for 32 bytes) in backend/.env

function getKey() {
    const hexKey = process.env.FILE_ENCRYPTION_KEY || '';
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
        throw new Error('Invalid or missing FILE_ENCRYPTION_KEY. Expect 64 hex chars (32 bytes).');
    }
    return Buffer.from(hexKey, 'hex');
}

function encryptFileTo(filePath, outPath) {
    return new Promise((resolve, reject) => {
        const key = getKey();
        const iv = crypto.randomBytes(12); // 96-bit nonce for GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

        const input = fs.createReadStream(filePath);
        const output = fs.createWriteStream(outPath);

        input.on('error', reject);
        output.on('error', reject);

        output.write(iv);

        input.pipe(cipher).pipe(output);

        input.on('end', () => {
            try {
                const authTag = cipher.getAuthTag();
                output.end(authTag, () => resolve());
            } catch (e) {
                reject(e);
            }
        });
    });
}

function decryptFileTo(filePath, outPath) {
    return new Promise((resolve, reject) => {
        const key = getKey();
        const stat = fs.statSync(filePath);
        if (stat.size < 12 + 16) return reject(new Error('Encrypted file too small'));

        const input = fs.createReadStream(filePath, { start: 0, end: 11 });
        const chunks = [];
        input.on('data', d => chunks.push(d));
        input.on('error', reject);
        input.on('end', () => {
            try {
                const iv = Buffer.concat(chunks);
                const authTagPos = stat.size - 16;
                const authTag = Buffer.alloc(16);
                const fd = fs.openSync(filePath, 'r');
                fs.readSync(fd, authTag, 0, 16, authTagPos);
                fs.closeSync(fd);

                const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                decipher.setAuthTag(authTag);

                const dataStream = fs.createReadStream(filePath, { start: 12, end: authTagPos - 1 });
                const output = fs.createWriteStream(outPath);
                dataStream.on('error', reject);
                output.on('error', reject);
                output.on('finish', () => resolve());

                dataStream.pipe(decipher).pipe(output);
            } catch (e) {
                reject(e);
            }
        });
    });
}

function decryptToStream(filePath, res) {
    const key = getKey();
    const stat = fs.statSync(filePath);
    if (stat.size < 28) throw new Error('Encrypted file too small');

    const fd = fs.openSync(filePath, 'r');
    const iv = Buffer.alloc(12);
    fs.readSync(fd, iv, 0, 12, 0);
    const authTag = Buffer.alloc(16);
    fs.readSync(fd, authTag, 0, 16, stat.size - 16);
    fs.closeSync(fd);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const dataStream = fs.createReadStream(filePath, { start: 12, end: stat.size - 17 });
    return dataStream.pipe(decipher);
}

module.exports = {
    encryptFileTo,
    decryptFileTo,
    decryptToStream
};


