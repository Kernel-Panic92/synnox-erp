// Telemetry auto-tracking script
(function() {
  function telemetryPost(url, data) {
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
    telemetryPost('/api/telemetry', {
      evento: 'page_view',
      pagina: location.pathname + location.hash
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPage);
  } else {
    trackPage();
  }

  var origPush = history.pushState;
  history.pushState = function() {
    origPush.apply(this, arguments);
    trackPage();
  };
  window.addEventListener('popstate', trackPage);
  window.addEventListener('hashchange', trackPage);

  window.addEventListener('error', function(e) {
    trackError(e.message, e.filename, e.lineno, e.colno, e.error);
  });

  window.addEventListener('unhandledrejection', function(e) {
    trackError('Unhandled Promise: ' + (e.reason?.message || e.reason || 'Unknown'), '', 0, 0, e.reason);
  });

  setInterval(heartbeat, 30000);
  heartbeat();
})();
