const express = require('express');
const router = express.Router();
const db = require('../database');
const requireAuth = require('../middleware/auth');

const SITE_KEYS = ['site_tag', 'site_title', 'site_description', 'start_location', 'end_location'];

// GET /api/settings — public
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT key, value FROM settings WHERE key IN (${SITE_KEYS.map(() => '?').join(',')})`
  ).all(...SITE_KEYS);

  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

// PUT /api/settings — kræver auth
router.put('/', requireAuth, (req, res) => {
  const update = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  const saved = {};
  for (const key of SITE_KEYS) {
    if (req.body[key] !== undefined) {
      const val = String(req.body[key]).trim();
      if (val.length === 0) continue;
      if (val.length > 500) return res.status(400).json({ error: `${key} er for langt` });
      update.run(key, val);
      saved[key] = val;
    }
  }

  res.json(saved);
});

module.exports = router;
