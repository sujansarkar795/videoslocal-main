/* Engine status line, shared by every page. */
(() => {
  const el = document.getElementById('engineNote');
  if (!el) return;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  fetch('/api/health')
    .then((r) => r.json())
    .then((h) => {
      if (h.ok) {
        el.classList.add('is-ok');
        el.innerHTML = `<i class="led"></i>engine ${esc(h.engine.version)}${h.cookies ? ' · cookies' : ''}`;
      } else {
        el.classList.add('is-bad');
        el.innerHTML = `<i class="led"></i>engine missing`;
      }
    })
    .catch(() => {
      el.classList.add('is-bad');
      el.innerHTML = `<i class="led"></i>engine offline`;
    });
})();
