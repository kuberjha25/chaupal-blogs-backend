const jwt = require('jsonwebtoken');
const { q } = require('../db');

/* Same permissions matrix as the approved CMS design.
   Frontend conditional rendering + backend enforcement dono isi se chalte hain. */
const PERMS = {
  admin: [
    'dashboard', 'posts', 'editor', 'media', 'playful', 'seo', 'marketing',
    'comments', 'users', 'settings', 'publish', 'delete', 'edit-content',
    'edit-meta', 'approve', 'utm', 'newsletter',
  ],
  author: [
    'dashboard', 'posts', 'editor', 'media', 'playful', 'comments',
    'edit-content', 'submit', 'approve', 'own-only',
  ],
  seo: ['dashboard', 'posts', 'seo', 'edit-meta'],
  marketing: ['dashboard', 'playful', 'marketing', 'utm', 'newsletter'],
};

const ROLES = Object.keys(PERMS);

function permsFor(role) {
  return ROLES.includes(role) ? PERMS[role] : [];
}

/* 'dev-secret' sirf development me. Production me server.js boot pe hi JWT_SECRET verify karta hai. */
const jwtSecret = () =>
  process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'dev-secret');

function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

/* Token sirf "kaun hai" dasda hai. Role te is_active har request te DB ton aunde ne,
   taaki role change / deactivate turant lagu hove (purane token da role nahi manya janda). */
async function requireAuth(req, res, next) {
  /* /api/admin te 3 routers mount ne, har ik requireAuth lagaunda — ik request te DB ik vaar */
  if (req.authLoaded) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret());
  } catch (e) {
    return res.status(401).json({ error: 'Session expired — dubara login karo' });
  }
  try {
    const rows = await q('SELECT id, name, role, is_active FROM users WHERE id = ? LIMIT 1', [payload.id]);
    const u = rows[0];
    if (!u || !u.is_active) return res.status(401).json({ error: 'Session expired — dubara login karo' });
    req.user = { id: u.id, name: u.name, role: u.role, permissions: permsFor(u.role) };
    req.authLoaded = true;
    next();
  } catch (e) {
    next(e);
  }
}

/* requirePerm('publish') ya requirePerm('edit-content,edit-meta') — koi ek match kaafi hai */
function requirePerm(perms) {
  const wanted = perms.split(',').map((p) => p.trim());
  return (req, res, next) => {
    const have = req.user ? req.user.permissions : [];
    if (wanted.some((p) => have.includes(p))) return next();
    return res.status(403).json({ error: 'Tuhade role kol is action di permission nahi hai' });
  };
}

/* Publisher (author) apne hi posts tak limited hai */
function isOwnOnly(req) {
  return req.user && req.user.permissions.includes('own-only');
}

module.exports = { PERMS, ROLES, permsFor, sign, requireAuth, requirePerm, isOwnOnly };
