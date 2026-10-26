import express from "express";
import { hashPassword, verifyPassword } from "../services/passwordHash.js";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { writeAuditLog } from "../services/auditLog.js";

import { newPasswordSchema } from "../services/passwordValidation.js";
import { accountActionEligibility, openAccountAssignments, ASSIGNMENT_BLOCK, BALANCE_BLOCK } from "../services/accountActionEligibility.js";

const router = express.Router();
const roleSchema = z.enum(["ADMIN", "COLLECTOR", "RESIDENT"]);
const userColumns = `id, full_name AS "fullName", email, role,
  is_active AS "isActive", approval_status AS "approvalStatus", email_verified AS "emailVerified",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const createUserSchema = z.object({
  fullName: z.string().trim().min(1).max(205),
  email: z.string().trim().toLowerCase().email().max(255),
  password: newPasswordSchema,
  role: roleSchema,
  isActive: z.boolean().optional().default(true),
}).strict();

const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(205).optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  password: newPasswordSchema.optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  approvalStatus: z.enum(["PENDING", "APPROVED"]).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: "At least one field must be provided.",
});
const deleteUserSchema = z.object({
  currentPassword: z.string().min(8).max(256).optional(),
}).strict();

router.use(requireAuth, allowRoles("ADMIN"));

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT ${userColumns} FROM users ORDER BY id`);
    return res.json({ users: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/action-eligibility", requireId, async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT ${userColumns} FROM users WHERE id=$1`, [req.resourceId]);
    if (!result.rows[0]) return res.status(404).json({ message: "User not found." });
    res.set('Cache-Control', 'no-store');
    return res.json(await accountActionEligibility(pool, result.rows[0], req.user.id));
  } catch (error) { return next(error); }
});

router.get("/:id", requireId, async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT ${userColumns} FROM users WHERE id = $1`, [req.resourceId]);
    if (!result.rows[0]) return res.status(404).json({ message: "User not found." });
    return res.json({ user: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post("/", validateBody(createUserSchema), async (req, res, next) => {
  let client;
  try {
    const { fullName, email, password, role, isActive } = req.validatedBody;
    const passwordHash = await hashPassword(password);
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active, approval_status, email_verified)
       VALUES ($1, $2, $3, $4, $5, 'APPROVED', TRUE)
       RETURNING ${userColumns}`,
      [fullName, email, passwordHash, role, isActive]
    );
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "USER_ACCOUNT",
      entityId: result.rows[0].id,
      action: "CREATE",
      newValues: result.rows[0],
    });
    await client.query("COMMIT");
    return res.status(201).json({ message: "User created.", user: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

router.patch("/:id", requireId, validateBody(updateUserSchema), async (req, res, next) => {
  let client;
  try {
    const body = req.validatedBody;
    client = await pool.connect();
    await client.query("BEGIN");
    const beforeResult = await client.query(`SELECT ${userColumns} FROM users WHERE id = $1 FOR NO KEY UPDATE`, [req.resourceId]);
    if (!beforeResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found." });
    }

    if (req.resourceId === Number(req.user.id)
      && (body.isActive === false || (body.role && body.role !== "ADMIN"))) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "You cannot deactivate your own account or remove your own Admin role.",
      });
    }

    if (body.role && body.role !== "RESIDENT") {
      const assignment = await client.query(
        "SELECT 1 FROM unit_assignments WHERE user_id = $1 LIMIT 1",
        [req.resourceId]
      );
      if (assignment.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "A user with assignment history must remain a Resident.",
        });
      }
    }

    if (body.isActive === false && beforeResult.rows[0].isActive && beforeResult.rows[0].role === 'RESIDENT') {
      const eligibility = await accountActionEligibility(client, beforeResult.rows[0], req.user.id, { refreshPenalties: true });
      if (!eligibility.canDeactivate) {
        await client.query("ROLLBACK");
        return res.status(409).json({ code: 'UNPAID_PUBLISHED_SOA', message: BALANCE_BLOCK, ...eligibility });
      }
    }

    const values = [];
    const updates = [];
    const columnMap = {
      fullName: "full_name",
      email: "email",
      role: "role",
      isActive: "is_active",
      approvalStatus: "approval_status",
    };

    for (const [field, column] of Object.entries(columnMap)) {
      if (body[field] !== undefined) {
        values.push(body[field]);
        updates.push(`${column} = $${values.length}`);
      }
    }

    if (body.password !== undefined) {
      values.push(await hashPassword(body.password));
      updates.push(`password_hash = $${values.length}`);
    }

    values.push(req.resourceId);
    const result = await client.query(
      `UPDATE users SET ${updates.join(", ")}
       WHERE id = $${values.length}
       RETURNING ${userColumns}`,
      values
    );
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "USER_ACCOUNT",
      entityId: req.resourceId,
      action: "UPDATE",
      oldValues: beforeResult.rows[0],
      newValues: { ...result.rows[0], ...(body.password !== undefined ? { credentialChanged: true } : {}) },
    });
    await client.query("COMMIT");
    return res.json({ message: "User updated.", user: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

router.delete("/:id", requireId, validateBody(deleteUserSchema), async (req, res, next) => {
  let client;
  try {
    if (req.resourceId === Number(req.user.id)) {
      return res.status(403).json({ message: "You cannot delete your own account." });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    const existingUser = await client.query(
      "SELECT id, role FROM users WHERE id = $1 FOR UPDATE",
      [req.resourceId]
    );
    if (!existingUser.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found." });
    }

    const activeAssignments = await openAccountAssignments(client, req.resourceId);
    if (activeAssignments.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ code: 'USER_ASSIGNED_TO_UNIT', message: ASSIGNMENT_BLOCK, activeAssignments });
    }

    if (["ADMIN", "COLLECTOR"].includes(existingUser.rows[0].role)) {
      if (!req.validatedBody.currentPassword) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Enter your current password to delete an Admin or Billing Associate account." });
      }
      const actor = await client.query("SELECT password_hash AS \"passwordHash\" FROM users WHERE id = $1", [req.user.id]);
      const passwordMatches = actor.rows[0] && await verifyPassword(req.validatedBody.currentPassword, actor.rows[0].passwordHash);
      if (!passwordMatches) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Your current password is incorrect. The account was not deleted." });
      }
    }

    // Reports submitted by this account must be removed before its RESTRICT FK.
    // Keep this in the same transaction so any failure restores reports and user.
    const removedBillingErrorReports = await client.query(
      "DELETE FROM billing_error_reports WHERE reported_by = $1 RETURNING to_jsonb(billing_error_reports) AS snapshot",
      [req.resourceId]
    );
    const removedAssignments = await client.query(
      "DELETE FROM unit_assignments WHERE user_id = $1 RETURNING to_jsonb(unit_assignments) AS snapshot",
      [req.resourceId]
    );

    const result = await client.query(
      `DELETE FROM users WHERE id = $1 RETURNING ${userColumns}`,
      [req.resourceId]
    );

    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "USER_ACCOUNT",
      entityId: req.resourceId,
      action: "DELETE",
      oldValues: { ...result.rows[0], removedAssignments: removedAssignments.rowCount, removedBillingErrorReports: removedBillingErrorReports.rowCount },
      context: { affectedRecords: [
        ...removedAssignments.rows.map(({ snapshot: row }) => ({ entityName: 'UNIT_ASSIGNMENT', entityId: row.id, unitId: row.unit_id, before: { relationshipType: row.relationship_type, startDate: row.start_date, endDate: row.end_date }, after: null })),
        ...removedBillingErrorReports.rows.map(({ snapshot: row }) => ({ entityName: 'BILLING_ERROR_REPORT', entityId: row.id, billId: row.unit_bill_id, before: { category: row.category, description: row.description, status: row.status }, after: null })),
      ] },
    });

    await client.query("COMMIT");
    return res.json({
      message: "User permanently deleted.",
      user: result.rows[0],
      removedAssignments: removedAssignments.rowCount,
      removedBillingErrorReports: removedBillingErrorReports.rowCount,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

export default router;
