/**
 * GET /api/probe?v=VIDEO_ID — temporary diagnostic, delete after use.
 * YouTube's "Sign in to confirm you're not a bot" depends on the IP and on
 * which player client yt-dlp impersonates. This runs the same extraction under
 * several client configs from inside the deployment and reports which survive.
 *
 * Runs sequentially on purpose: yt-dlp is a PyInstaller one-file binary that
 * unpacks itself into /tmp on every start, and parallel runs each need ~40 MB
 * of scratch — eight at once exhausted /tmp and every run died extracting
 * libcrypto.so.3.
 */
import { ytPath, run, commonArgs } from './_util.js';
import fs from 'node:fs';

const VARIANTS = [
  { name: 'default', args: [] },
  { name: 'tv', args: ['--extractor-args', 'youtube:player_client=tv'] },
  { name: 'web_safari', args: ['--extractor-args', 'youtube:player_client=web_safari'] },
  { name: 'ios', args: ['--extractor-args', 'youtube:player_client=ios'] },
  { name: 'android_vr', args: ['--extractor-args', 'youtube:player_client=android_vr'] },
  { name: 'tv_ipv4', args: ['--extractor-args', 'youtube:player_client=tv', '-4'] },
];

const BUDGET_MS = 42_000;

export default async function handler(req, res) {
  const v = String(req.query.v || 'jNQXAC9IVRw');
  if (!/^[A-Za-z0-9_-]{11}$/.test(v)) {
    res.status(400).json({ error: '11-character video id only.' });
    return;
  }

  const url = `https://www.youtube.com/watch?v=${v}`;
  const bin = ytPath();
  const started = Date.now();
  const results = [];

  for (const variant of VARIANTS) {
    if (Date.now() - started > BUDGET_MS) {
      results.push({ variant: variant.name, ok: false, skipped: 'out of time budget' });
      continue;
    }
    const t0 = Date.now();
    const r = await run(
      bin,
      ['--simulate', '-f', 'b', '--print', '%(title)s|%(height)s', ...commonArgs(), ...variant.args, url],
      15_000
    );
    const ok = r.code === 0 && r.out.trim().length > 0;
    results.push({
      variant: variant.name,
      ok,
      ms: Date.now() - t0,
      out: ok ? r.out.trim().slice(0, 90) : undefined,
      err: ok ? undefined : (r.err || '').trim().split('\n').filter(Boolean).pop()?.slice(0, 150),
    });
  }

  let scratch = null;
  try {
    scratch = {
      size: fs.statSync('/tmp/yt-dlp').size,
      entries: fs.readdirSync('/tmp').filter((f) => f.startsWith('_MEI')).length,
    };
  } catch {}

  res.status(200).json({
    video: v,
    engine: (await run(bin, ['--version'], 10_000)).out.trim(),
    totalMs: Date.now() - started,
    scratch,
    passed: results.filter((r) => r.ok).map((r) => r.variant),
    results,
  });
}
