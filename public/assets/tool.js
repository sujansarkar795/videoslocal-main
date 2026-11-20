/* Transfer UI — resolves a link, then runs the download and reports state. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const slot = $('#slot');
  if (!slot) return;

  let info = null;
  let es = null;
  let jobId = null;

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
    const mm = `${m}:${String(x).padStart(2, '0')}`;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : mm;
  };

  const siteLabel = (k) =>
    ({ Youtube: 'YouTube', Twitter: 'X', Instagram: 'Instagram', Facebook: 'Facebook', TikTok: 'TikTok', Reddit: 'Reddit', Vimeo: 'Vimeo' }[k] || k || 'Source');

  /* one colour per platform: colour identifies the source, it never decorates */
  const siteColor = (k) =>
    ({
      Youtube: '#ff4b45',
      Twitter: '#e8e8e8',
      Instagram: '#e1306c',
      Facebook: '#3d8bff',
      TikTok: '#2ec8c8',
      Reddit: '#ff4500',
      Vimeo: '#17d5ff',
    }[k] || '#9897a3');

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

    cancelJob();
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
          <button class="btn btn-solid" id="dl" type="button">Download</button>
        </div>
        <div id="live"></div>
      </div>`;

    $('#dl').addEventListener('click', start);
  }

  /* ---------- download ---------- */

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

    $('#cancel')?.addEventListener('click', () => cancelJob(true));

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
        track = $('#track');
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

  function cancelJob(kill) {
    if (es) { es.close(); es = null; }
    if (kill && jobId) {
      fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
    }
    jobId = null;
  }
})();
