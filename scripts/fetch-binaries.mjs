/**
 * Downloads the yt-dlp standalone Linux binary into api/bin/.
 * Runs only on Vercel's Linux build image (or explicitly forced);
 * on Windows/macOS dev machines it exits immediately.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'api', 'bin');
const TARGET = path.join(BIN, 'yt-dlp');

const onLinux = process.platform === 'linux';
const onVercel = !!process.env.VERCEL;

if (!onLinux && !onVercel) {
  console.log('fetch-binaries: skipped (not a Linux/Vercel build)');
  process.exit(0);
}

fs.mkdirSync(BIN, { recursive: true });

if (fs.existsSync(TARGET) && fs.statSync(TARGET).size > 10_000_000) {
  console.log('fetch-binaries: yt-dlp already present');
} else {
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  console.log(`fetch-binaries: downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`fetch-binaries: download failed (HTTP ${res.status})`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(TARGET, buf);
  fs.chmodSync(TARGET, 0o755);
  console.log(`fetch-binaries: wrote ${(buf.length / 1e6).toFixed(1)} MB to api/bin/yt-dlp`);
}
