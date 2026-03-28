const db = require('../database');

module.exports = function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Ikke autoriseret' });

  const session = db.prepare(
    "SELECT token FROM sessions WHERE token = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(token);

  if (!session) {
    // Ryd udløbet token hvis det fandtes
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Ugyldig eller udløbet session' });
  }

  next();
};
