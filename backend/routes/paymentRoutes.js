import crypto from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { analyzeReceipt } from "../services/receiptOcr.js";
import { writeAuditLog } from "../services/auditLog.js";
import { destroyReceipt, receiptDeliveryUrl, uploadReceipt } from "../services/cloudinaryReceipts.js";
import { regeneratePrescriptiveRecommendations } from "../services/prescriptiveAnalytics.js";
import {
  applyUnitCreditToOpenBills,
  billAppliedSql,
  ensurePaymentLedgerSchema,
  getUnitCreditBalance,
  manualReference,
} from "../services/paymentLedger.js";

const router = express.Router();
const uploadDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads/payment-proofs");
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const valid = ["image/jpeg", "image/png"].includes(file.mimetype);
    callback(valid ? null : new Error("Only JPG and PNG receipt images are accepted."), valid);
  },
});
const paymentMethodSchema = z.enum(["GCASH", "BANK_TRANSFER", "CASH", "OTHER"]);
const reviewSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("APPROVED"),
    verifiedAmount: z.coerce.number().positive(),
    paymentMethod: paymentMethodSchema,
    verifiedReferenceNo: z.string().trim().max(100).optional(),
    verifiedPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format."),
    remarks: z.string().trim().max(1000).optional(),
  }).strict(),
  z.object({
    status: z.literal("REJECTED"),
    remarks: z.string().trim().min(3).max(1000),
  }).strict(),
]);
const manualPaymentSchema = z.object({
  targetBillId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  paymentMethod: paymentMethodSchema,
  amount: z.coerce.number().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format."),
  referenceNo: z.string().trim().max(100).optional(),
  remarks: z.string().trim().max(1000).optional(),
}).strict().refine((body) => body.targetBillId || body.unitId, {
  message: "Choose an SOA or unit for the payment.",
});

const totalSql = `COALESCE((SELECT ROUND(SUM(c.quantity * c.rate_applied), 2) FROM bill_charges c WHERE c.unit_bill_id = b.id), 0)`;
const paymentApplicationSql = `COALESCE((SELECT ROUND(SUM(pa.amount_applied), 2) FROM payment_applications pa WHERE pa.payment_submission_id = ps.id), 0)`;
const unitAdvanceSql = `COALESCE((SELECT ROUND(SUM(up.verified_amount - COALESCE((SELECT SUM(upa.amount_applied) FROM payment_applications upa WHERE upa.payment_submission_id = up.id), 0)), 2)
  FROM payment_submissions up WHERE up.unit_id = ps.unit_id AND up.review_status = 'APPROVED'), 0)`;
const paymentSelect = `SELECT ps.id, ps.target_unit_bill_id AS "targetBillId", ps.submitted_by AS "submittedBy",
  ps.unit_id AS "unitId", ps.entry_type AS "entryType", ps.payment_method AS "paymentMethod",
  ps.receipt_original_name AS "receiptOriginalName", ps.receipt_mime_type AS "receiptMimeType",
  ps.ocr_raw_text AS "ocrRawText", ps.ocr_confidence AS "ocrConfidence",
  ps.ocr_quality_status AS "ocrQualityStatus", ps.ocr_amount AS "ocrAmount",
  ps.ocr_reference_no AS "ocrReferenceNo", ps.ocr_payment_date AS "ocrPaymentDate",
  ps.review_status AS "reviewStatus", ps.reviewed_by AS "reviewedBy", ps.reviewed_at AS "reviewedAt",
  ps.verified_amount AS "verifiedAmount", ps.verified_reference_no AS "verifiedReferenceNo",
  ps.verified_payment_date AS "verifiedPaymentDate", ps.remarks, ps.submitted_at AS "submittedAt",
  COALESCE(b.unit_number_snapshot, u.unit_number) AS "unitNumber", b.due_date_snapshot AS "dueDate", b.published_at AS "publishedAt",
  submitter.full_name AS "submittedByName", reviewer.full_name AS "reviewedByName",
  ${totalSql} AS "billTotal", ${billAppliedSql} AS "approvedTotal",
  ${paymentApplicationSql} AS "appliedAmount",
  GREATEST(COALESCE(ps.verified_amount, 0) - ${paymentApplicationSql}, 0) AS "unappliedAmount",
  ${unitAdvanceSql} AS "unitAdvanceBalance",
  GREATEST(${totalSql} - ${billAppliedSql}, 0) AS "remainingBalance",
  CASE WHEN b.id IS NULL THEN 'ADVANCE'
    WHEN ${billAppliedSql} >= ${totalSql} AND ${totalSql} > 0 THEN 'PAID'
    WHEN ${billAppliedSql} > 0 THEN 'PARTIAL'
    WHEN b.due_date_snapshot < CURRENT_DATE THEN 'OVERDUE' ELSE 'UNPAID' END AS "paymentStatus"
  FROM payment_submissions ps
  LEFT JOIN unit_bills b ON b.id = ps.target_unit_bill_id
  LEFT JOIN units u ON u.id = ps.unit_id
  JOIN users submitter ON submitter.id = ps.submitted_by
  LEFT JOIN users reviewer ON reviewer.id = ps.reviewed_by`;

function paymentAccess(req, params, conditions) {
  if (req.user.role === "RESIDENT") {
    params.push(req.user.id);
    conditions.push(`EXISTS (SELECT 1 FROM unit_assignments access
      WHERE access.unit_id = ps.unit_id AND access.user_id = $${params.length} AND access.end_date IS NULL)`);
  } else if (req.user.role === "COLLECTOR") conditions.push("ps.review_status = 'APPROVED'");
}

async function residentBill(id, userId) {
  const result = await pool.query(
    `SELECT b.id, b.unit_id AS "unitId",
      COALESCE((SELECT ROUND(SUM(c.quantity * c.rate_applied), 2) FROM bill_charges c WHERE c.unit_bill_id = b.id), 0) AS total,
      ${billAppliedSql} AS approved
     FROM unit_bills b
     WHERE b.id = $1 AND b.published_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM unit_assignments a
         WHERE a.unit_id = b.unit_id AND a.user_id = $2 AND a.end_date IS NULL)`,
    [id, userId],
  );
  return result.rows[0];
}

async function processReceipt(req, res) {
  if (!req.file) { res.status(400).json({ message: "Select a JPG or PNG receipt image." }); return null; }
  try {
    return await analyzeReceipt(req.file.buffer);
  } catch {
    res.status(400).json({ message: "The uploaded file is not a readable JPG or PNG image." });
    return null;
  }
}

router.use(requireAuth, allowRoles("ADMIN", "COLLECTOR", "RESIDENT"));
router.use(async (req, res, next) => {
  try {
    await ensurePaymentLedgerSchema(pool);
    return next();
  } catch (error) {
    return next(error);
  }
});

router.post("/bills/:id/preview", allowRoles("RESIDENT"), requireId, receiptUpload.single("receipt"), async (req, res, next) => {
  try {
    if (!await residentBill(req.resourceId, req.user.id)) return res.status(404).json({ message: "Published SOA not found." });
    const analysis = await processReceipt(req, res);
    if (!analysis) return undefined;
    if (analysis.quality.status !== "GOOD") {
      return res.status(422).json({
        message: analysis.quality.status === "BLURRY" ? "The receipt image appears blurry. Upload a clearer photo." : "The receipt image is too small. Upload a higher-resolution photo.",
        analysis,
      });
    }
    return res.json({
      message: analysis.complete ? "Receipt is clear and all payment fields were detected." : "Receipt is clear, but some fields could not be detected. Admin will verify the image manually.",
      analysis,
    });
  } catch (error) { return next(error); }
});

router.post("/bills/:id", allowRoles("RESIDENT"), requireId, receiptUpload.single("receipt"), async (req, res, next) => {
  let uploadedReceipt;
  let client;
  try {
    const bill = await residentBill(req.resourceId, req.user.id);
    if (!bill) return res.status(404).json({ message: "Published SOA not found." });
    if (Number(bill.approved) >= Number(bill.total) && Number(bill.total) > 0) {
      return res.status(409).json({ message: "This SOA is already fully paid." });
    }
    const digest = crypto.createHash("sha256").update(req.file?.buffer || Buffer.alloc(0)).digest("hex");
    const duplicate = await pool.query("SELECT id FROM payment_submissions WHERE receipt_sha256 = $1", [digest]);
    if (duplicate.rows[0]) return res.status(409).json({ message: "This receipt image was already submitted." });
    const analysis = await processReceipt(req, res);
    if (!analysis) return undefined;
    if (analysis.quality.status !== "GOOD") {
      return res.status(422).json({ message: analysis.quality.status === "BLURRY" ? "The receipt image appears blurry. Upload a clearer photo." : "The receipt image is too small. Upload a higher-resolution photo." });
    }

    uploadedReceipt = await uploadReceipt(req.file.buffer);
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO payment_submissions
        (unit_id, submitted_by, target_unit_bill_id, receipt_path, receipt_storage, receipt_cloudinary_public_id,
         receipt_original_name, receipt_mime_type, receipt_sha256,
         ocr_raw_text, ocr_confidence, ocr_quality_status, ocr_amount, ocr_reference_no, ocr_payment_date)
       VALUES ($1, $2, $3, $4, 'CLOUDINARY', $5, $6, $7, $8, $9, $10, 'GOOD', $11, $12, $13)
       RETURNING id`,
      [bill.unitId, req.user.id, req.resourceId, uploadedReceipt.publicId, uploadedReceipt.publicId,
        req.file.originalname.slice(0, 255), req.file.mimetype, digest,
        analysis.rawText, analysis.confidence, analysis.amount, analysis.referenceNo, analysis.paymentDate],
    );
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "PAYMENT_SUBMISSION",
      entityId: result.rows[0].id,
      action: "SUBMIT",
      newValues: {
        targetBillId: req.resourceId,
        receiptOriginalName: req.file.originalname.slice(0, 255),
        receiptStorage: "CLOUDINARY",
        ocrAmount: analysis.amount,
        ocrReferenceNo: analysis.referenceNo,
        ocrPaymentDate: analysis.paymentDate,
      },
    });
    await client.query("COMMIT");
    return res.status(201).json({ message: "Payment proof submitted for Admin verification.", paymentId: result.rows[0].id, analysis });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (uploadedReceipt?.publicId) await destroyReceipt(uploadedReceipt.publicId).catch(() => {});
    return next(error);
  } finally {
    client?.release();
  }
});

router.get("/credits", allowRoles("ADMIN", "RESIDENT"), async (req, res, next) => {
  try {
    const params = [];
    const conditions = [];
    if (req.user.role === "RESIDENT") {
      params.push(req.user.id);
      conditions.push(`EXISTS (SELECT 1 FROM unit_assignments access
        WHERE access.unit_id = u.id AND access.user_id = $1 AND access.end_date IS NULL)`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT u.id AS "unitId", u.unit_number AS "unitNumber",
        COALESCE(ROUND(SUM(ps.verified_amount - COALESCE((
          SELECT SUM(pa.amount_applied) FROM payment_applications pa WHERE pa.payment_submission_id = ps.id
        ), 0)), 2), 0) AS "advanceBalance"
       FROM units u
       LEFT JOIN payment_submissions ps ON ps.unit_id = u.id AND ps.review_status = 'APPROVED'
       ${where}
       GROUP BY u.id, u.unit_number
       ORDER BY u.unit_number`,
      params,
    );
    return res.json({ credits: result.rows });
  } catch (error) { return next(error); }
});

router.post("/manual", allowRoles("ADMIN"), validateBody(manualPaymentSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const body = req.validatedBody;
    let unitId = body.unitId || null;
    let billId = body.targetBillId || null;
    if (billId) {
      const bill = await client.query("SELECT id, unit_id FROM unit_bills WHERE id = $1 FOR UPDATE", [billId]);
      if (!bill.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "SOA not found." });
      }
      unitId = Number(bill.rows[0].unit_id);
    } else {
      const unit = await client.query("SELECT id FROM units WHERE id = $1", [unitId]);
      if (!unit.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Unit not found." });
      }
    }

    const placeholderReference = body.referenceNo || `TEMP-${crypto.randomUUID()}`;
    const result = await client.query(
      `INSERT INTO payment_submissions
        (unit_id, submitted_by, target_unit_bill_id, entry_type, payment_method, review_status,
         reviewed_by, reviewed_at, verified_amount, verified_reference_no, verified_payment_date, remarks)
       VALUES ($1, $2, $3, 'MANUAL', $4, 'APPROVED', $2, NOW(), $5, $6, $7, $8)
       RETURNING id`,
      [unitId, req.user.id, billId, body.paymentMethod, body.amount, placeholderReference, body.paymentDate, body.remarks || null],
    );
    const paymentId = result.rows[0].id;
    const verifiedReferenceNo = body.referenceNo || manualReference(body.paymentMethod, paymentId);
    if (!body.referenceNo) {
      await client.query("UPDATE payment_submissions SET verified_reference_no = $2 WHERE id = $1", [paymentId, verifiedReferenceNo]);
    }
    await applyUnitCreditToOpenBills(client, unitId, billId, paymentId);
    const advanceBalance = await getUnitCreditBalance(client, unitId);
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "PAYMENT_SUBMISSION",
      entityId: paymentId,
      action: "CREATE_MANUAL",
      newValues: {
        unitId,
        targetBillId: billId,
        paymentMethod: body.paymentMethod,
        amount: body.amount,
        verifiedReferenceNo,
        paymentDate: body.paymentDate,
        advanceBalance,
      },
      remarks: body.remarks || null,
    });
    await regeneratePrescriptiveRecommendations(client);
    await client.query("COMMIT");
    return res.status(201).json({
      message: billId ? "Manual payment recorded and applied to the SOA." : "Advance payment recorded for the unit.",
      paymentId,
      advanceBalance,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") return res.status(409).json({ message: "That payment reference number was already approved." });
    return next(error);
  } finally { client?.release(); }
});

router.get("/", async (req, res, next) => {
  try {
    const params = [];
    const conditions = [];
    paymentAccess(req, params, conditions);
    if (req.query.status) {
      const status = String(req.query.status).toUpperCase();
      if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) return res.status(400).json({ message: "Invalid payment status filter." });
      params.push(status);
      conditions.push(`ps.review_status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`${paymentSelect} ${where} ORDER BY ps.submitted_at DESC`, params);
    return res.json({ payments: result.rows });
  } catch (error) { return next(error); }
});

router.get("/:id/receipt", requireId, async (req, res, next) => {
  try {
    const params = [req.resourceId];
    const conditions = ["ps.id = $1"];
    paymentAccess(req, params, conditions);
    conditions.push("ps.entry_type = 'RECEIPT_UPLOAD'");
    const result = await pool.query(
      `SELECT ps.receipt_path, ps.receipt_storage, ps.receipt_cloudinary_public_id, ps.receipt_mime_type
       FROM payment_submissions ps WHERE ${conditions.join(" AND ")}`,
      params,
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Receipt not found." });
    const receipt = result.rows[0];
    if (receipt.receipt_storage === "CLOUDINARY") {
      const response = await fetch(receiptDeliveryUrl(receipt.receipt_cloudinary_public_id));
      if (!response.ok || !response.body) {
        console.error(`Cloudinary receipt ${receipt.receipt_cloudinary_public_id} could not be retrieved: ${response.status}`);
        return res.status(404).json({ message: "Receipt not found." });
      }
      res.type(receipt.receipt_mime_type);
      res.set("Cache-Control", "private, no-store");
      await pipeline(Readable.fromWeb(response.body), res);
      return undefined;
    }
    const filePath = path.join(uploadDirectory, path.basename(receipt.receipt_path));
    res.type(receipt.receipt_mime_type);
    return res.sendFile(filePath);
  } catch (error) { return next(error); }
});

router.get("/:id", requireId, async (req, res, next) => {
  try {
    const params = [req.resourceId];
    const conditions = ["ps.id = $1"];
    paymentAccess(req, params, conditions);
    const result = await pool.query(`${paymentSelect} WHERE ${conditions.join(" AND ")}`, params);
    if (!result.rows[0]) return res.status(404).json({ message: "Payment submission not found." });
    return res.json({ payment: result.rows[0] });
  } catch (error) { return next(error); }
});

router.post("/:id/review", allowRoles("ADMIN"), requireId, validateBody(reviewSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT ps.*, ps.target_unit_bill_id AS target_bill_id
       FROM payment_submissions ps
       WHERE ps.id = $1 FOR UPDATE OF ps`, [req.resourceId],
    );
    if (!locked.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Payment submission not found." }); }
    if (locked.rows[0].review_status !== "PENDING") { await client.query("ROLLBACK"); return res.status(409).json({ message: "This payment submission was already reviewed." }); }
    const body = req.validatedBody;
    if (body.status === "APPROVED") {
      const unitId = locked.rows[0].unit_id;
      if (!unitId) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Payment has no unit to receive credit." });
      }
      const verifiedReferenceNo = body.verifiedReferenceNo || manualReference(body.paymentMethod, req.resourceId);
      const reference = await client.query(
        "SELECT id FROM payment_submissions WHERE review_status = 'APPROVED' AND LOWER(verified_reference_no) = LOWER($1) AND id <> $2",
        [verifiedReferenceNo, req.resourceId],
      );
      if (reference.rows[0]) { await client.query("ROLLBACK"); return res.status(409).json({ message: "That payment reference number was already approved." }); }
      await client.query(
        `UPDATE payment_submissions SET review_status = 'APPROVED', reviewed_by = $2, reviewed_at = NOW(),
          unit_id = $3, payment_method = $4, verified_amount = $5, verified_reference_no = $6,
          verified_payment_date = $7, remarks = $8 WHERE id = $1`,
        [req.resourceId, req.user.id, unitId, body.paymentMethod, body.verifiedAmount,
          verifiedReferenceNo, body.verifiedPaymentDate, body.remarks || null],
      );
      await applyUnitCreditToOpenBills(client, unitId, locked.rows[0].target_bill_id, req.resourceId);
      const advanceBalance = await getUnitCreditBalance(client, unitId);
      await writeAuditLog({
        client,
        actorUserId: req.user.id,
        entityName: "PAYMENT_SUBMISSION",
        entityId: req.resourceId,
        action: "APPROVE",
        oldValues: { reviewStatus: "PENDING" },
        newValues: {
          reviewStatus: "APPROVED",
          paymentMethod: body.paymentMethod,
          verifiedAmount: body.verifiedAmount,
          verifiedReferenceNo,
          verifiedPaymentDate: body.verifiedPaymentDate,
          remarks: body.remarks || null,
          advanceBalance,
        },
      });
    } else {
      await client.query(
        `UPDATE payment_submissions SET review_status = 'REJECTED', reviewed_by = $2, reviewed_at = NOW(), remarks = $3,
          verified_amount = NULL, verified_reference_no = NULL, verified_payment_date = NULL WHERE id = $1`,
        [req.resourceId, req.user.id, body.remarks],
      );
      await writeAuditLog({
        client,
        actorUserId: req.user.id,
        entityName: "PAYMENT_SUBMISSION",
        entityId: req.resourceId,
        action: "REJECT",
        oldValues: { reviewStatus: "PENDING" },
        newValues: { reviewStatus: "REJECTED", remarks: body.remarks },
      });
    }
    await regeneratePrescriptiveRecommendations(client);
    await client.query("COMMIT");
    return res.json({ message: body.status === "APPROVED" ? "Payment approved and applied to the SOA." : "Payment proof rejected." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") return res.status(409).json({ message: "That payment reference number was already approved." });
    return next(error);
  } finally { client?.release(); }
});

router.delete("/:id", allowRoles("ADMIN"), requireId, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT id, review_status, receipt_path, receipt_storage, receipt_cloudinary_public_id
       FROM payment_submissions WHERE id = $1 FOR UPDATE`,
      [req.resourceId],
    );
    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Payment submission not found." });
    }
    if (locked.rows[0].review_status !== "REJECTED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only rejected payment submissions can be permanently deleted." });
    }

    await client.query("DELETE FROM payment_submissions WHERE id = $1", [req.resourceId]);
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "PAYMENT_SUBMISSION",
      entityId: req.resourceId,
      action: "DELETE",
      oldValues: {
        reviewStatus: locked.rows[0].review_status,
        receiptPath: locked.rows[0].receipt_path,
        receiptStorage: locked.rows[0].receipt_storage,
        receiptCloudinaryPublicId: locked.rows[0].receipt_cloudinary_public_id,
      },
      remarks: "Admin permanently deleted a rejected payment proof.",
    });
    await client.query("COMMIT");

    if (locked.rows[0].receipt_storage === "CLOUDINARY" && locked.rows[0].receipt_cloudinary_public_id) {
      await destroyReceipt(locked.rows[0].receipt_cloudinary_public_id).catch((error) => {
        console.error(`Cloudinary cleanup failed for receipt ${locked.rows[0].receipt_cloudinary_public_id}:`, error);
      });
    } else if (locked.rows[0].receipt_path) {
      const filePath = path.join(uploadDirectory, path.basename(locked.rows[0].receipt_path));
      await unlink(filePath).catch(() => {});
    }

    return res.json({ message: "Rejected payment submission permanently deleted." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
