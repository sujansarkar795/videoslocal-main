/**
 * GET /api/probe?v=VIDEO_ID — temporary diagnostic, delete after use.
 * YouTube's "Sign in to confirm you're not a bot" depends on the IP and on
 * which player client yt-dlp impersonates. This runs the same extraction under
 * several client configs from inside the deployment and reports which survive.
 * No arbitrary URLs: only an 11-character video id.
 */
import { ytPath, run, commonArgs } from './_util.js';

const VARIANTS = [
  { name: 'default', args: [] },
  { name: 'tv', args: ['--extractor-args', 'youtube:player_client=tv'] },
  { name: 'web_safari', args: ['--extractor-args', 'youtube:player_client=web_safari'] },
  { name: 'ios', args: ['--extractor-args', 'youtube:player_client=ios'] },
  { name: 'android_vr', args: ['--extractor-args', 'youtube:player_client=android_vr'] },
  { name: 'tv_ipv4', args: ['--extractor-args', 'youtube:player_client=tv', '-4'] },
  { name: 'default_ipv4', args: ['-4'] },
  { name: 'tv_embedded', args: ['--extractor-args', 'youtube:player_client=tv_embedded'] },
];

export default async function handler(req, res) {
  const v = String(req.query.v || 'jNQXAC9IVRw');
  if (!/^[A-Za-z0-9_-]{11}$/.test(v)) {
    res.status(400).json({ error: '11-character video id only.' });
    return;
  }

  const url = `https://www.youtube.com/watch?v=${v}`;
  const bin = ytPath();

  const results = await Promise.all(
    VARIANTS.map(async (variant) => {
      const started = Date.now();
      const r = await run(
        bin,
        ['--simulate', '-f', 'b', '--print', '%(title)s|%(height)s', ...commonArgs(), ...variant.args, url],
        22000
      );
      const ok = r.code === 0 && r.out.trim().length > 0;
      return {
        variant: variant.name,
        ok,
        ms: Date.now() - started,
        out: ok ? r.out.trim().slice(0, 90) : undefined,
        err: ok ? undefined : (r.err || '').trim().split('\n').filter(Boolean).pop()?.slice(0, 140),
      };
    })
  );

  res.status(200).json({
    video: v,
    engine: (await run(bin, ['--version'], 8000)).out.trim(),
    passed: results.filter((r) => r.ok).map((r) => r.variant),
    results,
  });
}
