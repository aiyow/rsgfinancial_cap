import express from "express";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { writeAuditLog } from "../services/auditLog.js";
import { defaultSoaTemplate, ensureSoaTemplate, normalizeSoaTemplate } from "../services/soaTemplate.js";

const router = express.Router();
const templateSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  companyAddress: z.string().trim().min(1).max(300),
  statementTitle: z.string().trim().min(1).max(80),
  paymentChannel: z.string().trim().min(1).max(80),
  paymentAccountName: z.string().trim().min(1).max(150),
  paymentAccountNumber: z.string().trim().min(1).max(80),
  preparedByName: z.string().trim().min(1).max(150),
  preparedByTitle: z.string().trim().min(1).max(100),
  checkedByName: z.string().trim().min(1).max(150),
  checkedByTitle: z.string().trim().min(1).max(100),
  noticeLine1: z.string().trim().max(300),
  noticeLine2: z.string().trim().max(300),
  footerText: z.string().trim().min(1).max(100),
}).strict();

router.use(requireAuth);

router.get("/", allowRoles("ADMIN", "COLLECTOR"), async (req, res, next) => {
  try {
    const template = await ensureSoaTemplate(pool);
    return res.json({ template: normalizeSoaTemplate(template), defaults: defaultSoaTemplate });
  } catch (error) { return next(error); }
});

router.patch("/", allowRoles("COLLECTOR"), validateBody(templateSchema), async (req, res, next) => {
  try {
    const before = await ensureSoaTemplate(pool);
    const template = normalizeSoaTemplate(req.validatedBody);
    const result = await pool.query(
      `UPDATE soa_templates
       SET template_data = $1::jsonb, updated_by = $2
       WHERE id = 1
       RETURNING template_data AS "templateData"`,
      [JSON.stringify(template), req.user.id],
    );
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "SOA_TEMPLATE",
      entityId: 1,
      action: "UPDATE",
      oldValues: normalizeSoaTemplate(before),
      newValues: result.rows[0].templateData,
    });
    return res.json({ message: "SOA template updated for future generated statements.", template: result.rows[0].templateData });
  } catch (error) { return next(error); }
});

export default router;
