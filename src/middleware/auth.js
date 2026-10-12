const jwt = require('jsonwebtoken');
const { q } = require('../db');

/* Same permissions matrix as the approved CMS design.
   Both frontend conditional rendering and backend enforcement run off this. */
const PERMS = {
  admin: [
    'dashboard', 'posts', 'editor', 'media', 'playful', 'seo', 'marketing',
    'comments', 'users', 'settings', 'publish', 'delete', 'edit-content',
    'edit-meta', 'approve', 'utm', 'newsletter', 'readers', 'notify',
  ],
  author: [
    'dashboard', 'posts', 'editor', 'media', 'playful', 'comments',
    'edit-content', 'submit', 'approve', 'own-only',
  ],
  seo: ['dashboard', 'posts', 'seo', 'edit-meta'],
  marketing: ['dashboard', 'playful', 'marketing', 'utm', 'newsletter', 'readers', 'notify'],
};

const ROLES = Object.keys(PERMS);

function permsFor(role) {
  return ROLES.includes(role) ? PERMS[role] : [];
}

/* 'dev-secret' only in development. In production server.js verifies JWT_SECRET at boot. */
const jwtSecret = () =>
  process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'dev-secret');

function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

/* The token only says "who this is". Role and is_active come from the DB on every request,
   so a role change / deactivation applies immediately (the role in an old token is not trusted). */
async function requireAuth(req, res, next) {
  /* Several routers are mounted on /api/admin and each applies requireAuth — hit the DB once per request */
  if (req.authLoaded) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret());
  } catch (e) {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
  try {
    const rows = await q('SELECT id, name, role, is_active FROM users WHERE id = ? LIMIT 1', [payload.id]);
    const u = rows[0];
    if (!u || !u.is_active) return res.status(401).json({ error: 'Session expired — please log in again' });
    req.user = { id: u.id, name: u.name, role: u.role, permissions: permsFor(u.role) };
    req.authLoaded = true;
    next();
  } catch (e) {
    next(e);
  }
}

/* requirePerm('publish') or requirePerm('edit-content,edit-meta') — any one match is enough */
function requirePerm(perms) {
  const wanted = perms.split(',').map((p) => p.trim());
  return (req, res, next) => {
    const have = req.user ? req.user.permissions : [];
    if (wanted.some((p) => have.includes(p))) return next();
    return res.status(403).json({ error: 'Your role does not have permission for this action' });
  };
}

/* A Publisher (author) is limited to their own posts */
function isOwnOnly(req) {
  return req.user && req.user.permissions.includes('own-only');
}

module.exports = { PERMS, ROLES, permsFor, jwtSecret, sign, requireAuth, requirePerm, isOwnOnly };
