import express from "express";
import { verifyPassword } from "../services/passwords.js";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { writeAuditLog } from "../services/audit.js";

const router = express.Router();
const occupancySchema = z.enum(["OCCUPIED", "VACANT"]);
const soaResidentNameField = z.string().trim().min(1).max(205)
  .regex(/^[^\u0000-\u001f\u007f]+$/, "Enter a name on one line.");
const soaNameSchema = z.object({ soaResidentName: soaResidentNameField }).strict();
const soaNamesSchema = z.object({
  names: z.array(z.object({ unitId: z.number().int().positive().safe(), soaResidentName: soaResidentNameField }).strict())
    .min(1).max(2000).refine(names => new Set(names.map(row => row.unitId)).size === names.length, "Each unit must appear only once."),
}).strict();
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

const deleteUnitSchema = z.object({
  currentPassword: z.string().min(1).max(256),
}).strict();

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
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const { unitNumber, floor, billableAreaSqm, occupancyStatus } = req.validatedBody;
    const result = await client.query(
      `INSERT INTO units (unit_number, floor, billable_area_sqm, occupancy_status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, unit_number AS "unitNumber", floor,
         billable_area_sqm AS "billableAreaSqm",
         occupancy_status AS "occupancyStatus",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [unitNumber, floor, billableAreaSqm, occupancyStatus]
    );
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "UNIT",
      entityId: result.rows[0].id,
      action: "CREATE",
      newValues: result.rows[0],
    });
    await client.query("COMMIT");
    return res.status(201).json({ message: "Unit created.", unit: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.patch("/soa-names", allowRoles("ADMIN"), validateBody(soaNamesSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const names = [...req.validatedBody.names].sort((a, b) => a.unitId - b.unitId);
    const before = await client.query(
      `SELECT id, unit_number AS "unitNumber", soa_resident_name AS "soaResidentName"
       FROM units WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`, [names.map(row => row.unitId)],
    );
    if (before.rows.length !== names.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "A selected unit no longer exists. Refresh the report and try again." });
    }
    const units = [];
    for (const [index, name] of names.entries()) {
      const result = await client.query(
        `UPDATE units SET soa_resident_name = $2, updated_at = NOW() WHERE id = $1
         RETURNING id, unit_number AS "unitNumber", soa_resident_name AS "soaResidentName"`,
        [name.unitId, name.soaResidentName],
      );
      await writeAuditLog({ client, actorUserId: req.user.id, entityName: "UNIT", entityId: name.unitId,
        action: "UPDATE", oldValues: before.rows[index], newValues: result.rows[0],
        remarks: "Updated the resident name template for new SOAs. Existing SOAs are unchanged." });
      units.push({ ...result.rows[0], id: Number(result.rows[0].id) });
    }
    await client.query("COMMIT");
    return res.json({ message: "Resident names saved for new SOAs.", units });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.patch("/:id", allowRoles("ADMIN"), requireId, validateBody(updateUnitSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const beforeResult = await client.query(
      `SELECT id, unit_number AS "unitNumber", floor,
        billable_area_sqm AS "billableAreaSqm",
        occupancy_status AS "occupancyStatus",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM units WHERE id = $1`,
      [req.resourceId]
    );
    if (!beforeResult.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Unit not found." }); }
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
    const result = await client.query(
      `UPDATE units SET ${updates.join(", ")} WHERE id = $${values.length}
       RETURNING id, unit_number AS "unitNumber", floor,
         billable_area_sqm AS "billableAreaSqm",
         occupancy_status AS "occupancyStatus",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      values
    );
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "UNIT",
      entityId: req.resourceId,
      action: "UPDATE",
      oldValues: beforeResult.rows[0],
      newValues: result.rows[0],
    });
    await client.query("COMMIT");
    return res.json({ message: "Unit updated.", unit: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.patch("/:id/soa-name", allowRoles("ADMIN"), requireId, validateBody(soaNameSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const before = await client.query(
      `SELECT id, unit_number AS "unitNumber", soa_resident_name AS "soaResidentName"
       FROM units WHERE id = $1 FOR UPDATE`, [req.resourceId],
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Unit not found." });
    }
    const result = await client.query(
      `UPDATE units SET soa_resident_name = $2, updated_at = NOW() WHERE id = $1
       RETURNING id, unit_number AS "unitNumber", soa_resident_name AS "soaResidentName"`,
      [req.resourceId, req.validatedBody.soaResidentName],
    );
    await writeAuditLog({ client, actorUserId: req.user.id, entityName: "UNIT", entityId: req.resourceId,
      action: "UPDATE", oldValues: before.rows[0], newValues: result.rows[0],
      remarks: "Updated the resident name template for new SOAs. Existing SOAs are unchanged." });
    await client.query("COMMIT");
    return res.json({ message: "Resident name saved. It will be used for new SOAs.", unit: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.delete("/:id", allowRoles("ADMIN"), requireId, validateBody(deleteUnitSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const actor = await client.query("SELECT password_hash AS \"passwordHash\" FROM users WHERE id = $1", [req.user.id]);
    const passwordMatches = actor.rows[0] && await verifyPassword(req.validatedBody.currentPassword, actor.rows[0].passwordHash);
    if (!passwordMatches) { await client.query("ROLLBACK"); return res.status(401).json({ message: "Your current Admin password is required to delete a unit." }); }

    const result = await client.query(
      `DELETE FROM units WHERE id = $1
       RETURNING id, unit_number AS "unitNumber"`,
      [req.resourceId]
    );
    if (!result.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Unit not found." }); }
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "UNIT",
      entityId: req.resourceId,
      action: "DELETE",
      oldValues: result.rows[0],
    });
    await client.query("COMMIT");
    return res.json({ message: "Unit permanently deleted.", unit: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
