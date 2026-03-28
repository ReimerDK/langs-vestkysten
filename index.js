const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Brug DATA_DIR miljøvariabel hvis sat (Railway Volume), ellers projekt-mappen
const dataDir = process.env.DATA_DIR || __dirname;
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3001;

// Fjern Express-fingerprint
app.disable('x-powered-by');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Auth routes (ingen beskyttelse)
app.use('/api/auth', require('./routes/auth'));

// Article-routes (GET er public, POST/PUT/DELETE kræver auth)
app.use('/api/articles', require('./routes/articles'));

// Settings-routes (GET er public, PUT kræver auth)
app.use('/api/settings', require('./routes/settings'));

// Servér public frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Health check — viser storage-stier (nyttigt til fejlfinding på Railway)
app.get('/api/health', (req, res) => {
  const dbPath = path.join(dataDir, 'blog.db');
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    DATA_DIR: process.env.DATA_DIR || '(ikke sat — bruger projektmappen)',
    uploadsDir,
    dbPath,
    uploadsExists: fs.existsSync(uploadsDir),
    dbExists: fs.existsSync(dbPath),
  });
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
