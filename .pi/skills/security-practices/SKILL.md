---
name: security-practices
description: >
  Secure-by-default engineering: OWASP Top 10 prevention, input validation
  (allowlist, canonicalize, reject), auth (short-lived tokens, least privilege),
  secrets management, dependency hygiene, output encoding, security headers.
  Use for any task involving user input, network access, or data storage.
---

# Security Practices

**Leading word:** _boundary_ — every entry point is a trust boundary. Validate, authorize, encode, and log at every boundary, never inside.

## Core: Secure by Default

> The default configuration must be secure. Users opt into less security, not more. Never trust input, network data, or file contents.

## Rule 1: Input Validation

- **Validate shape before content** — type, length, range, format first.
- **Allowlist over blocklist** — define what's allowed, reject everything else.
- **Canonicalize before validation** — normalize paths, URLs, Unicode.
- **Reject, don't sanitize** — invalid input is rejected outright, never "cleaned".

```typescript
// ❌ Weak: processes then tries to clean
const name = req.body.name.replace(/<[^>]*>/g, "");

// ✅ Strong: validate before use, reject outright
const schema = z.string().max(100).regex(/^[a-zA-Z0-9 _-]+$/);
const result = schema.safeParse(req.body.name);
if (!result.success) return res.status(422).json({ error: "Invalid name" });
```

## Rule 2: Authentication & Authorization

- Hash passwords with bcrypt/argon2 (never SHA-1, never unsalted).
- Short-lived tokens: 15m access + 7d refresh with rotation.
- **Authorize on every request**, not just at login.
- Least privilege: every component gets the minimum scope.
- Aggressively rate-limit auth endpoints (5 attempts/minute/IP).
- Never roll your own crypto — use libsodium, JWT with RS256/ES256.

## Rule 3: Secrets Management

- Never hardcode secrets — not in source, config, or env files.
- Use a secrets manager (Vault, AWS Secrets Manager, Doppler, `sops`).
- Inject at runtime via env vars or mounted volumes.
- Audit access, rotate regularly, scan for leaks (`trufflehog`, `gitleaks` in CI).

## Rule 4: Dependency Hygiene

- Pin exact versions in lockfiles (never `*` or `latest`).
- Audit regularly — `npm audit`, `pip audit`, `cargo audit` in CI.
- Minimize attack surface: prefer stdlib over third-party.
- Vet transitive deps. Remove unused deps. Watch for typo-squatting.

## Rule 5: Output Encoding

- Context-aware encoding: HTML, URL, JS, CSS, SQL — each has different rules.
- Never concatenate user data into SQL — always parameterized queries.
- Set Content-Type explicitly. Set `X-Content-Type-Options: nosniff`.

## Rule 6: Security Headers

```
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
```

## Rule 7: Security Logging & Monitoring

- Log all auth failures and authorization denials with context.
- Alert on anomalies: brute force, impossible travel, unusual data access.
- Never log secrets. Retention: 90 days interactive, 1 year cold storage.

---

## Pseudocode

```
SKILL security-practices

INPUTS:
  entryPoints: string[]       // HTTP routes, message handlers, file imports
  dataSensitivity: string     // public, internal, confidential, pii
  authModel: string           // none, apikey, oauth2, session
  dependencies: string[]      // Third-party packages

OUTPUTS:
  securityChecklist: object   // Pass/fail per entry point
  dependenciesAudit: object   // Vulnerabilities, severity, fixes
  secretScan: object          // Potential leaks detected

PRECONDITIONS:
  - Input validation at every entry point before business logic
  - Auth check on every protected endpoint
  - Secrets never in source code, only runtime-injected

POSTCONDITIONS:
  - All entry points validated, authorized, rate-limited
  - All outputs contextually encoded
  - Security headers on every HTTP response
  - Secrets scanned, none found in repository
  - Auth failures logged and monitored

ERROR_HANDLING:
  - Validation rejected → 422 with field-level details
  - Auth failure → 401 with generic message (don't reveal user existence)
  - Rate limit breached → 429 with Retry-After
  - Vulnerability found → upgrade or document exception
  - Secret leak detected → rotate immediately, audit access
```

Full reference: `.pi/skills/security-practices/reference.md`
