const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Adjust path relative to config dir

// PostgreSQL Docker container details - keep config together
const containerName = "uas_userdata";
const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME
};

// Create and export the pool with optimized settings for concurrent processing
const pool = new Pool({
    ...dbConfig,
    max: parseInt(process.env.DB_MAX_CONNECTIONS) || 20, // Maximum number of connections
    min: parseInt(process.env.DB_MIN_CONNECTIONS) || 5,  // Minimum number of connections
    idle: parseInt(process.env.DB_IDLE_TIMEOUT) || 10000, // Close connections after 10 seconds of inactivity
    acquire: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000, // Maximum time to get connection
    evict: parseInt(process.env.DB_EVICT_INTERVAL) || 1000, // Check for idle connections every second
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1); // Exit if pool encounters fatal error
});

module.exports = {
    pool,
    dbConfig, // Export raw config if needed elsewhere (e.g., init script)
    containerName
};