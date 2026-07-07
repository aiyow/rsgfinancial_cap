import express from "express";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { writeAuditLog } from "../services/auditLog.js";

const router = express.Router();
const occupancySchema = z.enum(["OCCUPIED", "VACANT"]);
const unitColumns = `u.id, u.unit_number AS "unitNumber", u.floor,
  u.billable_area_sqm AS "billableAreaSqm",
  u.occupancy_status AS "occupancyStatus",
  u.created_at AS "createdAt", u.updated_at AS "updatedAt"`;

const createUnitSchema = z.object({
  unitNumber: z.string().trim().min(1).max(30),
  floor: z.string().trim().min(1).max(20),
  billableAreaSqm: z.coerce.number().positive(),
  occupancyStatus: occupancySchema.optional().default("VACANT"),
}).strict();

const updateUnitSchema = z.object({
  unitNumber: z.string().trim().min(1).max(30).optional(),
  floor: z.string().trim().min(1).max(20).optional(),
  billableAreaSqm: z.coerce.number().positive().optional(),
  occupancyStatus: occupancySchema.optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: "At least one field must be provided.",
});

router.use(requireAuth);

router.get("/", allowRoles("ADMIN", "COLLECTOR", "RESIDENT"), async (req, res, next) => {
  try {
    const params = [];
    let where = "";

    if (req.user.role === "RESIDENT") {
      params.push(req.user.id);
      where = `WHERE EXISTS (
        SELECT 1 FROM unit_assignments a
        WHERE a.unit_id = u.id AND a.user_id = $1 AND a.end_date IS NULL
      )`;
    }

    const result = await pool.query(
      `SELECT ${unitColumns} FROM units u ${where} ORDER BY u.unit_number`,
      params
    );
    return res.json({ units: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", allowRoles("ADMIN", "COLLECTOR", "RESIDENT"), requireId, async (req, res, next) => {
  try {
    const params = [req.resourceId];
    let accessClause = "";

    if (req.user.role === "RESIDENT") {
      params.push(req.user.id);
      accessClause = `AND EXISTS (
        SELECT 1 FROM unit_assignments a
        WHERE a.unit_id = u.id AND a.user_id = $2 AND a.end_date IS NULL
      )`;
    }

    const result = await pool.query(
      `SELECT ${unitColumns} FROM units u WHERE u.id = $1 ${accessClause}`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Unit not found." });
    return res.json({ unit: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post("/", allowRoles("ADMIN"), validateBody(createUnitSchema), async (req, res, next) => {
  try {
    const { unitNumber, floor, billableAreaSqm, occupancyStatus } = req.validatedBody;
    const result = await pool.query(
      `INSERT INTO units (unit_number, floor, billable_area_sqm, occupancy_status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, unit_number AS "unitNumber", floor,
         billable_area_sqm AS "billableAreaSqm",
         occupancy_status AS "occupancyStatus",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [unitNumber, floor, billableAreaSqm, occupancyStatus]
    );
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "UNIT",
      entityId: result.rows[0].id,
      action: "CREATE",
      newValues: result.rows[0],
    });
    return res.status(201).json({ message: "Unit created.", unit: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", allowRoles("ADMIN"), requireId, validateBody(updateUnitSchema), async (req, res, next) => {
  try {
    const beforeResult = await pool.query(
      `SELECT id, unit_number AS "unitNumber", floor,
        billable_area_sqm AS "billableAreaSqm",
        occupancy_status AS "occupancyStatus",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM units WHERE id = $1`,
      [req.resourceId]
    );
    if (!beforeResult.rows[0]) return res.status(404).json({ message: "Unit not found." });
    const values = [];
    const updates = [];
    const columnMap = {
      unitNumber: "unit_number",
      floor: "floor",
      billableAreaSqm: "billable_area_sqm",
      occupancyStatus: "occupancy_status",
    };

    for (const [field, column] of Object.entries(columnMap)) {
      if (req.validatedBody[field] !== undefined) {
        values.push(req.validatedBody[field]);
        updates.push(`${column} = $${values.length}`);
      }
    }

    values.push(req.resourceId);
    const result = await pool.query(
      `UPDATE units SET ${updates.join(", ")} WHERE id = $${values.length}
       RETURNING id, unit_number AS "unitNumber", floor,
         billable_area_sqm AS "billableAreaSqm",
         occupancy_status AS "occupancyStatus",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      values
    );
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "UNIT",
      entityId: req.resourceId,
      action: "UPDATE",
      oldValues: beforeResult.rows[0],
      newValues: result.rows[0],
    });
    return res.json({ message: "Unit updated.", unit: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", allowRoles("ADMIN"), requireId, async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM units WHERE id = $1
       RETURNING id, unit_number AS "unitNumber"`,
      [req.resourceId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Unit not found." });
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "UNIT",
      entityId: req.resourceId,
      action: "DELETE",
      oldValues: result.rows[0],
    });
    return res.json({ message: "Unit permanently deleted.", unit: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
