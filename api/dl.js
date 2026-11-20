/**
 * GET /api/dl?url=…&mode=video|audio&height=NN — serverless variant.
 * Streams the media through to the browser.
 *
 * Why a stream and not the desktop job flow: serverless functions have no
 * persistent disk or cross-request memory, so there is no ./downloads and no
 * job list. yt-dlp writes to stdout and we pipe it straight at the client,
 * which is exactly what the Content-Disposition download needs.
 */
const { ytPath, commonArgs, formatArgs, hintFor } = require('./_util.js');
const { spawn } = require('node:child_process');

function slug(title, ext) {
  const t = String(title || 'video')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
  return `${t}.${ext}`;
}

module.exports = async (req, res) => {
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

  const p = ytPath();
  const args = ['--no-simulate', '-o', '-', ...commonArgs(), ...formatArgs(mode, height), url];

  let child;
  try {
    child = spawn(p, args, { windowsHide: true });
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

  // Wait briefly for the first byte so real failures answer as JSON instead of
  // a 200-empty-file download.
  const outcome = await new Promise((resolve) => {
    let done = false;
    const onData = () => settle('data');
    const onClose = (c) => settle(`close:${c}`);
    const onError = () => settle('error');
    const timer = setTimeout(() => settle('timeout'), 8000);
    function settle(v) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      resolve(v);
    }
    child.stdout.once('data', onData);
    child.once('close', onClose);
    child.once('error', onError);
  });

  if (outcome !== 'data') {
    if (!res.headersSent) {
      try { child.kill('SIGKILL'); } catch {}
      res.status(502).json({
        error: 'No stream within the wait window.',
        detail: (stderr || '').trim().split('\n').pop() || outcome,
        hint: hintFor(stderr),
      });
    }
    return;
  }

  const ext = mode === 'audio' ? 'mp3' : 'mp4';
  const mime = mode === 'audio' ? 'audio/mpeg' : 'video/mp4';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${slug(title, ext)}"`);
  res.setHeader('Cache-Control', 'no-store');

  child.stdout.pipe(res);

  // If the client disconnects (cancel / tab close), stop the engine so the
  // function does not burn its whole time budget downloading to nowhere.
  req.on('close', () => {
    try { child.kill('SIGKILL'); } catch {}
  });
};
