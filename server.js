import express from 'express';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS = path.join(ROOT, 'downloads');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const COOKIES = process.env.COOKIES_FILE
  ? path.resolve(ROOT, process.env.COOKIES_FILE)
  : fs.existsSync(path.join(ROOT, 'cookies.txt'))
    ? path.join(ROOT, 'cookies.txt')
    : null;

fs.mkdirSync(DOWNLOADS, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use('/assets', express.static(path.join(ROOT, 'public', 'assets'), { etag: true, maxAge: 0 }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

/* The scraper. yt-dlp is the engine; ffmpeg does the muxing. */
const jobs = new Map(); // id -> job
const listeners = new Map(); // id -> Set<res>
let ytdlp = null; // { cmd, pre, version }

function runOnce(cmd, args) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let p;
    try {
      p = spawn(cmd, args, { windowsHide: true });
    } catch {
      return resolve(null);
    }
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => resolve(null));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

async function detectEngine() {
  const candidates = [
    ['yt-dlp', []],
    ['py', ['-m', 'yt_dlp']],
    ['python', ['-m', 'yt_dlp']],
  ];
  for (const [cmd, pre] of candidates) {
    const r = await runOnce(cmd, [...pre, '--version']);
    if (r && r.code === 0) {
      ytdlp = { cmd, pre, version: r.out.trim() };
      return;
    }
  }
  ytdlp = null;
}

function yt(args, opts = {}) {
  if (!ytdlp) throw new Error('yt-dlp is not installed. Run: py -m pip install -U yt-dlp');
  return spawn(ytdlp.cmd, [...ytdlp.pre, ...args], { windowsHide: true, ...opts });
}

function commonArgs() {
  const a = ['--no-playlist', '--no-warnings', '--no-mtime', '--windows-filenames'];
  if (COOKIES) a.push('--cookies', COOKIES);
  return a;
}

/* ---------- metadata ---------- */

app.post('/api/info', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Paste a link first.' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'That does not look like a link.' });

  const args = ['-J', '--socket-timeout', '20', ...commonArgs(), url];
  const r = await new Promise((resolve) => {
    const p = yt(args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: -1, out, err: e.message }));
  });

  if (r.code !== 0) {
    return res.status(422).json({ error: tidyError(r.err || 'Could not read that link.'), hint: hintFor(r.err) });
  }

  let data;
  try {
    data = JSON.parse(r.out);
  } catch {
    return res.status(422).json({ error: 'Could not read that link.' });
  }

  const heights = [...new Set((data.formats || [])
    .filter((f) => f.height && f.vcodec && f.vcodec !== 'none')
    .map((f) => f.height))]
    .sort((a, b) => b - a);

  res.json({
    url: data.webpage_url || url,
    id: data.id,
    title: data.title || 'Untitled',
    thumbnail: data.thumbnail || null,
    duration: data.duration || null,
    uploader: data.uploader || data.channel || data.uploader_id || '',
    site: data.extractor_key || data.extractor || '',
    isLive: !!data.is_live,
    height: data.height || null,
    heights: heights.length ? heights : [1080, 720, 480, 360],
  });
});

/* ---------- download ---------- */

app.post('/api/download', (req, res) => {
  if (!ytdlp) return res.status(503).json({ error: 'yt-dlp is not installed.' });

  const { url, mode = 'video', height = null, title = '' } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url.' });

  const id = randomUUID();
  const job = {
    id,
    url,
    title: String(title).slice(0, 120),
    status: 'queued',
    percent: 0,
    size: '',
    speed: '',
    eta: '',
    stage: 'starting',
    file: null,
    fileName: null,
    fileSize: 0,
    error: null,
    hint: null,
    startedAt: Date.now(),
    proc: null,
  };
  jobs.set(id, job);

  const args = [
    '--newline',
    '--no-simulate',
    '--print', 'after_move:filepath',
    '-N', '4',
    '-P', DOWNLOADS,
    '-o', mode === 'audio'
      ? '%(title).60s [%(id)s] audio.%(ext)s'
      : '%(title).60s [%(id)s] %(height)sp.%(ext)s',
    '-S', 'res,vcodec:h264,acodec:aac',
    ...commonArgs(),
  ];

  if (mode === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (height) {
    args.push('-f', `bv*[height<=${Number(height)}]+ba/b[height<=${Number(height)}]`, '--merge-output-format', 'mp4');
  } else {
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  }
  args.push(url);

  const proc = yt(args);
  job.proc = proc;
  job.status = 'downloading';

  const handleLine = (line) => {
    const p = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+\s*[A-Za-z]+)(?:\s+at\s+([\d.]+\s*[A-Za-z]+\/s))?(?:\s+ETA\s+([\d:]+))?/);
    if (p) {
      job.percent = Number(p[1]);
      job.size = p[2];
      job.speed = p[3] || '';
      job.eta = p[4] || '';
      job.stage = 'downloading';
      push(job);
      return;
    }
    if (/^\[Merger\]/.test(line)) {
      job.stage = 'merging';
      job.speed = '';
      job.eta = '';
      push(job);
      return;
    }
    if (/^\[ExtractAudio\]/.test(line)) {
      job.stage = 'converting';
      push(job);
      return;
    }
    const candidate = line.trim();
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      job.file = candidate;
    }
  };

  let buf = '';
  const onData = (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line) handleLine(line);
    }
  };

  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));

  proc.on('error', (e) => {
    job.status = 'error';
    job.error = e.message;
    job.hint = 'Is yt-dlp installed? Run: py -m pip install -U yt-dlp';
    push(job);
  });

  proc.on('close', (code) => {
    if (job.status === 'cancelled') return;

    if (!job.file) job.file = newestFile(DOWNLOADS, job.startedAt);

    if (code === 0 && job.file && fs.existsSync(job.file)) {
      job.status = 'done';
      job.percent = 100;
      job.stage = 'done';
      job.fileName = path.basename(job.file);
      try {
        job.fileSize = fs.statSync(job.file).size;
      } catch {}
      push(job);
      return;
    }

    job.status = 'error';
    job.error = tidyError(stderr) || `Download failed (exit ${code}).`;
    job.hint = hintFor(stderr);
    push(job);
  });

  res.json({ id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job.' });
  res.json(snapshot(job));
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify(snapshot(job))}\n\n`);

  if (!listeners.has(job.id)) listeners.set(job.id, new Set());
  listeners.get(job.id).add(res);

  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  const done = () => {
    clearInterval(ping);
    listeners.get(job.id)?.delete(res);
  };
  req.on('close', done);
  if (job.status === 'done' || job.status === 'error') setTimeout(() => res.end(), 10);
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job.' });
  job.status = 'cancelled';
  try {
    job.proc?.kill();
  } catch {}
  push(job);
  res.json({ ok: true });
});

app.get('/api/file/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.file || !fs.existsSync(job.file)) {
    return res.status(404).send('File not found.');
  }
  res.download(job.file, job.fileName || path.basename(job.file));
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: !!ytdlp,
    engine: ytdlp ? { version: ytdlp.version, cmd: [ytdlp.cmd, ...ytdlp.pre].join(' ') } : null,
    cookies: COOKIES ? path.basename(COOKIES) : null,
  });
});

/* ---------- helpers ---------- */

function snapshot(job) {
  const { proc, ...rest } = job;
  return rest;
}

function push(job) {
  const set = listeners.get(job.id);
  if (!set) return;
  const payload = `data: ${JSON.stringify(snapshot(job))}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {}
  }
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    setTimeout(() => {
      for (const res of set) {
        try {
          res.end();
        } catch {}
      }
      set.clear();
    }, 50);
  }
}

function newestFile(dir, since) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t >= since - 5000)
      .sort((a, b) => b.t - a.t);
    return files[0] ? path.join(dir, files[0].f) : null;
  } catch {
    return null;
  }
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
  if (/sign in|login|log in|cookies|bot|account/.test(t)) {
    return 'This site wants a logged-in session. Export cookies from your browser into cookies.txt next to server.js and it will work.';
  }
  if (/private|unavailable|removed/.test(t)) return 'That video is private, removed, or region-locked.';
  if (/unsupported url|no video formats/.test(t)) return 'That link does not point at a single video. Try the direct video page.';
  return null;
}

/* anything that fell through: the filed-away page */
app.use((req, res) => {
  res.status(404).sendFile(path.join(ROOT, 'public', '404.html'));
});

/* sweep old files every hour so the folder does not grow forever */
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status === 'done' && job.file && fs.existsSync(job.file)) {
      try {
        if (fs.statSync(job.file).mtimeMs < cutoff) fs.unlinkSync(job.file);
      } catch {}
    }
    if (job.status !== 'downloading' && Date.now() - job.startedAt > 12 * 60 * 60 * 1000) jobs.delete(id);
  }
}, 60 * 60 * 1000).unref();

await detectEngine();

app.listen(PORT, HOST, () => {
  console.log(`\n  videoslocal  ->  http://${HOST}:${PORT}`);
  console.log(`  engine: ${ytdlp ? `${ytdlp.cmd} ${ytdlp.pre.join(' ')} (${ytdlp.version})` : 'MISSING — run: py -m pip install -U yt-dlp'}`);
  console.log(`  cookies: ${COOKIES || 'none'}`);
  console.log(`  saving to: ${DOWNLOADS}\n`);
});
