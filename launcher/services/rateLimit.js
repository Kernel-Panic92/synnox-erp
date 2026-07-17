const loginAttempts = {};

function createLoginRateLimit(db) {
  return function loginRateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const max = parseInt(db.prepare("SELECT value FROM config WHERE key = 'rate_limit_max'").get()?.value || '20', 10);
    const windowMs = parseInt(db.prepare("SELECT value FROM config WHERE key = 'rate_limit_window'").get()?.value || '60', 10) * 1000;
    if (!loginAttempts[ip]) loginAttempts[ip] = [];
    loginAttempts[ip] = loginAttempts[ip].filter(function(t) { return now - t < windowMs; });
    if (loginAttempts[ip].length >= max) {
      return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo en ' + (windowMs/1000) + ' segundos.' });
    }
    req._loginRateLimitKey = ip;
    req._loginRateLimitNow = now;
    next();
  };
}

function getLoginAttempts() {
  return loginAttempts;
}

// Periodic cleanup: purge stale IP entries every 5 minutes
setInterval(function() {
  const cutoff = Date.now() - 360000;
  for (const ip in loginAttempts) {
    if (loginAttempts.hasOwnProperty(ip)) {
      loginAttempts[ip] = loginAttempts[ip].filter(function(t) { return t > cutoff; });
      if (loginAttempts[ip].length === 0) delete loginAttempts[ip];
    }
  }
}, 300000);

module.exports = { createLoginRateLimit, getLoginAttempts };
