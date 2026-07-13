import express from "express";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth, allowRoles("ADMIN"));

router.get("/", async (req, res, next) => {
  try {
    const params = [];
    const auditConditions = [];
    if (req.query.entity) {
      params.push(String(req.query.entity).trim().toUpperCase());
      auditConditions.push(`a.entity_name = $${params.length}`);
    }

    if (req.query.action) {
      params.push(String(req.query.action).trim().toUpperCase());
      auditConditions.push(`a.action = $${params.length}`);
    }

    const auditWhere = auditConditions.length ? `WHERE ${auditConditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    params.push(limit);

    const result = await pool.query(
      `SELECT
          'AUDIT_LOG' AS source,
          a.id,
          a.created_at AS "createdAt",
          a.entity_name AS "entityName",
          a.entity_id AS "entityId",
          a.action,
          a.remarks,
          a.old_values AS "oldValues",
          a.new_values AS "newValues",
          usr.id AS "actorUserId",
          usr.full_name AS "actorName",
          usr.role AS "actorRole"
        FROM audit_logs a
        JOIN users usr ON usr.id = a.actor_user_id
        ${auditWhere}
      ORDER BY "createdAt" DESC
      LIMIT $${params.length}`,
      params,
    );

    return res.json({ logs: result.rows });
  } catch (error) {
    return next(error);
  }
});

export default router;
