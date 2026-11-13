# Self-hosted portfolio

A self-hosted, Docker-packaged alternative to [Authory](https://authory.com/): it scans
publication sites for your articles automatically and presents them on a public
portfolio page, with an admin dashboard (protected by a passkey, or HTTP Basic
Auth) for editing your bio, photo, socials and the list of sites to scan.

## How it works

- **Public portfolio** (`PUBLIC_PORT`, default `8080`) - the page anyone can
  visit: a cover image with your photo, name, tagline, bio and contact links,
  then your articles with search, source/section filters and a Featured
  showcase. The header and theme are rendered on the server (so it paints in
  its final look and link previews work); visitors can switch light/dark.
- **Admin dashboard** (`ADMIN_PORT`, default `8081`) - where you edit everything.
  By default `docker-compose.yml` binds this to `127.0.0.1` only, so **it is not
  reachable from the public internet** even though the container is running on
  a public server - see [Accessing the admin dashboard remotely](#accessing-the-admin-dashboard-remotely).

### Article scanning

For each source you add (e.g. `https://example-news.com/author/your-name`),
two scan modes are available from the admin dashboard:

- **Scan** - fast, polite, checks the site's RSS feed (most WordPress sites,
  which covers the vast majority of student/campus/local news sites, expose
  one automatically at `<author-url>/feed/`). Runs automatically every
  `SCAN_INTERVAL_MINUTES` (default 2 hours) to pick up new articles. RSS feeds
  typically only list the most recent ~10 articles, so this alone won't
  backfill your full history.
- **Full scan** - a deeper, paginated crawl of the author archive page
  (`.../page/2/`, `.../page/3/`, ...) to build your complete article history
  the first time you add a source. It's heavier on the target site (a short
  delay is added between page requests), so it's manual rather than automatic.
  It uses generic heuristics (common WordPress theme patterns) rather than a
  feed.

Either scan then visits any article that is still missing a publish date,
image or excerpt and fills those in from the article page's own metadata, and
records the site's icon for display next to its articles.

Medium profiles and publications (`https://medium.com/@you`) are scanned via
Medium's RSS feed. For other non-WordPress sites, scanning falls back to a
best-effort generic page scrape, which works less reliably - you can always
add individual articles by hand from the dashboard.

### Look and feel

Under **Display & SEO settings** in the dashboard you can pick a theme preset
as a starting point, then adjust the accent colour, cover overlay style and
strength, photo shape, grid/list layout, and separate **heading** and **body**
fonts. The bundled typefaces (Playfair Display, Fraunces, Source Serif, Inter,
DM Sans, Space Grotesk, JetBrains Mono) are served by the app itself from the
`@fontsource-variable` npm packages - nothing is loaded from a third-party CDN.

## Quick start

1. **Copy the environment file and fill it in:**

   ```bash
   cp .env.example .env
   ```

   At minimum, set `SETUP_TOKEN`, `SESSION_SECRET` and `BASIC_AUTH_PASS` to
   your own random values (see comments in `.env.example` for what each
   variable does).

2. **Build and start:**

   ```bash
   docker compose up --build -d
   ```

3. **Set up your passkey:** open `http://localhost:8081` (from the same
   machine, or via SSH tunnel - see below), enter the `SETUP_TOKEN` you set,
   and register a passkey (Touch ID, Windows Hello, a phone, a security key,
   etc.) using your browser's prompt.

4. **Add yourself:** fill in your name/bio/photo, add the publication URLs you
   want scanned, and add social/email buttons - all from the admin dashboard.

5. **Visit `http://localhost:8080`** (or whatever host/port you exposed it on)
   to see your public portfolio.

## Passkeys (WebAuthn) - what you need to know

Passkeys are a browser feature with two hard requirements set by the browser,
not by this app:

- The origin must be either exactly `http://localhost:<port>`, **or**
- Any hostname over **HTTPS**.

Plain `http://` on a real domain, or on a raw IP address, will not work - the
browser simply won't offer to create/use a passkey there.

This means, out of the box, the admin dashboard is set up for the common case
of accessing it as `http://localhost:8081` - e.g. because you're on the same
machine, or you've opened an SSH tunnel (see below). If you want to access the
admin dashboard from elsewhere using a real domain, put a reverse proxy (Caddy,
nginx, Traefik...) in front of it with a real TLS certificate, then update
`.env`:

```
RP_ID=admin.yourdomain.com
ORIGIN=https://admin.yourdomain.com
COOKIE_SECURE=true
```

...and change the admin port binding in `docker-compose.yml` to route through
your proxy instead of `127.0.0.1` only.

### Accessing the admin dashboard remotely

If the app runs on a remote server and you don't want to set up a domain/TLS
just for the admin panel, the simplest option is an SSH tunnel:

```bash
ssh -L 8081:localhost:8081 you@your-server
```

Then open `http://localhost:8081` in your local browser - to the browser,
and to this app, that's `localhost`, so passkeys work normally.

## If passkeys are too much hassle: Basic Auth fallback

Set `AUTH_MODE=basic` in `.env` (and set `BASIC_AUTH_USER` / `BASIC_AUTH_PASS`)
to skip WebAuthn entirely. In this mode the whole admin dashboard is protected
by standard HTTP Basic Auth - your browser will show its normal built-in
username/password prompt. Combined with the default `127.0.0.1`-only port
binding, this keeps the admin panel private without needing HTTPS at all.

## A note on that MemoryStore warning

You'll see `Warning: connect.session() MemoryStore is not designed for a
production environment...` in the logs. That's expected and harmless here:
sessions only exist for the one admin login, an in-memory session store is
plenty, and a restart just means logging back in with your passkey.

## Data & backups

Everything (the SQLite database and uploaded photos) lives under `./data`,
which is mounted into the container as a volume. Back that folder up; it's
all the state the app has.

## Project layout

```
server/     Express backend (two listeners: public + admin), scraper, auth
public/     Static public portfolio page
admin/      Static admin dashboard
data/       SQLite DB + uploaded photos (gitignored, created at runtime)
```

## Local development (without Docker)

```bash
npm install
cp .env.example .env
npm start
```

Requires Node 20+. `better-sqlite3` will compile a native binding on first
install if no prebuilt one is available for your platform.

## License

[MIT](LICENSE)
