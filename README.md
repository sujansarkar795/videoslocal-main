# videoslocal.store

A local transfer desk for video you have the right to keep. Paste a link, read the spec sheet,
take the file. Runs on your own machine; nothing is uploaded anywhere.

## Run

```bash
py -m pip install -U yt-dlp     # engine
npm install                     # express
npm start                       # http://127.0.0.1:4173
```

Requirements: Node 18+, Python 3.9+, ffmpeg on PATH.

## Structure

```
server.js                 API + static host + 404
Dockerfile                image: node + ffmpeg + standalone yt-dlp
deploy/                   docker-compose.yml, Caddyfile
scripts/set-ads.mjs       writes publisher/unit ids into public/
public/
  index.html              desk (tool), reading room, FAQ
  guides/                 3 articles + index
  about.html privacy.html terms.html contact.html 404.html
  ads.txt robots.txt sitemap.xml
  assets/site.css         design system
  assets/tool.js          transfer UI
  assets/status.js        engine status line (all pages)
  assets/consent.js       consent gate (localStorage)
  assets/ads.js           AdSense loader, gated on consent
downloads/                output folder, cleared after 6h
cookies.txt               optional session for login-walled sources
```

## Design

A dark instrument. Colour carries meaning only — it never decorates.

- **Base** — cool charcoal (`#0e0e12` page, `#16161b` panels, `#0a0a0d` input wells), hairline
  borders `#26262e`. No gradients, no soft shadows except the consent sheet.
- **Colour system** — state: green `#43d17c` (ready/complete), red `#ff6459` (error). Source: one
  dot per platform (`#ff4b45` YouTube, `#e8e8e8` X, `#e1306c` Instagram, `#3d8bff` Facebook,
  `#2ec8c8` TikTok, `#ff4500` Reddit). The dot is the only coloured element next to source text.
- **Action** — solid white is the only filled button; exactly one per view. Inverted contrast on
  dark, weight 600.
- **Type** — Schibsted Grotesk everywhere (700 display with −0.026em tracking, 500 UI, 400 body).
  Fragment Mono only for machine data: filenames, byte counts, durations, engine version.
- **Crispness** — 1px hairlines, tabular numerals in all readouts, 3px progress bar, 12px panel
  radius / 7px control radius, no letter-spaced caps anywhere.
- **States** — resolving / downloading / complete / failed each render exactly once, in place.
  The bar sweeps only while the byte count is unknown; motion answers action, nothing loops.

The tokens at the top of `site.css` are the whole palette; platform dots live in `tool.js`
(`siteColor`) because they belong to the data, not the stylesheet.

## Advertising (Google AdSense)

The shell is built to policy: labelled ad slots with reserved height (no layout shift), one unit
above the fold at most, consent gate before any ad request, privacy policy with the Google cookie
disclosures, ads.txt, and editorial pages with real content.

To go live:

1. Replace `ca-pub-XXXXXXXXXXXXXXXX` in every page's `<meta name="adsense-client">` (and the
   `data-ad-client` attributes) with your publisher id.
2. Replace `pub-XXXXXXXXXXXXXXXX` in `public/ads.txt` with the same id.
3. Replace each `data-ad-slot="0000000000"` with a unit id from your AdSense account.
4. Update the canonical/og URLs and `sitemap.xml` if the domain changes.
5. Serve over HTTPS on the real domain, submit the sitemap in Search Console, then apply.

Until the ids are real, the slots show a labelled placeholder and make no third-party requests.

## Cookies for private / age-gated sources

Export with a "cookies.txt" browser extension, save as `cookies.txt` next to `server.js`, restart.
`COOKIES_FILE=path` overrides the location.

## Routes

| Route | |
|---|---|
| `POST /api/info` | resolve metadata + available heights |
| `POST /api/download` | start a job (`mode`, `height`) |
| `GET /api/jobs/:id/events` | progress stream (SSE) |
| `POST /api/jobs/:id/cancel` | stop a job |
| `GET /api/file/:id` | download the finished file |
| `GET /api/health` | engine + cookies status |

## Vercel serverless

Vercel cannot run `server.js` (no long-running processes, no persistent disk, no
spawning across requests), so the repo carries a parallel serverless surface:

| File | Role |
|---|---|
| `api/health.js` | engine status (`yt-dlp --version`) |
| `api/info.js` | resolve metadata (stateless, one `yt-dlp -J`) |
| `api/dl.js` | **streams** the file to the browser via `Content-Disposition` |
| `scripts/fetch-binaries.mjs` | postinstall: downloads the standalone yt-dlp into `api/bin/` (Linux/Vercel only) |

The front end (`public/assets/tool.js`) detects the runtime from
`/api/health` and switches flows automatically: job+SSE on a server, direct
stream on serverless. No UI duplication.

Limits of the serverless mode, by design: no progress percent (the function
streams, it does not report), no cancel, no download folder, and function time
caps long videos (Hobby 60s default; `maxDuration: 300` needs Pro). For
full-length media and login-walled sources, self-host — the Docker section above
still works unchanged.

Deploy: push to GitHub, import in Vercel, framework preset **Other**, root
directory `/`. `vercel.json` sets `maxDuration` per function; no extra env vars
are required.

## VPS deploy (Docker)

Needs: a host with Docker + Compose, and DNS `A` records for `videoslocal.store` and
`www.videoslocal.store` pointing at it. Ports 80 and 443 must be reachable — Caddy uses them to
obtain the certificate.

```bash
# 1. put your AdSense ids into the pages (skip until you have them)
npm run ads -- ca-pub-1234567890123456 1234567890

# 2. ship the project to the host (git clone or rsync), then:
cd deploy
docker compose up -d --build

# 3. watch the first certificate issue
docker compose logs -f edge
```

Then submit `https://videoslocal.store/sitemap.xml` in Search Console.

| File | |
|---|---|
| `Dockerfile` | `node:22-bookworm-slim` + ffmpeg + the standalone yt-dlp build; runs as `node`, copies only `server.js` and `public/` |
| `deploy/docker-compose.yml` | app + Caddy, healthchecked, `downloads` on a named volume |
| `deploy/Caddyfile` | automatic TLS, zstd/gzip, HSTS, JSON access log |
| `scripts/set-ads.mjs` | rewrites the publisher and ad-unit placeholders across `public/` |

Updating the engine is a rebuild: `docker compose up -d --build` pulls the latest yt-dlp release.

For logged-in sources, put `cookies.txt` in the project root and uncomment the volume line in the
compose file.

The app listens on `0.0.0.0` inside the container (`HOST` env); on a desktop it stays on
`127.0.0.1` unless you set `HOST`.

## Maintenance

Platforms change; the engine moves faster than this code:

```bash
py -m pip install -U yt-dlp
```
