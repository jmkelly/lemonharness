---
name: error-resilience
description: >
  Production error resilience and failure-handling patterns:
  circuit breakers, retries with backoff, bulkheads, graceful
  degradation, timeouts, health-checked proxies, and supervisor
  trees. Use for any distributed system, microservice, or
  reliability-critical component.
---

# Error Resilience

## Core: Design for Failure

> Assume every network call fails. Assume every disk fills up.
> Assume every dependency is slow. The system survives not because
> components are reliable, but because failure is handled gracefully.

**The Resilience Stack (top-down):**
```
  ┌──────────────────────────┐
  │ Graceful Degradation     │  -- degrade features, not the whole system
  ├──────────────────────────┤
  │ Circuit Breaker          │  -- stop calling failing dependencies
  ├──────────────────────────┤
  │ Retry with Backoff       │  -- transient failures are retryable
  ├──────────────────────────┤
  │ Timeouts                 │  -- bound every operation
  ├──────────────────────────┤
  │ Bulkheads                │  -- isolate failure to one pool
  ├──────────────────────────┤
  │ Supervision / Watchdog   │  -- restart crashed components
  └──────────────────────────┘
```

## Rule 1: Timeouts Everywhere

Every external call MUST have a timeout. No exceptions.

```typescript
// ❌ Bad: no timeout — hangs forever if DB is slow
const result = await db.query("SELECT ...");

// ✅ Good: bounded timeout
const result = await db.query("SELECT ...", { timeout: 5000 });

// ✅ Better: per-operation timeout with context deadline
const result = await withTimeout(db.query("SELECT ..."), 5000, "db.query.users");
```

**Timeout hierarchy:** endpoint timeout > dependency timeout (e.g., 10s endpoint = 3s per DB, 3s per cache, 2s per external API).

## Rule 2: Retry with Exponential Backoff

Transient failures (network blips, connection pool exhaustion, replica lag) are retryable:

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
      if (!isRetryable(err)) throw err;  // 4xx ≠ retryable
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5);  // ±50% jitter
      await sleep(jitter);
    }
  }
}
```

**Retryable:** `5xx`, `429` (rate limit), `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`
**Not retryable:** `4xx` (client errors), malformed data, auth failures

## Rule 3: Circuit Breaker

Stop calling a failing dependency to let it recover:

States: **CLOSED** (normal) → **OPEN** (failing) → **HALF_OPEN** (testing recovery)

```typescript
const breaker = new CircuitBreaker("database", {
  failureThreshold: 5,      // Open after 5 consecutive failures
  successThreshold: 3,      // Close after 3 consecutive successes (half-open)
  resetTimeoutMs: 30_000,   // Wait 30s before half-open
  monitoredTimeoutMs: 10_000 // Consider timeout as failure
});
```

**When OPEN:** fail fast with cached fallback or clear error — don't waste time on a dead dependency.

## Rule 4: Bulkheads

Isolate failure by partitioning connections into pools:

- Per-dependency connection pool (DB pool, cache pool, API client pool)
- Per-tenant resource limits (noisy neighbor protection)
- Per-endpoint thread/worker limits

```
Without bulkheads:          With bulkheads:
  [API]                     [API]
    |                       /    \
  [POOL]              [DB Pool] [Cache Pool]
    |                  /    \       /    \
  [DB] [Cache]     [DB] [DB]  [Cache A] [Cache B]
  // One bad cache    // Cache A fails,
  // stalls DB too    // DB and Cache B unaffected
```

## Rule 5: Graceful Degradation

When a dependency fails, don't crash — degrade:

| Dependency Fails | Degraded Behavior |
|---|---|
| **Database** | Return cached results (stale but available). Disable writes. |
| **Cache** | Bypass cache, read from DB directly. Log high latency. |
| **Recommendation API** | Return defaults / popular items. Skip personalization. |
| **Auth service** | Accept cached tokens. Reject new logins. |

- **Explicit degradation paths** — plan what degrades before the outage
- **Degrade features, not the whole system** — partial availability > total outage
- **Inform users** — "Saving is temporarily unavailable, but your changes are local"

## Rule 6: Health Probes & Watchdogs

- **Liveness probe** — is the process alive? (simple HTTP check, no deps)
- **Readiness probe** — can it serve traffic? (checks critical deps)
- **Startup probe** — has it finished initializing? (slow starters)
- **Supervisor tree** — if a component crashes, restart it (Erlang/OTP style)

## Rule 7: Failure Observability

- **Record every failure** — structured log with `traceId`, `dependency`, `failureMode`
- **Classify failures** — transient vs. permanent, retried vs. blocked
- **Track error budgets** — SLO-based (see `observability` skill)
- **Alert on degraded mode** — partial functionality is an incident

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
  - Degradation paths defined before deployment

POSTCONDITIONS:
  - Timeouts set on all external calls (inner < outer)
  - Retry logic with exponential backoff + jitter on all transient failures
  - Circuit breakers protect all critical dependencies
  - Bulkheads isolate per-dependency connection pools
  - Degradation mode clearly communicated to users

ERROR_HANDLING:
  - Timeout exceeded → return degraded response or fail fast, never hang
  - Circuit open → use fallback immediately (do not attempt real call)
  - Bulkhead exhausted → reject with 503, don't borrow from other pools
  - All retries exhausted → escalate to circuit breaker + alert
```

Full reference: `.pi/skills/error-resilience/reference.md`
