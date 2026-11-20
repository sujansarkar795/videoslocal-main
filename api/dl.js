/**
 * GET /api/dl?url=…&mode=video|audio&height=NN — serverless variant.
 *
 * Shape of the thing: yt-dlp downloads and merges to a real file in /tmp, then
 * the file is streamed to the browser. It is deliberately not `-o -` straight
 * into the response — an MP4 written to a pipe has no seekable header, so the
 * muxer cannot write the avcC box and players report "non-existing PPS 0"
 * for every frame. Verified on a real download: right duration, undecodable
 * video. /tmp is the only writable place in a function, and it is per-container.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ytPath, ffmpegPath, commonArgs, formatPlan, hintFor, run, authArgs } from './_util.js';

const MAX_BYTES = '250M'; // /tmp is ~512 MB and shared with the binaries' scratch

function slug(title, ext) {
  const t = String(title || 'video')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70) || 'video';
  return `${t}.${ext}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only.' });
    return;
  }

  const url = String(req.query.url || '').trim();
  const mode = req.query.mode === 'audio' ? 'audio' : 'video';
  const height = /^\d{3,4}$/.test(String(req.query.height || '')) ? Number(req.query.height) : null;
  const title = String(req.query.title || '').slice(0, 80);

  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'Missing or invalid url.' });
    return;
  }

  // ffmpeg decides merge vs progressive-only; it ships via postinstall, but a
  // deploy without it must still answer instead of failing on a merge.
  const ffBin = ffmpegPath();
  const ffOk = (await run(ffBin, ['-version'], 8000)).code === 0;
  const plan = formatPlan(mode, height, ffOk);

  const id = randomUUID().slice(0, 8);
  const out = `/tmp/${id}.${plan.ext}`;

  const args = [
    '-o', out,
    '--no-playlist',
    '--no-warnings',
    '--no-mtime',
    '--max-filesize', MAX_BYTES,
    ...authArgs(),
    ...(ffOk ? ['--ffmpeg-location', ffBin] : []),
    ...plan.args,
    url,
  ];

  let child;
  try {
    child = spawn(ytPath(), args, { windowsHide: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not start the engine.', detail: String(e) });
    return;
  }

  let stderr = '';
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));

  const code = await new Promise((resolve) => {
    child.on('error', () => resolve(-1));
    child.on('close', (c) => resolve(c));
  });

  const exists = fs.existsSync(out);
  const size = exists ? fs.statSync(out).size : 0;

  if (code !== 0 || !exists || size < 1000) {
    try { child.kill('SIGKILL'); } catch {}
    if (exists) { try { fs.unlinkSync(out); } catch {} }
    res.status(502).json({
      error: size === 0 && /max-filesize|larger than/i.test(stderr)
        ? 'That file is larger than this deployment can hold.'
        : 'The source did not produce a file.',
      detail: (stderr || '').trim().split('\n').filter(Boolean).pop() || `exit ${code}`,
      hint: hintFor(stderr),
    });
    return;
  }

  res.setHeader('Content-Type', plan.mime);
  res.setHeader('Content-Length', String(size));
  res.setHeader('Content-Disposition', `attachment; filename="${slug(title, plan.ext)}"`);
  res.setHeader('Cache-Control', 'no-store');

  const stream = fs.createReadStream(out);
  stream.pipe(res);

  const drop = () => { try { fs.unlinkSync(out); } catch {} };
  stream.on('close', drop);
  stream.on('error', () => { drop(); if (!res.headersSent) res.status(500).end(); });
  res.on('close', () => { if (!res.writableEnded) stream.destroy(); });
}
