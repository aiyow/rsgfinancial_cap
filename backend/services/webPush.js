import { createECDH, ECDH } from 'node:crypto';
import { sendNotification } from 'web-push';
import pool from '../config/db.js';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 10_000;
const trustedHosts = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com']);
const trustedSuffixes = ['.push.apple.com', '.notify.windows.com'];

export function isPushEndpoint(value) {
  try {
    const url = new URL(value);
    // A subscription comes from an untrusted client and controls an outbound request.
    return url.href === value && url.protocol === 'https:' && !url.username && !url.password && !url.port
      && !url.hash && (trustedHosts.has(url.hostname) || trustedSuffixes.some(suffix => url.hostname.endsWith(suffix)));
  } catch {
    return false;
  }
}

function isBase64Key(value, length) {
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === length && bytes.toString('base64url') === value;
}

export function isSubscriptionKey(value) {
  if (!isBase64Key(value, 65)) return false;
  try {
    ECDH.convertKey(Buffer.from(value, 'base64url'), 'prime256v1');
    return true;
  } catch {
    return false;
  }
}

export function isSubscriptionSecret(value) {
  return isBase64Key(value, 16);
}

export function getWebPushConfig(env = process.env) {
  const { WEB_PUSH_SUBJECT: subject, WEB_PUSH_PUBLIC_KEY: publicKey, WEB_PUSH_PRIVATE_KEY: privateKey } = env;
  if (!subject || !publicKey || !privateKey) return null;
  try {
    const contact = new URL(subject);
    if (!['mailto:', 'https:'].includes(contact.protocol) || !isBase64Key(privateKey, 32)) return null;
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== publicKey) return null;
    return { subject, publicKey, privateKey };
  } catch {
    return null;
  }
}

async function claimDeliveries(db) {
  const result = await db.query(
    `WITH due AS (
       SELECT notification_id, subscription_id FROM push_deliveries
       WHERE next_attempt_at <= NOW()
       ORDER BY next_attempt_at, notification_id, subscription_id
       LIMIT $1 FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE push_deliveries d
       SET attempts = attempts + 1, next_attempt_at = NOW() + INTERVAL '2 minutes'
       FROM due WHERE d.notification_id = due.notification_id AND d.subscription_id = due.subscription_id
       RETURNING d.notification_id, d.subscription_id, d.attempts
     )
     SELECT c.*, s.endpoint, s.p256dh, s.auth,
       (s.user_id = n.recipient_user_id AND u.is_active AND u.approval_status = 'APPROVED'
         AND n.created_at > NOW() - INTERVAL '24 hours') AS eligible
     FROM claimed c
     JOIN push_subscriptions s ON s.id = c.subscription_id
     JOIN user_notifications n ON n.id = c.notification_id
     JOIN users u ON u.id = s.user_id`,
    [BATCH_SIZE],
  );
  return result.rows;
}

async function deliver(db, send, config, item) {
  const { notification_id, subscription_id, attempts, endpoint, p256dh, auth, eligible } = item;
  const claim = [notification_id, subscription_id, attempts];
  if (eligible && attempts <= MAX_ATTEMPTS && isPushEndpoint(endpoint)) {
    try {
      // Only generic text reaches the lock screen. The signed-in app shows the details.
      await send({ endpoint, keys: { p256dh, auth } }, JSON.stringify({ id: String(notification_id) }), {
        vapidDetails: config, TTL: 3600, timeout: 10_000,
      });
    } catch (error) {
      const status = error.statusCode;
      if (status === 404 || status === 410) {
        await db.query('DELETE FROM push_subscriptions WHERE id = $1', [subscription_id]);
        return;
      }
      if (attempts < MAX_ATTEMPTS && (!status || status === 408 || status === 429 || status >= 500)) {
        await db.query(
          `UPDATE push_deliveries SET next_attempt_at = NOW() + $4::integer * INTERVAL '1 second'
           WHERE notification_id = $1 AND subscription_id = $2 AND attempts = $3`,
          [...claim, 30 * 2 ** (attempts - 1)],
        );
        return;
      }
      console.warn('Web Push delivery ended without confirmation', { status: status || 'network', attempts });
    }
  }
  await db.query('DELETE FROM push_deliveries WHERE notification_id = $1 AND subscription_id = $2 AND attempts = $3', claim);
}

export async function processWebPushQueue(config, db = pool, send = sendNotification) {
  const items = await claimDeliveries(db);
  const results = await Promise.allSettled(items.map(item => deliver(db, send, config, item)));
  if (results.some(result => result.status === 'rejected')) {
    console.error('Web Push could not update some deliveries. The queue will retry after the lease expires.');
  }
}

export function startWebPushDelivery() {
  const config = getWebPushConfig();
  if (!config) {
    if (process.env.WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_PRIVATE_KEY || process.env.WEB_PUSH_SUBJECT) {
      console.warn('Web Push is disabled because the VAPID configuration is incomplete or invalid.');
    }
    return;
  }
  let running = false;
  async function poll() {
    if (running) return;
    running = true;
    try {
      await processWebPushQueue(config);
    } catch (error) {
      console.error('Web Push queue could not be read.', { code: error.code });
    } finally {
      running = false;
    }
  }
  setInterval(poll, POLL_INTERVAL_MS).unref();
  void poll();
}
