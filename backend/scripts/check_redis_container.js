#!/usr/bin/env node
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

async function inspectContainer(containerName = 'uas_redis') {
    const image = process.env.REDIS_DOCKER_IMAGE || 'redis:alpine';
    const hostPort = process.env.REDIS_DOCKER_HOST_PORT || '6379';
    const autoCreate = (process.env.REDIS_DOCKER_AUTO_CREATE || 'true').toLowerCase() !== 'false';

    try {
        await execAsync('docker --version');
    } catch (err) {
        console.error('[check-redis] Docker not available on this machine');
        process.exit(2);
    }

    try {
        const { stdout } = await execAsync(
            `docker ps -a --filter "name=^/${containerName}$" --format "{{.Names}}:{{.Status}}"`
        );

        if (!stdout || stdout.trim() === '') {
            console.log(`[check-redis] Container '${containerName}' not found.`);
            if (!autoCreate) {
                console.log(
                    `[check-redis] Auto-create disabled. Create it with: docker run -d --name ${containerName} -p ${hostPort}:6379 ${image}`
                );
                process.exit(1);
            }

            console.log(
                `[check-redis] Auto-creating container '${containerName}' using image '${image}' and host port ${hostPort}...`
            );
            try {
                const { stdout: runOut } = await execAsync(
                    `docker run -d --name ${containerName} -p ${hostPort}:6379 ${image}`
                );
                console.log(`[check-redis] docker run -> ${runOut.toString().trim()}`);
            } catch (runErr) {
                console.error('[check-redis] Failed to create container:', runErr.message || runErr);
                console.error(
                    `[check-redis] You may need to remove existing service on host port ${hostPort} or choose another port.`
                );
                process.exit(5);
            }
        } else {
            const line = stdout.trim();
            const parts = line.split(':');
            const name = parts[0];
            const status = parts.slice(1).join(':');
            console.log(`[check-redis] Found container '${name}' with status: ${status}`);

            if (!status.toLowerCase().startsWith('up')) {
                console.log(`[check-redis] Starting container '${name}'...`);
                await execAsync(`docker start ${name}`);
                console.log(`[check-redis] Started '${name}'.`);
            }
        }

        // Wait for Redis to accept connections inside the container
        const maxRetries = 12;
        const delayMs = 1000;
        for (let i = 0; i < maxRetries; i++) {
            try {
                const { stdout: pingOut } = await execAsync(`docker exec ${containerName} redis-cli ping`);
                const pong = pingOut.toString().trim();
                console.log(`[check-redis] redis-cli ping -> ${pong}`);
                if (pong.toLowerCase() === 'pong') {
                    process.exit(0);
                }
            } catch (pingErr) {
                // keep retrying
            }
            console.log(
                `[check-redis] Waiting for Redis in '${containerName}' to become ready (attempt ${i + 1}/${maxRetries})...`
            );
            await sleep(delayMs);
        }

        console.error('[check-redis] Redis did not become ready in time');
        process.exit(6);
    } catch (err) {
        console.error('[check-redis] Error inspecting Docker container:', err.message || err);
        process.exit(4);
    }
}

const container = process.argv[2] || 'uas_redis';
inspectContainer(container);
