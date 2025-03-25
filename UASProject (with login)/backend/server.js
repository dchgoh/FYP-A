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
      email VARCHAR(255) UNIQUE NOT NULL,
      password TEXT NOT NULL,
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
      "INSERT INTO users (email, password) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
      ["shwhongwei@gmail.com", hashedPassword]
    );
    console.log("Default admin user created: shwhongwei@gmail.com / root");
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

    const result = await pool.query("SELECT mfa_code, mfa_expires_at FROM users WHERE email = $1", [email]);

    if (result.rows.length === 0 || !result.rows[0].mfa_code) {
      return res.status(400).json({ success: false, message: "No MFA code found." });
    }

    const { mfa_code, mfa_expires_at } = result.rows[0];

    if (new Date(mfa_expires_at) < new Date()) {
      await sendMfaCode(email);
      return res.status(400).json({ success: false, message: "MFA code expired. A new one has been sent." });
    }

    const isMatch = await bcrypt.compare(code, mfa_code);

    if (!isMatch) {
      await sendMfaCode(email);
      return res.status(401).json({ success: false, message: "Incorrect MFA code. A new one has been sent." });
    }

    await pool.query("UPDATE users SET mfa_code = NULL, mfa_expires_at = NULL WHERE email = $1", [email]);
    res.json({ success: true, message: "MFA verified! Access granted." });
  });

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
});
