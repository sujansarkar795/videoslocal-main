/**
 * GET /api/health — serverless variant.
 * Reports the engine this function can actually reach, plus whether ffmpeg
 * exists (it decides merge vs progressive-only, see _util.formatPlan).
 */
import { ytPath, ffmpegPath, run, binaryReport, authState } from './_util.js';

export default async function handler(req, res) {
  const p = ytPath();
  const ffBin = ffmpegPath();
  const [engine, ff] = await Promise.all([
    run(p, ['--version'], 20000),
    run(ffBin, ['-version'], 10000),
  ]);

  const ok = engine.code === 0 && /^\d{4}\./.test(engine.out.trim());

  res.status(200).json({
    ok,
    engine: ok ? { version: engine.out.trim(), cmd: p } : null,
    ffmpeg: ff.code === 0 ? { cmd: ffBin, version: (ff.out.split('\n')[0] || '').trim().slice(0, 70) } : null,
    runtime: 'vercel-serverless',
    auth: authState(),
    node: process.version,
    note: ok ? null : `yt-dlp did not run: ${(engine.err || '').split('\n').pop() || 'no output'} — ${binaryReport().chosen}`,
    paths: ok ? undefined : binaryReport(),
  });
}
