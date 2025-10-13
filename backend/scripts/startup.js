// scripts/startup.js
const { processingQueue, redis } = require('../services/queueService');
const systemMonitor = require('../services/systemMonitor');
const gpuManager = require('../services/gpuResourceManager');

async function initializeSystem() {
    console.log('[Startup] Initializing system components...');

    try {
        // Test Redis connection
        await redis.ping();
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
