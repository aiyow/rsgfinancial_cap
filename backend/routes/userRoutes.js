import express from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { writeAuditLog } from "../services/auditLog.js";

const router = express.Router();
const roleSchema = z.enum(["ADMIN", "COLLECTOR", "RESIDENT"]);
const userColumns = `id, full_name AS "fullName", email, role,
  is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`;

const createUserSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(72),
  role: roleSchema,
  isActive: z.boolean().optional().default(true),
}).strict();

const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(150).optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  password: z.string().min(8).max(72).optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: "At least one field must be provided.",
});

router.use(requireAuth, allowRoles("ADMIN"));

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT ${userColumns} FROM users ORDER BY id`);
    return res.json({ users: result.rows });
  } catch (error) {
    return next(error);
  }
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
  try {
    const { fullName, email, password, role, isActive } = req.validatedBody;
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${userColumns}`,
      [fullName, email, passwordHash, role, isActive]
    );
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "USER_ACCOUNT",
      entityId: result.rows[0].id,
      action: "CREATE",
      newValues: result.rows[0],
    });
    return res.status(201).json({ message: "User created.", user: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", requireId, validateBody(updateUserSchema), async (req, res, next) => {
  try {
    const body = req.validatedBody;
    const beforeResult = await pool.query(`SELECT ${userColumns} FROM users WHERE id = $1`, [req.resourceId]);
    if (!beforeResult.rows[0]) return res.status(404).json({ message: "User not found." });

    if (req.resourceId === Number(req.user.id)
      && (body.isActive === false || (body.role && body.role !== "ADMIN"))) {
      return res.status(403).json({
        message: "You cannot deactivate your own account or remove your own Admin role.",
      });
    }

    if (body.role && body.role !== "RESIDENT") {
      const assignment = await pool.query(
        "SELECT 1 FROM unit_assignments WHERE user_id = $1 LIMIT 1",
        [req.resourceId]
      );
      if (assignment.rows.length > 0) {
        return res.status(409).json({
          message: "A user with assignment history must remain a Resident.",
        });
      }
    }

    const values = [];
    const updates = [];
    const columnMap = {
      fullName: "full_name",
      email: "email",
      role: "role",
      isActive: "is_active",
    };

    for (const [field, column] of Object.entries(columnMap)) {
      if (body[field] !== undefined) {
        values.push(body[field]);
        updates.push(`${column} = $${values.length}`);
      }
    }

    if (body.password !== undefined) {
      values.push(await bcrypt.hash(body.password, 12));
      updates.push(`password_hash = $${values.length}`);
    }

    values.push(req.resourceId);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(", ")}
       WHERE id = $${values.length}
       RETURNING ${userColumns}`,
      values
    );
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "USER_ACCOUNT",
      entityId: req.resourceId,
      action: "UPDATE",
      oldValues: beforeResult.rows[0],
      newValues: result.rows[0],
    });
    return res.json({ message: "User updated.", user: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", requireId, async (req, res, next) => {
  let client;
  try {
    if (req.resourceId === Number(req.user.id)) {
      return res.status(403).json({ message: "You cannot delete your own account." });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    const existingUser = await client.query(
      "SELECT id FROM users WHERE id = $1 FOR UPDATE",
      [req.resourceId]
    );
    if (!existingUser.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found." });
    }

    const removedAssignments = await client.query(
      "DELETE FROM unit_assignments WHERE user_id = $1",
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
      oldValues: { ...result.rows[0], removedAssignments: removedAssignments.rowCount },
    });

    await client.query("COMMIT");
    return res.json({
      message: "User permanently deleted.",
      user: result.rows[0],
      removedAssignments: removedAssignments.rowCount,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

export default router;
