# Security Audit Report — ai_os (2026-08-07)

**Target**: https://ai-os-app.zeabur.app  
**Repository**: https://github.com/aa0968111723-prog/ai_os  
**Scope**: Code-level security review + deployment configuration audit  
**Overall Risk**: 🟡 Medium — 2 critical items needing immediate action, 4 high-priority improvements, defense-in-depth is solid

---

## 🔴 CRITICAL: Immediate Action Required

### 1. Weak Admin Password
- **Issue**: `SEED_ADMIN_PASSWORD` is only 8 characters with a simple pattern, vulnerable to dictionary/brute-force attacks.
- **Impact**: Full system compromise if admin account (`aa0968111723@gmail.com`) is breached.
- **Fix**: Rotate immediately to a ≥20 character random password (`openssl rand -hex 20`), update Zeabur env vars, and redeploy.

### 2. No Multi-Factor Authentication
- **Issue**: No MFA/TOTP/WebAuthn protection. Admin account protected only by password + session cookie.
- **Impact**: No second line of defense if the password is compromised.
- **Fix**: Add TOTP or WebAuthn for admin accounts. At minimum, IP-whitelist the `/admin` route.

---

## 🟠 HIGH: Recommended Improvements

### 3. MCP Legacy Shared Key Mode
- **Issue**: `MCP_API_KEY` is a 64-char shared secret — all MCP clients share the same key. Cannot differentiate clients, cannot revoke individually.
- **Code**: `server/services/mcpAuth.ts` → `isMcpEnabled()`
- **Note**: Per-user token mode already implemented in code (`randomBytes(32)` hex), but production still uses shared `MCP_API_KEY`.
- **Fix**: Migrate to per-user MCP tokens with create/revoke/scoping support.

### 4. CSP `style-src 'unsafe-inline'`
- **Issue**: Content-Security-Policy allows inline styles, weakening XSS/CSS injection protection.
- **Code**: `server/index.ts` — `styleSrc: ["'self'", "'unsafe-inline'"]`
- **Fix**: Move inline styles to external CSS or use nonce/hash. Requires frontend refactoring — schedule as roadmap item.

### 5. MinIO/S3 Internal Traffic Over HTTP
- **Issue**: `S3_ENDPOINT=http://minio.zeabur.internal:9000` uses HTTP, not HTTPS.
- **Impact**: Lateral movement within Zeabur's internal network could intercept file transfers. Risk is lower than public-network exposure but should still be addressed.
- **Fix**: Enable TLS on MinIO and switch to `https://`.

### 6. HSTS Without `preload`
- **Issue**: `max-age=31536000; includeSubDomains` is missing `preload`.
- **Fix**: Add `preload` and submit to hstspreload.org.
- **Code**: `server/index.ts` helmet config

---

## 🟡 MEDIUM: Scheduled Improvements

### 7. Weak Password Policy
- **Issue**: Password minimum is only 8 characters with no complexity requirements (uppercase/lowercase/digit/special).
- **Fix**: Raise to min(12) + require mixed character classes.

### 8. Incomplete `.env.example`
- **Issue**: These env vars are missing from `.env.example`: `FAL_ADMIN_KEY`, `S3_ACCESS_KEY`, `S3_ENDPOINT`, `ZSEND_API_KEY`, `NVIDIA_NIM_ENDPOINT`
- **Fix**: Add all required variables (with empty values) to `.env.example`.

### 9. No CI/CD Secret Scanning
- **Issue**: GitHub Actions workflows (`ci.yml`, `apk.yml`, `desktop-native.yml`) have no secret scanning step.
- **Fix**: Enable GitHub Advanced Security > Secret scanning (free for public repos). Add `trufflehog` or `git-secrets` to CI.

### 10. `/api/health` Leaks Build Branch
- **Issue**: Response includes `{"build":{"branch":"claude/healing-migration-ai-os-erewp2"}}`
- **Fix**: Remove or sanitize build metadata from health endpoint; keep only `ok` and `time`.

---

## 🟢 Verified Secure (Defense-in-Depth Highlights)

| Area | Implementation |
|---|---|
| **Service Passwords** | All 32+ char random hex (PostgreSQL, Redis, MinIO) — no weak passwords |
| **API Keys** | FAL_KEY, MCP_API_KEY, RATE_LIMIT_SECRET all 44–70 chars with sufficient entropy |
| **Password Hashing** | bcrypt(10) + account enumeration protection (dummy hash timing) |
| **Session Cookies** | HttpOnly + SameSite=Lax + Secure (production) + `randomBytes(32)` |
| **SSRF Protection** | DNS resolution check + literal host blacklist + per-hop redirect re-validation (3 layers) |
| **Rate Limiting** | 19 PostgreSQL-persisted policies, HMAC-SHA256 identity hashing, advisory locks across replicas, fail-close (no fallback) |
| **CSP** | `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, strict `script-src` |
| **COOP/COEP/CORP** | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site` |
| **Docker** | Multi-stage build, `node:22-alpine`, non-root `USER node`, `HEALTHCHECK` using Node's built-in `fetch`, `STOPSIGNAL SIGTERM` |
| **Helmet** | Full suite: `hidePoweredBy`, `frameguard DENY`, `hsts`, `referrerPolicy no-referrer`, XSS filter |
| **No Hardcoded Secrets** | Full codebase scan — zero hardcoded keys/passwords/tokens |
| **Git History Clean** | `.env.example` commits exist but values are blank; no real secrets in history |

---

## Action Priority Matrix

| Priority | Item | Type | Est. Effort |
|---|---|---|---|
| **P0** | Rotate admin password | CRITICAL | 5 min |
| **P0** | Enable 2FA/MFA | CRITICAL | 1–3 days |
| **P1** | MCP → per-user token mode | HIGH | 1–2 days |
| **P1** | CSP remove `unsafe-inline` | HIGH | 1–3 days |
| **P1** | S3/MinIO → HTTPS | HIGH | 1 hr |
| **P1** | HSTS add `preload` | HIGH | 5 min |
| **P2** | Strengthen password policy | MEDIUM | 1 day |
| **P2** | Complete `.env.example` | MEDIUM | 15 min |
| **P2** | CI/CD secret scanning | MEDIUM | 30 min |
| **P2** | `/api/health` de-identification | MEDIUM | 5 min |

---

*Audit performed by CEO deep analysis. Covers code-level, configuration, and deployment-layer findings beyond routine agent scanning. No plaintext secrets retained.*
