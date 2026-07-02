import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import roleTestRoutes from "./routes/roleTestRoutes.js";

dotenv.config({ path: new URL("./.env", import.meta.url) });

const app = express();

app.use(cors());
app.use(express.json());

// Testing backend if running try entering http://localhost:5000/ in the browser or Postman
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Backend API is running",
    healthCheck: "/api/health",
  });
});

// Use the authRoutes and roleTestRoutes for handling authentication and role-based routes
app.use("/api/auth", authRoutes);
app.use("/api/roles", roleTestRoutes);

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.status(200).json({
      message: "Server and database are working",
      databaseTime: result.rows[0].now,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Database connection failed",
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const port = Number(process.env.PORT) || 5000;

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
