function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export async function createUserNotifications(client, notifications) {
  const items = (notifications || [])
    .filter((notification) => Number.isSafeInteger(Number(notification.recipientUserId)) && Number(notification.recipientUserId) > 0)
    .map((notification) => ({
      recipientUserId: Number(notification.recipientUserId),
      type: text(notification.type, 60) || "GENERAL",
      title: text(notification.title, 180) || "RSG Condo update",
      message: text(notification.message, 1000) || "You have a new account update.",
      href: notification.href ? text(notification.href, 500) : null,
      dedupeKey: notification.dedupeKey ? text(notification.dedupeKey, 160) : null,
    }));

  for (const notification of items) {
    await client.query(
      `INSERT INTO user_notifications
        (recipient_user_id, notification_type, title, message, href, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING`,
      [
        notification.recipientUserId,
        notification.type,
        notification.title,
        notification.message,
        notification.href,
        notification.dedupeKey,
      ],
    );
  }
}
