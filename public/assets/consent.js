/* Consent gate. Nothing non-essential loads before a choice is made. */
(() => {
  const KEY = 'vl.consent.v1';
  const banner = document.getElementById('consent');
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  };
  const write = (ads) => {
    const v = { ads, ts: Date.now(), v: 1 };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
    return v;
  };

  window.VLConsent = { ads: false, decided: false };

  const apply = (state) => {
    const ads = !!(state && state.ads);
    window.VLConsent = { ads, decided: true };
    document.documentElement.dataset.consent = ads ? 'all' : 'essential';
    document.dispatchEvent(new CustomEvent('vl:consent', { detail: { ads } }));
  };

  const show = () => { if (banner) banner.hidden = false; };
  const hide = () => { if (banner) banner.hidden = true; };

  const decide = (ads) => {
    apply(write(ads));
    hide();
  };

  banner?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-consent]');
    if (btn) decide(btn.dataset.consent === 'all');
  });

  document.querySelectorAll('[data-consent-open]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); show(); });
  });

  const saved = read();
  if (saved) { apply(saved); hide(); }
  else { apply({ ads: false }); show(); }
})();
