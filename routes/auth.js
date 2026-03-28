const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15; // Øget fra 1 til 15 minutter

function getAttemptRecord(ip) {
  return db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip);
}

function isLocked(record) {
  if (!record || !record.locked_until) return false;
  return new Date(record.locked_until) > new Date();
}

function secondsRemaining(record) {
  if (!record?.locked_until) return 0;
  return Math.max(0, Math.ceil((new Date(record.locked_until) - new Date()) / 1000));
}

function registerFailedAttempt(ip) {
  const record = getAttemptRecord(ip);
  const count = (record?.count || 0) + 1;

  // Eksponentiel backoff: låsetid fordobles for hvert ekstra forsøg over grænsen
  let lockedUntil = null;
  if (count >= MAX_ATTEMPTS) {
    const extra = count - MAX_ATTEMPTS;
    const minutes = LOCK_MINUTES * Math.pow(2, extra);
    lockedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }

  db.prepare(`
    INSERT INTO login_attempts (ip, count, locked_until) VALUES (?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until
  `).run(ip, count, lockedUntil);

  return { count, lockedUntil };
}

function resetAttempts(ip) {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const ip = req.ip;
  const { password } = req.body;

  const record = getAttemptRecord(ip);

  if (isLocked(record)) {
    return res.status(429).json({
      error: 'For mange forsøg. Prøv igen om lidt.',
      seconds: secondsRemaining(record)
    });
  }

  const setting = db.prepare("SELECT value FROM settings WHERE key = 'password'").get();
  const valid = setting && bcrypt.compareSync(password || '', setting.value);

  if (!valid) {
    const { count, lockedUntil } = registerFailedAttempt(ip);
    const left = Math.max(0, MAX_ATTEMPTS - count);

    if (lockedUntil) {
      return res.status(429).json({
        error: `For mange forsøg. Prøv igen om ${LOCK_MINUTES} minutter.`,
        seconds: secondsRemaining(getAttemptRecord(ip))
      });
    }

    return res.status(401).json({
      error: `Forkert adgangskode. ${left} forsøg tilbage.`,
      attempts_left: left
    });
  }

  // Login ok — ryd forsøg og opret session med udløb (24 timer)
  resetAttempts(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    "INSERT INTO sessions (token, expires_at) VALUES (?, datetime('now', '+24 hours'))"
  ).run(token);

  res.json({ token });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

module.exports = router;
