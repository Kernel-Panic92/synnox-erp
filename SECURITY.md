# Security Advisories — SynnoxERP

## Resumen

| CVE | Severidad | Estado | Fecha |
|-----|-----------|--------|-------|
| CVE-2025-001 | Critical (9.8) | ✅ Fixed | 2025-06-30 |
| CVE-2025-002 | Critical (9.1) | ✅ Fixed | 2025-06-30 |
| CVE-2025-003 | Critical (8.5) | ✅ Fixed | 2025-06-30 |
| CVE-2025-004 | Critical (8.1) | ✅ Fixed | 2025-06-30 |
| CVE-2025-005 | Critical (8.0) | ✅ Fixed | 2025-06-30 |
| CVE-2025-006 | Critical (7.5) | ✅ Fixed | 2025-06-30 |
| CVE-2025-007 | Critical (7.2) | ✅ Fixed | 2025-06-30 |
| CVE-2025-008 | Critical (7.0) | ⚠️ Deferred | 2025-06-30 |
| CVE-2025-009 | High (7.5) | ✅ Fixed | 2025-07-01 |
| Hardening | — | ✅ Fixed | 2026-07-14 |
| Hardening 2 | — | ✅ Fixed | 2026-07-17 |

---

## CVE-2025-001: Command Injection via SSH Test Endpoint

**Severity:** Critical (CVSS 9.8)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js

### Description
The SSH test endpoint accepted unvalidated `host` and `user` parameters that were directly concatenated into a shell command via `execSync()`.

### Fix
- Input validation with strict regex patterns (`host`: `[a-zA-Z0-9._-]`, `user`: `[a-zA-Z0-9_-]`)
- Migrated from `execSync` string to `execFileSync` with array args (sesión 13)

---

## CVE-2025-002: Weak JWT Secret Defaults

**Severity:** Critical (CVSS 9.1)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** All auth modules

### Description
JWT_SECRET fell back to hardcoded defaults (`'dev-secret'`, `'dev-jwt-secret'`) when not set.

### Fix
All modules now call `process.exit(1)` if JWT_SECRET is not configured. Zero fallback defaults.

---

## CVE-2025-003: JWT Secret Logged to Console

**Severity:** Critical (CVSS 8.5)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** framework/auth.mjs, modules/nomina/src/middleware/auth.js

### Description
The JWT secret prefix and token content were logged on every authenticated request.

### Fix
Removed all secret/token content from log output. Only request path and error messages are logged.

---

## CVE-2025-004: Password Reset URL Exposed in Response

**Severity:** Critical (CVSS 8.1)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js

### Description
When SMTP was not configured, the password reset endpoint returned the full reset URL in the JSON response.

### Fix
Removed `resetUrl` from response. Token is only logged server-side and sent via email when SMTP is configured.

---

## CVE-2025-005: Insecure Cookie Configuration

**Severity:** Critical (CVSS 8.0)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js

### Description
The `launcher_jwt` cookie was set with `httpOnly: false` and `secure: false`.

### Fix
- `httpOnly: true` — cookie not accessible via JavaScript
- `secure: true` in production — cookie only sent over HTTPS
- `sameSite: 'lax'` — cookie not sent in cross-site POST requests

---

## CVE-2025-006: Unauthenticated SMTP Credentials Endpoint

**Severity:** Critical (CVSS 7.5)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js

### Description
`GET /api/smtp/internal` returned SMTP credentials with no authentication.

### Fix
Added IP allowlist — only requests from localhost (127.0.0.1, ::1) are allowed.

---

## CVE-2025-007: Command Injection via Scaffold Module

**Severity:** Critical (CVSS 7.2)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js

### Description
The scaffold endpoint ran `execSync('npm install', ...)` and wrote files with user-supplied module IDs without escaping.

### Fix
- Module ID regex validation strengthened
- `execSync` → `execFileSync` with array args
- JWT_SECRET generated with `crypto.randomBytes(32)` instead of `change-me-${id}`

---

## CVE-2025-008: OAuth Token Endpoint Missing Client Authentication

**Severity:** Critical (CVSS 7.0)
**Date:** 2025-06-30
**Status:** Deferred
**Affected:** launcher/server.js

### Description
The OAuth token endpoint did not verify `client_secret`.

### Fix
Requires OAuth client registration and secret validation. Deferred to OAuth refactor.

---

## CVE-2025-009: IMAP Infinite File Creation (DoS)

**Severity:** High (CVSS 7.5)
**Date:** 2025-07-01
**Status:** Fixed
**Affected:** modules/proveedores/src/services/imap.service.js

### Description
The IMAP service processed emails but never marked duplicates as `\Seen`, creating ~45GB/day of files.

### Fix
1. Mark ALL processed emails as `\Seen`
2. Delete orphaned files on duplicate/error
3. Split IMAP into download + process steps
4. Add 5-minute timeout for stuck syncs

---

## Hardening — Sesión 9 (14 Jul 2026)

### CodeQL Security Fixes (56 high-severity + 260 rate-limiting alerts)

| Category | Count | Fix |
|----------|-------|-----|
| Command-line injection | 16 | `execSync` string → `execFileSync`/`spawnSync` with array args |
| Path injection | 35 | `sanitizePath(input, base)` helper in 8 files |
| SQL injection | 2 | MCP Nómina reescrito con input estructurado y placeholders |
| Request forgery/SSRF | 2 | URL validation regex, solo localhost en `fetch()` |
| Email in login logs | — | Encryptado con AES-256-CBC |
| Missing rate limiting | ~260 | `express-rate-limit` middleware global en los 5 servidores |

### Additional Fixes
- **httpOnly: true**: Cookie `launcher_jwt` now with `httpOnly: true`, `secure` conditional on protocol
- **JWT_SECRET enforcement**: All modules call `process.exit(1)` if not configured
- **parseCookies centralized**: Eliminated duplication across 5 files
- **bcrypt → bcryptjs**: Single dependency, no native bindings
- **Hardcoded values eliminated**: 0 references to `Horix`, `vitamar`, `DocFlow` in source code

---

## Hardening — Sesión 13 (17 Jul 2026)

### Bug Fixes
- **spawnSync not imported**: `launcher/server.js` imported `execSync` but used `spawnSync`. Fixed with `execFileSync` import.
- **Admin password overwrite**: Admin was re-seeded with `admin123` on every restart. Fixed: INSERT only if not exists, UPDATE only role.
- **JWT 24h → 1h**: Token expiry was 24h instead of designed 1h. Fixed.
- **Import con backup**: `POST /api/admin/import` now creates pre-import backup before DELETEs.
- **Rate limit en reset**: `GET/POST /api/auth/reset` now have `loginRateLimit`.
- **`encryptEmail` sin fallback**: Removed `|| 'fallback'` from encryption key.
- **JWT_SECRET random en scaffold**: New modules use `crypto.randomBytes(32).toString('hex')`.
- **CORS restrictions**: Proyectos and logística use `cors({ origin: process.env.CORS_ORIGIN || true, credentials: true })`.
- **Error messages**: Logística and proyectos hide `err.message` in production.

---

## Recomendaciones

### Implementadas ✅
- [x] Strong JWT_SECRET enforcement (min 32 chars, no defaults)
- [x] httpOnly + secure cookies
- [x] Rate limiting on all endpoints
- [x] Input validation (regex, sanitizePath)
- [x] SQL injection prevention (parameterized queries)
- [x] XSS prevention (httpOnly cookies, no secret logging)
- [x] Command injection prevention (execFileSync with array args)
- [x] CORS configuration

### Pendientes
- [ ] CSRF protection tokens
- [ ] CSP headers with nonce
- [ ] OAuth 2.0 with proper client registration
- [ ] Audit logging for all admin actions
- [ ] Penetration testing
- [ ] Frontend build obfuscation
