import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { createUserNotifications } from "../services/notifications.js";

const router = express.Router();
const roleSchema = z.enum(["ADMIN", "COLLECTOR", "RESIDENT"]);
const passwordSchema = z.string().min(8).max(72);

const registerSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  email: z.string().trim().toLowerCase().email().max(255),
  password: passwordSchema,
  role: roleSchema,
}).strict();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(72),
}).strict();
const userColumns = `
  id,
  full_name AS "fullName",
  email,
  role,
  is_active AS "isActive",
  approval_status AS "approvalStatus",
  email_verified AS "emailVerified",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

router.post("/register", validateBody(registerSchema), async (req, res, next) => {
  let client;
  try {
    const { fullName, email, password, role } = req.validatedBody;
    const passwordHash = await bcrypt.hash(password, 12);
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO users (
        full_name, email, password_hash, role, approval_status, email_verified
       ) VALUES ($1, $2, $3, $4, 'PENDING', TRUE)
       RETURNING ${userColumns}`,
      [fullName, email, passwordHash, role]
    );
    const user = result.rows[0];
    const admins = await client.query("SELECT id FROM users WHERE role = 'ADMIN' AND is_active = TRUE");
    await createUserNotifications(client, admins.rows.map((admin) => ({
      recipientUserId: admin.id,
      type: "ACCOUNT_APPROVAL",
      title: "New account awaiting approval",
      message: `${user.fullName} (${user.email}) requested a ${user.role.toLowerCase()} account.`,
      href: "/admin/users",
      dedupeKey: `account-approval:${user.id}`,
    })));
    await client.query("COMMIT");

    return res.status(201).json({
      message: "Account created. An administrator must approve it before you can sign in.",
      user,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

router.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;
    const result = await pool.query(
      `SELECT ${userColumns}, password_hash AS "passwordHash"
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    const user = result.rows[0];
    const passwordMatches = user
      ? await bcrypt.compare(password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: "This account has been deactivated." });
    }

    if (user.approvalStatus !== "APPROVED") {
      return res.status(403).json({
        code: "ACCOUNT_APPROVAL_REQUIRED",
        message: "Your account is waiting for administrator approval.",
        email: user.email,
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "8h" });
    delete user.passwordHash;

    return res.json({ message: "Login successful.", token, user });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ${userColumns}
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );
    return res.json({ user: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
