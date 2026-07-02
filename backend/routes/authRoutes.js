import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();
const ALLOWED_ROLES = new Set(["ADMIN", "COLLECTOR", "UNIT_OWNER"]);

function serializeUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    isActive: user.is_active,
    createdAt: user.created_at,
  };
}

// DEMO ONLY: public registration is enabled for all three roles.
router.post("/register", async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;
    
    //error if required fields are missing
    if (!fullName || !email || !password || !role) {
      return res.status(400).json({
        message: "Full name, email, password, and role are required.",
      });
    }

    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ message: "Please select a valid role." });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters.",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();

    if (!cleanName) {
      return res.status(400).json({ message: "Full name is required." });
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
      [cleanEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: "Email is already registered.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const newUser = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email, role, is_active, created_at`,
      [cleanName, cleanEmail, passwordHash, role]
    );

    return res.status(201).json({
      message: `${role.replace("_", " ")} account created successfully.`,
      user: serializeUser(newUser.rows[0]),
    });
  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      message: "Something went wrong while creating the account.",
    });
  }
});

// PUBLIC: Login for all roles
router.post("/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        message: "Email, password, and role are required.",
      });
    }

    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ message: "Please select a valid role." });
    }

    const cleanEmail = email.trim().toLowerCase();

    const result = await pool.query(
      `SELECT id, full_name, email, password_hash, role, is_active
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid email, password, or role.",
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        message: "This account has been deactivated.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches || user.role !== role) {
      return res.status(401).json({
        message: "Invalid email, password, or role.",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h",
      }
    );

    return res.status(200).json({
      message: "Login successful.",
      token,
      user: serializeUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Something went wrong while logging in.",
    });
  }
});

// PRIVATE: Check currently logged-in user
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, role, is_active, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.json({ user: serializeUser(result.rows[0]) });
  } catch (error) {
    console.error("Get current user error:", error);

    return res.status(500).json({
      message: "Could not retrieve user information.",
    });
  }
});

export default router;
