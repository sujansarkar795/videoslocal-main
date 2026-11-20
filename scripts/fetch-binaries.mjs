/**
 * Postinstall: on Linux builds (Vercel), fetch the two binaries the serverless
 * functions exec — yt-dlp and a static ffmpeg — into api/bin/.
 * ffmpeg is not optional: modern YouTube only serves separate video and audio
 * streams, so without it there is nothing to hand the caller.
 * No-op on Windows/macOS, where the local server uses PATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'api', 'bin');

const onLinux = process.platform === 'linux' || !!process.env.VERCEL;

if (!onLinux) {
  console.log('fetch-binaries: skipped (not a Linux/Vercel build)');
  process.exit(0);
}

fs.mkdirSync(BIN, { recursive: true });

async function grab({ name, url, gz, minMb, required }) {
  const target = path.join(BIN, name);

  if (fs.existsSync(target) && fs.statSync(target).size > minMb * 1e6) {
    console.log(`fetch-binaries: ${name} already present`);
    return;
  }

  console.log(`fetch-binaries: downloading ${url}`);
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let buf = Buffer.from(await res.arrayBuffer());
    if (gz) buf = gunzipSync(buf);

    fs.writeFileSync(target, buf);
    fs.chmodSync(target, 0o755);
    console.log(`fetch-binaries: wrote ${(buf.length / 1e6).toFixed(1)} MB to api/bin/${name}`);
  } catch (e) {
    // yt-dlp is the engine: without it nothing works, so fail the build loudly.
    // ffmpeg only costs merging, and /api/health reports it, so warn and ship.
    if (required) {
      console.error(`fetch-binaries: ${name} is required and failed: ${e.message}`);
      process.exit(1);
    }
    console.warn(`fetch-binaries: ${name} unavailable (${e.message}) — merging disabled`);
  }
}

await grab({
  name: 'yt-dlp',
  url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
  gz: false,
  minMb: 10,
  required: true,
});

await grab({
  name: 'ffmpeg',
  url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz',
  gz: true,
  minMb: 20,
  required: false,
});
