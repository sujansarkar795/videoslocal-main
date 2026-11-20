/**
 * Shared plumbing for the serverless endpoints.
 * Plain CommonJS: Vercel's Node builder treats api/* as functions only when
 * they export a handler; a helper module must not look like one. This file is
 * excluded from builds via vercel.json and imported directly by the endpoints.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;

function ytPath() {
  // scripts/fetch-binaries.mjs (postinstall) downloads the standalone binary here
  const p = path.join(HERE, 'bin', 'yt-dlp');
  try {
    fs.chmodSync(p, 0o755);
  } catch {}
  return p;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out, err: String(e) });
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    child.stdout?.on?.('data', (d) => (out += d));
    child.stderr?.on?.('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, killed: child.killed });
    });
  });
}

function tidyError(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[(download|info|Merger|ExtractAudio)\]/.test(l));
  const last = lines.filter((l) => /^ERROR:/i.test(l)).pop() || lines.pop() || '';
  return last.replace(/^ERROR:\s*/i, '').slice(0, 300);
}

function hintFor(text) {
  const t = String(text || '').toLowerCase();
  if (/sign in|login|log in|cookies|bot|account/.test(t))
    return 'This source wants a logged-in session, which is not configurable on the serverless deploy. Run the tool on your own machine or a VPS with a cookies.txt for that.';
  if (/private|unavailable|removed/.test(t)) return 'That video is private, removed, or region-locked.';
  if (/unsupported url|no video formats/.test(t)) return 'That link does not point at a single video page.';
  if (/http error 429|too many requests/.test(t))
    return 'The source is rate-limiting this shared server IP. Try again later, or self-host — home and VPS IPs are far less throttled than cloud IPs.';
  return null;
}

function commonArgs() {
  return ['--no-playlist', '--no-warnings', '--no-mtime'];
}

function formatArgs(mode, height) {
  const args = ['-S', 'res,vcodec:h264,acodec:aac'];
  if (mode === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (height) {
    args.push('-f', `bv*[height<=${height}]+ba/b[height<=${height}]`, '--merge-output-format', 'mp4');
  } else {
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  }
  return args;
}

module.exports = { ytPath, run, tidyError, hintFor, commonArgs, formatArgs };
