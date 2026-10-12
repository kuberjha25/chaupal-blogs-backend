const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { a } = require('../utils');
const { sign, permsFor, requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');

router.post(
  '/login',
  loginLimiter,
  a(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are both required' });

    const rows = await q('SELECT * FROM users WHERE email = ? LIMIT 1', [email.toLowerCase().trim()]);
    const user = rows[0];
    /* Inactive users get the same generic error — don't leak the account's state */
    if (!user || !bcrypt.compareSync(password, user.password_hash) || !user.is_active) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }

    await q('UPDATE users SET last_active = NOW() WHERE id = ?', [user.id]);

    res.json({
      token: sign(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      permissions: permsFor(user.role),
    });
  })
);

router.get(
  '/me',
  requireAuth,
  a(async (req, res) => {
    const rows = await q('SELECT id, name, email, role FROM users WHERE id = ?', [req.user.id]);
    if (!rows[0]) return res.status(401).json({ error: 'User not found' });
    res.json({ user: rows[0], permissions: permsFor(rows[0].role) });
  })
);

module.exports = router;
