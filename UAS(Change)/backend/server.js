const { execSync } = require("child_process");
const express = require("express");
const cors = require("cors");
const { Pool, Client } = require("pg");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");

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

// Function to check and start Docker container
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
    } else {
      console.log("PostgreSQL container is already running.");
    }
  } catch (error) {
    console.error("Error managing Docker container:", error.message);
  }
};

// Function to create the database if it doesn't exist
const createDatabase = async () => {
  const client = new Client({ ...dbConfig, database: "postgres" });
  await client.connect();

  const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'uasuserdata';");

  if (result.rowCount === 0) {
    console.log("Database 'uasuserdata' does not exist. Creating...");
    await client.query("CREATE DATABASE uasuserdata;");
    console.log("Database created successfully.");
  } else {
    console.log("Database already exists.");
  }

  await client.end();
};

// Function to create the users table and insert a default user
const createUsersTable = async () => {
  const pool = new Pool({ ...dbConfig, database: "uasuserdata" });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      age INT,
      role VARCHAR(50) CHECK (role IN ('admin', 'manager')),
      failed_attempts INT DEFAULT 0,
      is_locked BOOLEAN DEFAULT FALSE,
      mfa_code TEXT,
      mfa_expires_at TIMESTAMP
    );
  `);

  console.log("Users table is ready.");

  const result = await pool.query("SELECT COUNT(*) FROM users");
  if (parseInt(result.rows[0].count) === 0) {
    const hashedPassword = await bcrypt.hash("root", 10);
    await pool.query(
      "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
      ["SHW", "shwhongwei@gmail.com", hashedPassword, 21, "admin"]
    );    
    console.log("Default admin user created");
  } else {
    console.log("Users already exist, skipping default user creation.");
  }

  await pool.end();
};

// Initialize the database setup
const initDatabase = async () => {
  startDockerContainer();
  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for PostgreSQL to be ready
  await createDatabase();
  await createUsersTable();
};

// Run the database initialization before starting the server
initDatabase().then(() => {
  const pool = new Pool({ ...dbConfig, database: "uasuserdata" });

  app.use(express.json());
  app.use(cors());

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "shwhongwei@gmail.com",
      pass: "xzgm kwsz bgbk gbho",
    },
  });

  const sendMfaCode = async (email) => {
    const rawMfaCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedMfaCode = await bcrypt.hash(rawMfaCode, 10);
    const expiryTime = new Date(Date.now() + 5 * 60 * 1000);

    await pool.query("UPDATE users SET mfa_code = $1, mfa_expires_at = $2 WHERE email = $3",
      [hashedMfaCode, expiryTime, email]
    );

    await transporter.sendMail({
      from: "shwhongwei@gmail.com",
      to: email,
      subject: "Your MFA Code",
      text: `Your MFA code is: ${rawMfaCode}`,
    });
  };

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
        await pool.query("UPDATE users SET failed_attempts = 0 WHERE email = $1", [email]);
        await sendMfaCode(email);
        return res.json({ success: true, mfaRequired: true, message: "MFA code sent to your email." });
      } else {
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
      console.error("Database error:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  app.post("/api/verify-mfa", async (req, res) => {
    const { email, code } = req.body;
  
    try { // Wrap in try...catch for better error handling
      // Fetch user data including the role
      const userResult = await pool.query(
        "SELECT id, mfa_code, mfa_expires_at, role FROM users WHERE email = $1", // <-- Added 'role' here
        [email]
      );
  
      if (userResult.rows.length === 0) { // Check if user exists first
        return res.status(400).json({ success: false, message: "User not found." });
      }
  
      const user = userResult.rows[0];
      const { id, mfa_code, mfa_expires_at, role } = user; // <-- Destructure the role
  
      if (!mfa_code) {
          // This might happen if MFA wasn't initiated properly or already cleared
          return res.status(400).json({ success: false, message: "MFA not active for this user." });
      }
  
      if (new Date(mfa_expires_at) < new Date()) {
        await sendMfaCode(email); // Resend expired code
        return res.status(400).json({ success: false, message: "MFA code expired. A new one has been sent." });
      }
  
      const isMatch = await bcrypt.compare(code, mfa_code);
  
      if (!isMatch) {
        // Consider rate limiting or temporary lockout for MFA attempts too
        await sendMfaCode(email); // Resend on incorrect code
        return res.status(401).json({ success: false, message: "Incorrect MFA code. A new one has been sent." });
      }
  
      // MFA Successful! Clear MFA data in the database
      await pool.query("UPDATE users SET mfa_code = NULL, mfa_expires_at = NULL WHERE email = $1", [email]);
  
      res.json({
        success: true,
        message: "MFA verified! Access granted.",
        role: role, // <-- Include the role here
      });
  
    } catch (error) {
      console.error("Error during MFA verification:", error);
      res.status(500).json({ success: false, message: "Server error during MFA verification." });
    }
  });

  // Fetch all users
  app.get("/api/users", async (req, res) => {
    try {
      const result = await pool.query("SELECT id, username, email, age, role FROM users ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });  

  // Add a new user
  app.post("/api/users", async (req, res) => {
    const { username, email, password, age, role } = req.body;

    try {
      // Hash the password before storing
      const hashedPassword = await bcrypt.hash(password, 10);

      await pool.query(
        "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5)",
        [username, email, hashedPassword, age, role]
      );

      res.status(201).json({ message: "User added successfully" });
    } catch (error) {
      console.error("Error adding user:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.put("/api/users/:id", async (req, res) => {
    const userId = parseInt(req.params.id); // Get user ID from URL parameter
    const { username, email, password, age, role } = req.body;
  
    // --- SECURITY TODO: Implement Authorization ---
    // Before proceeding, verify if the user making this request IS ALLOWED
    // to edit users. This usually involves checking a JWT payload or session data.
    // Example (pseudo-code, needs proper implementation):
    // const requestingUserRole = checkUserRoleFromToken(req.headers.authorization);
    // if (requestingUserRole !== 'admin') {
    //   return res.status(403).json({ message: "Forbidden: Admin privileges required." });
    // }
    // --- End Security TODO ---
  
  
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID." });
    }
  
    // Build the query dynamically based on provided fields
    let query = "UPDATE users SET ";
    const values = [];
    let valueIndex = 1;
  
    if (username !== undefined) {
      query += `username = $${valueIndex++}, `;
      values.push(username);
    }
    if (email !== undefined) {
      query += `email = $${valueIndex++}, `;
      values.push(email);
    }
    // Only hash and update password IF a new one was provided
    if (password) {
      try {
          const hashedPassword = await bcrypt.hash(password, 10);
          query += `password = $${valueIndex++}, `;
          values.push(hashedPassword);
      } catch (hashError) {
          console.error("Error hashing password during update:", hashError);
          return res.status(500).json({ message: "Server error hashing password." });
      }
    }
    if (age !== undefined) {
      query += `age = $${valueIndex++}, `;
      values.push(age);
    }
    if (role !== undefined) {
      query += `role = $${valueIndex++}, `;
      values.push(role);
    }
  
    // Remove trailing comma and space
    query = query.slice(0, -2);
  
    // Add the WHERE clause
    query += ` WHERE id = $${valueIndex++}`;
    values.push(userId);
  
    // Ensure at least one field was provided for update
    if (values.length <= 1) { // Only contains the userId
      return res.status(400).json({ message: "No fields provided for update." });
    }
  
    try {
      const result = await pool.query(query, values);
  
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "User not found." });
      }
  
      res.json({ message: "User updated successfully" });
  
    } catch (error) {
      console.error("Error updating user:", error);
      // Check for specific errors like unique constraints
      if (error.code === '23505') { // Unique violation (e.g., email already exists)
          return res.status(409).json({ message: `Error: ${error.constraint} already exists.` });
      }
      res.status(500).json({ message: "Server error updating user." });
    }
  });

  app.delete("/api/users/:id", async (req, res) => {
    const userIdToDelete = parseInt(req.params.id);
  
    // --- SECURITY TODO: Implement Authorization ---
    // Verify if the user making this request IS ALLOWED to delete users.
    // const requestingUserId = getUserIdFromToken(req.headers.authorization); // Get ID of user making request
    // const requestingUserRole = getUserRole(requestingUserId); // Fetch role of requester
    //
    // if (requestingUserRole !== 'admin') {
    //   return res.status(403).json({ message: "Forbidden: Admin privileges required." });
    // }
    //
    // --- Optional: Prevent self-deletion ---
    // if (requestingUserId === userIdToDelete) {
    //    return res.status(400).json({ message: "Cannot delete your own account." });
    // }
    // --- End Security TODO ---
  
  
    if (isNaN(userIdToDelete)) {
      return res.status(400).json({ message: "Invalid user ID." });
    }
  
    try {
      const result = await pool.query("DELETE FROM users WHERE id = $1", [userIdToDelete]);
  
      if (result.rowCount === 0) {
        // If no rows were deleted, the user ID likely didn't exist
        return res.status(404).json({ message: "User not found." });
      }
  
      // Successfully deleted
      // Can return 200 with a message or 204 No Content
      // res.json({ message: "User deleted successfully" });
      res.status(204).send(); // Send 204 No Content response (common for DELETE)
  
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Server error deleting user." });
    }
  });

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
});
