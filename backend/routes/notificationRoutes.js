import express from "express";
import { z } from "zod";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { getWebPushConfig, isPushEndpoint, isSubscriptionKey, isSubscriptionSecret } from "../services/webPush.js";

const router = express.Router();
const endpointSchema = z.string().max(2048).refine(isPushEndpoint, "Unsupported browser push endpoint.");
const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().length(87).refine(isSubscriptionKey),
    auth: z.string().length(22).refine(isSubscriptionSecret),
  }),
});

router.use(requireAuth);

router.post("/push/settings", validateBody(z.object({ endpoint: endpointSchema.optional() })), async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const config = getWebPushConfig();
  if (!config) return res.json({ publicKey: null, enabled: false });
  try {
    const { endpoint } = req.validatedBody;
    const result = endpoint && await pool.query(
      "SELECT id FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
      [req.user.id, endpoint],
    );
    return res.json({ publicKey: config.publicKey, enabled: Boolean(result?.rowCount) });
  } catch (error) { return next(error); }
});

router.put("/push/subscription", validateBody(subscriptionSchema), async (req, res, next) => {
  if (!getWebPushConfig()) return res.status(503).json({ message: "Push notifications are unavailable." });
  try {
    const { endpoint, keys } = req.validatedBody;
    const result = await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
       WHERE push_subscriptions.user_id = EXCLUDED.user_id`,
      [req.user.id, endpoint, keys.p256dh, keys.auth],
    );
    if (!result.rowCount) return res.status(409).json({ message: "This device subscription is already linked to another account." });
    return res.sendStatus(204);
  } catch (error) { return next(error); }
});

router.delete("/push/subscription", validateBody(z.object({ endpoint: endpointSchema })), async (req, res, next) => {
  try {
    await pool.query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [req.user.id, req.validatedBody.endpoint]);
    return res.sendStatus(204);
  } catch (error) { return next(error); }
});

router.get("/", async (req, res, next) => {
  try {
    const requestedLimit = Number(req.query.limit || 20);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
    const requestedOffset = Number(req.query.offset || 0);
    const offset = Number.isSafeInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    const unreadOnly = req.query.status === "unread";
    const statusClause = unreadOnly ? " AND read_at IS NULL" : "";
    const [notifications, unread, total] = await Promise.all([
      pool.query(
        `SELECT id, notification_type AS "type", title, message, href,
          read_at AS "readAt", created_at AS "createdAt"
         FROM user_notifications
         WHERE recipient_user_id = $1${statusClause}
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset],
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM user_notifications WHERE recipient_user_id = $1 AND read_at IS NULL",
        [req.user.id],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM user_notifications WHERE recipient_user_id = $1${statusClause}`,
        [req.user.id],
      ),
    ]);
    return res.json({ notifications: notifications.rows, unreadCount: unread.rows[0].count, totalCount: total.rows[0].count });
  } catch (error) { return next(error); }
});

router.patch("/read-all", async (req, res, next) => {
  try {
    await pool.query(
      "UPDATE user_notifications SET read_at = NOW() WHERE recipient_user_id = $1 AND read_at IS NULL",
      [req.user.id],
    );
    return res.json({ message: "All notifications marked as read." });
  } catch (error) { return next(error); }
});

router.patch("/:id/read", requireId, async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE user_notifications SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND recipient_user_id = $2
       RETURNING id, read_at AS "readAt"`,
      [req.resourceId, req.user.id],
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Notification not found." });
    return res.json({ notification: result.rows[0] });
  } catch (error) { return next(error); }
});

export default router;
