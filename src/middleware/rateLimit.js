const rateLimit = require('express-rate-limit');

/* Per-IP limits. app.set('trust proxy', 1) is on, so the default keyGenerator uses the real client IP from nginx. */
const limiter = (windowMs, limit, keyGenerator) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => res.status(429).json({ error: 'Too many requests' }),
  });

/* POST /api/auth/login — 10 per 15 min */
const loginLimiter = limiter(15 * 60 * 1000, 10);

/* Public POSTs (comments, newsletter, poll vote, quiz play) — 30 per min */
const publicWriteLimiter = limiter(60 * 1000, 30);

/* ---- Readers (buckets separate from staff) ---- */
/* POST /api/reader/login — 10 per 15 min per IP, and separately 10 per 15 min per email */
const readerLoginIpLimiter = limiter(15 * 60 * 1000, 10);
const readerLoginEmailLimiter = limiter(15 * 60 * 1000, 10, (req) =>
  `email:${String((req.body || {}).email || '').toLowerCase().trim()}`
);
/* Other reader writes — 30 per min per IP */
const readerWriteLimiter = limiter(60 * 1000, 30);
/* Requests that ask for a code (signup/start, password/forgot) — 20 per hour per IP.
   Requests are counted, not codes, so a 429 doesn't reveal whether an email is registered. */
const otpIpLimiter = limiter(60 * 60 * 1000, 20);
/* Comments — 5 per min per reader (apply after requireReader) */
const readerCommentLimiter = limiter(60 * 1000, 5, (req) => `reader:${req.reader.id}`);

module.exports = {
  loginLimiter,
  publicWriteLimiter,
  readerLoginIpLimiter,
  readerLoginEmailLimiter,
  readerWriteLimiter,
  otpIpLimiter,
  readerCommentLimiter,
};
