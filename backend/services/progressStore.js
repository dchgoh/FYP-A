// Simple in-memory progress store keyed by fileId
// Not persisted; values are lost on server restart

const progressByFileId = new Map();

function setProgress(fileId, percent) {
    if (typeof fileId !== 'number') return;
    if (typeof percent !== 'number' || isNaN(percent)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    progressByFileId.set(fileId, clamped);
}

function getProgress(fileId) {
    if (typeof fileId !== 'number') return null;
    const val = progressByFileId.get(fileId);
    return typeof val === 'number' ? val : null;
}

function clearProgress(fileId) {
    if (typeof fileId !== 'number') return;
    progressByFileId.delete(fileId);
}

module.exports = { setProgress, getProgress, clearProgress };


