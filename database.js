const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

// Brug DATA_DIR miljøvariabel hvis sat (Railway Volume), ellers projekt-mappen
const dataDir = process.env.DATA_DIR || __dirname;
if (!require('fs').existsSync(dataDir)) require('fs').mkdirSync(dataDir, { recursive: true });

let db;
try {
  db = new Database(path.join(dataDir, 'blog.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000'); // Vent op til 5s hvis DB er låst (rolling deploy)
  db.prepare('SELECT 1').get(); // test connection
} catch (err) {
  console.error('FATAL: Database initialization failed:', err);
  process.exit(1);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subtitle TEXT,
    date TEXT NOT NULL,
    image_url TEXT,
    image_type TEXT DEFAULT 'url',
    content TEXT NOT NULL,
    location_name TEXT,
    latitude REAL,
    longitude REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    locked_until TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL DEFAULT (datetime('now', '+24 hours'))
  );

  CREATE TABLE IF NOT EXISTS article_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    image_type TEXT DEFAULT 'url',
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
  );
`);

// Migrationer
const cols = db.pragma('table_info(articles)').map(c => c.name);
if (!cols.includes('location_name')) db.exec('ALTER TABLE articles ADD COLUMN location_name TEXT');
if (!cols.includes('latitude'))      db.exec('ALTER TABLE articles ADD COLUMN latitude REAL');
if (!cols.includes('longitude'))     db.exec('ALTER TABLE articles ADD COLUMN longitude REAL');

const sessionCols = db.pragma('table_info(sessions)').map(c => c.name);
if (!sessionCols.includes('expires_at')) {
  // SQLite tillader ikke datetime() som DEFAULT i ALTER TABLE — tilføj uden default
  db.exec('ALTER TABLE sessions ADD COLUMN expires_at TEXT');
  // Giv eksisterende sessioner 24 timers levetid fra nu
  db.prepare("UPDATE sessions SET expires_at = datetime('now', '+24 hours') WHERE expires_at IS NULL").run();
}

// Database-indexes for performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(date);
  CREATE INDEX IF NOT EXISTS idx_article_images_article_id ON article_images(article_id);
  CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

// Sæt adgangskode hvis den ikke allerede findes
// Brug ADMIN_PASSWORD miljøvariabel, eller fallback til 'tranevej' lokalt
const existing = db.prepare("SELECT value FROM settings WHERE key = 'password'").get();
if (!existing) {
  const initPassword = process.env.ADMIN_PASSWORD || 'tranevej';
  const hash = bcrypt.hashSync(initPassword, 12);
  db.prepare("INSERT INTO settings (key, value) VALUES ('password', ?)").run(hash);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('ADVARSEL: Ingen ADMIN_PASSWORD sat — bruger standardadgangskode. Sæt ADMIN_PASSWORD i miljøvariabler.');
  }
}

// Seed standard site-tekster
const siteDefaults = {
  site_tag:         'Rejseblog',
  site_title:       'Langs Vestkysten',
  site_description: 'Fra den dansk-tyske grænse ned langs Europas vestkyst — hele vejen til Gibraltar.',
  start_location:   'Padborg',
  end_location:     'Gibraltar',
  end_description:  'Sydspidsen af Europa. Endestationen.',
  scroll_hint:      'Scroll for at følge rejsen ↓',
  section_label:    'Opslag fra turen',
};
const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [key, value] of Object.entries(siteDefaults)) {
  insertSetting.run(key, value);
}

// Ryd udløbne sessioner ved opstart
db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

// Ryd udløbne sessioner og gamle login-forsøg hver time
setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  db.prepare("DELETE FROM login_attempts WHERE locked_until IS NULL OR locked_until <= datetime('now', '-1 day')").run();
}, 60 * 60 * 1000);

module.exports = db;
