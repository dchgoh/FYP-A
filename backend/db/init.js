const { Client, Pool } = require('pg');
const bcrypt = require('bcrypt');
const { execSync } = require("child_process");
const { dbConfig, containerName } = require('../config/db'); // Import config
const ROLES = require('../config/roles');

// --- Docker Helper ---
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

// --- Database Creation ---
const createDatabase = async () => {
    let client;
    try {
        // Connect to the default 'postgres' db to create the target one
        const tempConfig = { ...dbConfig, database: "postgres" };
        client = new Client(tempConfig);
        await client.connect();
        const result = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${dbConfig.database}';`); // Use dbConfig.database
        if (result.rowCount === 0) {
            console.log(`Database '${dbConfig.database}' does not exist. Creating...`);
            await client.query(`CREATE DATABASE ${dbConfig.database};`);
            console.log("Database created successfully.");
        } else {
            console.log("Database already exists.");
        }
    } catch (error) {
        console.error("Error connecting to or creating database:", error);
        process.exit(1);
    } finally {
        if (client) await client.end();
    }
};

// --- Table Creation Functions ---
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
          role VARCHAR(50) CHECK (role IN ('${ROLES.ADMIN}', '${ROLES.DATA_MANAGER}', '${ROLES.REGULAR}')),
          failed_attempts INT DEFAULT 0,
          is_locked BOOLEAN DEFAULT FALSE,
          mfa_code TEXT,
          mfa_expires_at TIMESTAMP
        );
      `);

      console.log("Users table checked/created.");

      const result = await pool.query("SELECT COUNT(*) FROM users");
      if (parseInt(result.rows[0].count) === 0) {
        const hashedPassword = await bcrypt.hash("root", 10);
        // Insert default user
        await pool.query(
          "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
          ["Darren", "dchgoh@gmail.com", hashedPassword, 21, "Administrator"]
        );
        await pool.query(
          "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
          ["Ethan", "ethting@gmail.com", hashedPassword, 21, "Administrator"]
        );
        await pool.query(
          "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
          ["Hong Wei", "shwhongwei@gmail.com", hashedPassword, 21, "Administrator"]
        );
        await pool.query(
          "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
          ["Jordan", "jhzhaw@gmail.com", hashedPassword, 21, "Administrator"]
        );
        await pool.query(
          "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
          ["Brenda", "bdsimry@gmail.com", hashedPassword, 21, "Administrator"]
        );
        console.log("Default admin users created");
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
const createDivisionsTable = async () => {
let pool = null;
 try {
  pool = new Pool({ ...dbConfig, database: "uasuserdata" });
   await pool.query(`
     CREATE TABLE IF NOT EXISTS divisions (
       id SERIAL PRIMARY KEY,
       name VARCHAR(255) UNIQUE NOT NULL,
       description TEXT,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
     );
   `);
   console.log("Divisions table checked/created.");
 } catch (error) {
   console.error("Error creating divisions table:", error);
   throw error; // Propagate error
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
        division_id INTEGER NOT NULL,                
        name VARCHAR(255) NOT NULL,                  
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_division_project_name UNIQUE (division_id, name), 
        CONSTRAINT fk_division                          
          FOREIGN KEY(division_id)
          REFERENCES divisions(id)
          ON DELETE CASCADE                            
          ON UPDATE CASCADE
      );
    `);
    console.log("Projects table checked/created.");

    // Add index for faster lookups by division_id
     await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_division_id ON projects(division_id);
    `);
    console.log("Index on projects(division_id) checked/created.");

  } catch (error) {
    console.error("Error creating projects table:", error);
    throw error; // Propagate error
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
          project_id INTEGER,
          plot_name VARCHAR(255),
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION,
          status VARCHAR(50) DEFAULT 'uploaded',
          processing_error TEXT,
          processing_progress JSONB,
          tree_midpoints JSONB,
          tree_heights_adjusted JSONB,
          tree_dbhs_cm JSONB,
          tree_count INTEGER,
          -- tree_volumes_m3 JSONB, -- This will now store the "stem volume"
                                 -- Consider renaming to tree_stem_volumes_m3 for clarity
                                 -- If renaming, adjust Python output key or mapping layer
          tree_stem_volumes_m3 JSONB, -- Explicitly naming it stem volume
          assumed_d2_cm_for_volume DOUBLE PRECISION,
          -- New columns for additional metrics from your table:
          tree_above_ground_volumes_m3 JSONB,
          tree_total_volumes_m3 JSONB,
          tree_biomass_tonnes JSONB,
          tree_carbon_tonnes JSONB,
          tree_co2_equivalent_tonnes JSONB,
          CONSTRAINT fk_project
            FOREIGN KEY(project_id)
            REFERENCES projects(id)
            ON DELETE SET NULL
            ON UPDATE CASCADE
      );
    `);
    console.log("Uploaded_files table checked/updated with new biomass/carbon metrics columns.");

    // Index remains useful
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_uploaded_files_project_id ON uploaded_files(project_id);
    `);
    console.log("Index on uploaded_files(project_id) checked/created.");

  } catch (error) {
    console.error("Error creating/updating uploaded_files table:", error);
    throw error; // Propagate error
  } finally {
     if(pool) await pool.end();
  }
};

const createProjectDataManagersTable = async () => {
  let pool = null;
  try {
    pool = new Pool({ ...dbConfig, database: "uasuserdata" }); // Ensure "uasuserdata" is your correct database name
    await pool.query(`
        CREATE TABLE IF NOT EXISTS project_data_managers (
            user_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, project_id),
            CONSTRAINT fk_pdm_user_id  -- Using a more specific constraint name
                FOREIGN KEY(user_id)
                REFERENCES users(id)
                ON DELETE CASCADE,
            CONSTRAINT fk_pdm_project_id -- Using a more specific constraint name
                FOREIGN KEY(project_id)
                REFERENCES projects(id)
                ON DELETE CASCADE
        );
    `); // The SQL query is now correctly within backticks
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
    throw error; // It's good practice to re-throw the error so initDatabase can catch it and exit if critical
  } finally {
    if (pool) await pool.end();
  }
};

// --- Main Initialization Function ---
const initDatabase = async () => {
    startDockerContainer();
    console.log("Giving PostgreSQL time to initialize...");
    await new Promise(resolve => setTimeout(resolve, 7000));
    try {
        await createDatabase();
        await createUsersTable();
        await createDivisionsTable();
        await createProjectsTable();
        await createFilesTable();
        await createProjectDataManagersTable();
        console.log("Database initialization sequence complete.");
    } catch (initError) {
        console.error("FATAL: Database initialization failed.", initError);
        process.exit(1);
    }
};

module.exports = { initDatabase };