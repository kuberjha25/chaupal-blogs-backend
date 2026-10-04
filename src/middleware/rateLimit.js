const rateLimit = require('express-rate-limit');

/* Per-IP limits. app.set('trust proxy', 1) hai, isliye default keyGenerator nginx wala real client IP leta hai. */
const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many requests' }),
  });

/* POST /api/auth/login — 10 per 15 min */
const loginLimiter = limiter(15 * 60 * 1000, 10);

/* Public POSTs (comments, newsletter, poll vote, quiz play) — 30 per min */
const publicWriteLimiter = limiter(60 * 1000, 30);

module.exports = { loginLimiter, publicWriteLimiter };
