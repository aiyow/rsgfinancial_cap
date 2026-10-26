import express from "express";
import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../services/passwordHash.js";
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
  createPasswordResetOtp,
  createPasswordResetToken,
  hashPasswordResetToken,
  hashPasswordResetOtp,
  passwordResetOtpMatches,
  PASSWORD_RESET_MAX_ATTEMPTS,
  PASSWORD_RESET_COOLDOWN_SECONDS,
  userIdentityOrderSql,
  passwordResetExpiryDate,
  sendPasswordResetEmail,
} from "../services/passwordReset.js";
import { normalizeEmailIdentity } from "../services/emailIdentity.js";

import { newPasswordSchema } from "../services/passwordValidation.js";

import registrationRoutes from './registrationRoutes.js';
import { consumeRegistrationGrant, registrationQuota } from '../services/registrationVerification.js';

const router = express.Router();
router.use(registrationRoutes);
const passwordSchema = newPasswordSchema;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

const registrationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Verify your email before creating an account.');
const registrationAccountSchema = z.object({
  fullName: z.string().trim().min(1).max(205),
  email: z.string().trim().toLowerCase().email().max(255),
  password: passwordSchema,
  registrationToken: registrationTokenSchema,
}).strict();
const registrationNameSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  middleInitial: z.string().refine(value => value === '' || (/^[A-Za-z]{1,2}\.?$/.test(value) && value === value.trim()),
    'MI must be 1–2 letters with an optional period at the end.').optional().default(''),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: passwordSchema,
  registrationToken: registrationTokenSchema,
}).strict().transform(({ firstName, middleInitial, lastName, email, password, registrationToken }) => ({
  fullName: [firstName, middleInitial, lastName].filter(Boolean).join(' '), email, password, registrationToken,
}));
// Assemble structured names on the server. Existing clients may still send fullName.
const registerSchema = z.union([registrationNameSchema, registrationAccountSchema]).pipe(registrationAccountSchema);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(256),
}).strict();
const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
}).strict();
const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
}).strict();
const verifyPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  challengeId: z.uuid(),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code from your email."),
}).strict();
const resetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  resetToken: z.string().min(40).max(128),
  password: passwordSchema,
}).strict();
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
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
  res.set('Cache-Control','no-store');
  let client;
  try {
    const { fullName, password, registrationToken } = req.validatedBody;
    const email = normalizeEmailIdentity(req.validatedBody.email);
    await registrationQuota(pool,'complete-ip',req.ip,10,3600);
    client = await pool.connect();
    await client.query('BEGIN');
    await consumeRegistrationGrant(client,email,registrationToken);
    const existing = await client.query('SELECT 1 FROM users WHERE LOWER(BTRIM(email))=$1 LIMIT 1',[email]);
    if(existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message:'This email is already registered. Sign in or reset your password.' });
    }
    const passwordHash = await hashPassword(password);
    const result = await client.query(`INSERT INTO users(full_name,email,password_hash,role,approval_status,email_verified)
      VALUES($1,$2,$3,'RESIDENT','PENDING',TRUE) RETURNING ${userColumns}`,[fullName,email,passwordHash]);
    const user = result.rows[0];
    const admins = await client.query("SELECT id FROM users WHERE role='ADMIN' AND is_active=TRUE");
    await createUserNotifications(client,admins.rows.map(admin=>({
      recipientUserId:admin.id,type:'ACCOUNT_APPROVAL',title:'New resident awaiting approval',
      message:`${user.fullName} (${user.email}) verified their email and requested a resident account. Review their resident details before approval.`,
      href:'/admin/users',dedupeKey:`account-approval:${user.id}`,
    })));
    await writeAuditLog({ client, actorUserId: user.id, entityName: 'USER_ACCOUNT', entityId: user.id, action: 'REGISTER', newValues: user });
    await client.query('COMMIT');
    return res.status(201).json({ message:'Account created. Wait for Admin approval before signing in.',user });
  } catch(error) {
    if(client)await client.query('ROLLBACK').catch(()=>{});
    if(error.retryAfterSeconds) res.set('Retry-After',String(error.retryAfterSeconds));
    return next(error);
  } finally { client?.release(); }
});

router.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;
    const result = await pool.query(
      `SELECT ${userColumns}, auth_version AS "authVersion", password_hash AS "passwordHash"
       FROM users
       WHERE LOWER(BTRIM(email)) = $1
       ORDER BY ${userIdentityOrderSql} LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    const passwordMatches = user
      ? await verifyPassword(password, user.passwordHash)
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
        message: "Your account is awaiting Admin approval. You can sign in after approval.",
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
  const sentMessage = "A six-digit code was sent to your registered email. Check your inbox and spam folder.";
  res.set("Cache-Control", "no-store");
  let client;
  try {
    const { email } = req.validatedBody;
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, full_name AS "fullName", email, password_reset_last_sent_at AS "lastSentAt",
         is_active AS "isActive", approval_status AS "approvalStatus", email_verified AS "emailVerified"
       FROM users
       WHERE LOWER(BTRIM(email)) = $1
       ORDER BY ${userIdentityOrderSql} LIMIT 1 FOR UPDATE`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      await client.query("COMMIT");
      return res.status(404).json({ code: "EMAIL_NOT_REGISTERED", message: "This email address is not registered. Check your email address and try again." });
    }
    if (!user.isActive) {
      await client.query("COMMIT");
      return res.status(403).json({ code: "ACCOUNT_INACTIVE", message: "This account is inactive. Contact an administrator for help." });
    }
    if (user.approvalStatus !== "APPROVED") {
      await client.query("COMMIT");
      return res.status(403).json({ code: "ACCOUNT_APPROVAL_REQUIRED", message: "Your account is awaiting Admin approval. Contact an administrator for help." });
    }
    const challengeId = randomUUID();
    const response = { message: sentMessage, challengeId, retryAfterSeconds: PASSWORD_RESET_COOLDOWN_SECONDS };

    // Read after acquiring the user lock so concurrent sends see the newest code.
    const existingChallenge = (await client.query("SELECT id FROM password_reset_challenges WHERE user_id = $1", [user.id])).rows[0];
    const lastSentAt = user.lastSentAt ? new Date(user.lastSentAt).getTime() : 0;
    if (existingChallenge && Date.now() - lastSentAt < PASSWORD_RESET_COOLDOWN_SECONDS * 1000) {
      await client.query("COMMIT");
      return res.json({ ...response, message: "A code was already sent. Use that code or wait before requesting another.", challengeId: existingChallenge.id });
    }

    const otp = createPasswordResetOtp();
    await client.query(
      `INSERT INTO password_reset_challenges (id, user_id, otp_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET id = EXCLUDED.id, otp_hash = EXCLUDED.otp_hash,
         expires_at = EXCLUDED.expires_at, attempts = 0`,
      [challengeId, user.id, hashPasswordResetOtp(challengeId, otp), passwordResetExpiryDate()]
    );
    await client.query(
      `UPDATE users
       SET password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           password_reset_last_sent_at = NOW()
       WHERE id = $1`,
      [user.id]
    );
    try {
      await sendPasswordResetEmail({ fullName: user.fullName, email: user.email, otp });
    } catch (error) {
      console.error("Unable to send password reset email:", error.message);
      const unavailable = new Error("We could not send the code. Please try again shortly or contact an administrator.");
      unavailable.status = 503;
      throw unavailable;
    }
    await client.query("COMMIT");
    return res.json(response);
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

router.post("/verify-password-reset-otp", validateBody(verifyPasswordResetSchema), async (req, res, next) => {
  let client;
  try {
    const { email, challengeId, otp } = req.validatedBody;
    client = await pool.connect();
    await client.query("BEGIN");
    const userResult = await client.query(
      `SELECT id
       FROM users
       WHERE LOWER(BTRIM(email)) = $1
         AND is_active = TRUE
         AND approval_status = 'APPROVED'
       ORDER BY ${userIdentityOrderSql} LIMIT 1 FOR UPDATE`,
      [email]
    );
    const user = userResult.rows[0];
    const challengeResult = user ? await client.query(
      `SELECT otp_hash AS "otpHash", attempts, expires_at > NOW() AS "isValid"
       FROM password_reset_challenges WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [challengeId, user.id]
    ) : { rows: [] };
    const challenge = challengeResult.rows[0];
    if (!challenge || !challenge.isValid) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "This code is invalid or has expired. Request a new code to continue." });
    }
    if (challenge.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      await client.query("ROLLBACK");
      return res.status(429).json({ message: "Too many incorrect attempts. Request a new code to continue." });
    }
    if (!passwordResetOtpMatches(challengeId, otp, challenge.otpHash)) {
      // Commit failed attempts so repeated requests cannot reset the limit.
      await client.query("UPDATE password_reset_challenges SET attempts = attempts + 1 WHERE id = $1", [challengeId]);
      await client.query("COMMIT");
      const remaining = PASSWORD_RESET_MAX_ATTEMPTS - challenge.attempts - 1;
      return res.status(remaining ? 400 : 429).json({ message: remaining
        ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : "Too many incorrect attempts. Request a new code to continue." });
    }

    const resetToken = createPasswordResetToken();
    await client.query(
      `UPDATE users SET password_reset_token_hash = $1, password_reset_expires_at = $2 WHERE id = $3`,
      [hashPasswordResetToken(resetToken), passwordResetExpiryDate(), user.id]
    );
    await client.query("DELETE FROM password_reset_challenges WHERE user_id = $1", [user.id]);
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store");
    return res.json({ message: "Code verified.", resetToken });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

router.post("/reset-password", validateBody(resetPasswordSchema), async (req, res, next) => {
  let client;
  try {
    const { email, resetToken, password } = req.validatedBody;
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, password_reset_token_hash AS "resetHash",
         password_reset_expires_at > NOW() AS "isValid"
       FROM users WHERE LOWER(BTRIM(email)) = $1 AND is_active = TRUE
         AND approval_status = 'APPROVED'
       ORDER BY ${userIdentityOrderSql} LIMIT 1 FOR UPDATE`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.isValid || user.resetHash !== hashPasswordResetToken(resetToken)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ code: "PASSWORD_RESET_VERIFICATION_EXPIRED", message: "Verification expired. Request a new code." });
    }
    const passwordHash = await hashPassword(password);
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
    await client.query("DELETE FROM password_reset_challenges WHERE user_id = $1", [user.id]);
    await writeAuditLog({
      client,
      actorUserId: user.id,
      entityName: "USER_ACCOUNT",
      entityId: user.id,
      action: "PASSWORD_RESET",
      newValues: { sessionsInvalidated: true },
      remarks: "Password reset with a single-use email code.",
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

router.post("/change-password", requireAuth, allowRoles("ADMIN", "COLLECTOR", "RESIDENT"), validateBody(changePasswordSchema), async (req, res, next) => {
  let client;
  try {
    const { currentPassword, newPassword } = req.validatedBody;
    client = await pool.connect();
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT password_hash AS "passwordHash"
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [req.user.id]
    );
    const user = userResult.rows[0];
    const passwordMatches = user && await verifyPassword(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Your current password is incorrect." });
    }

    const passwordHash = await hashPassword(newPassword);
    const updateResult = await client.query(
      `UPDATE users
       SET password_hash = $1,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           auth_version = auth_version + 1
       WHERE id = $2
       RETURNING auth_version AS "authVersion"`,
      [passwordHash, req.user.id]
    );
    await client.query('DELETE FROM password_reset_challenges WHERE user_id=$1', [req.user.id]);
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "USER_ACCOUNT",
      entityId: req.user.id,
      action: "PASSWORD_CHANGE",
      remarks: "Account owner changed their own password.",
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
      return res.json({ message: user.approvalStatus === "APPROVED" ? "This account is approved. You can sign in." : "Your email is verified. Wait for Admin approval before signing in." });
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
    return res.json({ message: "Verification email sent. Open its link to verify your email. Admin approval is still required." });
  } catch (error) {
    if (error.code === "EMAIL_NOT_CONFIGURED") error.status = 503;
    return next(error);
  }
});

router.get("/verify-email", async (req, res, next) => {
  let client;
  try {
    const token = String(req.query.token || "").trim();
    if (!token || token.length > 512) {
      return res.status(400).json({ message: "A valid verification link is required." });
    }

    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE users
       SET email_verified = TRUE,
           email_verification_token_hash = NULL,
           email_verification_expires_at = NULL
       WHERE email_verification_token_hash = $1
         AND email_verification_expires_at > NOW()
       RETURNING ${userColumns}`,
      [hashVerificationToken(token)]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "This verification link is invalid or has expired. Request a new link to continue." });
    }
    await writeAuditLog({ client, actorUserId: result.rows[0].id, entityName: "USER_ACCOUNT", entityId: result.rows[0].id, action: "VERIFY_EMAIL", oldValues: { emailVerified: false }, newValues: { emailVerified: true, fullName: result.rows[0].fullName } });
    await client.query("COMMIT");
    return res.json({
      message: "Email verified. Admin approval is still required before signing in.",
      user: result.rows[0],
    });
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
