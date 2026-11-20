/**
 * GET /api/health — serverless variant.
 * Reports which engine this deployment can actually reach.
 */
const { ytPath, run } = require('./_util.js');

module.exports = async (req, res) => {
  const p = ytPath();
  const r = await run(p, ['--version'], 20000);
  const ok = r.code === 0 && /^\d{4}\./.test(r.out.trim());
  res.status(200).json({
    ok,
    engine: ok ? { version: r.out.trim(), cmd: p } : null,
    runtime: 'vercel-serverless',
    note: ok
      ? null
      : 'yt-dlp binary missing from this deployment — check the build log for fetch-binaries output.',
  });
};
