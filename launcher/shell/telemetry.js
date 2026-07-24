// Telemetry auto-tracking script
(function() {
  console.log('[Telemetry] script loaded');
  function getToken() {
    var c = document.cookie.split('; ').find(function(r) { return r.startsWith('launcher_jwt='); });
    return c ? c.split('=')[1] : localStorage.getItem('launcher_jwt');
  }

  function telemetryPost(url, data) {
    var token = getToken();
    console.log('[Telemetry] telemetryPost', url, 'token:', token ? 'yes' : 'no');
    if (!token) return;
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      }).catch(function() {});
    } catch (e) {}
  }

  function trackPage() {
    console.log('[Telemetry] trackPage called');
    telemetryPost('/api/telemetry', {
      evento: 'page_view',
      pagina: location.pathname + location.hash,
      datos: { referrer: document.referrer }
    });
  }

  function trackError(msg, source, line, col, err) {
    telemetryPost('/api/telemetry/error', {
      mensaje: msg || 'Unknown error',
      stack: err?.stack || '',
      pagina: location.pathname,
      linea: line || 0,
      columna: col || 0
    });
  }

  function heartbeat() {
    telemetryPost('/api/telemetry/heartbeat', {});
  }

  // Track initial page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPage);
  } else {
    trackPage();
  }

  // Track navigation
  var origPush = history.pushState;
  history.pushState = function() {
    origPush.apply(this, arguments);
    trackPage();
  };
  window.addEventListener('popstate', trackPage);

  // Track JS errors
  window.addEventListener('error', function(e) {
    trackError(e.message, e.filename, e.lineno, e.colno, e.error);
  });

  // Track unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    trackError('Unhandled Promise: ' + (e.reason?.message || e.reason || 'Unknown'), '', 0, 0, e.reason);
  });

  // Heartbeat every 30s
  setInterval(heartbeat, 30000);
  heartbeat();
})();
