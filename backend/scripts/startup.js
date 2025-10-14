// scripts/startup.js
const { processingQueue, redis } = require('../services/queueService');
const systemMonitor = require('../services/systemMonitor');
const gpuManager = require('../services/gpuResourceManager');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function initializeSystem() {
    console.log('[Startup] Initializing system components...');

    try {
        // Ensure Redis is available (optionally create a Docker container named 'uas_userdata')
        await ensureRedisContainer();

        // Test Redis connection with retries
        await waitForRedis();
        console.log('[Startup] Redis connection established');

        // Initialize queue
        console.log('[Startup] Processing queue initialized');

        // Initialize GPU manager
        console.log('[Startup] GPU resource manager initialized');

        // Initialize system monitor
        console.log('[Startup] System monitor initialized');

        // Clean up any stuck jobs from previous runs
        await cleanupStuckJobs();

        console.log('[Startup] System initialization complete');
    } catch (error) {
        console.error('[Startup] Failed to initialize system:', error);
        process.exit(1);
    }
}

// Try to ensure a Docker container named 'uas_redis' is running with Redis.
// If Docker is not available or the creation fails, we gracefully continue and let the
// existing Redis config/environment be used (startup will still fail later if Redis isn't reachable).
async function ensureRedisContainer() {
    const containerName = 'uas_redis';

    try {
        // Check if docker is available
        await execAsync('docker --version');
    } catch (err) {
        console.log('[Startup] Docker not available, skipping automatic Redis container management');
        return;
    }

    try {
        // Check if the container exists
        const { stdout: psOut } = await execAsync(`docker ps -a --filter "name=^/${containerName}$" --format "{{.Names}}:{{.Status}}"`);
        if (!psOut || psOut.trim() === '') {
            console.log(`[Startup] Redis container '${containerName}' not found. Creating and starting it using 'redis:alpine'`);
            // Create and run the container mapped to host 6379
            await execAsync(`docker run -d --name ${containerName} -p 6379:6379 redis:alpine`);
            console.log(`[Startup] Created container '${containerName}'`);
        } else {
            const statusLine = psOut.trim();
            const parts = statusLine.split(':');
            const name = parts[0];
            const status = parts.slice(1).join(':');
            if (status.toLowerCase().startsWith('up')) {
                console.log(`[Startup] Redis container '${containerName}' is already running`);
            } else {
                console.log(`[Startup] Redis container '${containerName}' exists but is not running. Starting it.`);
                await execAsync(`docker start ${containerName}`);
                console.log(`[Startup] Started container '${containerName}'`);
            }
        }
    } catch (err) {
        console.error('[Startup] Error while ensuring Redis container:', err.message || err);
        // Do not throw here; if docker operations fail, we'll let the redis.ping retry handle eventual failure
    }
}

async function waitForRedis(retries = 10, delayMs = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            await redis.ping();
            return;
        } catch (err) {
            const remaining = retries - i - 1;
            console.log(`[Startup] Redis not reachable yet (attempt ${i + 1}/${retries}), retrying in ${delayMs}ms...`);
            if (remaining <= 0) break;
            await new Promise((res) => setTimeout(res, delayMs));
        }
    }
    // Final attempt to surface the error
    await redis.ping();
}

async function cleanupStuckJobs() {
    try {
        // Get stuck jobs (jobs that have been active for more than 1 hour)
        const stuckJobs = await processingQueue.getActive();
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        
        for (const job of stuckJobs) {
            if (job.processedOn && job.processedOn < oneHourAgo) {
                console.log(`[Startup] Cleaning up stuck job ${job.id}`);
                await job.moveToFailed(new Error('Job was stuck and cleaned up on startup'));
            }
        }

        console.log(`[Startup] Cleaned up ${stuckJobs.length} potentially stuck jobs`);
    } catch (error) {
        console.error('[Startup] Error cleaning up stuck jobs:', error);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[Startup] Received SIGTERM, shutting down gracefully');
    await shutdown();
});

process.on('SIGINT', async () => {
    console.log('[Startup] Received SIGINT, shutting down gracefully');
    await shutdown();
});

async function shutdown() {
    try {
        console.log('[Startup] Closing processing queue...');
        await processingQueue.close();

        console.log('[Startup] Closing Redis connection...');
        await redis.quit();

        console.log('[Startup] Stopping system monitor...');
        systemMonitor.stopMonitoring();

        console.log('[Startup] Destroying GPU manager...');
        gpuManager.destroy();

        console.log('[Startup] Shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('[Startup] Error during shutdown:', error);
        process.exit(1);
    }
}

module.exports = {
    initializeSystem,
    shutdown,
};
