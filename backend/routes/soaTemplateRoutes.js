import express from "express";
import multer from "multer";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { writeAuditLog } from "../services/auditLog.js";
import { defaultSoaTemplate, ensureSoaTemplate, normalizeSoaTemplate } from "../services/soaTemplate.js";
import { destroySoaAsset, soaAssetDeliveryUrl, uploadSoaAsset } from "../services/soaAssets.js";

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
  logoPlacement: z.enum(["LEFT", "CENTER", "RIGHT"]),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color."),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color."),
  highlightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color."),
}).strict();

const assetUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => callback(["image/jpeg", "image/png"].includes(file.mimetype) ? null : new Error("Only JPG and PNG images are accepted."), ["image/jpeg", "image/png"].includes(file.mimetype)),
});

router.use(requireAuth);

router.get("/", allowRoles("ADMIN", "COLLECTOR"), async (req, res, next) => {
  try {
    const template = await ensureSoaTemplate(pool);
    return res.json({ template: normalizeSoaTemplate(template), defaults: defaultSoaTemplate });
  } catch (error) { return next(error); }
});

router.patch("/", allowRoles("ADMIN"), validateBody(templateSchema), async (req, res, next) => {
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

router.get("/assets/:type", allowRoles("ADMIN", "COLLECTOR", "RESIDENT"), async (req, res, next) => {
  const type = String(req.params.type || "").toLowerCase();
  const column = type === "logo" ? "logo_asset_public_id" : type === "qr" ? "qr_asset_public_id" : null;
  const mimeColumn = type === "logo" ? "logo_asset_mime_type" : type === "qr" ? "qr_asset_mime_type" : null;
  if (!column) return res.status(404).json({ message: "SOA asset not found." });
  try {
    const result = await pool.query(`SELECT ${column} AS "publicId", ${mimeColumn} AS "mimeType" FROM soa_templates WHERE id = 1`);
    const asset = result.rows[0];
    if (!asset?.publicId) return res.status(404).json({ message: "No SOA asset has been uploaded." });
    const response = await fetch(soaAssetDeliveryUrl(asset.publicId));
    if (!response.ok || !response.body) return res.status(404).json({ message: "SOA asset could not be retrieved." });
    res.type(asset.mimeType || "image/png");
    res.set("Cache-Control", "private, no-store");
    await pipeline(Readable.fromWeb(response.body), res);
    return undefined;
  } catch (error) { return next(error); }
});

router.post("/assets/:type", allowRoles("ADMIN"), assetUpload.single("asset"), async (req, res, next) => {
  const type = String(req.params.type || "").toLowerCase();
  const idColumn = type === "logo" ? "logo_asset_public_id" : type === "qr" ? "qr_asset_public_id" : null;
  const mimeColumn = type === "logo" ? "logo_asset_mime_type" : type === "qr" ? "qr_asset_mime_type" : null;
  if (!idColumn) return res.status(404).json({ message: "Unknown SOA asset type." });
  if (!req.file) return res.status(400).json({ message: "Select a JPG or PNG image." });
  let uploaded;
  try {
    await ensureSoaTemplate(pool);
    const before = await pool.query(`SELECT ${idColumn} AS "publicId" FROM soa_templates WHERE id = 1`);
    uploaded = await uploadSoaAsset(req.file.buffer, type);
    await pool.query(`UPDATE soa_templates SET ${idColumn} = $1, ${mimeColumn} = $2, updated_by = $3 WHERE id = 1`, [uploaded.publicId, req.file.mimetype, req.user.id]);
    await writeAuditLog({ actorUserId: req.user.id, entityName: "SOA_TEMPLATE", entityId: 1, action: "UPLOAD_ASSET", newValues: { type, mimeType: req.file.mimetype } });
    if (before.rows[0]?.publicId) await destroySoaAsset(before.rows[0].publicId).catch(() => {});
    return res.status(201).json({ message: `${type === "logo" ? "Logo" : "Payment QR code"} uploaded.` });
  } catch (error) {
    if (uploaded?.publicId) await destroySoaAsset(uploaded.publicId).catch(() => {});
    return next(error);
  }
});

export default router;
