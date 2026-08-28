import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import {
  createVerificationToken,
  hashVerificationToken,
  sendVerificationEmail,
  verificationExpiryDate,
} from "../services/emailVerification.js";

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
const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
}).strict();
const RESEND_COOLDOWN_MS = 15 * 60 * 1000;

const userColumns = `
  id,
  full_name AS "fullName",
  email,
  role,
  is_active AS "isActive",
  email_verified AS "emailVerified",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

function tokenFromQuery(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null;
}

async function deliverVerificationEmail({ user, token }) {
  await sendVerificationEmail({ fullName: user.fullName, email: user.email, token });
  await pool.query(
    `UPDATE users SET email_verification_last_sent_at = NOW()
     WHERE id = $1 AND email_verification_token_hash = $2`,
    [user.id, hashVerificationToken(token)],
  );
}

// Development helper: public registration is intentionally enabled for all roles.
router.post("/register", validateBody(registerSchema), async (req, res, next) => {
  try {
    const { fullName, email, password, role } = req.validatedBody;
    const passwordHash = await bcrypt.hash(password, 12);
    const token = createVerificationToken();
    const result = await pool.query(
      `INSERT INTO users (
        full_name, email, password_hash, role, email_verified,
        email_verification_token_hash, email_verification_expires_at
       ) VALUES ($1, $2, $3, $4, FALSE, $5, $6)
       RETURNING ${userColumns}`,
      [fullName, email, passwordHash, role, hashVerificationToken(token), verificationExpiryDate()]
    );
    const user = result.rows[0];

    try {
      await deliverVerificationEmail({ user, token });
    } catch (error) {
      if (error?.code === "EMAIL_NOT_CONFIGURED") {
        return res.status(503).json({
          code: "EMAIL_DELIVERY_UNAVAILABLE",
          message: "Account created, but email delivery is not configured. Configure SMTP, then request a new verification email from the sign-in page.",
          email: user.email,
        });
      }
      return next(error);
    }

    return res.status(201).json({
      message: "Account created. Check your email to verify it before signing in.",
      user,
    });
  } catch (error) {
    return next(error);
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

    if (!user.emailVerified) {
      return res.status(403).json({
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify your email address before signing in.",
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

router.get("/verify-email", async (req, res, next) => {
  const token = tokenFromQuery(req.query.token);
  if (!token) return res.status(400).json({ message: "This verification link is invalid or incomplete." });

  try {
    const result = await pool.query(
      `UPDATE users
       SET email_verified = TRUE,
           email_verification_token_hash = NULL,
           email_verification_expires_at = NULL
       WHERE email_verified = FALSE
         AND email_verification_token_hash = $1
         AND email_verification_expires_at > NOW()
       RETURNING id`,
      [hashVerificationToken(token)],
    );
    if (!result.rows[0]) return res.status(400).json({ message: "This verification link is invalid, expired, or has already been used." });
    return res.json({ message: "Your email has been verified. You can now sign in." });
  } catch (error) { return next(error); }
});

router.post("/resend-verification", validateBody(resendVerificationSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, full_name AS "fullName", email,
        email_verified AS "emailVerified", email_verification_last_sent_at AS "lastSentAt"
       FROM users WHERE LOWER(email) = LOWER($1) FOR UPDATE`,
      [req.validatedBody.email],
    );
    const user = result.rows[0];
    if (!user || user.emailVerified) {
      await client.query("COMMIT");
      return res.json({ message: "If this account needs verification, a new email will be sent shortly." });
    }

    const elapsed = user.lastSentAt ? Date.now() - new Date(user.lastSentAt).getTime() : Infinity;
    if (elapsed < RESEND_COOLDOWN_MS) {
      await client.query("ROLLBACK");
      const retryAfterSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({ message: "Please wait before requesting another verification email.", retryAfterSeconds });
    }

    const token = createVerificationToken();
    const tokenHash = hashVerificationToken(token);
    await client.query(
      `UPDATE users
       SET email_verification_token_hash = $2,
           email_verification_expires_at = $3,
           email_verification_last_sent_at = NOW()
       WHERE id = $1`,
      [user.id, tokenHash, verificationExpiryDate()],
    );
    await client.query("COMMIT");

    try {
      await sendVerificationEmail({ fullName: user.fullName, email: user.email, token });
    } catch (error) {
      await pool.query(
        `UPDATE users SET email_verification_last_sent_at = NULL
         WHERE id = $1 AND email_verification_token_hash = $2`,
        [user.id, tokenHash],
      );
      if (error?.code === "EMAIL_NOT_CONFIGURED") {
        return res.status(503).json({ message: "Email delivery is not configured. Ask an administrator to configure SMTP first." });
      }
      return next(error);
    }
    return res.json({ message: "If this account needs verification, a new email will be sent shortly." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
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
