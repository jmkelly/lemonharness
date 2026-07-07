---
name: security-practices
description: >
  Secure-by-default software engineering: OWASP Top 10 prevention,
  input validation, authentication/authorization patterns, secrets
  management, dependency scanning, CSP, and output encoding.
  Use for any task involving user input, network access, or data storage.
---

# Security Practices

## Core: Secure by Default

> The default configuration must be secure. Users opt into less security, not more.
> Never trust user input. Never trust network data. Never trust file contents.

## Rule 1: Input Validation & Sanitization

- **Validate shape before content** — check type, length, range, format first
- **Allowlist over blocklist** — define what's allowed, reject everything else
- **Canonicalize before validation** — normalize paths, URLs, Unicode
- **Reject, don't sanitize** — if input is invalid, reject it entirely. Don't try to "clean" it.
- **Limit all inputs** — max length, max nesting depth, max array size, max file size

```typescript
// ❌ Weak: checks after processing
const name = req.body.name.replace(/<[^>]*>/g, "");
process(`Hello ${name}`);

// ✅ Strong: validate before any use, reject outright
const schema = z.string().max(100).regex(/^[a-zA-Z0-9 _-]+$/);
const result = schema.safeParse(req.body.name);
if (!result.success) return res.status(422).json({ error: "Invalid name" });
```

## Rule 2: Authentication & Authorization

- **Hash passwords** with bcrypt/argon2 (never SHA-1, never unsalted)
- **Use short-lived tokens** (15m access + 7d refresh with rotation)
- **Authorize on every request**, not just at login
- **Principle of least privilege** — every component gets the minimum scope
- **Rate-limit auth endpoints** aggressively (5 attempts/minute/IP)
- **Never roll your own crypto** — use established libraries (libsodium, JWT with RS256/ES256)

## Rule 3: Secrets Management

- **Never hardcode secrets** — not in source code, not in config files, not in env files
- **Use a secrets manager** (HashiCorp Vault, AWS Secrets Manager, Doppler, `sops`)
- **Inject at runtime** via environment variables or mounted volumes
- **Audit secret access** — know who accessed what
- **Rotate regularly** — automate rotation, detect stale secrets
- **Scan for leaks** — use `trufflehog`, `git-secrets`, `gitleaks` in CI

## Rule 4: Dependency Hygiene

- **Pin exact versions** in lockfiles (never `*` or `latest`)
- **Audit regularly** — `npm audit`, `pip audit`, `cargo audit` in CI
- **Minimize attack surface** — prefer standard library over third-party
- **Vet transitive dependencies** — use `npm ls`, `pipdeptree` to review trees
- **Remove unused deps** — each dep is a liability
- **Watch for typo-squatting** — verify package names before install

## Rule 5: Output Encoding

- **Context-aware encoding** — HTML, URL, JS, CSS, SQL each have different encoding rules
- **Never concatenate user data into SQL** — use parameterized queries always
- **Set Content-Type explicitly** — don't rely on auto-detection
- **Set X-Content-Type-Options: nosniff** — prevent MIME sniffing

## Rule 6: HTTP Security Headers

Every response should include:

```
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
Cache-Control: no-store                     (for sensitive endpoints)
```

## Rule 7: Logging & Monitoring (Security)

- **Log all auth failures** (with context, not just "failed")
- **Log all authorization denials** (who tried to access what)
- **Alert on anomalies** — brute force attempts, impossible travel, unusual data access
- **Never log secrets** — strip passwords, tokens, PII before logging
- **Log retention** — 90 days interactive, 1 year cold storage, then delete

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
  securityChecklist: object   // Applied rules with pass/fail per entry point
  dependenciesAudit: object   // Vulnerabilities found, severity, fix versions
  secretScan: object          // Potential leaks detected

PRECONDITIONS:
  - Input validation at every entry point before business logic
  - Auth check on every protected endpoint (not just login)
  - Secrets never in source code, only runtime-injected
  - Dependency audit passes before deployment

POSTCONDITIONS:
  - All entry points validated, authorized, and rate-limited
  - All outputs contextually encoded
  - Security headers set on every HTTP response
  - Secrets scanned and none found in repository
  - Auth failures logged and monitored

ERROR_HANDLING:
  - Validation rejected → 422 with field-level details
  - Auth failure → 401 with generic message (don't reveal user existence)
  - Rate limit breached → 429 with Retry-After
  - Vulnerability found → upgrade or document exception before deploy
  - Secret leak detected → rotate immediately, audit access
```

Full reference: `.pi/skills/security-practices/reference.md`
