/* Web push to every reader who allowed notifications — shared by the Studio "send" form and the new-post notifier */
const webpush = require('web-push');
const { q } = require('./db');

/* All three env vars must be set and web-push must accept them as valid (subject mailto:/https:, key format) — otherwise null.
   With a bad key every subscription would count as "failed", so stop up front. */
const vapid = () => {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env;
  if (!publicKey || !privateKey || !subject) return null;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (e) {
    console.error(`[push] VAPID env invalid: ${e.message}`);
    return null;
  }
  return { publicKey, privateKey, subject };
};

const SEND_CONCURRENCY = 10;
const TTL_SECONDS = 24 * 60 * 60;

/* Send to one subscription; 404/410 = the browser ended the subscription → delete */
async function sendOne(sub, payload, details) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: TTL_SECONDS, vapidDetails: details }
    );
    await q('UPDATE push_subscriptions SET last_success_at = NOW() WHERE id = ?', [sub.id]);
    return true;
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) {
      await q('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
    } else {
      await q('UPDATE push_subscriptions SET failed_count = failed_count + 1 WHERE id = ?', [sub.id]);
    }
    return false;
  }
}

/* → { target, sent, failed }; null when push is not configured */
async function sendToAll({ title, body, url }) {
  const keys = vapid();
  if (!keys) return null;
  const subs = await q(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps JOIN readers r ON r.id = ps.reader_id
     WHERE r.notif_status = 'granted' AND r.is_active = 1 AND r.email_verified_at IS NOT NULL`
  );
  const payload = JSON.stringify({ title, body, url });
  const details = { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey };

  /* 10 workers, one queue */
  let next = 0;
  let sent = 0;
  let failed = 0;
  const worker = async () => {
    while (next < subs.length) {
      const sub = subs[next++];
      if (await sendOne(sub, payload, details)) sent += 1;
      else failed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, subs.length) }, worker));
  return { target: subs.length, sent, failed };
}

module.exports = { vapid, sendToAll };
