---
name: error-resilience
description: >
  Failure-handling patterns for distributed systems: timeouts on every
  external call, retry with exponential backoff, circuit breakers,
  bulkheads, and graceful degradation. Use for microservices,
  reliability-critical components, or any system with network deps.
---

# Error Resilience

**Leading word:** _bulkhead_ — compartmentalize failure so one broken dependency doesn't sink the whole ship.

## Core: Design for Failure

> Assume every network call fails. Assume every disk fills up. Assume every dependency is slow. The system survives not because components are reliable, but because failure is handled in predictable compartments.

**The Resilience Stack (top-down):**

```
  ┌──────────────────────────┐
  │ Graceful Degradation     │  degrade features, not the system
  ├──────────────────────────┤
  │ Circuit Breaker          │  stop calling failing dependencies
  ├──────────────────────────┤
  │ Retry with Backoff       │  transient failures are retryable
  ├──────────────────────────┤
  │ Timeouts                 │  bound every operation
  ├──────────────────────────┤
  │ Bulkheads                │  isolate failure to one pool
  ├──────────────────────────┤
  │ Supervision / Watchdog   │  restart crashed components
  └──────────────────────────┘
```

## Rule 1: Timeouts Everywhere

Every external call MUST have a timeout — no exceptions.

```typescript
// ❌ Hangs forever if DB is slow
const result = await db.query("SELECT ...");

// ✅ Bounded timeout
const result = await db.query("SELECT ...", { timeout: 5000 });
```

**Hierarchy:** endpoint timeout > dependency timeout (e.g., 10s endpoint → 3s per DB, 3s per cache, 2s per external API).

## Rule 2: Retry with Exponential Backoff

Transient failures (network blips, pool exhaustion, replica lag) are retryable. 4xx client errors are not.

```typescript
async function fetchWithRetry(url: string, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelayMs ?? 100;
  const maxDelay = options.maxDelayMs ?? 5000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      if (!isRetryable(err)) throw err; // 4xx ≠ retryable
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      await sleep(jitter);
    }
  }
}
```

**Retryable:** `5xx`, `429`, `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`
**Not retryable:** `4xx`, malformed data, auth failures

## Rule 3: Circuit Breaker

Stop calling a failing dependency to let it recover.

States: **CLOSED** (normal) → **OPEN** (failing) → **HALF_OPEN** (testing recovery)

```typescript
const breaker = new CircuitBreaker("database", {
  failureThreshold: 5,       // Open after 5 consecutive failures
  successThreshold: 3,       // Close after 3 consecutive successes
  resetTimeoutMs: 30_000,    // Wait 30s before half-open
});
```

When OPEN: fail fast with cached fallback or clear error — don't waste time on a dead dependency.

## Rule 4: Bulkheads

Partition connections per dependency so one failure doesn't cascade.

```
Without bulkheads:          With bulkheads:
  [API]                     [API]
    |                       /    \
  [POOL]              [DB Pool] [Cache Pool]
    |                  /    \       /    \
  [DB] [Cache]     [DB] [DB]  [Cache A] [Cache B]
```

Per-dependency connection pools. Per-tenant resource limits. Per-endpoint worker limits.

## Rule 5: Graceful Degradation

When a dependency fails, degrade — don't crash:

| Fails | Degraded Behavior |
|---|---|
| Database | Return cached results (stale but available). Disable writes. |
| Cache | Bypass, read from DB directly. Log latency. |
| Recommendation API | Return defaults. Skip personalization. |
| Auth service | Accept cached tokens. Reject new logins. |

Degrade features, never the whole system. Inform users: "Saving is temporarily unavailable."

## Rule 6: Health Probes & Watchdogs

- **Liveness** — is the process alive? (simple HTTP, no deps)
- **Readiness** — can it serve traffic? (checks critical deps)
- **Startup** — has it finished initializing?
- **Supervisor** — restart crashed components (Erlang/OTP style).

## Rule 7: Failure Observability

- Record every failure — structured log with `traceId`, `dependency`, `failureMode`.
- Classify: transient vs. permanent, retried vs. blocked.
- Track error budgets (SLO-based, see `observability` skill).
- Alert on degraded mode — partial functionality is an incident.

---

## Pseudocode

```
SKILL error-resilience

INPUTS:
  dependencies: string[]          // External services, databases, caches
  criticality: string             // critical, important, best_effort
  sloTarget: number               // Target availability (e.g., 99.9)

OUTPUTS:
  resilienceConfig: object
  //   timeouts: { per_dependency_ms: number }
  //   retries: { max_attempts, base_delay_ms }
  //   circuitBreakers: { threshold, reset_timeout_ms }
  //   bulkheads: { pool_sizes, queue_sizes }
  degradationPlan: object         // Feature degradation per failure scenario

PRECONDITIONS:
  - Every external call has a defined timeout
  - Dependencies classified as retryable vs. non-retryable
  - Bulkhead pools sized per dependency, not shared

POSTCONDITIONS:
  - Timeouts on all external calls (inner < outer)
  - Retry logic with exponential backoff + jitter on transient failures
  - Circuit breakers protect all critical dependencies
  - Bulkheads isolate per-dependency connection pools
  - Degradation mode clearly communicated to users

ERROR_HANDLING:
  - Timeout exceeded → degraded response or fail fast, never hang
  - Circuit open → use fallback immediately (never attempt real call)
  - Bulkhead exhausted → reject with 503, don't borrow from other pools
  - All retries exhausted → escalate to circuit breaker + alert
```

Full reference: `.pi/skills/error-resilience/reference.md`
