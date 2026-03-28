# Blog — Langs Vestkysten

RV-rejseblog om en tur i en **Weinsberg CaraSuite 650 MEG** fra den dansk-tyske grænse ned langs Europas vestkyst til Gibraltar.

## Arkitektur

```
blog/
├── index.js              # Express server (port 3001)
├── database.js           # SQLite opsætning + migrationer
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
| GET      | /api/articles         | nej  | Alle artikler        |
| GET      | /api/articles/:id     | nej  | Enkelt artikel       |
| POST     | /api/articles         | ja   | Opret artikel        |
| PUT      | /api/articles/:id     | ja   | Rediger artikel      |
| DELETE   | /api/articles/:id     | ja   | Slet artikel         |
| POST     | /api/auth/login       | nej  | Log ind              |
| POST     | /api/auth/logout      | ja   | Log ud               |
| GET      | /api/settings         | nej  | Hent site-tekster    |
| PUT      | /api/settings         | ja   | Opdater site-tekster |

Auth sendes som header: `x-auth-token: <token>`

## Database (SQLite — blog.db)

**articles** — title, subtitle, date, content (HTML), location_name, latitude, longitude
**article_images** — article_id, image_url, image_type (url/upload), sort_order
**settings** — adgangskode (bcrypt-hashet) + site-tekster (site_tag, site_title, site_description, start_location, end_location)
**login_attempts** — IP-baseret brute-force beskyttelse (max 5 forsøg, 1 min lås)
**sessions** — aktive login-tokens

## Admin CMS

- Adgangskode: `tranevej`
- Max 5 forkerte forsøg → 1 minuts lås
- Felter per artikel: overskrift, underoverskrift, dato, tekst (Quill rich text), billeder (ubegrænset, URL eller upload), lokation (stednavn + GPS via browser)
- ⚙-knap åbner indstillingssektion: rediger site_tag, site_title, site_description, start_location, end_location

## Frontend (public/index.html)

**Layout:** 42% scrollbar venstre sidebar + 58% fast kort (Leaflet / OpenStreetMap)

**Dynamiske tekster:** `loadSettings()` henter `/api/settings` ved opstart og opdaterer hero-tag, h1, beskrivelse, start/slut-lokation og `<title>`.

**Scroll-mekanik:**
- Bilen (🚐) starter ved første artikel med GPS-koordinater
- Mens man scroller interpoleres bilens position lineært mellem artikel-koordinater
- Kortet panner til den aktive artikel når man krydser midtpunktet
- Klik på artikel-kort → bilen animerer til lokationen + kortet flyver derhen
- Klik på prik på kortet → sidebar scroller til artiklen, artiklen åbnes, bilen flyver derhen

**Kort:**
- Grå rutelinje langs hele vestkysten (Padborg → Gibraltar, ~40 waypoints)
- Blå prikker ved artikler med GPS-koordinater (klikbare)
- 🚐-markør der bevæger sig i realtid under scroll

**Artikelkort:**
- Thumbnail af første billede
- Dato + lokationsnavn
- Overskrift + underoverskrift
- "Læs mere" → udvider med HTML-indhold + billedgalleri (horisontal scroll)
- Klik på billede → lightbox

## Sikkerhed

- `.db`, `.sqlite`, `.env`, `.log`-filer returnerer 403
- GET på artikler er offentligt
- Alle skrivninger kræver auth-token
