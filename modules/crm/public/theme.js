/* ── SynnoxERP Framework - Theme loader from Launcher ── */
/* Incluye <script src="/js/theme.js"></script> y llama a `aplicarTheme()` en el <head> para evitar FOUC */

const THEME_DEFAULTS = {
  grad_c1: '0,168,107',
  grad_c2: '247,148,79',
  grad_c3: '196,98,16',
};

async function fetchTheme(launcherUrl) {
  try {
    const url = (launcherUrl || 'http://localhost:3002').replace(/\/+$/, '') + '/api/shell/config';
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return THEME_DEFAULTS;
    return await res.json();
  } catch {
    return THEME_DEFAULTS;
  }
}

function aplicarTheme(t) {
  if (!t) return;
  const root = document.documentElement;
  if (t.grad_c1) root.style.setProperty('--accent', 'rgb(' + t.grad_c1 + ')');
  if (t.grad_c2) root.style.setProperty('--accent2', 'rgb(' + t.grad_c2 + ')');
}

// Auto-aplicar si se incluye sync
(async function() {
  const theme = await fetchTheme(window._LAUNCHER_URL);
  aplicarTheme(theme);
})();
