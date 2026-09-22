import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireId } from "../middleware/validate.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const requestedLimit = Number(req.query.limit || 20);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
    const [notifications, unread] = await Promise.all([
      pool.query(
        `SELECT id, notification_type AS "type", title, message, href,
          read_at AS "readAt", created_at AS "createdAt"
         FROM user_notifications
         WHERE recipient_user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [req.user.id, limit],
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM user_notifications WHERE recipient_user_id = $1 AND read_at IS NULL",
        [req.user.id],
      ),
    ]);
    return res.json({ notifications: notifications.rows, unreadCount: unread.rows[0].count });
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
