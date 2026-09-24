const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { a } = require('../utils');
const { sign, permsFor, requireAuth } = require('../middleware/auth');

router.post(
  '/login',
  a(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email te password dono chahide' });

    const rows = await q('SELECT * FROM users WHERE email = ? LIMIT 1', [email.toLowerCase().trim()]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email ya password galat hai' });
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
    if (!rows[0]) return res.status(401).json({ error: 'User nahi mila' });
    res.json({ user: rows[0], permissions: permsFor(rows[0].role) });
  })
);

module.exports = router;
