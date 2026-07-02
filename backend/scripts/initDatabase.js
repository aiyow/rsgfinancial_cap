import "dotenv/config";
import { readFile } from "node:fs/promises";
import pool from "../config/db.js";

async function initializeDatabase() {
  try {
    const schemaUrl = new URL("../database/schema.sql", import.meta.url);
    const schema = await readFile(schemaUrl, "utf8");

    await pool.query(schema);
    console.log("Database schema initialized successfully.");
  } catch (error) {
    console.error("Database initialization failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

initializeDatabase();
