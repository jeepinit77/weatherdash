# WeatherDash

Shareable dashboards for Ambient Weather personal weather stations.

Anyone can sign in with Google, connect their Ambient Weather station, and get a page at
`<your-site>/weatherdash/<station-name>` showing live conditions, a local forecast, and
history charts. A server cron job records a reading from every station every 5 minutes.

WeatherDash is self-hosted: it runs on any PHP host, shared hosting included (see
[Self-hosting](#self-hosting)). A public instance runs at
**https://jumblemint.com/weatherdash** if you want to see it first.

## How it works

- **Visitors** browse public stations or open a station link. Unlisted stations work by link but aren't in the public list.
- **Owners** sign in with Google (the only sign-in method), add up to 5 stations with their Ambient **API key** and **Application key** (both from their ambientweather.net account page) and location, and can edit or delete them. A station's exact location is never shown publicly.
- **Units** (°F, mph, in, inHg or °C, km/h, mm, hPa) are also picked per browser, from the °F/°C button in the header. Stations report in US units and conversion happens only on screen.
- **Refresh** asks Ambient for a reading right now. Only the station's signed-in owner sees it, because it spends their Ambient API quota; everyone else gets the stored readings, refreshed every minute while the tab is visible.
- **Full screen** is built for an unattended wall display: large figures only, a stale-data banner that stays up, an alert ticker, and popups that close themselves after a minute.
- **Themes** are picked per browser, not per station or per account, and are remembered in local storage: the same station is read on a phone in daylight and on a wall panel in a dark room. Four are available from the palette button in the header — Midnight Glass, Paper & Glass, Matte Slate & Chalk, and Desert Terracotta & Sage.
- **The poller** (`backend/cron.php`) fetches each station's latest data, stores it in SQLite, and rolls it up into daily summaries for the 30-day and 1-year charts. Raw readings are kept for 90 days.

## Stack

- Frontend: Vite + React + TypeScript + Tailwind CSS (`src/`)
- API: PHP 8.2 JSON endpoints (`public_html/api/`)
- Backend core: SQLite, Ambient client, cron poller (`backend/`)
- Data: Ambient Weather API (station readings), Open-Meteo and the US National Weather Service (forecast, and NWS alerts)

```
src/
  components/
    account/     AccountModal (Google sign-in, my stations, account deletion), StationForm
    dashboard/   Header, StationSwitcher, StationPage, DashboardGrid, and the alert
                 views: AlertsBanner, AlertsTicker (full screen), AlertsModal, AlertCard
    home/        HomePage (public station list)
    settings/    ThemePicker, UnitsPicker
    tiles/       The dashboard cards: temperature, wind, rain, humidity, pressure,
                 UV & solar, clock/daylight, forecast strip and its day popup
    widgets/     All sensors, hourly forecast, history chart (loaded on demand), status
    ui/          Modal, the shell every popup uses
    dev/         MockDataEditorModal (only with the local mock)
  services/      api.ts (all API calls), googleAuth.ts
  lib/           formatting, units, theme.ts, sun times, and hooks: polling that pauses
                 in background tabs, full screen, idle hide/close, shared clock tick
  index.css      every colour in the app, as one block of tokens per theme
public_html/api/
  auth.php       Google sign-in / session / account deletion
  stations.php   public list, owner CRUD, link availability check
  current.php    latest reading for a station (live=1 only for its owner)
  history.php    24h / 7d raw, 30d / 1y daily
  forecast.php   Forecast for a station's location, from Open-Meteo or the NWS
  alerts.php     Active NWS watches, warnings and advisories (cached 5 minutes)
  records.php    Record high/low for today's date, from Open-Meteo's archive
  geocode.php    Place search and reverse lookup for the station form
backend/
  config.php     reads config.json
  db.php         SQLite schema (versioned with PRAGMA user_version)
  http.php       shared API helpers (sessions, JSON, auth, rate limits)
  cache.php      file cache shared by the endpoints
  ambient.php    Ambient API client, ingestion, gap-fill, daily roll-ups
  backfill.php   pulls a new station's past year from Ambient
  stats.php      today/yesterday extremes, 7-day rain, pressure trend
  nws.php        National Weather Service client (forecast and active alerts)
  cron.php       5-minute poller (CLI only), also prunes old readings and caches
```

## Self-hosting

### Requirements

- **PHP 8.2 or newer** with the `pdo_sqlite`, `curl` and `mbstring` extensions (all standard on shared hosts). SQLite is the
  only database; it is a single file the app creates itself, so there is nothing to set up.
- **Apache** (or LiteSpeed) with `mod_rewrite` and `.htaccess` files honoured. Any ordinary
  shared host will do; a VPS works too.
- **HTTPS** on the domain. Google sign-in and the installable app both need it.
- **A cron job** every 5 minutes. Shared hosts offer this in their control panel.
- **Node.js 20 or newer** on your own machine to build the frontend. The server never needs Node.
- A **Google Cloud** project for sign-in (free; below).

Forecasts come from Open-Meteo everywhere in the world, and from the US National Weather
Service where it has coverage. **Weather alerts (watches, warnings and advisories) come only
from the NWS, so they are US-only**: stations elsewhere get forecasts but no alerts.

### Layout on the server

The whole app lives under one folder in your web root, `weatherdash/` by default:

```
weatherdash/
  index.html, assets/, icons/, .htaccess   the built frontend (everything in dist/)
  api/                                     public_html/api/*.php
  private/                                 backend/*.php, backend/.htaccess, and on the
                                           server only: config.json, db/, cache/,
                                           sessions/, logs/
```

`private/` ships an `.htaccess` that denies every request, so PHP reads it from disk but the
web server never serves it. Check this after uploading: `https://<your-site>/weatherdash/private/config.json`
must return 403 or 404. If it returns the file, your server is ignoring `.htaccess` files;
turn them on (`AllowOverride All` for the folder) before going further.

### 1. Create a Google OAuth client

Sign-in is Google only, and the app needs a client ID (no client secret).

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project (or
   pick an existing one).
2. **APIs & Services → OAuth consent screen**: set it up as **External**, give it an app name
   and support email, and publish it (the `openid`, `email` and `profile` scopes it uses need
   no verification).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type
   **Web application**:
   - Authorized JavaScript origins: `https://<your-site>` (scheme and host only)
   - Authorized redirect URIs: `https://<your-site>/weatherdash/`, exactly your base path
     with its trailing slash. Add one per environment if you run more than one.
4. Copy the client ID (`….apps.googleusercontent.com`) for `config.json`.

### 2. Write config.json

Create `private/config.json` on the server (never commit it) from
[`backend/config.json.example`](backend/config.json.example):

```json
{
  "google_client_id": "1234567890-abc.apps.googleusercontent.com",
  "user_agent": "WeatherDash (https://example.com/weatherdash, you@example.com)"
}
```

| Key | What it is |
|-----|------------|
| `google_client_id` | The OAuth client ID from step 1. Without it, sign-in is switched off and the site is read-only. |
| `user_agent` | How this install identifies itself to api.weather.gov and to OpenStreetMap's Nominatim (the station form's place search). Both ask every caller for a user agent naming the site and a contact address, and throttle or block those without. Set it to your own site and address. (`nws_user_agent`, its older name, is still read.) |

Each station owner enters their own Ambient Weather API key and Application key in the app,
so the server needs no Ambient credentials.

### 3. Choose the base path

The app is served under `/weatherdash/` unless you say otherwise. The base path is set in
one place, the `BASE_PATH` build setting, and must have a leading and trailing slash:

```bash
BASE_PATH=/weather/ npm run build   # served at https://<your-site>/weather/
BASE_PATH=/ npm run build           # served at the root of the domain
```

or put `BASE_PATH=/weather/` in a `.env.local` file (gitignored) so every build uses it.
`vite build --base /weather/` overrides it for one build. The build uses it for the
frontend's URLs and writes `dist/.htaccess` from `public_html/.htaccess` with the base path
filled into its rewrite rules. The PHP works its path out from where it is installed and
needs no setting. Upload into a folder whose name matches the base path, and use the same
path in the Google redirect URI.

### 4. Build and upload

```bash
npm install
npm run build        # writes dist/, including the hidden dist/.htaccess
```

Then upload, by SFTP, your host's file manager, or `deploy.sh` (below):

- everything in `dist/` → `weatherdash/`, **including `.htaccess`** (many FTP clients hide
  dotfiles; turn that on)
- `public_html/api/*.php` → `weatherdash/api/`
- `backend/*.php` and `backend/.htaccess` → `weatherdash/private/`

and create `weatherdash/private/config.json` as above. The database, cache, session and log
folders are created on first use; `private/` must be writable by PHP.

### 5. Add the cron job

Every 5 minutes, run the poller with the command-line PHP:

```
*/5 * * * * php /path/to/your/web-root/weatherdash/private/cron.php
```

Shared hosts usually take this in their control panel rather than `crontab`; give the full
path to both `php` (often `/usr/bin/php` or `/usr/local/bin/php`) and `cron.php`. The cron job
is the only thing that records readings, builds the daily summaries, finishes history
backfills, fills gaps after outages and prunes old data. It logs to `private/logs/cron.log`.

Then open the site, sign in, and add a station.

## Development

```bash
npm install
npm run dev      # frontend only; the API needs PHP
npm run build
npm run lint     # oxlint, then a TypeScript check
```

## Deploying with deploy.sh

`deploy.sh` builds and uploads over `ssh`/`scp` to any host with SSH access. It keeps two
environments, each in its own folder beneath the web root: `prod`, deployed from the `prod`
branch, and `dev`, deployed from the `dev` branch.

Copy `deploy.config.example` to `deploy.config` (gitignored) and fill in the SSH host, user
and port, the absolute path of the web root on the server, the site's origin, and the folder
each environment lives in. The folder is also its base path, so `PROD_FOLDER="weatherdash"`
is served at `/weatherdash/`. Each setting can also be given as an environment variable of
the same name, which wins over the file. Then:

```bash
./deploy.sh dev
./deploy.sh prod
```

The script refuses to deploy when the selected target does not match the checked-out
branch. It builds with the environment's base path, uploads the frontend, API, and
backend, and verifies that `private/config.json` cannot be served publicly. The new
frontend is uploaded to a staging folder and swapped in at the end, so the live site never
has its assets missing mid-upload, and the web-root `.htaccess` gets the environment's own
base path in its rewrite rules. It never uploads `config.json` or touches the database.
Each environment needs its own `private/config.json`, its own redirect URI on the Google
OAuth client, and maintains its own SQLite database, cache, and sessions.

A dev environment can do without the cron job. A station added there stores its first
reading and starts its history backfill straight away, and its owner's Refresh button
fetches a new reading on demand, which is enough for testing. Give a dev station its own
Ambient API key: the rate limit is per key, so a dev station sharing production's key takes
requests away from the production poller.

## License

WeatherDash is free software, licensed under the [GNU Affero General Public License v3.0](LICENSE).
Copyright (C) 2026 Jumblemint. If you run a modified version as a public website, the AGPL
asks you to offer its users the source of your version.
