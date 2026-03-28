const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const requireAuth = require('../middleware/auth');

const UPLOADS_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..'), 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Kun billeder er tilladt (jpg, png, gif, webp)'));
  }
});

// Valider at en URL er http/https
function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Valider GPS-koordinater
function parseCoord(val, min, max) {
  if (val === undefined || val === null || val === '') return undefined;
  const n = parseFloat(val);
  if (isNaN(n) || n < min || n > max) return null; // null = ugyldig
  return n;
}

// Sikker filsletning — beskytter mod path traversal
function safeUnlink(imageUrl) {
  const resolved = path.resolve(path.join(__dirname, '..', imageUrl));
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) && resolved !== UPLOADS_DIR) return;
  if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
}

function getImages(articleId) {
  return db.prepare('SELECT * FROM article_images WHERE article_id = ? ORDER BY sort_order').all(articleId);
}

function saveImages(articleId, meta, files) {
  const fileMap = {};
  for (const f of files) fileMap[f.fieldname] = f;

  db.prepare('DELETE FROM article_images WHERE article_id = ?').run(articleId);

  const insert = db.prepare(
    'INSERT INTO article_images (article_id, image_url, image_type, sort_order) VALUES (?, ?, ?, ?)'
  );

  let order = 0;
  for (const item of meta) {
    if (item.type === 'url' && item.url) {
      if (!isValidHttpUrl(item.url)) continue; // Afvis javascript: og data: URLs
      insert.run(articleId, item.url, 'url', order++);
    } else if (item.type === 'upload' && fileMap[item.field]) {
      const url = `/uploads/${fileMap[item.field].filename}`;
      insert.run(articleId, url, 'upload', order++);
    }
  }
}

function deleteUploadedFiles(articleId) {
  const images = getImages(articleId);
  for (const img of images) {
    if (img.image_type === 'upload') safeUnlink(img.image_url);
  }
}

function validateArticleFields(body) {
  const { title, date, content, latitude, longitude } = body;

  if (!title || title.trim().length === 0) return 'title er påkrævet';
  if (title.length > 300) return 'title må maks. være 300 tegn';
  if (!date) return 'date er påkrævet';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date)))
    return 'Ugyldig dato (skal være YYYY-MM-DD)';
  if (!content || content.trim().length === 0) return 'content er påkrævet';
  if (content.length > 200000) return 'content er for langt';

  if (latitude !== undefined && latitude !== '') {
    const lat = parseCoord(latitude, -90, 90);
    if (lat === null) return 'latitude skal være mellem -90 og 90';
  }
  if (longitude !== undefined && longitude !== '') {
    const lng = parseCoord(longitude, -180, 180);
    if (lng === null) return 'longitude skal være mellem -180 og 180';
  }

  return null; // OK
}

// GET alle artikler
router.get('/', (req, res) => {
  const articles = db.prepare(`
    SELECT id, title, subtitle, date, location_name, latitude, longitude, created_at, updated_at
    FROM articles ORDER BY date DESC
  `).all();
  for (const a of articles) a.images = getImages(a.id);
  res.json(articles);
});

// GET enkelt artikel
router.get('/:id', (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Artikel ikke fundet' });
  article.images = getImages(article.id);
  res.json(article);
});

// POST opret artikel
router.post('/', requireAuth, upload.any(), (req, res) => {
  const validationError = validateArticleFields(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { title, subtitle, date, content, location_name, latitude, longitude, images_meta } = req.body;

  const result = db.prepare(`
    INSERT INTO articles (title, subtitle, date, content, location_name, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(), subtitle?.trim() || null, date, content,
    location_name?.trim() || null,
    parseCoord(latitude, -90, 90) ?? null,
    parseCoord(longitude, -180, 180) ?? null
  );

  const id = result.lastInsertRowid;

  if (images_meta) {
    let meta;
    try { meta = JSON.parse(images_meta); } catch {
      return res.status(400).json({ error: 'Ugyldig JSON i images_meta' });
    }
    if (!Array.isArray(meta)) return res.status(400).json({ error: 'images_meta skal være et array' });
    saveImages(id, meta, req.files || []);
  }

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  article.images = getImages(id);
  res.status(201).json(article);
});

// PUT opdater artikel
router.put('/:id', requireAuth, upload.any(), (req, res) => {
  const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Artikel ikke fundet' });

  // Valider kun felter der er medsendt
  const toValidate = { ...req.body };
  if (!toValidate.title)   toValidate.title   = existing.title;
  if (!toValidate.date)    toValidate.date    = existing.date;
  if (!toValidate.content) toValidate.content = existing.content;
  const validationError = validateArticleFields(toValidate);
  if (validationError) return res.status(400).json({ error: validationError });

  const { title, subtitle, date, content, location_name, latitude, longitude, images_meta } = req.body;

  db.prepare(`
    UPDATE articles
    SET title = ?, subtitle = ?, date = ?, content = ?,
        location_name = ?, latitude = ?, longitude = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    (title || existing.title).trim(),
    subtitle !== undefined ? (subtitle?.trim() || null) : existing.subtitle,
    date || existing.date,
    content || existing.content,
    location_name !== undefined ? (location_name?.trim() || null) : existing.location_name,
    latitude  !== undefined ? (parseCoord(latitude,  -90,  90)  ?? null) : existing.latitude,
    longitude !== undefined ? (parseCoord(longitude, -180, 180) ?? null) : existing.longitude,
    req.params.id
  );

  if (images_meta) {
    let meta;
    try { meta = JSON.parse(images_meta); } catch {
      return res.status(400).json({ error: 'Ugyldig JSON i images_meta' });
    }
    if (!Array.isArray(meta)) return res.status(400).json({ error: 'images_meta skal være et array' });

    // Slet gamle uploadede filer der ikke genbruges
    const oldImages = getImages(req.params.id);
    const keptUrls = new Set(meta.filter(m => m.type === 'url').map(m => m.url));
    for (const img of oldImages) {
      if (img.image_type === 'upload' && !keptUrls.has(img.image_url)) safeUnlink(img.image_url);
    }
    saveImages(req.params.id, meta, req.files || []);
  }

  const updated = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  updated.images = getImages(req.params.id);
  res.json(updated);
});

// DELETE slet artikel
router.delete('/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Artikel ikke fundet' });

  deleteUploadedFiles(req.params.id);
  db.prepare('DELETE FROM article_images WHERE article_id = ?').run(req.params.id);
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.json({ message: 'Artikel slettet' });
});

module.exports = router;
