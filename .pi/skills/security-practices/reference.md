---
name: security-practices-reference
description: Full reference for security-practices skill (lazy-loaded on demand)
---

# Security Practices — Full Reference

## Core Philosophy

> *"Security is not a feature — it's a property of the whole system."*
> *"The only truly secure system is one that is powered off."* — But even then, check the supply chain.

---

## OWASP Top 10 (2025+ Context)

### 1. Broken Access Control
- **Prevention:** Authorize on every request, not at login. Use least-privilege RBAC/ABAC.
- **Check:** Every endpoint has an explicit authorization check. No default-allow.
- **Tool:** `zanzibar`-style relation tuples for fine-grained access.

### 2. Cryptographic Failures
- **Prevention:** Use established libraries (libsodium, `tink`). Never roll your own.
- **Check:** No MD4, MD5, SHA-1 for security. No ECB mode. No static IVs.
- **Tool:** `cryptography` (Python), `libsodium.js` (JS), `ring` (Rust).

### 3. Injection
- **Prevention:** Parameterized queries always. No string concatenation for SQL/NoSQL.
- **Check:** ORM raw queries reviewed. No `eval()`, no `new Function()`.
- **Tool:** ESLint `no-eval`, `sqlmap` for injection testing.

### 4. Insecure Design
- **Prevention:** Threat modeling before implementation. Rate limiting by design.
- **Check:** More than 1 person reviewed the architecture. No "we'll fix it later."
- **Tool:** OWASP Threat Dragon, STRIDE per component.

### 5. Security Misconfiguration
- **Prevention:** Secure defaults. Automated hardening. Least functionality.
- **Check:** Default credentials changed. Unnecessary features disabled.
- **Tool:** `CIS Benchmarks`, `kube-bench`, `trivy` config scan.

### 6. Vulnerable & Outdated Components
- **Prevention:** Daily dependency audit. Automated updates for patch versions.
- **Check:** No dependencies with known CVEs. No deprecated packages.
- **Tool:** `npm audit`, `pip audit`, `cargo audit`, `osv-scanner`, `dependabot`.

### 7. Identification & Authentication Failures
- **Prevention:** Multi-factor. Short-lived tokens. Rate-limit login endpoints.
- **Check:** No hardcoded credentials. No basic auth. bcrypt/argon2 for passwords.
- **Tool:** `zxcvbn` for password strength. `passcheck` library.

### 8. Software & Data Integrity Failures
- **Prevention:** Signed artifacts. Lockfiles. Supply chain vetting.
- **Check:** CI pipeline secured. No unsigned dependencies. SLSA level ≥ 2.
- **Tool:** `sigstore`, `cosign`, `SLSA` framework.

### 9. Security Logging & Monitoring Failures
- **Prevention:** Log all auth events. Monitor for anomalies. Alert on thresholds.
- **Check:** Auth failures logged. Access denials logged. Secrets never logged.
- **Tool:** `ELK`, `Grafana`, `Wazuh`, `Splunk`.

### 10. Server-Side Request Forgery (SSRF)
- **Prevention:** Allowlist URLs. No user-controlled URLs passed to internal services.
- **Check:** No `fetch(userInput)`. URL validated against allowlist.
- **Tool:** URL parser with blocklist for internal IP ranges.

---

## Secrets Management

### Where NOT to Put Secrets

| Location | Risk |
|---|---|
| Source code | Committed to git, visible to all developers |
| `.env` files (committed) | Same as source code |
| Configuration files (committed) | Visible in CI logs, deploy artifacts |
| Environment variables (hardcoded in deploy scripts) | Visible in process listings, logs |
| Docker image layers | Visible to anyone with image access |
| Logs | Splunked, ELK'd, forever searchable |

### Secrets Management Tools

| Tool | Use Case |
|---|---|
| **HashiCorp Vault** | Enterprise-grade, dynamic secrets, auto-rotation |
| **AWS Secrets Manager / GCP Secret Manager** | Cloud-native, automatic rotation |
| **Doppler** | Developer-friendly, syncs across environments |
| **sops** (encrypted files in git) | Simple, git-native, GPG/KMS encrypted |
| **1Password CLI** | Small teams, developer secrets |
| **`agenix`** (Nix) | Nix-native secret encryption |

### Secret Rotation

- **Database credentials:** Every 90 days (automated)
- **API keys:** Every 90 days (automated)
- **JWT signing keys:** Every 30 days (rotation with overlap)
- **SSH keys:** Every 180 days (or on employee offboarding)
- **Incident-triggered:** Immediately on suspected compromise

---

## Dependency Security Checklist

- [ ] `npm audit` (or equivalent) passes with 0 critical vulnerabilities
- [ ] All dependencies are pinned with lockfile (no `*` ranges)
- [ ] No deprecated packages in use
- [ ] Transitive dependencies reviewed for known critical CVEs
- [ ] Dependencies with native code are from trusted sources
- [ ] Dependency count is justified (no "convenience" packages)
- [ ] `dependabot` / `renovate` configured for automated PRs
- [ ] `osv-scanner` runs in CI for ecosystem-agnostic vuln scanning

---

## Input Validation Patterns

### Numeric Inputs

```typescript
// Good: range-bound
const schema = z.number().int().min(0).max(10000);

// Better: domain-specific
const pageSchema = z.number().int().min(1).max(1000);
```

### String Inputs

```typescript
// Good: length-bound + pattern
const nameSchema = z.string().min(1).max(100).regex(/^[a-zA-Z\s'-]+$/);

// Better: contextual + reject suspicious patterns
const safeString = z.string().max(5000).refine(
  (s) => !/<script|javascript:|onerror|onload/i.test(s),
  { message: "Suspicious content detected" }
);
```

### File Uploads

```typescript
// Validate: magic bytes (not just extension), max size, virus scan
const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Check magic bytes: first 4 bytes determine type, not the extension
function detectMimeType(buffer: Buffer): string {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  return "application/octet-stream";
}
```

---

## Authentication & Authorization Patterns

### JWT Token Strategy

```typescript
// Access token (short-lived: 15 minutes)
const accessToken = jwt.sign(
  { sub: userId, roles: ["admin"], org: orgId },
  ACCESS_SECRET,
  { expiresIn: "15m", algorithm: "ES256" }
);

// Refresh token (longer-lived: 7 days, opaque, stored in DB)
const refreshToken = crypto.randomUUID();
await db.refreshTokens.create({
  token: refreshToken,
  userId,
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
});

// Rotation: invalidate old refresh token on use (prevents replay)
```

### Authorization Middleware Pattern

```typescript
function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user; // populated by auth middleware
    if (!user || !user.permissions.includes(permission)) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "Insufficient permissions" }
      });
    }
    next();
  };
}

// Usage: POST /admin/users requires admin
router.post("/admin/users",
  requirePermission("users:admin"),
  createUserHandler
);
```

---

## Security Headers Quick Reference

| Header | Value | Effect |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'` | Prevents XSS, data injection |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforces HTTPS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer leakage |
| `Permissions-Policy` | `geolocation=(), microphone=()` | Controls browser API access |
| `Cache-Control` | `no-store` (auth endpoints) | Prevents sensitive caching |

---

## Related Skills

- **[api-design](.pi/skills/api-design/SKILL.md)** — Input validation, auth in API contracts
- **[error-resilience](.pi/skills/error-resilience/SKILL.md)** — Rate limiting, circuit breakers
- **[observability](.pi/skills/observability/SKILL.md)** — Security logging, audit trails
- **[engineering-practices](.pi/skills/engineering-practices/SKILL.md)** — Error handling patterns
