// server.js
const express = require("express");
const cors = require("cors");
const path = require('path');

// Load environment variables FIRST
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); // Make sure path is correct

// --- IMPORTS ---
const { initDatabase } = require('./db/init'); // Import DB initializer
const { pool } = require('./config/db'); // Import the configured pool (optional here, mainly needed in controllers/middleware)

// Import Routers
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const divisionRoutes = require('./routes/divisionRoutes');
const projectRoutes = require('./routes/projectRoutes');
const fileRoutes = require('./routes/fileRoutes');

// --- GLOBAL CONFIGURATION ---
const app = express();
const port = process.env.PORT || 5000; // Use environment variable or default

// --- MAIN APPLICATION LOGIC ---

// Run the database initialization before starting the server
initDatabase().then(() => {
    console.log("Database initialization complete. Starting server...");

    // --- EXPRESS MIDDLEWARE SETUP ---
    app.use(cors()); // Enable CORS
    app.use(express.json()); // Parse JSON request bodies
    app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

    // --- MOUNT ROUTERS ---
    app.use('/api/auth', authRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/divisions', divisionRoutes);
    app.use('/api/projects', projectRoutes);
    app.use('/api/files', fileRoutes);

    // --- Basic Root Route (Optional) ---
    app.get("/", (req, res) => {
        res.send("UAS Data Management API is running.");
    });

    // --- START SERVER ---
    app.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
    });

}).catch(error => {
    console.error("FATAL: Failed to initialize database and start server:", error);
    process.exit(1); // Exit if init fails
});

// Handle pool errors globally if not handled in config/db.js
pool.on('error', (err, client) => {
  console.error('Global Pool Error:', err);
  // Decide if this is fatal enough to exit
});