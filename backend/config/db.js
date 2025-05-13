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

// Create and export the pool - it will be initialized later
// We export the pool itself for direct use
const pool = new Pool(dbConfig);

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1); // Exit if pool encounters fatal error
});

module.exports = {
    pool,
    dbConfig, // Export raw config if needed elsewhere (e.g., init script)
    containerName
};