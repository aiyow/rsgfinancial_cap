import crypto from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { analyzeReceipt } from "../services/receiptOcr.js";
import { writeAuditLog } from "../services/auditLog.js";

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
const reviewSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("APPROVED"),
    verifiedAmount: z.coerce.number().positive(),
    verifiedReferenceNo: z.string().trim().min(4).max(100),
    verifiedPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format."),
    remarks: z.string().trim().max(1000).optional(),
  }).strict(),
  z.object({
    status: z.literal("REJECTED"),
    remarks: z.string().trim().min(3).max(1000),
  }).strict(),
]);

const totalSql = `COALESCE((SELECT ROUND(SUM(c.quantity * c.rate_applied), 2) FROM bill_charges c WHERE c.unit_bill_id = b.id), 0)`;
const approvedSql = `COALESCE((SELECT ROUND(SUM(ap.verified_amount), 2) FROM payment_submissions ap WHERE ap.unit_bill_id = b.id AND ap.review_status = 'APPROVED'), 0)`;
const paymentSelect = `SELECT ps.id, ps.unit_bill_id AS "unitBillId", ps.submitted_by AS "submittedBy",
  ps.receipt_original_name AS "receiptOriginalName", ps.receipt_mime_type AS "receiptMimeType",
  ps.ocr_raw_text AS "ocrRawText", ps.ocr_confidence AS "ocrConfidence",
  ps.ocr_quality_status AS "ocrQualityStatus", ps.ocr_amount AS "ocrAmount",
  ps.ocr_reference_no AS "ocrReferenceNo", ps.ocr_payment_date AS "ocrPaymentDate",
  ps.review_status AS "reviewStatus", ps.reviewed_by AS "reviewedBy", ps.reviewed_at AS "reviewedAt",
  ps.verified_amount AS "verifiedAmount", ps.verified_reference_no AS "verifiedReferenceNo",
  ps.verified_payment_date AS "verifiedPaymentDate", ps.remarks, ps.submitted_at AS "submittedAt",
  b.unit_number_snapshot AS "unitNumber", b.due_date_snapshot AS "dueDate", b.published_at AS "publishedAt",
  submitter.full_name AS "submittedByName", reviewer.full_name AS "reviewedByName",
  ${totalSql} AS "billTotal", ${approvedSql} AS "approvedTotal",
  GREATEST(${totalSql} - ${approvedSql}, 0) AS "remainingBalance",
  CASE WHEN ${approvedSql} >= ${totalSql} AND ${totalSql} > 0 THEN 'PAID'
    WHEN ${approvedSql} > 0 THEN 'PARTIAL'
    WHEN b.due_date_snapshot < CURRENT_DATE THEN 'OVERDUE' ELSE 'UNPAID' END AS "paymentStatus"
  FROM payment_submissions ps
  JOIN unit_bills b ON b.id = ps.unit_bill_id
  JOIN users submitter ON submitter.id = ps.submitted_by
  LEFT JOIN users reviewer ON reviewer.id = ps.reviewed_by`;

function paymentAccess(req, params, conditions) {
  if (req.user.role === "RESIDENT") {
    params.push(req.user.id);
    conditions.push(`ps.submitted_by = $${params.length}`);
  } else if (req.user.role === "COLLECTOR") conditions.push("ps.review_status = 'APPROVED'");
}

async function residentBill(id, userId) {
  const result = await pool.query(
    `SELECT b.id,
      COALESCE((SELECT ROUND(SUM(c.quantity * c.rate_applied), 2) FROM bill_charges c WHERE c.unit_bill_id = b.id), 0) AS total,
      COALESCE((SELECT ROUND(SUM(ps.verified_amount), 2) FROM payment_submissions ps WHERE ps.unit_bill_id = b.id AND ps.review_status = 'APPROVED'), 0) AS approved
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
  let savedPath;
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

    await mkdir(uploadDirectory, { recursive: true });
    const extension = req.file.mimetype === "image/png" ? ".png" : ".jpg";
    const fileName = `${crypto.randomUUID()}${extension}`;
    savedPath = path.join(uploadDirectory, fileName);
    await writeFile(savedPath, req.file.buffer, { flag: "wx" });
    const result = await pool.query(
      `INSERT INTO payment_submissions
        (unit_bill_id, submitted_by, receipt_path, receipt_original_name, receipt_mime_type, receipt_sha256,
         ocr_raw_text, ocr_confidence, ocr_quality_status, ocr_amount, ocr_reference_no, ocr_payment_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GOOD', $9, $10, $11)
       RETURNING id`,
      [req.resourceId, req.user.id, fileName, req.file.originalname.slice(0, 255), req.file.mimetype, digest,
        analysis.rawText, analysis.confidence, analysis.amount, analysis.referenceNo, analysis.paymentDate],
    );
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "PAYMENT_SUBMISSION",
      entityId: result.rows[0].id,
      action: "SUBMIT",
      newValues: {
        unitBillId: req.resourceId,
        receiptOriginalName: req.file.originalname.slice(0, 255),
        ocrAmount: analysis.amount,
        ocrReferenceNo: analysis.referenceNo,
        ocrPaymentDate: analysis.paymentDate,
      },
    });
    return res.status(201).json({ message: "Payment proof submitted for Admin verification.", paymentId: result.rows[0].id, analysis });
  } catch (error) {
    if (savedPath) await unlink(savedPath).catch(() => {});
    return next(error);
  }
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
    const result = await pool.query(`SELECT ps.receipt_path, ps.receipt_mime_type FROM payment_submissions ps WHERE ${conditions.join(" AND ")}`, params);
    if (!result.rows[0]) return res.status(404).json({ message: "Receipt not found." });
    const filePath = path.join(uploadDirectory, path.basename(result.rows[0].receipt_path));
    res.type(result.rows[0].receipt_mime_type);
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
      `SELECT ps.*, b.id AS bill_id FROM payment_submissions ps
       JOIN unit_bills b ON b.id = ps.unit_bill_id
       WHERE ps.id = $1 FOR UPDATE OF ps, b`, [req.resourceId],
    );
    if (!locked.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Payment submission not found." }); }
    if (locked.rows[0].review_status !== "PENDING") { await client.query("ROLLBACK"); return res.status(409).json({ message: "This payment submission was already reviewed." }); }
    const body = req.validatedBody;
    if (body.status === "APPROVED") {
      const totals = await client.query(
        `SELECT COALESCE(ROUND(SUM(c.quantity * c.rate_applied), 2), 0) AS total,
          COALESCE((SELECT ROUND(SUM(verified_amount), 2) FROM payment_submissions WHERE unit_bill_id = $1 AND review_status = 'APPROVED'), 0) AS approved
         FROM bill_charges c WHERE c.unit_bill_id = $1`, [locked.rows[0].bill_id],
      );
      const remaining = Number(totals.rows[0].total) - Number(totals.rows[0].approved);
      if (body.verifiedAmount > remaining + 0.005) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: `Verified amount exceeds the remaining balance of PHP ${remaining.toFixed(2)}.` });
      }
      const reference = await client.query(
        "SELECT id FROM payment_submissions WHERE review_status = 'APPROVED' AND LOWER(verified_reference_no) = LOWER($1)",
        [body.verifiedReferenceNo],
      );
      if (reference.rows[0]) { await client.query("ROLLBACK"); return res.status(409).json({ message: "That payment reference number was already approved." }); }
      await client.query(
        `UPDATE payment_submissions SET review_status = 'APPROVED', reviewed_by = $2, reviewed_at = NOW(),
          verified_amount = $3, verified_reference_no = $4, verified_payment_date = $5, remarks = $6 WHERE id = $1`,
        [req.resourceId, req.user.id, body.verifiedAmount, body.verifiedReferenceNo, body.verifiedPaymentDate, body.remarks || null],
      );
      await writeAuditLog({
        client,
        actorUserId: req.user.id,
        entityName: "PAYMENT_SUBMISSION",
        entityId: req.resourceId,
        action: "APPROVE",
        oldValues: { reviewStatus: "PENDING" },
        newValues: {
          reviewStatus: "APPROVED",
          verifiedAmount: body.verifiedAmount,
          verifiedReferenceNo: body.verifiedReferenceNo,
          verifiedPaymentDate: body.verifiedPaymentDate,
          remarks: body.remarks || null,
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
    await client.query("COMMIT");
    return res.json({ message: body.status === "APPROVED" ? "Payment approved and applied to the SOA." : "Payment proof rejected." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.delete("/:id", allowRoles("ADMIN"), requireId, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query(
      "SELECT id, review_status, receipt_path FROM payment_submissions WHERE id = $1 FOR UPDATE",
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
      oldValues: { reviewStatus: locked.rows[0].review_status, receiptPath: locked.rows[0].receipt_path },
      remarks: "Admin permanently deleted a rejected payment proof.",
    });
    await client.query("COMMIT");

    const filePath = path.join(uploadDirectory, path.basename(locked.rows[0].receipt_path));
    await unlink(filePath).catch(() => {});

    return res.json({ message: "Rejected payment submission permanently deleted." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
