# Security Advisories — SynnoxERP

## CVE-2025-001: Command Injection via SSH Test Endpoint

**Severity:** Critical (CVSS 9.8)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js:300-309

### Description
The SSH test endpoint (`POST /api/admin/config/test-ssh`) accepted unvalidated `host` and `user` parameters that were directly concatenated into a shell command via `execSync()`. An authenticated admin could inject arbitrary shell commands.

### Impact
Remote Code Execution (RCE) with the privileges of the Node.js process.

### Fix
Added input validation with strict regex patterns:
- `host`: only `[a-zA-Z0-9._-]`
- `user`: only `[a-zA-Z0-9_-]`

---

## CVE-2025-002: Weak JWT Secret Defaults

**Severity:** Critical (CVSS 9.1)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** All auth modules (launcher, framework, nomina, proveedores)

### Description
JWT_SECRET fell back to hardcoded defaults (`'dev-secret'`, `'dev-jwt-secret'`) when the environment variable was not set. In production, this allowed token forgery.

### Impact
Token forgery, authentication bypass, privilege escalation.

### Fix
All modules now throw an error and exit if JWT_SECRET is not configured. No more fallback defaults.

---

## CVE-2025-003: JWT Secret Logged to Console

**Severity:** Critical (CVSS 8.5)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** framework/auth.mjs:21,30, modules/nomina/src/middleware/auth.js:47

### Description
The JWT secret prefix and token content were logged on every authenticated request. An attacker with log access could extract the secret and forge tokens.

### Impact
Token forgery, authentication bypass.

### Fix
Removed all secret/token content from log output. Only request path and error messages are logged.

---

## CVE-2025-004: Password Reset URL Exposed in Response

**Severity:** Critical (CVSS 8.1)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js:375

### Description
When SMTP was not configured, the password reset endpoint returned the full reset URL (containing the token) in the JSON response body. Combined with `httpOnly: false` cookies, this enabled token exfiltration.

### Impact
Account takeover via password reset token theft.

### Fix
Removed resetUrl from response. Token is only logged server-side and sent via email when SMTP is configured.

---

## CVE-2025-005: Insecure Cookie Configuration

**Severity:** Critical (CVSS 8.0)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js:230

### Description
The `launcher_jwt` cookie was set with `httpOnly: false` and `secure: false`. Any XSS vulnerability could steal the JWT via `document.cookie`.

### Impact
Session hijacking via XSS, credential theft.

### Fix
- `httpOnly: true` — cookie not accessible via JavaScript
- `secure: true` in production — cookie only sent over HTTPS
- `sameSite: 'strict'` — cookie not sent in cross-site requests

---

## CVE-2025-006: Unauthenticated SMTP Credentials Endpoint

**Severity:** Critical (CVSS 7.5)
**Date:** 2025-06-30
**Status:** Fixed
**Affected:** launcher/server.js:277-282

### Description
`GET /api/smtp/internal` returned SMTP credentials (host, user, password) with no authentication. Any process on the network could access SMTP passwords.

### Impact
SMTP credential theft, email spoofing.

### Fix
Added IP allowlist — only requests from localhost (127.0.0.1, ::1) are allowed.

---

## CVE-2025-007: Command Injection via Scaffold Module

**Severity:** Critical (CVSS 7.2)
**Date:** 2025-06-30
**Status:** Partially Fixed
**Affected:** launcher/server.js:520-801

### Description
The scaffold endpoint ran `execSync('npm install', ...)` and wrote files with user-supplied module IDs. While module IDs are validated with a regex, the ID is interpolated into file contents and `.env` files without escaping.

### Impact
Potential code injection in generated module files.

### Fix
Module ID regex validation strengthened. Full fix requires parameterized file generation.

---

## CVE-2025-008: OAuth Token Endpoint Missing Client Authentication

**Severity:** Critical (CVSS 7.0)
**Date:** 2025-06-30
**Status:** Partially Fixed
**Affected:** launcher/server.js:1222-1240

### Description
The OAuth token endpoint did not verify `client_secret`. Any client that obtained an authorization code could exchange it without proof of identity.

### Impact
Unauthorized token issuance.

### Fix
Requires OAuth client registration and secret validation. Deferred to OAuth refactor.

---

## Recommendations

### Immediate Actions
1. Set strong JWT_SECRET (min 32 chars, high entropy)
2. Enable HTTPS in production
3. Configure CORS properly
4. Add rate limiting to auth endpoints

### Short Term
1. Implement CSRF protection
2. Add input validation library (express-validator)
3. Enable CSP headers
4. Standardize auth middleware across modules

### Long Term
1. OAuth 2.0 with proper client registration
2. Audit logging for all admin actions
3. Penetration testing
4. Security training for development team

---

## CVE-2025-009: IMAP Infinite File Creation (DoS)

**Severity:** High (CVSS 7.5)
**Date:** 2025-07-01
**Status:** Fixed
**Affected:** modules/proveedores/src/services/imap.service.js

### Description
The IMAP service processed emails but never marked duplicate messages as `\Seen`. Each duplicate email was reprocessed on every 5-minute poll cycle, writing new files to disk. With 1000+ duplicate emails, this created ~45GB/day of files.

### Impact
Denial of Service via disk exhaustion. Server crashes when disk is full.

### Fix
1. Mark ALL processed emails as `\Seen` (not just created ones)
2. Delete orphaned files on duplicate/error
3. Split IMAP into download + process steps
4. Add 5-minute timeout for stuck syncs
