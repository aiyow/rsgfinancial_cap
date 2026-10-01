import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { createUserNotifications } from "../services/notifications.js";
import { writeAuditLog } from "../services/auditLog.js";
import {
  createVerificationToken,
  hashVerificationToken,
  sendVerificationEmail,
  verificationExpiryDate,
} from "../services/emailVerification.js";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  passwordResetExpiryDate,
  sendPasswordResetEmail,
} from "../services/passwordReset.js";

const router = express.Router();
const roleSchema = z.enum(["ADMIN", "COLLECTOR", "RESIDENT"]);
const passwordSchema = z.string().min(8).max(72);
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;

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
const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
}).strict();
const resetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(512),
  password: passwordSchema,
}).strict();
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordSchema,
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
    const verificationToken = createVerificationToken();
    const verificationExpiry = verificationExpiryDate();
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO users (
        full_name, email, password_hash, role, approval_status, email_verified,
        email_verification_token_hash, email_verification_expires_at, email_verification_last_sent_at
       ) VALUES ($1, $2, $3, $4, 'PENDING', FALSE, $5, $6, NOW())
       RETURNING ${userColumns}`,
      [fullName, email, passwordHash, role, hashVerificationToken(verificationToken), verificationExpiry]
    );
    const user = result.rows[0];
    const admins = await client.query("SELECT id FROM users WHERE role = 'ADMIN' AND is_active = TRUE");
    await createUserNotifications(client, admins.rows.map((admin) => ({
      recipientUserId: admin.id,
      type: "ACCOUNT_APPROVAL",
      title: "New account awaiting activation",
      message: `${user.fullName} (${user.email}) requested a ${user.role.toLowerCase()} account. They can activate it by email, or you can approve it.`,
      href: "/admin/users",
      dedupeKey: `account-approval:${user.id}`,
    })));
    await client.query("COMMIT");

    let verificationEmailSent = true;
    try {
      await sendVerificationEmail({ fullName: user.fullName, email: user.email, token: verificationToken });
    } catch (error) {
      verificationEmailSent = false;
      console.error("Unable to send account verification email:", error.message);
    }

    return res.status(201).json({
      message: verificationEmailSent
        ? "Account created. Verify your email or wait for an administrator to approve your account."
        : "Account created. Email delivery is unavailable, so an administrator can approve your account.",
      verificationEmailSent,
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
      `SELECT ${userColumns}, auth_version AS "authVersion", password_hash AS "passwordHash"
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

    if (user.approvalStatus !== "APPROVED" && !user.emailVerified) {
      return res.status(403).json({
        code: "ACCOUNT_APPROVAL_REQUIRED",
        message: "Verify your email or wait for administrator approval before signing in.",
        email: user.email,
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const token = jwt.sign({ id: user.id, authVersion: user.authVersion }, process.env.JWT_SECRET, { expiresIn: "8h" });
    delete user.passwordHash;
    delete user.authVersion;

    return res.json({ message: "Login successful.", token, user });
  } catch (error) {
    return next(error);
  }
});

router.post("/forgot-password", validateBody(forgotPasswordSchema), async (req, res, next) => {
  const genericMessage = "If an eligible account exists for that email, a password-reset link has been sent.";
  try {
    const { email } = req.validatedBody;
    const result = await pool.query(
      `SELECT id, full_name AS "fullName", email, password_reset_last_sent_at AS "lastSentAt"
       FROM users
       WHERE LOWER(email) = LOWER($1)
         AND is_active = TRUE
         AND (approval_status = 'APPROVED' OR email_verified = TRUE)`,
      [email]
    );
    const user = result.rows[0];
    if (!user) return res.json({ message: genericMessage });

    const lastSentAt = user.lastSentAt ? new Date(user.lastSentAt).getTime() : 0;
    if (PASSWORD_RESET_RESEND_COOLDOWN_MS - (Date.now() - lastSentAt) > 0) {
      return res.json({ message: genericMessage });
    }

    const token = createPasswordResetToken();
    await pool.query(
      `UPDATE users
       SET password_reset_token_hash = $1,
           password_reset_expires_at = $2,
           password_reset_last_sent_at = NOW()
       WHERE id = $3`,
      [hashPasswordResetToken(token), passwordResetExpiryDate(), user.id]
    );
    try {
      await sendPasswordResetEmail({ fullName: user.fullName, email: user.email, token });
    } catch (error) {
      console.error("Unable to send password reset email:", error.message);
      const unavailable = new Error("Password reset emails are unavailable right now. Please contact an administrator.");
      unavailable.status = 503;
      return next(unavailable);
    }
    return res.json({ message: genericMessage });
  } catch (error) {
    return next(error);
  }
});

router.post("/reset-password", validateBody(resetPasswordSchema), async (req, res, next) => {
  let client;
  try {
    const { token, password } = req.validatedBody;
    client = await pool.connect();
    await client.query("BEGIN");
    const userResult = await client.query(
      `SELECT id
       FROM users
       WHERE password_reset_token_hash = $1
         AND password_reset_expires_at > NOW()
         AND is_active = TRUE
         AND (approval_status = 'APPROVED' OR email_verified = TRUE)
       FOR UPDATE`,
      [hashPasswordResetToken(token)]
    );
    const user = userResult.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "This password-reset link is invalid or has expired. Request a new link to continue." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `UPDATE users
       SET password_hash = $1,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           password_reset_last_sent_at = NULL,
           auth_version = auth_version + 1
       WHERE id = $2`,
      [passwordHash, user.id]
    );
    await writeAuditLog({
      client,
      actorUserId: user.id,
      entityName: "USER_ACCOUNT",
      entityId: user.id,
      action: "PASSWORD_RESET",
      newValues: { sessionsInvalidated: true },
      remarks: "Password reset through emailed link.",
    });
    await client.query("COMMIT");
    return res.json({ message: "Your password was changed. Sign in with your new password." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

router.post("/change-password", requireAuth, allowRoles("RESIDENT"), validateBody(changePasswordSchema), async (req, res, next) => {
  let client;
  try {
    const { currentPassword, newPassword } = req.validatedBody;
    client = await pool.connect();
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT password_hash AS "passwordHash"
       FROM users
       WHERE id = $1
         AND role = 'RESIDENT'
       FOR UPDATE`,
      [req.user.id]
    );
    const user = userResult.rows[0];
    const passwordMatches = user && await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Your current password is incorrect." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updateResult = await client.query(
      `UPDATE users
       SET password_hash = $1,
           auth_version = auth_version + 1
       WHERE id = $2
       RETURNING auth_version AS "authVersion"`,
      [passwordHash, req.user.id]
    );
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "USER_ACCOUNT",
      entityId: req.user.id,
      action: "PASSWORD_CHANGE",
      remarks: "Resident changed their own password.",
    });
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }
    const token = jwt.sign(
      { id: req.user.id, authVersion: updateResult.rows[0].authVersion },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    await client.query("COMMIT");
    return res.json({ message: "Your password has been changed.", token });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

router.post("/resend-verification", validateBody(resendVerificationSchema), async (req, res, next) => {
  try {
    const { email } = req.validatedBody;
    const result = await pool.query(
      `SELECT id, full_name AS "fullName", email, approval_status AS "approvalStatus",
              email_verified AS "emailVerified", email_verification_last_sent_at AS "lastSentAt"
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      return res.json({ message: "If an account exists for that email, a verification link will be sent." });
    }
    if (user.approvalStatus === "APPROVED" || user.emailVerified) {
      return res.json({ message: "This account is already active. You can sign in." });
    }

    const lastSentAt = user.lastSentAt ? new Date(user.lastSentAt).getTime() : 0;
    const remainingMs = VERIFICATION_RESEND_COOLDOWN_MS - (Date.now() - lastSentAt);
    if (remainingMs > 0) {
      return res.status(429).json({
        message: "A verification email was just sent.",
        retryAfterSeconds: Math.ceil(remainingMs / 1000),
      });
    }

    const token = createVerificationToken();
    await pool.query(
      `UPDATE users
       SET email_verification_token_hash = $1,
           email_verification_expires_at = $2,
           email_verification_last_sent_at = NOW()
       WHERE id = $3`,
      [hashVerificationToken(token), verificationExpiryDate(), user.id]
    );
    await sendVerificationEmail({ fullName: user.fullName, email: user.email, token });
    return res.json({ message: "Verification email sent. Open its link to activate your account." });
  } catch (error) {
    if (error.code === "EMAIL_NOT_CONFIGURED") error.status = 503;
    return next(error);
  }
});

router.get("/verify-email", async (req, res, next) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token || token.length > 512) {
      return res.status(400).json({ message: "A valid verification link is required." });
    }

    const result = await pool.query(
      `UPDATE users
       SET email_verified = TRUE,
           approval_status = 'APPROVED',
           email_verification_token_hash = NULL,
           email_verification_expires_at = NULL
       WHERE email_verification_token_hash = $1
         AND email_verification_expires_at > NOW()
       RETURNING ${userColumns}`,
      [hashVerificationToken(token)]
    );
    if (!result.rows[0]) {
      return res.status(400).json({ message: "This verification link is invalid or has expired. Request a new link to continue." });
    }
    return res.json({
      message: "Email verified. Your account is active and you can now sign in.",
      user: result.rows[0],
    });
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
