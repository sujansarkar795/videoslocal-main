# Deploying this repo

One source, two runtimes. Vercel is now the **supported deploy target**; the old
Node server and Dockerfile remain for local use and self-hosting, but Vercel
serves the public site from `api/`.

## What runs where

| Surface | Local / VPS | Vercel |
|---|---|---|
| Static pages | `server.js` static host | Vercel static build from `public/` |
| Resolve link | `server.js` → `/api/info` | `api/info.js` serverless |
| Download | `server.js` → `/api/download` + SSE jobs | `api/dl.js` serverless **stream** |
| Engine | system `yt-dlp` on PATH | standalone binary fetched at build into `api/bin/` |

## Why the rewrite

The first Vercel deploy 500'd (`FUNCTION_INVOCATION_FAILED`) because Vercel has
no long-running processes, no persistent disk, and no bundled yt-dlp/ffmpeg.
The classic server cannot work there. The serverless endpoints avoid all three:
they are stateless, fetch the engine binary during the build, and stream the
download straight through the function to the browser.

## Deploy steps

1. Push to GitHub (this repo).
2. Vercel → Add New → Project → import `videoslocal-main`.
3. Framework preset: **Other**. Build command: none. Output: none.
4. Deploy. Verify `https://<app>.vercel.app/api/health` returns
   `{"ok":true,...}` — it should report the yt-dlp version fetched at build time.

## Limits of the serverless mode (by design)

- No progress percent — the function streams, it does not report.
- No cancel button — the browser controls the transfer.
- Function time caps long videos (`maxDuration: 300` on `api/dl.js`; Hobby
  accounts cap at 60s regardless of config).
- Cloud IPs get rate-limited by platforms more than home/VPS IPs.
- Login-walled sources need `cookies.txt`, which serverless can't hold — run
  that class of source locally or on the VPS.

For those cases the Docker/VPS path still works unchanged:

```bash
cd deploy && docker compose up -d --build
```

## Local development

```bash
npm install        # also fetches api/bin/yt-dlp when on Linux/Vercel builds
npm start          # http://127.0.0.1:4173 — full experience, job UI, cookies
```

On Windows/macOS the postinstall is a no-op; the local server uses the system
`yt-dlp` from PATH.
