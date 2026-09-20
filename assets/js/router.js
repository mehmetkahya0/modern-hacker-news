// Hash tabanlı yönlendirme — GitHub Pages'te sunucu ayarı gerektirmez.

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { parts, query, raw };
}

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
}

export function onRoute(handler) {
  window.addEventListener('hashchange', handler);
  handler();
}
