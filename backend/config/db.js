import pg from "pg";
import dotenv from "dotenv";

// Always load the backend environment file, regardless of the directory from
// which `node backend/server.js` (or an npm script) is started.
dotenv.config({ path: new URL("../.env", import.meta.url) });

const { Pool, types } = pg;

// PostgreSQL DATE values have no timezone. Keep them as YYYY-MM-DD strings so
// Manila's UTC offset cannot shift May 1 back to April 30 in API responses.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
});

pool.on("connect", () => {
  console.log("Connected to the database");
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

export default pool;
