import express from "express";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { writeAuditLog } from "../services/auditLog.js";

const router = express.Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.");
const assignmentSelect = `
  SELECT a.id, a.unit_id AS "unitId", a.user_id AS "userId",
    a.relationship_type AS "relationshipType",
    a.is_primary_payer AS "isPrimaryPayer",
    a.start_date AS "startDate", a.end_date AS "endDate",
    a.created_at AS "createdAt", a.updated_at AS "updatedAt",
    u.unit_number AS "unitNumber",
    usr.full_name AS "residentName", usr.email AS "residentEmail"
  FROM unit_assignments a
  JOIN units u ON u.id = a.unit_id
  JOIN users usr ON usr.id = a.user_id`;

const createAssignmentSchema = z.object({
  unitId: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
  relationshipType: z.enum(["OWNER", "TENANT"]),
  isPrimaryPayer: z.boolean().optional().default(false),
  startDate: dateSchema.optional(),
  endDate: z.union([dateSchema, z.null()]).optional().default(null),
}).strict();

const updateAssignmentSchema = z.object({
  unitId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  relationshipType: z.enum(["OWNER", "TENANT"]).optional(),
  isPrimaryPayer: z.boolean().optional(),
  startDate: dateSchema.optional(),
  endDate: z.union([dateSchema, z.null()]).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: "At least one field must be provided.",
});

async function findAssignment(id) {
  const result = await pool.query(`${assignmentSelect} WHERE a.id = $1`, [id]);
  return result.rows[0];
}

async function ensureAssignableResident(userId, res) {
  const result = await pool.query(
    "SELECT role, is_active FROM users WHERE id = $1",
    [userId]
  );
  const user = result.rows[0];

  if (!user) {
    res.status(404).json({ message: "Resident user not found." });
    return false;
  }
  if (user.role !== "RESIDENT" || !user.is_active) {
    res.status(409).json({ message: "Only active Resident accounts can be assigned to units." });
    return false;
  }
  return true;
}

router.use(requireAuth);

router.get("/", allowRoles("ADMIN", "COLLECTOR", "RESIDENT"), async (req, res, next) => {
  try {
    const params = [];
    let where = "";
    if (req.user.role === "RESIDENT") {
      params.push(req.user.id);
      where = "WHERE a.user_id = $1";
    }
    const result = await pool.query(
      `${assignmentSelect} ${where} ORDER BY a.id`,
      params
    );
    return res.json({ assignments: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", allowRoles("ADMIN", "COLLECTOR", "RESIDENT"), requireId, async (req, res, next) => {
  try {
    const params = [req.resourceId];
    const scope = req.user.role === "RESIDENT" ? "AND a.user_id = $2" : "";
    if (req.user.role === "RESIDENT") params.push(req.user.id);
    const result = await pool.query(
      `${assignmentSelect} WHERE a.id = $1 ${scope}`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Unit assignment not found." });
    return res.json({ assignment: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post("/", allowRoles("ADMIN"), validateBody(createAssignmentSchema), async (req, res, next) => {
  try {
    const { unitId, userId, relationshipType, isPrimaryPayer, startDate, endDate } = req.validatedBody;
    if (!(await ensureAssignableResident(userId, res))) return;

    const result = await pool.query(
      `INSERT INTO unit_assignments
        (unit_id, user_id, relationship_type, is_primary_payer, start_date, end_date)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6)
       RETURNING id`,
      [unitId, userId, relationshipType, isPrimaryPayer, startDate || null, endDate]
    );
    const assignment = await findAssignment(result.rows[0].id);
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "UNIT_ASSIGNMENT",
      entityId: assignment.id,
      action: "CREATE",
      newValues: assignment,
    });
    return res.status(201).json({ message: "Unit assignment created.", assignment });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", allowRoles("ADMIN"), requireId, validateBody(updateAssignmentSchema), async (req, res, next) => {
  try {
    const before = await findAssignment(req.resourceId);
    if (!before) return res.status(404).json({ message: "Unit assignment not found." });
    if (req.validatedBody.userId !== undefined
      && !(await ensureAssignableResident(req.validatedBody.userId, res))) return;

    const values = [];
    const updates = [];
    const columnMap = {
      unitId: "unit_id",
      userId: "user_id",
      relationshipType: "relationship_type",
      isPrimaryPayer: "is_primary_payer",
      startDate: "start_date",
      endDate: "end_date",
    };

    for (const [field, column] of Object.entries(columnMap)) {
      if (req.validatedBody[field] !== undefined) {
        values.push(req.validatedBody[field]);
        updates.push(`${column} = $${values.length}`);
      }
    }

    values.push(req.resourceId);
    const result = await pool.query(
      `UPDATE unit_assignments SET ${updates.join(", ")}
       WHERE id = $${values.length} RETURNING id`,
      values
    );
    const assignment = await findAssignment(result.rows[0].id);
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "UNIT_ASSIGNMENT",
      entityId: assignment.id,
      action: "UPDATE",
      oldValues: before,
      newValues: assignment,
    });
    return res.json({ message: "Unit assignment updated.", assignment });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", allowRoles("ADMIN"), requireId, async (req, res, next) => {
  try {
    const before = await findAssignment(req.resourceId);
    if (!before) return res.status(404).json({ message: "Unit assignment not found." });
    const result = await pool.query(
      `UPDATE unit_assignments
       SET end_date = COALESCE(end_date, GREATEST(CURRENT_DATE, start_date))
       WHERE id = $1 RETURNING id`,
      [req.resourceId]
    );
    const assignment = await findAssignment(result.rows[0].id);
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "UNIT_ASSIGNMENT",
      entityId: assignment.id,
      action: "END",
      oldValues: before,
      newValues: assignment,
    });
    return res.json({ message: "Unit assignment ended.", assignment });
  } catch (error) {
    return next(error);
  }
});

export default router;
