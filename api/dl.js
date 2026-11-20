/**
 * GET /api/dl?url=…&mode=video|audio&height=NN — serverless variant.
 * Streams the media to the browser through the function.
 *
 * Why a stream and not the desktop job flow: serverless has no persistent disk
 * and no cross-request memory, so there is no ./downloads and no job list.
 * yt-dlp writes to stdout and we pipe it straight at the client, which is what
 * the Content-Disposition download needs.
 */
import { spawn } from 'node:child_process';
import { ytPath, commonArgs, formatPlan, hintFor, run } from './_util.js';

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

  // ffmpeg decides merge vs progressive-only; check once, cheaply.
  const ff = await run('ffmpeg', ['-version'], 8000);
  const plan = formatPlan(mode, height, ff.code === 0);

  const args = ['--no-simulate', '-o', '-', ...commonArgs(), ...plan.args, url];

  let child;
  try {
    child = spawn(ytPath(), args, { windowsHide: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not start the engine.', detail: String(e) });
    return;
  }

  // yt-dlp writes progress chatter to stderr; stderr must drain or it deadlocks.
  let stderr = '';
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));

  child.on('close', (code) => {
    if (!res.headersSent) {
      res.status(502).json({
        error: 'The source did not produce a stream.',
        detail: (stderr || '').trim().split('\n').pop() || `exit ${code}`,
        hint: hintFor(stderr),
      });
    } else {
      res.end();
    }
  });

  child.on('error', (e) => {
    if (!res.headersSent) res.status(500).json({ error: 'Engine failed.', detail: e.message });
    else res.end();
  });

  // Wait for the first byte so a failure answers as JSON instead of a
  // zero-byte "download" that looks like it worked.
  const outcome = await new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => settle('timeout'), 15000);

    function settle(v) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      resolve(v);
    }
    const onData = () => settle('data');
    const onClose = (c) => settle(`close:${c}`);
    const onError = () => settle('error');

    child.stdout.once('data', onData);
    child.once('close', onClose);
    child.once('error', onError);
  });

  if (outcome !== 'data') {
    if (!res.headersSent) {
      try { child.kill('SIGKILL'); } catch {}
      res.status(502).json({
        error: outcome === 'timeout' ? 'The source took too long to start.' : 'The source did not produce a stream.',
        detail: (stderr || '').trim().split('\n').pop() || outcome,
        hint: hintFor(stderr),
      });
    }
    return;
  }

  res.setHeader('Content-Type', plan.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${slug(title, plan.ext)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  child.stdout.pipe(res);

  // Client left (cancel / tab closed): stop the engine instead of burning the
  // whole time budget on a download nobody is reading.
  req.on('close', () => {
    try { child.kill('SIGKILL'); } catch {}
  });
}
