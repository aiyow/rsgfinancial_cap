import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import pool from "../config/db.js";

async function initializeDatabase() {
  try {
    const schemaUrl = new URL("../database/schema.sql", import.meta.url);
    const schema = await readFile(schemaUrl, "utf8");
    await pool.query(schema);

    const migrationsUrl = new URL("../database/migrations/", import.meta.url);
    const migrations = (await readdir(migrationsUrl))
      .filter((fileName) => /^\d{3}_.+\.sql$/.test(fileName))
      .sort();

    for (const migration of migrations) {
      const sql = await readFile(new URL(migration, migrationsUrl), "utf8");
      await pool.query(sql);
      console.log(`Applied migration: ${migration}`);
    }

    console.log("Database schema and migrations initialized successfully.");
  } catch (error) {
    console.error("Database initialization failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

initializeDatabase();
