const rateLimit = require('express-rate-limit');

/* Per-IP limits. app.set('trust proxy', 1) hai, isliye default keyGenerator nginx wala real client IP leta hai. */
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

/* ---- Readers (staff ton alag buckets) ---- */
/* POST /api/reader/login — 10 per 15 min per IP, te alag ton 10 per 15 min per email */
const readerLoginIpLimiter = limiter(15 * 60 * 1000, 10);
const readerLoginEmailLimiter = limiter(15 * 60 * 1000, 10, (req) =>
  `email:${String((req.body || {}).email || '').toLowerCase().trim()}`
);
/* Baaki reader writes — 30 per min per IP */
const readerWriteLimiter = limiter(60 * 1000, 30);
/* Code mangan wale requests (signup/start, password/forgot) — 20 per hour per IP.
   Requests ginde ne, codes nahi, taaki 429 ton eh na pata lagge ki email registered hai ya nahi. */
const otpIpLimiter = limiter(60 * 60 * 1000, 20);
/* Comments — 5 per min per reader (requireReader ton baad lagao) */
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
