# Blog — Langs Vestkysten

RV-rejseblog om en tur i en **Weinsberg CaraSuite 650 MEG** fra den dansk-tyske grænse ned langs Europas vestkyst til Gibraltar.

## Arkitektur

```
blog/
├── index.js              # Express server (port 3001)
├── database.js           # SQLite opsætning + migrationer + periodisk cleanup
├── middleware/
│   └── auth.js           # Token-validering (x-auth-token header)
├── routes/
│   ├── articles.js       # REST API for artikler
│   ├── auth.js           # Login / logout
│   └── settings.js       # Site-indstillinger (GET public, PUT auth)
└── public/
    ├── index.html        # Offentlig blog-frontend
    └── admin/
        ├── index.html    # Admin CMS
        └── login.html    # Login-side
```

## Køre serveren

```bash
npm run dev   # node --watch index.js
```

- Frontend: http://localhost:3001/
- Admin:    http://localhost:3001/admin/
- API:      http://localhost:3001/api/articles

## API

| Metode   | URL                   | Auth | Beskrivelse          |
|----------|-----------------------|------|----------------------|
| GET      | /api/articles         | nej  | Alle artikler (dato DESC) |
| GET      | /api/articles/:id     | nej  | Enkelt artikel       |
| POST     | /api/articles         | ja   | Opret artikel        |
| PUT      | /api/articles/:id     | ja   | Rediger artikel      |
| DELETE   | /api/articles/:id     | ja   | Slet artikel         |
| POST     | /api/auth/login       | nej  | Log ind              |
| POST     | /api/auth/logout      | ja   | Log ud               |
| GET      | /api/settings         | nej  | Hent site-tekster    |
| PUT      | /api/settings         | ja   | Opdater site-tekster |
| GET      | /api/health           | nej  | Status (stier skjult i prod) |

Auth sendes som header: `x-auth-token: <token>`

## Database (SQLite — blog.db)

**articles** — title, subtitle, date, content (HTML), location_name, latitude, longitude
**article_images** — article_id, image_url, image_type (url/upload), sort_order
**settings** — adgangskode (bcrypt-hashet, cost 12) + site-tekster:
  `site_tag`, `site_title`, `site_description`, `start_location`, `end_location`, `end_description`, `scroll_hint`, `section_label`
**login_attempts** — IP-baseret brute-force beskyttelse (max 5 forsøg, 15 min lås, eksponentiel backoff)
**sessions** — aktive login-tokens med 24-timers udløb. Ryddes ved opstart + hver time.

## Miljøvariabler

| Variabel          | Beskrivelse                                              |
|-------------------|----------------------------------------------------------|
| `DATA_DIR`        | Sti til Railway Volume (`/data`) — database + uploads    |
| `ADMIN_PASSWORD`  | Adgangskode ved første opstart (fallback: `tranevej`)    |
| `ALLOWED_ORIGINS` | Kommaseparerede CORS-origins (tillader alle hvis ikke sat) |
| `NODE_ENV`        | `production` aktiverer HSTS + skjuler health-detaljer   |
| `PORT`            | Serverport (standard: 3001, Railway sætter automatisk)  |

## Admin CMS

- Adgangskode sættes via `ADMIN_PASSWORD` ved DB-oprettelse
- Max 5 forkerte forsøg → 15 minutters lås (eksponentiel backoff)
- Felter per artikel: overskrift, underoverskrift, dato, tekst (Quill rich text), billeder (ubegrænset, URL eller upload), lokation (stednavn + GPS via browser eller klik på kort)
- Kort vises altid i artikel-editoren — klik placerer markør
- ⚙ Indstillinger i topmenuen: rediger alle 8 site-tekster
- Sidebar glider ud på mobil når artikel åbnes (< 768px), ☰-knap bringer den tilbage
- Artikler sorteres nyeste først i listen

## Frontend (public/index.html)

**Design:** Editorial Luxury — Playfair Display (serif), Plus Jakarta Sans, amber-guld accent (#B5895A), varm creme (#FDFBF7), grain-overlay, CartoDB Voyager kortfliser

**Layout:** 42% scrollbar venstre sidebar + 58% fast kort (Leaflet / CartoDB Voyager)

**Dynamiske tekster:** `loadSettings()` henter `/api/settings` ved opstart og opdaterer hero-tag, h1, beskrivelse, start/slut-lokation, scroll-hint, sektionslabel og `<title>`.

**Scroll-mekanik:**
- Bilen (🚐) starter ved første artikel med GPS-koordinater
- Mens man scroller interpoleres bilens position langs ROUTE-waypoints mellem artikel-GPS-koordinater (præcis start/slut, ruten imellem)
- `cardTops` genberegnes ved hvert scroll-event (håndterer åbne/lukkede kort)
- Kortet panner til den aktive artikel når den krydser midten af viewport
- Klik på artikel-kort → bilen animerer til lokationen + kortet flyver derhen
- Klik på prik på kortet → sidebar scroller til artiklen, artiklen åbnes, bilen flyver derhen

**Kort:**
- Ingen rutelinje (fjernet)
- Amber prikker ved artikler med GPS-koordinater (klikbare)
- 🚐-markør der bevæger sig i realtid langs ruten under scroll

**Artikelkort — Double-Bezel:**
- Ydre skal (border-radius 20px) + indre hvid kerne (17px) med inset highlight
- Thumbnail af første billede
- Dato + lokationsnavn
- Overskrift (Playfair Display) + underoverskrift
- Pill-knap "Læs mere" med ikon-i-cirkel (button-in-button)
- Udvider med HTML-indhold (DOMPurify saniteret) + billedgalleri (horisontal scroll)
- Klik på billede → lightbox
- Scroll-entry animation via IntersectionObserver (staggered fade-up)

## Hosting (Railway)

- Volume monteret på `/data` — database og uploads overlever redeploy
- `DATA_DIR=/data` miljøvariabel peger server og multer på volumet
- Graceful shutdown på SIGTERM (forhindrer npm-fejl ved rolling deploy)
- `busy_timeout=5000ms` på SQLite (håndterer overlappende deploys)

## Sikkerhed

- `.db`, `.sqlite`, `.env`, `.log`-filer returnerer 403
- `trust proxy 1` (korrekt IP-håndtering bag Railway)
- Rate limiting: 200 req/15min på `/api`, 20 req/15min på `/api/auth`
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS (prod)
- SSRF-beskyttelse: private IP-ranges blokeres i billede-URLs
- Multer: maks 20 filer, 10 MB per fil
- DOMPurify på artikel-indhold i både frontend og admin-editor
- GET på artikler og settings er offentligt — alle skrivninger kræver auth-token
- Sessioner og login-forsøg ryddes automatisk hver time
