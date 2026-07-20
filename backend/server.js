import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import unitRoutes from "./routes/unitRoutes.js";
import unitAssignmentRoutes from "./routes/unitAssignmentRoutes.js";
import billingPeriodRoutes from "./routes/billingPeriodRoutes.js";
import billRoutes from "./routes/billRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import auditLogRoutes from "./routes/auditLogRoutes.js";
import analyticsImportRoutes from "./routes/analyticsImportRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import prescriptiveRecommendationRoutes from "./routes/prescriptiveRecommendationRoutes.js";
import soaTemplateRoutes from "./routes/soaTemplateRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import errorHandler from "./middleware/errorHandler.js";

dotenv.config({ path: new URL("./.env", import.meta.url) });

const app = express();

const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed by CORS"));
    },
  })
);
app.use(express.json());

// Testing backend if running try entering http://localhost:5000/ in the browser or Postman
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Backend API is running",
    healthCheck: "/api/health",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/units", unitRoutes);
app.use("/api/unit-assignments", unitAssignmentRoutes);
app.use("/api/billing-periods", billingPeriodRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/analytics/imports", analyticsImportRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/prescriptive-recommendations", prescriptiveRecommendationRoutes);
app.use("/api/soa-template", soaTemplateRoutes);
app.use("/api/dashboard", dashboardRoutes);

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

app.use(errorHandler);

const port = Number(process.env.PORT) || 5000;

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
