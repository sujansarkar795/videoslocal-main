/* Serverless adapter — same UI, different endpoints.
   Desktop/VPS: /api/info + /api/download + SSE.
   Vercel: /api/info (stateless) + /api/dl (stream). Detects at load. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const slot = $('#slot');
  if (!slot) return;

  const SRV = fetch('/api/health').then(r => r.json()).catch(() => ({}));
  let MODE = 'srv';     // srv = job flow, sls = stream flow
  let info = null;
  let es = null;

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const bytes = (n) => {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
  };

  const dur = (s) => {
    if (!s) return '';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };

  const siteLabel = (k) =>
    ({ Youtube: 'YouTube', Twitter: 'X', Instagram: 'Instagram', Facebook: 'Facebook', TikTok: 'TikTok', Reddit: 'Reddit', Vimeo: 'Vimeo' }[k] || k || 'Source');

  const siteColor = (k) =>
    ({ Youtube: '#ff4b45', Twitter: '#e8e8e8', Instagram: '#e1306c', Facebook: '#3d8bff', TikTok: '#2ec8c8', Reddit: '#ff4500', Vimeo: '#17d5ff' }[k] || '#9897a3');

  SRV.then((h) => {
    if (h && h.runtime === 'vercel-serverless') MODE = 'sls';
  });

  /* ---------- paste ---------- */

  $('#paste')?.addEventListener('click', async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) return;
      $('#url').value = t;
      if (/^https?:\/\//i.test(t)) $('#form').requestSubmit();
    } catch {
      $('#url').focus();
    }
  });

  /* ---------- resolve ---------- */

  $('#form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#url').value.trim();
    if (!url) { $('#url').focus(); return; }

    teardown();
    const go = $('#go');
    go.disabled = true;
    go.textContent = 'Checking…';
    slot.innerHTML = `
      <div class="progress">
        <div class="track is-waiting"><div class="fill"></div></div>
        <p class="readout">Reading the link</p>
      </div>`;

    try {
      const r = await fetch('/api/info', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (!r.ok) return fail(data.error || 'That link could not be read.', data.hint);
      info = data;
      render(data);
    } catch {
      fail('The tool did not answer.', 'Check that the server is running on this machine.');
    } finally {
      go.disabled = false;
      go.textContent = 'Check link';
    }
  });

  /* ---------- result ---------- */

  function render(d) {
    const heights = (d.heights || []).slice(0, 4);
    const opts = [
      { v: 'best', k: 'Best' },
      ...heights.map((h) => ({ v: String(h), k: `${h}p` })),
      { v: 'audio', k: 'MP3' },
    ];

    slot.innerHTML = `
      <div class="result">
        <div class="result-head">
          <div class="thumb">
            ${d.thumbnail ? `<img src="${esc(d.thumbnail)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}
          </div>
          <div class="result-meta">
            <p class="result-title" title="${esc(d.title)}">${esc(d.title)}</p>
            <p class="result-sub">
              <span><span class="src-dot" style="background:${siteColor(d.site)}"></span>${esc(siteLabel(d.site))}</span>
              ${d.duration ? `<span>${dur(d.duration)}</span>` : ''}
              ${d.uploader ? `<span>${esc(d.uploader)}</span>` : ''}
              ${d.isLive ? '<span>Live</span>' : ''}
            </p>
          </div>
        </div>
        <fieldset class="formats">
          <legend>Format</legend>
          <div class="segmented" role="radiogroup" aria-label="Format">
            ${opts.map((o, i) => `
              <label>
                <input type="radio" name="format" value="${o.v}" ${i === 0 ? 'checked' : ''}>
                <span>${esc(o.k)}</span>
              </label>`).join('')}
          </div>
        </fieldset>
        <div class="actions">
          <button class="btn btn-solid" id="dl" type="button">${MODE === 'sls' ? 'Download via stream' : 'Download'}</button>
        </div>
        <div id="live"></div>
      </div>`;

    $('#dl').addEventListener('click', MODE === 'sls' ? stream : start);
  }

  /* ---------- flow A: job + SSE (desktop / VPS) ---------- */

  async function start() {
    if (!info) return;
    const v = $('input[name="format"]:checked')?.value || 'best';
    const mode = v === 'audio' ? 'audio' : 'video';
    const height = v === 'best' || v === 'audio' ? null : Number(v);

    $('#dl').disabled = true;
    $('#live').innerHTML = `
      <div class="progress">
        <div class="progress-head"><span id="stageLabel">Starting</span><b id="readout">0%</b></div>
        <div class="track is-waiting" id="track"><div class="fill" id="fill"></div></div>
        <p class="readout" id="detail"></p>
        <div class="actions"><button class="btn btn-sm" id="cancel" type="button">Cancel</button></div>
      </div>`;

    $('#cancel')?.addEventListener('click', () => {
      if (es) fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
    });

    let jobId;
    try {
      const r = await fetch('/api/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: info.url, mode, height, title: info.title }),
      });
      const j = await r.json();
      if (!r.ok) return fail(j.error || 'The download could not start.', j.hint);
      jobId = j.id;
      watch(jobId);
    } catch {
      fail('The download could not start.');
    }
  }

  function watch(id) {
    if (es) es.close();
    es = new EventSource(`/api/jobs/${id}/events`);

    es.onmessage = (m) => {
      const j = JSON.parse(m.data);
      let track = $('#track');
      if (!track) return;

      if (j.status === 'downloading' || j.status === 'queued') {
        track.classList.toggle('is-waiting', !j.percent);
        $('#fill').style.width = `${j.percent || 0}%`;
        $('#stageLabel').textContent =
          j.stage === 'merging' ? 'Combining audio and video' :
          j.stage === 'converting' ? 'Converting to MP3' : 'Downloading';
        $('#readout').textContent = j.percent ? `${j.percent.toFixed(0)}%` : '0%';

        const parts = [];
        if (j.size) parts.push(`${j.percent ? j.percent.toFixed(0) + '% of ' : ''}${j.size}`);
        if (j.speed) parts.push(j.speed);
        if (j.eta) parts.push(`${j.eta} left`);
        $('#detail').textContent = parts.join(', ');
        return;
      }

      if (j.status === 'done') {
        if (es) { es.close(); es = null; }
        $('#live').innerHTML = `
          <div class="done">
            <div class="done-main">
              <p class="done-file" title="${esc(j.fileName || '')}">${esc(j.fileName || 'video.mp4')}</p>
              <p class="done-meta">Saved to ./downloads${j.fileSize ? `, ${bytes(j.fileSize)}` : ''}</p>
            </div>
            <a class="btn btn-solid" href="/api/file/${j.id}" download>Save file</a>
          </div>`;
        const dl = $('#dl'); if (dl) dl.disabled = false;
        return;
      }

      if (j.status === 'error' || j.status === 'cancelled') {
        if (es) { es.close(); es = null; }
        fail(j.error || 'The download stopped.', j.hint);
        const dl = $('#dl'); if (dl) dl.disabled = false;
      }
    };

    es.onerror = () => { if (es) { es.close(); es = null; } };
  }

  /* ---------- flow B: serverless stream (Vercel) ---------- */

  async function stream() {
    if (!info) return;
    const v = $('input[name="format"]:checked')?.value || 'best';
    const mode = v === 'audio' ? 'audio' : 'video';
    const height = v === 'best' || v === 'audio' ? null : Number(v);

    $('#dl').disabled = true;
    $('#live').innerHTML = `
      <div class="progress">
        <div class="progress-head"><span id="stageLabel">Streaming to your browser</span><b id="readout"></b></div>
        <div class="track is-waiting" id="track"><div class="fill" id="fill"></div></div>
        <p class="readout">Big files depend on the function time limit. Self-host for full-length videos.</p>
      </div>`;

    const params = new URLSearchParams({
      url: info.url,
      mode,
      title: info.title || '',
    });
    if (height) params.set('height', String(height));

    // Navigating an iframe at /api/dl triggers the browser's save dialog
    // without leaving the page — same UX as the desktop Save file button.
    const iframe = document.createElement('iframe');
    iframe.src = `/api/dl?${params}`;
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);

    let settled = false;
    // probe: if the endpoint answers JSON (error), show it; a file stream never resolves as JSON
    try {
      const probe = await fetch(`/api/dl?${params}&probe=1`, { method: 'GET' });
      const ct = probe.headers.get('content-type') || '';
      if (probe.ok && ct.includes('application/json')) {
        const j = await probe.json().catch(() => ({}));
        settled = true;
        iframe.remove();
        fail(j.error || 'The stream failed.', j.hint);
        return;
      }
    } catch {}

    if (!settled) {
      // assume the iframe is downloading; wait a bit then restore the button
      setTimeout(() => {
        const track = $('#track');
        if (track) {
          track.classList.remove('is-waiting');
          $('#fill').style.width = '100%';
          $('#stageLabel').textContent = 'Download handed to your browser';
          $('#readout').textContent = '';
          $('#detail').textContent = 'Saving the file now — watch your downloads.';
          const dl = $('#dl'); if (dl) { dl.disabled = false; dl.textContent = 'Download again'; }
        }
      }, 1200);
    }
  }

  /* ---------- helpers ---------- */

  function fail(msg, hint) {
    if (es) { es.close(); es = null; }
    const target = $('#live') || slot;
    target.innerHTML = `
      <div class="error">
        <p class="error-msg">${esc(msg)}</p>
        ${hint ? `<p class="error-hint">${esc(hint)}</p>` : ''}
      </div>`;
  }

  function teardown() {
    if (es) { es.close(); es = null; }
  }
})();
