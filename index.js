const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

// Brug DATA_DIR miljøvariabel hvis sat (Railway Volume), ellers projekt-mappen
const dataDir = process.env.DATA_DIR || __dirname;
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

// Stol på Railway's proxy (nødvendigt for korrekt req.ip og rate limiting)
app.set('trust proxy', 1);

// Fjern Express-fingerprint
app.disable('x-powered-by');

// CORS — tillad kun kendte origins hvis ALLOWED_ORIGINS er sat, ellers alle
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

app.use(cors({
  origin: (origin, cb) => {
    // Tillad requests uden origin (server-til-server, curl, same-origin)
    if (!origin) return cb(null, true);
    // Hvis ingen ALLOWED_ORIGINS sat — tillad alle (development/ikke-konfigureret)
    if (!allowedOrigins) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS ikke tilladt'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (IS_PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Rate limiting på API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutter
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange forespørgsler — prøv igen om lidt.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange login-forsøg — prøv igen om lidt.' },
});

app.use('/api', apiLimiter);

// Bloker adgang til databasefiler og følsomme filer
app.use((req, res, next) => {
  const blocked = /\.(db|db-shm|db-wal|sqlite|sqlite3|env|log)$/i;
  if (blocked.test(req.path)) return res.status(403).end();
  next();
});

// Servér uploadede billeder statisk fra DATA_DIR (Railway Volume eller lokal mappe)
app.use('/uploads', express.static(uploadsDir));

// Servér admin-panel
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// Ingen browser-caching af API-svar
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Auth routes — ekstra rate limit
app.use('/api/auth', authLimiter, require('./routes/auth'));

// Article-routes (GET er public, POST/PUT/DELETE kræver auth)
app.use('/api/articles', require('./routes/articles'));

// Settings-routes (GET er public, PUT kræver auth)
app.use('/api/settings', require('./routes/settings'));

// Servér public frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Health check — ingen interne stier i produktion
app.get('/api/health', (req, res) => {
  const dbPath = path.join(dataDir, 'blog.db');
  const info = { status: 'ok', time: new Date().toISOString() };
  if (!IS_PROD) {
    info.uploadsDir = uploadsDir;
    info.dbPath = dbPath;
    info.uploadsExists = fs.existsSync(uploadsDir);
    info.dbExists = fs.existsSync(dbPath);
  }
  res.json(info);
});

const server = app.listen(PORT, () => {
  console.log(`Blog API kører på http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin/`);
  console.log(`DATA_DIR: ${dataDir}`);
  console.log(`Uploads: ${uploadsDir}`);
  console.log(`Database: ${path.join(dataDir, 'blog.db')}`);
});

// Graceful shutdown — forhindrer npm-fejl ved Railway rolling deploy
process.on('SIGTERM', () => {
  console.log('SIGTERM modtaget — lukker ned...');
  server.close(() => {
    const db = require('./database');
    try { db.close(); } catch {}
    process.exit(0);
  });
});
