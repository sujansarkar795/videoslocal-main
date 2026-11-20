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

## Two things that break this deploy if you get them wrong

**1. Framework preset must not be Express.** Vercel auto-detects `server.js` and
sets the project's framework to `express`. That turns the old Node server into a
single serverless function and routes `/` and every unknown path into it — it
needs a disk, a spawned binary and long-lived jobs, so every request returns
`FUNCTION_INVOCATION_FAILED` while `public/` files still serve. If the project
was created that way, fix it once:

```bash
curl -X PATCH https://api.vercel.com/v9/projects/<project> \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H 'content-type: application/json' \
  -d '{"framework":null}'
```

or in the dashboard: Settings → General → Framework Preset → **Other** → Save →
Redeploy.

**2. `api/*.js` must be ESM.** `package.json` has `"type": "module"`, so a
CommonJS file there is parsed as ESM and dies on `module.exports` before the
handler runs — same 500. Use `export default async function handler(req, res)`.
The yt-dlp binary is not traced by the bundler either; it ships because
`vercel.json` sets `includeFiles: "api/bin/**"` per function.

## Limits of the serverless mode (by design)

- No progress percent — the function streams, it does not report.
- No cancel button — the browser controls the transfer.
- No ffmpeg. The runtime has no ffmpeg and the repo does not ship one, so there
  is no merging and no MP3. Video is a ready-mixed progressive MP4 (usually
  360p/720p); audio is the source `m4a`. `api/_util.js` checks for ffmpeg at
  request time and picks that plan automatically.
- Function time caps long videos (`maxDuration: 300` on `api/dl.js`; Hobby caps
  at 60s unless Fluid Compute is on).
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
