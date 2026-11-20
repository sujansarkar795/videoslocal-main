/**
 * GET /api/health — serverless variant.
 * Reports the engine this function can actually reach, plus whether ffmpeg
 * exists (it decides merge vs progressive-only, see _util.formatPlan).
 */
import { ytPath, run, binaryReport } from './_util.js';

export default async function handler(req, res) {
  const p = ytPath();
  const [engine, ff] = await Promise.all([
    run(p, ['--version'], 20000),
    run('ffmpeg', ['-version'], 10000),
  ]);

  const ok = engine.code === 0 && /^\d{4}\./.test(engine.out.trim());

  res.status(200).json({
    ok,
    engine: ok ? { version: engine.out.trim(), cmd: p } : null,
    ffmpeg: ff.code === 0 ? (ff.out.split('\n')[0] || '').trim().slice(0, 80) : null,
    runtime: 'vercel-serverless',
    node: process.version,
    note: ok ? null : `yt-dlp did not run: ${(engine.err || '').split('\n').pop() || 'no output'} — ${binaryReport().chosen}`,
    paths: ok ? undefined : binaryReport(),
  });
}
