// services/systemMonitor.js
const os = require('os');
const { pool } = require('../config/db');
const gpuManager = require('./gpuResourceManager');

class SystemMonitor {
    constructor() {
        this.monitoringInterval = null;
        this.alertThresholds = {
            cpuUsage: 90, // 90%
            memoryUsage: 85, // 85%
            diskUsage: 90, // 90%
            dbConnections: 80, // 80% of max connections
        };
        this.startMonitoring();
    }

    startMonitoring() {
        // Monitor every 30 seconds
        this.monitoringInterval = setInterval(() => {
            this.collectMetrics();
        }, 30000);
    }

    async collectMetrics() {
        try {
            const metrics = await this.getSystemMetrics();
            this.checkThresholds(metrics);
            this.logMetrics(metrics);
        } catch (error) {
            console.error('[System Monitor] Error collecting metrics:', error);
        }
    }

    async getSystemMetrics() {
        const metrics = {
            timestamp: new Date().toISOString(),
            cpu: this.getCpuUsage(),
            memory: this.getMemoryUsage(),
            disk: await this.getDiskUsage(),
            database: await this.getDatabaseMetrics(),
            gpu: gpuManager.getGpuStatus(),
            processes: this.getProcessCount(),
        };

        return metrics;
    }

    getCpuUsage() {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;

        cpus.forEach(cpu => {
            for (let type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });

        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);

        return {
            usage: usage,
            cores: cpus.length,
            loadAverage: os.loadavg(),
        };
    }

    getMemoryUsage() {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        const usage = (used / total) * 100;

        return {
            total: Math.round(total / 1024 / 1024), // MB
            used: Math.round(used / 1024 / 1024), // MB
            free: Math.round(free / 1024 / 1024), // MB
            usage: Math.round(usage * 100) / 100, // Percentage
        };
    }

    async getDiskUsage() {
        try {
            const stats = require('fs').statSync;
            const path = require('path');
            
            // Get disk usage for the uploads directory
            const uploadsPath = path.resolve(__dirname, '../uploads');
            const statsObj = stats(uploadsPath);
            
            // This is a simplified check - in production you might want to use a proper disk usage library
            return {
                path: uploadsPath,
                available: true, // Simplified
            };
        } catch (error) {
            return {
                path: 'unknown',
                available: false,
                error: error.message,
            };
        }
    }

    async getDatabaseMetrics() {
        try {
            const result = await pool.query(`
                SELECT 
                    count(*) as total_connections,
                    count(*) FILTER (WHERE state = 'active') as active_connections,
                    count(*) FILTER (WHERE state = 'idle') as idle_connections
                FROM pg_stat_activity 
                WHERE datname = current_database()
            `);

            const connections = result.rows[0];
            const maxConnections = 20; // From our pool config
            const connectionUsage = (connections.total_connections / maxConnections) * 100;

            return {
                total: parseInt(connections.total_connections),
                active: parseInt(connections.active_connections),
                idle: parseInt(connections.idle_connections),
                max: maxConnections,
                usage: Math.round(connectionUsage * 100) / 100,
            };
        } catch (error) {
            return {
                error: error.message,
            };
        }
    }

    getProcessCount() {
        return {
            node: process.pid,
            uptime: process.uptime(),
            version: process.version,
            platform: process.platform,
        };
    }

    checkThresholds(metrics) {
        const alerts = [];

        // CPU usage check
        if (metrics.cpu.usage > this.alertThresholds.cpuUsage) {
            alerts.push({
                type: 'cpu',
                level: 'warning',
                message: `High CPU usage: ${metrics.cpu.usage}%`,
                value: metrics.cpu.usage,
                threshold: this.alertThresholds.cpuUsage,
            });
        }

        // Memory usage check
        if (metrics.memory.usage > this.alertThresholds.memoryUsage) {
            alerts.push({
                type: 'memory',
                level: 'warning',
                message: `High memory usage: ${metrics.memory.usage}%`,
                value: metrics.memory.usage,
                threshold: this.alertThresholds.memoryUsage,
            });
        }

        // Database connections check
        if (metrics.database.usage && metrics.database.usage > this.alertThresholds.dbConnections) {
            alerts.push({
                type: 'database',
                level: 'warning',
                message: `High database connection usage: ${metrics.database.usage}%`,
                value: metrics.database.usage,
                threshold: this.alertThresholds.dbConnections,
            });
        }

        // GPU memory check
        if (metrics.gpu.totalGPUs > 0) {
            metrics.gpu.gpuDetails.forEach(gpu => {
                const memoryUsage = (gpu.usedMemory / gpu.totalMemory) * 100;
                if (memoryUsage > 90) {
                    alerts.push({
                        type: 'gpu',
                        level: 'warning',
                        message: `High GPU ${gpu.id} memory usage: ${memoryUsage.toFixed(1)}%`,
                        value: memoryUsage,
                        threshold: 90,
                        gpuId: gpu.id,
                    });
                }
            });
        }

        // Log alerts
        if (alerts.length > 0) {
            console.warn('[System Monitor] Alerts:', alerts);
        }

        return alerts;
    }

    logMetrics(metrics) {
        // Only log every 5 minutes to avoid spam
        if (Date.now() % 300000 < 30000) {
            console.log('[System Monitor] Metrics:', {
                cpu: `${metrics.cpu.usage}%`,
                memory: `${metrics.memory.usage}% (${metrics.memory.used}MB/${metrics.memory.total}MB)`,
                db: metrics.database.usage ? `${metrics.database.usage}%` : 'unknown',
                gpu: `${metrics.gpu.allocatedGPUs}/${metrics.gpu.totalGPUs} GPUs allocated`,
            });
        }
    }

    async getSystemHealth() {
        const metrics = await this.getSystemMetrics();
        const alerts = this.checkThresholds(metrics);
        
        return {
            status: alerts.length === 0 ? 'healthy' : 'warning',
            metrics,
            alerts,
            timestamp: new Date().toISOString(),
        };
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }
}

// Create singleton instance
const systemMonitor = new SystemMonitor();

module.exports = systemMonitor;
