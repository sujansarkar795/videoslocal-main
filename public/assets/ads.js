/* AdSense loader. Runs only after advertising consent.
   Set the publisher id in <meta name="adsense-client" content="ca-pub-…">.
   Until then the slots render as labelled placeholders (no requests, no cookies). */
(() => {
  const meta = document.querySelector('meta[name="adsense-client"]');
  const client = (meta?.content || '').trim();
  const placeholder = !client || /X{6,}/i.test(client);
  let started = false;

  document.querySelectorAll('.ad').forEach((el) => el.classList.add(placeholder ? 'is-placeholder' : 'is-live'));

  function load() {
    if (started || placeholder) return;
    started = true;

    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    s.onload = () => {
      document.querySelectorAll('ins.adsbygoogle').forEach(() => {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      });
    };
    document.head.appendChild(s);
  }

  function gate() {
    if (window.VLConsent?.ads) load();
  }

  document.addEventListener('vl:consent', gate);
  gate();
})();
