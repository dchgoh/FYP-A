// --- IMPORTS ---
const path = require('path'); // Make sure 'path' is required
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); // Specify path

const jwt = require('jsonwebtoken');
const { execSync, spawn } = require("child_process");
const express = require("express");
const cors = require("cors");
const { Pool, Client } = require("pg");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const multer = require('multer');
const fs = require('fs'); // File system module

// --- CONSTANTS ---
const ROLES = {
  ADMIN: 'Administrator',
  DATA_MANAGER: 'Data Manager',
  REGULAR: 'Regular',
};

// --- GLOBAL CONFIGURATION ---
const app = express();
const port = 5000;

// PostgreSQL Docker container details
const containerName = "uas_userdata";
const dbConfig = {
  user: "postgres",
  host: "localhost",
  password: "root",
  port: 5432,
};

// --- PERMISSION HELPER FUNCTIONS ---

// Function: Check Role Middleware
const checkRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ success: false, message: 'Not authorized, user role not found.' });
        }
        // Allow Administrator to access everything
        if (req.user.role === 'Administrator') {
            return next();
        }
        // Check if the user has the required role (can be a single string or an array)
        if (Array.isArray(requiredRole)) {
            if (requiredRole.includes(req.user.role)) {
                next();
            } else {
                return res.status(403).json({ success: false, message: `Forbidden: Role ${req.user.role} not authorized for this action.` });
            }
        } else {
            if (req.user.role === requiredRole) {
                next();
            } else {
                return res.status(403).json({ success: false, message: `Forbidden: Role ${req.user.role} not authorized for this action.` });
            }
        }
    };
};

// Function: Check Data Manager Project Assignment Middleware
const checkProjectAssignment = async (req, res, next) => {
    // Admins always have access
    if (req.user.role === 'Administrator') {
        return next();
    }

    // Other roles that aren't Data Manager aren't subject to this check here
    // (Specific route permissions handle them)
    if (req.user.role !== 'Data Manager') {
        return next();
    }

    const userId = req.user.userId;
    let fileId = null;

    // Extract fileId from params - adjust based on your routes
    if (req.params.id) fileId = parseInt(req.params.id);
    // Add other param names if necessary (e.g., req.params.fileId)

    if (!fileId || isNaN(fileId)) {
        // If no fileId, this check might not apply (e.g., listing all files)
        // Let the main route logic handle this or add specific logic if needed.
        // For actions that *must* have a fileId (delete, download, convert, patch file),
        // we *should* have a fileId here.
        console.warn("checkProjectAssignment: No valid file ID found in params for Data Manager check.");
        return next(); // Or maybe return error if action definitely requires fileId?
                       // For simplicity, let's proceed and assume the route checks later.
    }


    const poolForCheck = new Pool({ ...dbConfig, database: "uasuserdata" });
    let poolClient;
    try {
        poolClient = await poolForCheck.connect();
        // 1. Get the project_id of the file
        const fileResult = await poolClient.query(
            "SELECT project_id FROM uploaded_files WHERE id = $1",
            [fileId]
        );

        if (fileResult.rows.length === 0) {
            // File not found, let the main route handler return 404
             return next();
        }

        const fileProjectId = fileResult.rows[0].project_id;

        // 2. Check if the file is assigned to a project
        if (fileProjectId === null) {
            // Unassigned file - Data Manager CANNOT perform restricted actions (delete, download, convert, patch)
            console.log(`Data Manager (${userId}) access denied for UNASSIGNED file (${fileId})`);
            return res.status(403).json({ success: false, message: "Forbidden: Data Managers cannot perform this action on unassigned files." });
        }

        // 3. Check if the Data Manager is assigned to this project
        const assignmentResult = await poolClient.query(
            "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
            [userId, fileProjectId]
        );

        if (assignmentResult.rowCount > 0) {
            // User is assigned, allow access
            return next();
        } else {
            // User is not assigned to this project
            console.log(`Data Manager (${userId}) access denied for file (${fileId}) in project (${fileProjectId}) - Not assigned.`);
            return res.status(403).json({ success: false, message: "Forbidden: You are not assigned to manage this project." });
        }

    } catch (error) {
        console.error("Error in checkProjectAssignment:", error);
        return res.status(500).json({ success: false, message: "Server error checking project permissions." });
    } finally {
        if (poolClient) poolClient.release();
        poolForCheck.end(); // Close the temporary pool
    }
};

// --- DATABASE INITIALIZATION FUNCTIONS ---

// Function: Check and start Docker container
const startDockerContainer = () => {
  try {
    const runningContainers = execSync("docker ps --format '{{.Names}}'").toString();
    if (!runningContainers.includes(containerName)) {
      console.log("PostgreSQL container is not running. Starting...");

      const allContainers = execSync("docker ps -a --format '{{.Names}}'").toString();
      if (!allContainers.includes(containerName)) {
        console.log("Container does not exist. Creating and starting a new one...");
        execSync(
          `docker run --name ${containerName} -e POSTGRES_PASSWORD=root -p 5432:5432 -d postgres`
        );
      } else {
        console.log("Starting existing PostgreSQL container...");
        execSync(`docker start ${containerName}`);
      }
      console.log("Waiting for container to potentially start...");
    } else {
      console.log("PostgreSQL container is already running.");
    }
  } catch (error) {
    console.error("Error managing Docker container:", error.message);
    // If docker commands fail, database connection will likely fail later.
    // Consider exiting or throwing a fatal error if Docker is critical.
  }
};

// Function: Create the database if it doesn't exist
const createDatabase = async () => {
  let client; // Declare client outside try block
  try {
    client = new Client({ ...dbConfig, database: "postgres" });
    await client.connect();
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'uasuserdata';");
    if (result.rowCount === 0) {
      console.log("Database 'uasuserdata' does not exist. Creating...");
      await client.query("CREATE DATABASE uasuserdata;");
      console.log("Database created successfully.");
    } else {
      console.log("Database already exists.");
    }
  } catch (error) {
     console.error("Error connecting to or creating database:", error);
     // Decide how to handle this critical failure (e.g., exit)
     process.exit(1); // Exit if DB connection fails
  } finally {
     if (client) {
        await client.end(); // Ensure client is ended if it was connected
     }
  }
};


// Function: Create the users table and insert a default user
const createUsersTable = async () => {
  let pool = null;
  try {
      pool = new Pool({ ...dbConfig, database: "uasuserdata" });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password TEXT NOT NULL,
          age INT,
          role VARCHAR(50) CHECK (role IN ('Administrator', 'Data Manager', 'Regular')),
          failed_attempts INT DEFAULT 0,
          is_locked BOOLEAN DEFAULT FALSE,
          mfa_code TEXT,
          mfa_expires_at TIMESTAMP
        );
      `);

      console.log("Users table checked/created.");

      const result = await pool.query("SELECT COUNT(*) FROM users");
      if (parseInt(result.rows[0].count) === 0) {
        const hashedPassword = await bcrypt.hash("1234567890", 10);
        await pool.query(
          "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
          ["darren", "dchgoh@gmail.com", hashedPassword, 21, "Administrator"]
        );
        console.log("Default admin user created");
      } else {
        console.log("Users already exist, skipping default user creation.");
      }
  } catch (error) {
      console.error("Error setting up users table:", error);
      // Consider exiting if user table setup fails
      // process.exit(1);
  } finally {
     if(pool) await pool.end();
  }
};

// Function: Create the projects table
const createProjectsTable = async () => {
   let pool = null;
  try {
    pool = new Pool({ ...dbConfig, database: "uasuserdata" });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Projects table checked/created.");
  } catch (error) {
    console.error("Error creating projects table:", error);
  } finally {
    if (pool) await pool.end();
  }
};

// Function: Create/update the files table
const createFilesTable = async () => {
   let pool = null;
  try {
    pool = new Pool({ ...dbConfig, database: "uasuserdata" });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS uploaded_files (
          id SERIAL PRIMARY KEY,
          original_name VARCHAR(255) NOT NULL,
          stored_filename VARCHAR(255) UNIQUE NOT NULL,
          stored_path TEXT NOT NULL,
          mime_type VARCHAR(100),
          size_bytes BIGINT,
          upload_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          potree_metadata_path TEXT,
          project_id INTEGER, -- Foreign key column
          latitude DOUBLE PRECISION,  
          longitude DOUBLE PRECISION,
          CONSTRAINT fk_project
            FOREIGN KEY(project_id)
            REFERENCES projects(id)
            ON DELETE SET NULL -- If project is deleted, set file's project_id to NULL
            ON UPDATE CASCADE
      );
    `);
    console.log("Uploaded_files table checked/updated.");

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_uploaded_files_project_id ON uploaded_files(project_id);
    `);
    console.log("Index on uploaded_files(project_id) checked/created.");

  } catch (error) {
    console.error("Error creating/updating uploaded_files table:", error);
  } finally {
    if (pool) await pool.end();
  }
};


// Function: Create the project_data_managers table
const createProjectDataManagersTable = async () => {
  let pool = null;
  try {
    pool = new Pool({ ...dbConfig, database: "uasuserdata" });
    await pool.query(`
        CREATE TABLE IF NOT EXISTS project_data_managers (
            user_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, project_id), -- Ensures uniqueness
            CONSTRAINT fk_user
                FOREIGN KEY(user_id)
                REFERENCES users(id)
                ON DELETE CASCADE, -- If user is deleted, remove assignments
            CONSTRAINT fk_project_assignment
                FOREIGN KEY(project_id)
                REFERENCES projects(id)
                ON DELETE CASCADE -- If project is deleted, remove assignments
        );
    `);
    console.log("Project_data_managers table checked/created.");

    // Index for faster lookups (optional but recommended)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pdm_project_id ON project_data_managers(project_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pdm_user_id ON project_data_managers(user_id);
    `);
    console.log("Indexes on project_data_managers checked/created.");

  } catch (error) {
    console.error("Error creating project_data_managers table:", error);
  } finally {
    if (pool) await pool.end();
  }
};


// Function: Initialize the database (run all setup functions)
const initDatabase = async () => {
  startDockerContainer();
  console.log("Giving PostgreSQL time to initialize...");
  // Use a loop or promise-based check instead of fixed timeout if possible
  await new Promise(resolve => setTimeout(resolve, 7000)); // Increased wait time for Docker start
  try {
    await createDatabase();
    await createUsersTable();
    await createProjectsTable();
    await createFilesTable();
    await createProjectDataManagersTable(); // *** NEW: Create the junction table ***
    console.log("Database initialization sequence complete.");
  } catch(initError) {
      console.error("FATAL: Database initialization failed.", initError);
      process.exit(1); // Exit if essential setup fails
  }
};

// --- FILE UPLOAD CONFIGURATION (Multer) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, 'uploads'); // Store in ./uploads/ relative to server file
    // Ensure the directory exists
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Create a unique filename: timestamp + original name
    // Replace spaces/special chars in original name for safety
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, uniqueSuffix + '-' + safeOriginalName);
  }
});

const upload = multer({ storage: storage });

// --- MAIN APPLICATION LOGIC ---

// Run the database initialization before starting the server
initDatabase().then(() => {
  // Create Pool AFTER database is likely ready
  const pool = new Pool({ ...dbConfig, database: "uasuserdata" });

  // --- EXPRESS MIDDLEWARE SETUP ---
  app.use(express.json());
  app.use(cors());

  // --- UTILITIES (Mailer, etc.) ---
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  // Function: Send MFA Code Helper
  const sendMfaCode = async (email) => {
      const rawMfaCode = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedMfaCode = await bcrypt.hash(rawMfaCode, 10);
      const expiryTime = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

      try {
          await pool.query(
              "UPDATE users SET mfa_code = $1, mfa_expires_at = $2 WHERE email = $3",
              [hashedMfaCode, expiryTime, email]
          );

          await transporter.sendMail({
              from: process.env.MAIL_USER, // Use env variable
              to: email,
              subject: "Your MFA Code",
              text: `Your MFA code is: ${rawMfaCode}. It expires in 5 minutes.`,
          });
          console.log(`MFA code sent to ${email}`);
      } catch (error) {
          console.error(`Failed to send MFA code to ${email}:`, error);
          // Handle error appropriately, maybe throw or return an error status
      }
  };

  // --- AUTHENTICATION ROUTES ---
  // Endpoint: Login
  app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid email or password." });
        }

        const user = userResult.rows[0];

        if (user.is_locked) {
            return res.status(403).json({ success: false, message: "Your account is locked. Contact support." });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            // Password correct, reset attempts and send MFA code
            await pool.query("UPDATE users SET failed_attempts = 0 WHERE email = $1", [email]);
            await sendMfaCode(email); // Keep MFA trigger
            // DO NOT send token here
            return res.json({ success: true, mfaRequired: true, message: "MFA code sent to your email." });
        } else {
            // Handle failed attempts
            let failedAttempts = user.failed_attempts + 1;
            if (failedAttempts >= 3) {
                await pool.query("UPDATE users SET is_locked = TRUE WHERE email = $1", [email]);
                return res.status(403).json({ success: false, message: "Account locked due to too many failed attempts." });
            } else {
                await pool.query("UPDATE users SET failed_attempts = $1 WHERE email = $2", [failedAttempts, email]);
                return res.status(401).json({ success: false, message: `Invalid credentials. Attempts left: ${3 - failedAttempts}` });
            }
        }
    } catch (error) {
        console.error("Database error during login:", error); // Log specific error
        res.status(500).json({ success: false, message: "Server error during login." });
    }
  });

  // Endpoint: Verify MFA Code
  app.post("/api/verify-mfa", async (req, res) => {
    const { email, code } = req.body;

    try {
        const userResult = await pool.query(
            "SELECT id, username, mfa_code, mfa_expires_at, role FROM users WHERE email = $1",
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({ success: false, message: "User not found." });
        }

        const user = userResult.rows[0];
        const { id, username, mfa_code, mfa_expires_at, role } = user; // Get user ID

        if (!mfa_code) {
            return res.status(400).json({ success: false, message: "MFA not active for this user." });
        }

        if (new Date(mfa_expires_at) < new Date()) {
             // Don't resend code here on expired, force login again
             // await sendMfaCode(email);
            return res.status(400).json({ success: false, message: "MFA code expired. Please log in again to get a new code." });
        }

        const isMatch = await bcrypt.compare(code, mfa_code);

        if (!isMatch) {
            // Consider attempt limits for MFA
             // Don't resend on incorrect - prevents brute force
            // await sendMfaCode(email);
            return res.status(401).json({ success: false, message: "Incorrect MFA code. Please try again." });
        }

        // MFA Successful! Clear MFA data
        await pool.query("UPDATE users SET mfa_code = NULL, mfa_expires_at = NULL WHERE email = $1", [email]);

        // --- GENERATE JWT ---
        const payload = {
            userId: id, // Include user ID - CRITICAL for permission checks
            username: username,
            role: role,
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1h' } // Use expiry from .env or default
        );

        // --- SEND TOKEN TO CLIENT ---
        res.json({
            success: true,
            message: "MFA verified! Access granted.",
            token: token,
            role: role, // Keep sending role/username if needed directly on frontend
            username: username,
            userId: id // Send userId too if useful on frontend (though it's in token)
        });

    } catch (error) {
        console.error("Error during MFA verification:", error);
        res.status(500).json({ success: false, message: "Server error during MFA verification." });
    }
    });

  // --- AUTHORIZATION MIDDLEWARE (JWT Protect) ---
  const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Fetch fresh user data - important for role/lock status changes
            const userResult = await pool.query("SELECT id, username, role, is_locked FROM users WHERE id = $1", [decoded.userId]);
            if (!userResult.rows[0]) {
                throw new Error('User associated with token not found.');
            }
            const currentUser = userResult.rows[0];

            if (currentUser.is_locked) {
                 return res.status(403).json({ success: false, message: 'Your account is locked. Please contact support.' });
            }


            req.user = { // Attach crucial info
                 userId: currentUser.id,
                 username: currentUser.username,
                 role: currentUser.role
            };

            next();
        } catch (error) {
            console.error('Token verification failed:', error.message);
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ success: false, message: 'Not authorized, token expired' });
            }
            if(error.message === 'User associated with token not found.'){
                 return res.status(401).json({ success: false, message: 'Not authorized, user not found' });
            }
             return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }
  };

  // --- USER MANAGEMENT ROUTES ---
  // Endpoint: Fetch all users
  app.get("/api/users", protect, async (req, res) => {
    try {
      const result = await pool.query("SELECT id, username, email, age, role, is_locked FROM users ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Endpoint: Add a new user (Admin Only)
  app.post("/api/users", protect, checkRole('Administrator'), async (req, res) => {
    const { username, email, password, age, role } = req.body;
     // Basic validation
     if (!username || !email || !password || !role) {
       return res.status(400).json({ message: "Username, email, password, and role are required." });
    }
    if (!['Administrator', 'Data Manager', 'Regular'].includes(role)) {
        return res.status(400).json({ message: "Invalid role specified." });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5)",
        [username, email, hashedPassword, age, role]
      );
      res.status(201).json({ message: "User added successfully" });
    } catch (error) {
      console.error("Error adding user:", error);
       if (error.code === '23505') { // Unique violation
         return res.status(409).json({ message: `Error: ${error.constraint} already exists.` });
       }
      res.status(500).json({ message: "Server error adding user" });
    }
  });

  // Endpoint: Update a user (Admin Only)
  app.put("/api/users/:id", protect, checkRole('Administrator'), async (req, res) => {
    const userId = parseInt(req.params.id);
    const { username, email, password, age, role } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID." });
    }
     if (role && !['Administrator', 'Data Manager', 'Regular'].includes(role)) {
        return res.status(400).json({ message: "Invalid role specified." });
     }

    let query = "UPDATE users SET ";
    const values = [];
    let valueIndex = 1;

    if (username !== undefined) { query += `username = $${valueIndex++}, `; values.push(username); }
    if (email !== undefined) { query += `email = $${valueIndex++}, `; values.push(email); }
    if (password) { // Only update password if provided
      try {
          const hashedPassword = await bcrypt.hash(password, 10);
          query += `password = $${valueIndex++}, `;
          values.push(hashedPassword);
      } catch (hashError) {
          console.error("Error hashing password during update:", hashError);
          return res.status(500).json({ message: "Server error hashing password." });
      }
    }
    if (age !== undefined) { query += `age = $${valueIndex++}, `; values.push(age); }
    if (role !== undefined) { query += `role = $${valueIndex++}, `; values.push(role); }

    if (values.length === 0) { // No fields to update
        return res.status(400).json({ message: "No fields provided for update." });
    }

    query = query.slice(0, -2); // Remove trailing comma and space
    query += ` WHERE id = $${valueIndex++}`;
    values.push(userId);

    try {
      const result = await pool.query(query, values);
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "User not found." });
      }
      res.json({ message: "User updated successfully" });
    } catch (error) {
      console.error("Error updating user:", error);
      if (error.code === '23505') {
          return res.status(409).json({ message: `Error: ${error.constraint} already exists.` });
      }
      res.status(500).json({ message: "Server error updating user." });
    }
  });

  // Endpoint: Delete a user (Admin Only)
  app.delete("/api/users/:id", protect, checkRole('Administrator'), async (req, res) => {
    const userIdToDelete = parseInt(req.params.id);

    if (isNaN(userIdToDelete)) {
      return res.status(400).json({ message: "Invalid user ID." });
    }
     // Prevent self-deletion? Or deletion of the last admin? Add checks if needed.
     if (userIdToDelete === req.user.userId) {
       return res.status(400).json({ message: "Cannot delete your own account." });
     }

    try {
        // CASCADE constraint on project_data_managers handles assignment removal
      const result = await pool.query("DELETE FROM users WHERE id = $1", [userIdToDelete]);
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "User not found." });
      }
      res.status(204).send(); // No Content
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Server error deleting user." });
    }
  });

  // Endpoint: Get user count
  app.get("/api/users/count", protect, async (req, res) => {
    try {
      const result = await pool.query("SELECT COUNT(*) FROM users");
      const count = parseInt(result.rows[0].count, 10);
      res.json({ count: count });
    } catch (error) {
      console.error("Error fetching user count:", error);
      res.status(500).json({ message: "Server error fetching user count" });
    }
  });

  // Endpoint: Unlock a user (Admin Only)
  app.put("/api/users/:id/unlock", protect, checkRole('Administrator'), async (req, res) => {
    const userIdToUnlock = parseInt(req.params.id);
    if (isNaN(userIdToUnlock)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }
    try {
        const result = await pool.query(
            "UPDATE users SET is_locked = FALSE, failed_attempts = 0 WHERE id = $1",
            [userIdToUnlock]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        res.json({ success: true, message: "User unlocked successfully" });
    } catch (error) {
        console.error("Error unlocking user:", error);
        res.status(500).json({ message: "Server error unlocking user." });
    }
  });

  // --- PROJECT MANAGEMENT ROUTES ---
  // Endpoint: Create a new Project (Admin Only)
  app.post("/api/projects", protect, checkRole(['Administrator']), async (req, res) => {
    const { name, description } = req.body;
    if (!name || name.trim() === "") return res.status(400).json({ success: false, message: "Project name required." });
    try {
      const result = await pool.query( "INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id, name, description, created_at", [name.trim(), description || null]);
      res.status(201).json({ success: true, project: result.rows[0] });
    } catch (error) { /* ... keep error handling ... */ if(error.code==='23505')return res.status(409).json({success:false,message:`Project "${name.trim()}" exists.`}); res.status(500).json({ success: false, message: "Server error creating project." }); }
  });

  // Endpoint: Get all Projects (All logged-in users)
  app.get("/api/projects", protect, async (req, res) => {
    try {
      const result = await pool.query("SELECT id, name FROM projects ORDER BY name ASC");
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ success: false, message: "Server error fetching projects." });
    }
  });

  // Endpoint: Assign Data Manager to Project (Admin Only)
  app.post("/api/projects/:projectId/datamanagers", protect, checkRole('Administrator'), async (req, res) => {
    const projectId = parseInt(req.params.projectId);
    const { userId } = req.body; // Get userId from request body

    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: "Invalid project ID." });
    }
    if (!userId || isNaN(parseInt(userId))) {
        return res.status(400).json({ success: false, message: "Invalid or missing user ID." });
    }
    const managerUserId = parseInt(userId);

    let poolClient;
    try {
        poolClient = await pool.connect(); // Use connection pooling

        // --- Validation Step 1: Check if project exists ---
        const projectCheck = await poolClient.query("SELECT 1 FROM projects WHERE id = $1", [projectId]);
        if (projectCheck.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Project not found." });
        }

        // --- Validation Step 2: Check if user exists and is a Data Manager ---
        const userCheck = await poolClient.query("SELECT role FROM users WHERE id = $1", [managerUserId]);
        if (userCheck.rowCount === 0) {
            return res.status(404).json({ success: false, message: "User not found." });
        }
        if (userCheck.rows[0].role !== ROLES.DATA_MANAGER) {
            return res.status(400).json({ success: false, message: "User is not a Data Manager." });
        }

        // --- Perform Assignment ---
        await poolClient.query(
            "INSERT INTO project_data_managers (user_id, project_id) VALUES ($1, $2) ON CONFLICT (user_id, project_id) DO NOTHING",
            [managerUserId, projectId]
        );
        // ON CONFLICT ... DO NOTHING prevents errors if already assigned, just silently succeeds.
        // If you want to explicitly tell the user it was already assigned, you could query first or check rowCount after INSERT (might be 0 if conflict occurred).

        res.status(201).json({ success: true, message: "Data Manager assigned successfully." });

    } catch (error) {
        console.error("Error assigning data manager:", error);
         // You could check for specific error codes if needed, e.g., foreign key constraints if validation missed something
        res.status(500).json({ success: false, message: "Server error assigning data manager." });
    } finally {
        if (poolClient) {
            poolClient.release(); // Release client back to pool
        }
    }
  });

  // Endpoint: Get Data Managers for a Project (Admin Only)
  app.get("/api/projects/:projectId/datamanagers", protect, checkRole('Administrator'), async (req, res) => {
    const projectId = parseInt(req.params.projectId);

    if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID." });
    }

    try {
        // Verify project exists
        const projectResult = await pool.query("SELECT 1 FROM projects WHERE id = $1", [projectId]);
        if (projectResult.rowCount === 0) {
            return res.status(404).json({ message: "Project not found." });
        }

        // Query users table joined with the assignments table for this project
        const assignmentsResult = await pool.query(
            `SELECT u.id, u.username, u.email
             FROM users u
             JOIN project_data_managers pdm ON u.id = pdm.user_id
             WHERE pdm.project_id = $1 AND u.role = 'Data Manager'
             ORDER BY u.username ASC`,
            [projectId]
        );

        // assignmentsResult.rows will contain { id, username, email } for assigned DMs
        res.json(assignmentsResult.rows);

    } catch (error) {
        console.error(`Error fetching data managers for project ${projectId}:`, error);
        res.status(500).json({ message: "Server error fetching assigned data managers." });
    }
});

  // Endpoint: Unassign Data Manager from Project (Admin Only)
  app.delete("/api/projects/:projectId/datamanagers/:userId", protect, checkRole('Administrator'), async (req, res) => {
    const projectId = parseInt(req.params.projectId);
    const managerUserId = parseInt(req.params.userId);

    if (isNaN(projectId) || isNaN(managerUserId)) {
        return res.status(400).json({ message: "Invalid project ID or user ID." });
    }

    try {
        const result = await pool.query(
            "DELETE FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
            [managerUserId, projectId]
        );

        if (result.rowCount === 0) {
            // This is okay, maybe they weren't assigned or IDs were wrong
            return res.status(404).json({ message: "Assignment not found." });
        }

        res.status(200).json({ success: true, message: "Data Manager unassigned from project successfully." });

    } catch (error) {
        console.error("Error unassigning data manager:", error);
        res.status(500).json({ message: "Server error unassigning data manager." });
    }
  });

  // Endpoint: Get Projects assigned to the Current User (Data Managers mainly)
  app.get("/api/users/me/projects", protect, async (req, res) => {
    const userId = req.user.userId; // From protect middleware

    // Administrators have access to all projects conceptually,
    // but for this endpoint's purpose (checking DM assignments), return empty for Admins
    if (req.user.role === 'Administrator' || req.user.role === 'Regular') {
        return res.json({ assignedProjectIds: [] });
    }

    if (req.user.role === 'Data Manager') {
        try {
            const result = await pool.query(
                "SELECT project_id FROM project_data_managers WHERE user_id = $1",
                [userId]
            );
            const assignedIds = result.rows.map(row => row.project_id);
            res.json({ assignedProjectIds: assignedIds });
        } catch (error) {
            console.error("Error fetching user's assigned projects:", error);
            res.status(500).json({ success: false, message: "Server error fetching assigned projects." });
        }
    } else {
        // Should not happen if roles are handled correctly, but as a fallback
        res.json({ assignedProjectIds: [] });
    }
});

  // --- FILE MANAGEMENT ROUTES ---

// Endpoint: File Upload (Admin, Data Manager) - FULLY UPDATED CODE
app.post("/api/files/upload", protect, checkRole(['Administrator', 'Data Manager']), upload.single('file'), async (req, res) => {
  // 1. Check if a file was actually uploaded
  if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
  }

  // 2. Extract file details provided by multer
  const { originalname, filename, path: stored_path_absolute, mimetype, size } = req.file;
  // Construct the relative path for database storage
  const stored_path_relative = path.join('uploads', filename);

  // 3. Initialize variables needed across the process
  let savedFileRecord; // To store formatted data for the initial response
  let fileIdToUpdate; // To store the ID for the later DB update

  // 4. Main processing block with error handling
  try {
      // 5. --- Insert Initial Record into Database ---
      // Latitude and Longitude are initially set to NULL. Python will update them later.
      const latitude = null;
      const longitude = null;

      const result = await pool.query(
          `INSERT INTO uploaded_files
           (original_name, stored_filename, stored_path, mime_type, size_bytes, latitude, longitude)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, original_name, size_bytes, upload_date, stored_path, project_id, latitude, longitude`, // Return necessary fields including the new ID
          [originalname, filename, stored_path_relative, mimetype, size, latitude, longitude] // Pass values, including nulls for lat/lon
      );

      // Check if the insert was successful and returned the ID
      if (result.rows.length === 0 || !result.rows[0].id) {
           // If insert failed, try to clean up the saved file
           fs.unlink(stored_path_absolute, (err) => {
              if (err && err.code !== 'ENOENT') console.error("Node: Error deleting orphaned upload file after failed DB insert:", err);
           });
           throw new Error("Failed to insert file record or retrieve its ID.");
      }

      // Store the newly created file's ID for the background update task
      fileIdToUpdate = result.rows[0].id;

      // Format the initial file data for the response (consistent with GET /api/files)
      const initialDbRecord = result.rows[0];
      savedFileRecord = {
          id: initialDbRecord.id,
          name: initialDbRecord.original_name,
          size_bytes: initialDbRecord.size_bytes,
          upload_date: initialDbRecord.upload_date,
          stored_path: initialDbRecord.stored_path,
          potreeUrl: null, // No Potree URL initially
          project_id: initialDbRecord.project_id, // Will be null initially
          latitude: initialDbRecord.latitude, // Will be null initially
          longitude: initialDbRecord.longitude, // Will be null initially
          size: initialDbRecord.size_bytes ? `${(initialDbRecord.size_bytes / 1024 / 1024).toFixed(2)} MB` : 'N/A',
          uploadDate: initialDbRecord.upload_date ? new Date(initialDbRecord.upload_date).toLocaleDateString() : 'N/A',
          downloadLink: `/api/files/download/${initialDbRecord.id}`,
          projectName: null, // Initially unassigned
          project_name: null
      };


      // 6. --- Respond to Client Immediately ---
      // Let the client know the upload was received and background processing has started.
      res.status(201).json({
           success: true,
           message: "File upload accepted, processing coordinates in background.", // Informative message
           file: savedFileRecord // Send details of the initial record
      });


      // 7. --- Trigger Python Script Asynchronously (AFTER RESPONSE SENT) ---
      const pythonScriptName = 'process_las.py'; // Ensure this matches your script file name
      const pythonScriptPath = path.resolve(__dirname, pythonScriptName);
      const absoluteFilePathForPython = stored_path_absolute; // Use the full path for Python

      // Safety check: Ensure the Python script actually exists
      if (!fs.existsSync(pythonScriptPath)) {
          console.error(`Node Error (FileID ${fileIdToUpdate}): Python script not found at ${pythonScriptPath}. Cannot process coordinates.`);
          // Log the error, but processing stops here for this file. Node server continues running.
          return;
      }

      console.log(`Node (FileID ${fileIdToUpdate}): Spawning Python script "${pythonScriptPath}" with arg "${absoluteFilePathForPython}"`);

      // Define the command to run Python (adjust if necessary, e.g., 'python3')
      const pythonCommand = 'python';

      // Spawn the Python process
      const pythonProcess = spawn(pythonCommand, [pythonScriptPath, absoluteFilePathForPython]);

      let stdoutData = ''; // Accumulate standard output
      let stderrData = ''; // Accumulate standard error

      // 8. --- Listen for Python Process Events ---

      // Capture standard output
      pythonProcess.stdout.on('data', (data) => {
          stdoutData += data.toString();
      });

      // Capture standard error (log immediately for debugging)
      pythonProcess.stderr.on('data', (data) => {
           const errorMsg = data.toString().trim();
           if (errorMsg) { // Avoid logging empty lines
              stderrData += errorMsg + '\n'; // Accumulate stderr as well
              console.error(`Python stderr (FileID ${fileIdToUpdate}): ${errorMsg}`);
           }
      });

      // Handle errors in starting the process itself
       pythonProcess.on('error', (error) => {
           console.error(`Node Error (FileID ${fileIdToUpdate}): Failed to start Python process. Command: ${pythonCommand}. Error: ${error.message}`);
           // Potentially log this error to a persistent store or monitoring system
       });

      // Handle the script finishing (most important part)
      pythonProcess.on('close', async (code) => {
          console.log(`Node (FileID ${fileIdToUpdate}): Python script exited with code ${code}.`);

          if (code === 0 && stdoutData) { // Python script succeeded and produced output
              // 9. --- Process Successful Python Output ---
              try {
                  const resultData = JSON.parse(stdoutData.trim()); // Trim whitespace before parsing

                  // Validate the structure and types received from Python
                  if (resultData && (typeof resultData.latitude === 'number' || resultData.latitude === null) && (typeof resultData.longitude === 'number' || resultData.longitude === null)) {

                      const { latitude: calculatedLat, longitude: calculatedLon } = resultData;

                      // Log what was received before updating DB
                      if (calculatedLat !== null && calculatedLon !== null) {
                           console.log(`Node (FileID ${fileIdToUpdate}): Received coordinates Lat: ${calculatedLat}, Lon: ${calculatedLon}. Attempting DB update...`);
                      } else {
                          console.log(`Node (FileID ${fileIdToUpdate}): Received NULL coordinates (e.g., empty file). Attempting DB update...`);
                      }

                      // 10. --- Update Database with Coordinates ---
                      try {
                          const updateResult = await pool.query(
                              `UPDATE uploaded_files SET latitude = $1, longitude = $2 WHERE id = $3`,
                              [calculatedLat, calculatedLon, fileIdToUpdate] // Use the captured ID
                          );
                          // Check if the update actually modified a row
                          if (updateResult.rowCount > 0) {
                              console.log(`Node (FileID ${fileIdToUpdate}): Successfully updated coordinates in DB.`);
                          } else {
                              // This might happen if the file record was deleted between upload and processing completion
                              console.warn(`Node Warning (FileID ${fileIdToUpdate}): DB update query ran but did not affect any rows (ID ${fileIdToUpdate} might not exist anymore?).`);
                          }
                      } catch (dbError) {
                           // Log database specific errors during the update
                           console.error(`Node DB Error (FileID ${fileIdToUpdate}): Error updating coordinates in DB:`, dbError);
                      }
                  } else {
                       // Log error if JSON structure from Python is not as expected
                       console.error(`Node Error (FileID ${fileIdToUpdate}): Invalid JSON structure or missing/invalid lat/lon received from Python stdout: ${stdoutData}`);
                  }
              } catch (parseError) {
                  // Log error if the Python output was not valid JSON
                  console.error(`Node Error (FileID ${fileIdToUpdate}): Error parsing JSON from Python stdout: ${parseError}\nRaw stdout data: >>>${stdoutData}<<<`);
              }
          } else if (code !== 0) {
              // Python script exited with an error code. stderrData should have been logged via the 'data' listener.
              console.error(`Node Error (FileID ${fileIdToUpdate}): Python script exited with error code ${code}. Check previous stderr logs for details.`);
              // Consider adding more robust error reporting here if needed
          } else if (code === 0 && !stdoutData) {
               // Python script finished successfully but gave no output (might be expected in some cases)
               console.warn(`Node Warning (FileID ${fileIdToUpdate}): Python script exited successfully (code 0) but produced no stdout data.`);
          }
      }); // --- End pythonProcess.on('close') ---

  } catch (error) {
      // 11. --- Handle Errors During Initial Upload/Spawn ---
      console.error("Node Error: Error during initial file upload processing or Python spawn:", error);
      // Check if response has already been sent before trying to send another
      if (!res.headersSent) {
          // Attempt to delete the potentially orphaned file if something went wrong early on
          fs.unlink(stored_path_absolute, (err) => {
              // Ignore ENOENT (file already gone), log other errors
              if (err && err.code !== 'ENOENT') console.error("Node: Error deleting orphaned upload file on failure:", err);
          });
          // Send a generic server error response
          res.status(500).json({ success: false, message: "Server error during file upload process." });
      } else {
           // If response was already sent, we can't send another one. Just log the error.
           console.error(`Node Error: Occurred after response was sent for file ${filename}. Background processing might be incomplete.`);
      }
  } // --- End main try...catch ---
}); // --- End POST /api/files/upload ---

  // Endpoint: Get List of Files (All logged-in users, filtered potentially)
  app.get("/api/files", protect, async (req, res) => {
    const { projectId } = req.query; // Get potential project ID filter

    let query = `
      SELECT
          f.id,
          f.original_name AS name,
          f.size_bytes,
          f.upload_date,
          f.stored_path,
          f.potree_metadata_path AS "potreeUrl", -- Keep alias for frontend
          f.project_id,
          f.latitude,  
          f.longitude, 
          p.name AS project_name
      FROM uploaded_files f
      LEFT JOIN projects p ON f.project_id = p.id
    `;
    const queryParams = [];

    // Filtering logic (remains the same)
    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        query += ` WHERE f.project_id = $1`;
        queryParams.push(parseInt(projectId));
    } else if (projectId === 'unassigned') {
        query += ` WHERE f.project_id IS NULL`;
    } // 'all' or missing projectId fetches all

    query += ` ORDER BY f.upload_date DESC`;

    try {
        const result = await pool.query(query, queryParams);

        // Formatting remains mostly the same
        const formattedFiles = result.rows.map(file => ({
            ...file,
            size: file.size_bytes ? `${(file.size_bytes / 1024 / 1024).toFixed(2)} MB` : 'N/A',
            uploadDate: file.upload_date ? new Date(file.upload_date).toLocaleDateString() : 'N/A', // Use local date string format
            downloadLink: `/api/files/download/${file.id}`,
            projectName: file.project_name || "Unassigned" // Use "Unassigned" if null
            // Note: We are NOT adding project access checks here.
            // Frontend `canPerformAction` will handle disabling actions based on assignment.
        }));
        console.log('Backend sending formattedFiles (check types):', formattedFiles);
        res.json(formattedFiles);

    } catch (error) {
        console.error("Database error fetching files:", error);
        res.status(500).json({ success: false, message: "Server error fetching file list." });
    }
  });

  // Endpoint: File Download (All logged-in users - Frontend gates)
  app.get("/api/files/download/:id",
    protect, // Just need login check
    // REMOVED checkProjectAssignment middleware
    async (req, res) => {
        // Only `protect` runs before this. Admins/DMs/Regulars can potentially hit this.
        // The frontend's canPerformAction('download') should gate this for roles.

        const fileId = parseInt(req.params.id);
        if (isNaN(fileId)) return res.status(400).json({ message: "Invalid file ID." });
        try {
            const result = await pool.query( "SELECT original_name, stored_path FROM uploaded_files WHERE id = $1", [fileId]);
            if (result.rows.length === 0) return res.status(404).json({ message: "File not found." });
            const file = result.rows[0];
            const filePath = path.resolve(__dirname, file.stored_path);
            if (fs.existsSync(filePath)) {
                res.download(filePath, file.original_name, (err) => { if(err){ console.error("Download send err:", err); if(!res.headersSent)res.status(500).send("Download err."); }});
            } else { console.error(`Download file missing disk: ${filePath}`); res.status(404).json({ message: "File source missing." }); }
        } catch (error) { console.error("Download retrieval err:", error); if(!res.headersSent) res.status(500).json({ message: "Server error during download." }); }
  });

  // Endpoint: File Deletion (Admin, Assigned Data Manager)
  app.delete("/api/files/:id", protect, checkRole(['Administrator', 'Data Manager']), checkProjectAssignment, async (req, res) => {
      // Admins bypass checkProjectAssignment logic inside the function.
      // Data Managers are checked by checkProjectAssignment middleware.
      const fileId = parseInt(req.params.id);
      if (isNaN(fileId)) {
          return res.status(400).json({ message: "Invalid file ID." });
      }

      let poolClient;
      try {
          poolClient = await pool.connect();
          await poolClient.query('BEGIN');

          const fileResult = await poolClient.query(
              "SELECT stored_path, potree_metadata_path FROM uploaded_files WHERE id = $1 FOR UPDATE",
              [fileId]
          );

          if (fileResult.rows.length === 0) {
              await poolClient.query('ROLLBACK');
              return res.status(404).json({ message: "File not found in database." });
          }

          const fileData = fileResult.rows[0];
          const originalFilePath = path.resolve(__dirname, fileData.stored_path);
          let potreeOutputDirPath = null;

          if (fileData.potree_metadata_path) {
            const pathParts = fileData.potree_metadata_path.split('/');
            if (pathParts.length >= 3 && pathParts[1] === 'pointclouds') {
                const outputDirName = pathParts[2]; // e.g., '123' which should be the file ID
                potreeOutputDirPath = path.resolve(__dirname, "..", "public", "pointclouds", outputDirName); // Base dir is relative to server.js's parent
            } else {
                console.warn(`Could not parse potree path structure for deletion: ${fileData.potree_metadata_path}`);
            }
          }

          const deleteResult = await poolClient.query("DELETE FROM uploaded_files WHERE id = $1", [fileId]);
          if (deleteResult.rowCount === 0) {
              await poolClient.query('ROLLBACK');
              return res.status(404).json({ message: "File not found for deletion (concurrency issue?)." });
          }

          await poolClient.query('COMMIT');

          // Perform file system cleanup after commit
          fs.unlink(originalFilePath, (err) => {
              if (err && err.code !== 'ENOENT') { // Ignore error if file already gone
                  console.error(`Error deleting original file ${originalFilePath} from disk:`, err);
              } else {
                  console.log(`Attempted deletion of original file: ${originalFilePath}`);
              }
          });

          if (potreeOutputDirPath) {
             fs.rm(potreeOutputDirPath, { recursive: true, force: true }, (err) => {
                  if (err && err.code !== 'ENOENT') { // Ignore error if directory already gone
                     console.error(`Error deleting Potree output directory ${potreeOutputDirPath}:`, err);
                  } else {
                     console.log(`Attempted deletion of Potree output directory: ${potreeOutputDirPath}`);
                  }
              });
          }

          res.status(200).json({ success: true, message: "File delete request processed." }); // Return 200 with message

      } catch (error) {
          console.error("Error during file deletion process:", error);
          if (poolClient) {
              try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr);}
          }
          res.status(500).json({ message: "Server error during file deletion." });
      } finally {
          if (poolClient) poolClient.release();
      }
  });


  // Endpoint: Potree Conversion (Admin, Data Manager, Regular)
  app.get("/api/files/potreeconverter/:id", protect, (req, res, next) => {
    // Custom Middleware Logic:
    // Allow Admin & Regular User always
    if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.REGULAR) {
        return next();
    }
    // Allow Data Manager always (removed project assignment check) // *** CHANGED ***
    if (req.user.role === ROLES.DATA_MANAGER) {
        return next();
    }
    // Deny others
    return res.status(403).json({ success: false, message: "Forbidden: Role not authorized." });
 }, async (req, res) => {
    // Handler logic: Runs if middleware calls next()
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) return res.status(400).json({ message: "Invalid file ID." });
    let poolClient;
    try {
        // ... (rest of conversion logic using transaction) ...
        poolClient=await pool.connect(); await poolClient.query('BEGIN');
        const fileRes=await poolClient.query("SELECT stored_path, potree_metadata_path FROM uploaded_files WHERE id = $1 FOR UPDATE",[fileId]);
        if(fileRes.rows.length === 0){ await poolClient.query('ROLLBACK'); return res.status(404).json({message:"File not found"});}
        const file=fileRes.rows[0]; if(file.potree_metadata_path){await poolClient.query('ROLLBACK'); return res.status(400).json({success:false, message:"Already converted"});}
        const lasPath=path.resolve(__dirname,file.stored_path); if(!fs.existsSync(lasPath)){await poolClient.query('ROLLBACK');return res.status(404).json({success:false, message:`Input missing: ${file.stored_path}`});}
        const outDirName=fileId.toString(); const outBase=path.resolve(__dirname,"..","public","pointclouds"); const outDir=path.join(outBase, outDirName);
        fs.mkdirSync(outBase,{recursive:true}); fs.mkdirSync(outDir,{recursive:true});
        const converterPath=path.resolve(__dirname,"potreeconverter","PotreeConverter.exe"); if(!fs.existsSync(converterPath)){await poolClient.query('ROLLBACK'); return res.status(500).json({success:false, message:"Converter not found."});}
        const command=`"${converterPath}" "${lasPath}" -o "${outDir}"`; console.log(`Exec: ${command}`);
        try { execSync(command,{stdio:'inherit'}); } catch(convErr){ console.error("Convert fail:", convErr); await poolClient.query('ROLLBACK'); /* Optionally try cleanup fs.rmSync(outDir) */ return res.status(500).json({success:false, message:`Convert command failed. ${convErr.message}`});}
        const metaPath=`/pointclouds/${outDirName}/metadata.json`;
        await poolClient.query("UPDATE uploaded_files SET potree_metadata_path = $1 WHERE id = $2",[metaPath, fileId]);
        await poolClient.query('COMMIT');
        res.json({ success: true, message: "Conversion complete!", potreeUrl: metaPath });
    } catch (error) { console.error("Convert process err:", error); if(poolClient){try{await poolClient.query('ROLLBACK');}catch(rbE){console.error("RB err:",rbE);}} res.status(500).json({ success: false, message: "Server error during conversion." }); }
    finally { if (poolClient) poolClient.release(); }
  });


  // Endpoint: Assign Project to File (PATCH) (Admin or Assigned Data Manager for TARGET project)
  app.patch("/api/files/:id",
    protect,
    checkRole(['Administrator', 'Data Manager']),
    // *** REMOVED checkProjectAssignment MIDDLEWARE HERE ***
    async (req, res) => {
        // Middleware allows Admin or DM to reach here.
        // Handler logic below validates the *target* project for DMs.

        const fileId = parseInt(req.params.id);
        const { projectId } = req.body; // projectId can be number or null

        if (isNaN(fileId)) {
            return res.status(400).json({ message: "Invalid file ID." });
        }
        if (projectId !== null && typeof projectId !== 'number') {
            return res.status(400).json({ message: "Invalid project ID format." });
        }

        try {
             // Verify target project ID exists if not null
             if (projectId !== null) {
                 const projectExists = await pool.query("SELECT 1 FROM projects WHERE id = $1", [projectId]);
                 if (projectExists.rowCount === 0) {
                     return res.status(404).json({ message: "Target project not found." });
                 }
             }

            // *** DM specific check: Can only assign TO a project they manage ***
            // This check REMAINS and is NOW the primary check for DMs on this route
            if (req.user.role === 'Data Manager' && projectId !== null) {
                 const assignmentResult = await pool.query( "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2", [req.user.userId, projectId]);
                 if (assignmentResult.rowCount === 0) {
                    return res.status(403).json({ success: false, message: "Forbidden: Cannot assign to a project you don't manage." });
                 }
            }
            // Admins and DMs assigning to NULL (unassigning) or to a project they manage pass through.

            // Update the file's project_id
            const result = await pool.query( "UPDATE uploaded_files SET project_id = $1 WHERE id = $2 RETURNING id, project_id", [projectId, fileId]);
            if (result.rowCount === 0) {
                return res.status(404).json({ message: "File not found." });
            }

            // Fetch full updated file details to return
            const updatedFileResult = await pool.query( `SELECT f.id, f.original_name AS name, f.size_bytes, f.upload_date, f.stored_path, f.potree_metadata_path AS "potreeUrl", f.project_id, p.name AS project_name FROM uploaded_files f LEFT JOIN projects p ON f.project_id = p.id WHERE f.id = $1`, [fileId]);
            if(updatedFileResult.rows.length === 0) return res.status(404).json({message:"Updated info not found."}); // Should not happen

            const uf=updatedFileResult.rows[0]; const updatedFile={...uf, size:uf.size_bytes?`${(uf.size_bytes/1024/1024).toFixed(2)} MB`:'N/A', uploadDate:uf.upload_date?new Date(uf.upload_date).toLocaleDateString():'N/A', downloadLink:`/api/files/download/${uf.id}`, projectName:uf.projectName||"Unassigned" };
            res.json({ success: true, message: "File assignment updated.", file: updatedFile });

        } catch (error) {
            console.error("Err assigning project:", error);
            if(error.code === '23503') return res.status(404).json({message:"Project FK fail."}); // Foreign key violation likely means bad project ID again
            res.status(500).json({ message: "Server error assigning project." });
        }
  }); // End PATCH /api/files/:id route

  app.delete("/api/projects/:projectId", protect, checkRole('Administrator'), async (req, res) => {
    const projectId = parseInt(req.params.projectId);

    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: "Invalid project ID." });
    }

    // Note: 'ON DELETE SET NULL' on uploaded_files and 'ON DELETE CASCADE' on
    // project_data_managers in the table definitions will handle related records.

    let poolClient;
    try {
        poolClient = await pool.connect(); // Use the main pool defined earlier
        await poolClient.query('BEGIN'); // Start transaction

        // Check if project exists before deleting (optional but good practice)
        const checkResult = await poolClient.query("SELECT 1 FROM projects WHERE id = $1", [projectId]);
        if (checkResult.rowCount === 0) {
             await poolClient.query('ROLLBACK');
            return res.status(404).json({ success: false, message: "Project not found." });
        }

        // Perform the deletion
        const deleteResult = await poolClient.query("DELETE FROM projects WHERE id = $1", [projectId]);

        // Although the foreign keys handle cleanup, double-check if deletion happened
        if (deleteResult.rowCount === 0) {
            // Should not happen if check passed, but good safety measure
            await poolClient.query('ROLLBACK');
             console.warn(`Project deletion attempt failed for ID ${projectId} after existence check.`);
            return res.status(404).json({ success: false, message: "Project not found during delete operation." });
        }

        await poolClient.query('COMMIT'); // Commit transaction

        res.status(200).json({ success: true, message: "Project deleted successfully." });

    } catch (error) {
        console.error(`Error deleting project ${projectId}:`, error);
        if (poolClient) {
            try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
        }
        res.status(500).json({ success: false, message: "Server error deleting project." });
    } finally {
        if (poolClient) {
            poolClient.release(); // Release client back to the pool
        }
    }
  });

  // --- START SERVER ---
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

}).catch(error => {
    // Catch errors during the initial `initDatabase` phase
    console.error("Failed to initialize database and start server:", error);
    process.exit(1); // Exit if init fails
});