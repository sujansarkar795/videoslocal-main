/**
 * POST /api/info — serverless variant.
 * { url } → { title, thumbnail, duration, uploader, site, heights[] }
 * One `yt-dlp -J`; metadata only, so it fits a function comfortably.
 */
import { ytPath, run, tidyError, hintFor, commonArgs } from './_util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only.' });
    return;
  }

  const body = req.body || {};
  const url = String(body.url || '').trim();

  if (!url) {
    res.status(400).json({ error: 'Paste a link first.' });
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'That does not look like a link.' });
    return;
  }

  const r = await run(ytPath(), ['-J', '--socket-timeout', '20', ...commonArgs(), url], 55000);

  if (r.code !== 0) {
    res.status(422).json({
      error: tidyError(r.err || 'Could not read that link.'),
      hint: hintFor(r.err),
    });
    return;
  }

  let data;
  try {
    data = JSON.parse(r.out);
  } catch {
    res.status(422).json({ error: 'Could not read that link.' });
    return;
  }

  const heights = [
    ...new Set(
      (data.formats || [])
        .filter((f) => f.height && f.vcodec && f.vcodec !== 'none')
        .map((f) => f.height)
    ),
  ].sort((a, b) => b - a);

  res.status(200).json({
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
}
