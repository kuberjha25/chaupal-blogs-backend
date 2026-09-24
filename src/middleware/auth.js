const jwt = require('jsonwebtoken');

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

function permsFor(role) {
  return PERMS[role] || [];
}

function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    req.user.permissions = permsFor(req.user.role);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired — dubara login karo' });
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

module.exports = { PERMS, permsFor, sign, requireAuth, requirePerm, isOwnOnly };
