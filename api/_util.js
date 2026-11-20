/**
 * Shared plumbing for the serverless endpoints.
 * ESM on purpose: package.json is `"type": "module"`, so a CommonJS file here
 * is parsed as ESM and dies on `module.exports` before the handler runs.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/* The bundler keeps includeFiles relative to the project root, so the binary
 * can land in a couple of places depending on how Vercel packs the function.
 * /var/task is read-only at runtime, so chmod there fails and the file may not
 * carry its exec bit: copy it to /tmp (writable, executable, cached per
 * container) and run that. */
const CANDIDATES = [
  path.join(process.cwd(), 'api', 'bin', 'yt-dlp'),
  '/var/task/api/bin/yt-dlp',
  path.join(process.cwd(), 'bin', 'yt-dlp'),
  '/var/task/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/usr/bin/yt-dlp',
];

const TMP = '/tmp/yt-dlp';

function executable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function ytPath() {
  if (executable(TMP)) return TMP;

  for (const p of CANDIDATES) {
    let exists = false;
    try { exists = fs.existsSync(p); } catch {}
    if (!exists) continue;

    try { fs.chmodSync(p, 0o755); } catch {}
    if (executable(p)) return p;

    // read-only mount or lost mode: copy where we can set the bit
    try {
      fs.copyFileSync(p, TMP);
      fs.chmodSync(TMP, 0o755);
      if (executable(TMP)) return TMP;
    } catch {}
  }

  return 'yt-dlp'; // last resort: whatever is on PATH
}

export function binaryReport() {
  return {
    cwd: process.cwd(),
    candidates: CANDIDATES.map((p) => ({ path: p, exists: (() => { try { return fs.existsSync(p); } catch { return false; } })() })),
    chosen: ytPath(),
  };
}

export function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      resolve({ code: -1, out, err: String(e) });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

export function tidyError(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[(download|info|Merger|ExtractAudio)\]/.test(l));
  const last = lines.filter((l) => /^ERROR:/i.test(l)).pop() || lines.pop() || '';
  return last.replace(/^ERROR:\s*/i, '').slice(0, 300);
}

export function hintFor(text) {
  const t = String(text || '').toLowerCase();
  if (/sign in|login|log in|cookies|confirm your age|bot/.test(t))
    return 'This source wants a logged-in session, which the serverless deploy cannot hold. Run the tool locally or on the VPS with a cookies.txt for that.';
  if (/private|unavailable|removed/.test(t)) return 'That video is private, removed, or region-locked.';
  if (/unsupported url|no video formats/.test(t)) return 'That link does not point at a single video page.';
  if (/http error 429|too many requests/.test(t))
    return 'The source is rate-limiting this server IP. Retry later; home and VPS IPs are throttled far less than cloud IPs.';
  if (/ffmpeg|merger/.test(t))
    return 'This format needs ffmpeg to merge audio and video, which this deploy does not ship. Pick a lower quality (a ready-mixed MP4) instead.';
  return null;
}

export function commonArgs() {
  return ['--no-playlist', '--no-warnings', '--no-mtime'];
}

/**
 * Without ffmpeg there is no merging and no re-encoding, so the only honest
 * output is a progressive MP4 (video) or the source audio track (m4a).
 */
export function formatPlan(mode, height, ffmpeg) {
  if (mode === 'audio') {
    if (ffmpeg) {
      return { args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'], ext: 'mp3', mime: 'audio/mpeg' };
    }
    return { args: ['-f', 'ba[ext=m4a]/ba/b'], ext: 'm4a', mime: 'audio/mp4' };
  }

  if (ffmpeg) {
    if (height) {
      return {
        args: ['-S', 'res,vcodec:h264,acodec:aac', '-f', `bv*[height<=${height}]+ba/b[height<=${height}]`, '--merge-output-format', 'mp4'],
        ext: 'mp4', mime: 'video/mp4',
      };
    }
    return { args: ['-S', 'res,vcodec:h264,acodec:aac', '-f', 'bv*+ba/b', '--merge-output-format', 'mp4'], ext: 'mp4', mime: 'video/mp4' };
  }

  // progressive only: one file, already muxed, no post-processing needed
  const cap = height ? `[height<=${height}]` : '';
  return { args: ['-f', `b${cap}[ext=mp4]/b${cap}/b`], ext: 'mp4', mime: 'video/mp4' };
}
