---
name: error-resilience-reference
description: Full reference for error-resilience skill (lazy-loaded on demand)
---

# Error Resilience — Full Reference

## Core Philosophy

> *"Everything fails, all the time."* — Werner Vogels (Amazon CTO)

The key insight: reliability comes not from preventing failures, but from **handling them gracefully** when they occur.

---

## The Resilience Stack (Detailed)

```
            ┌──────────────────────────────────────────────────┐
            │         Graceful Degradation                     │
            │  • Feature-level degradation                     │
            │  • Cached fallbacks                              │
            │  • User communication                            │
            ├──────────────────────────────────────────────────┤
            │         Circuit Breaker                          │
            │  • Closed → Open → Half-Open                     │
            │  • Bulkhead isolation                            │
            │  • Fail-fast with fallback                       │
            ├──────────────────────────────────────────────────┤
            │         Retry with Backoff                       │
            │  • Exponential backoff + jitter                  │
            │  • Retry classification (transient vs permanent) │
            │  • Idempotency for safe retries                  │
            ├──────────────────────────────────────────────────┤
            │         Timeouts                                 │
            │  • Per-dependency timeout                        │
            │  • Deadline propagation                          │
            │  • Fail-fast, not wait-slow                      │
            ├──────────────────────────────────────────────────┤
            │         Bulkheads                                │
            │  • Per-dependency connection pools               │
            │  • Per-tenant limits                             │
            │  • Failure isolation                             │
            ├──────────────────────────────────────────────────┤
            │         Supervision / Watchdog                   │
            │  • Liveness + readiness probes                   │
            │  • Restart crashed components                    │
            │  • Crash-only design                             │
            └──────────────────────────────────────────────────┘
```

---

## Timeouts (Detailed)

### Timeout Hierarchy

```mermaid
┌───────────────────────────────────────────┐
│  HTTP Request (total: 30s)                 │
│  ├─ Middleware chain (5s)                  │
│  ├─ Business logic (2s)                    │
│  ├─ Database query (3s)                    │
│  ├─ Cache lookup (500ms)                   │
│  └─ External API call (8s)                 │
└───────────────────────────────────────────┘
```

**Rule:** `dependency_timeout = endpoint_timeout × 0.3` (at most)

### Deadline Propagation

```typescript
// Use AbortSignal / Context propagation across async boundaries
async function handleRequest(req: Request, res: Response) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const user = await fetchUser(req.params.id, { signal: controller.signal });
    const orders = await fetchOrders(user.id, { signal: controller.signal });
    res.json({ user, orders });
  } catch (err) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: "Request timeout" });
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timeout);
  }
}
```

---

## Retry Patterns (Detailed)

### Exponential Backoff with Jitter

```python
import random
import time
from typing import Callable

def retry_with_backoff(
    fn: Callable,
    max_retries: int = 3,
    base_delay: float = 0.1,
    max_delay: float = 10.0,
    retryable_exceptions: tuple = (ConnectionError, TimeoutError),
):
    """Retry with exponential backoff + full jitter."""
    last_exception = None

    for attempt in range(max_retries + 1):
        try:
            return fn()
        except retryable_exceptions as e:
            last_exception = e
            if attempt == max_retries:
                raise
            # Full jitter: random between 0 and cap
            delay = min(base_delay * (2 ** attempt), max_delay)
            sleep_time = random.uniform(0, delay)
            time.sleep(sleep_time)

    raise last_exception  # Should not reach here
```

### What to Retry vs. What NOT to Retry

| Error Type | Examples | Retry? |
|---|---|---|
| **Transient** | Timeout, connection reset, 503, 429 | ✅ Yes, with backoff |
| **Idempotent safe** | GET, PUT, DELETE, idempotent POST | ✅ Yes |
| **Rate limited** | 429 (Retry-After header present) | ✅ Yes, respect Retry-After |
| **Non-idempotent mutation** | POST without idempotency key | ❌ No — could create duplicates |
| **Client error** | 400, 401, 403, 404, 422 | ❌ No — won't succeed on retry |
| **Data error** | Malformed response, parse failure | ❌ No — indicates bug |
| **Auth failure** | 401, token expired | ❌ No — refresh token first, then retry once |

---

## Circuit Breaker (Detailed)

### State Machine

```
    ┌──────────────┐
    │   CLOSED     │  ← Normal operation. Requests pass through.
    │              │    Failure count resets after success_threshold successes.
    └──────┬───────┘
           │ failures ≥ failure_threshold
           ▼
    ┌──────────────┐
    │    OPEN      │  ← Failing fast. No requests pass through.
    │              │    After reset_timeout_ms, transitions to HALF_OPEN.
    └──────┬───────┘
           │ reset_timeout expires
           ▼
    ┌──────────────┐
    │  HALF_OPEN   │  ← Testing recovery. Limited requests pass through.
    │              │    On success: back to CLOSED.
    │              │    On failure: back to OPEN.
    └──────────────┘
```

### Implementation

```typescript
class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly name: string,
    private readonly options: {
      failureThreshold: number;    // e.g., 5
      successThreshold: number;    // e.g., 3
      resetTimeoutMs: number;      // e.g., 30_000
      halfOpenMaxRequests: number; // e.g., 1
    }
  ) {}

  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        this.state = "HALF_OPEN";
      } else {
        // Fail fast — use fallback if available
        if (fallback) return fallback();
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      if (fallback) return fallback();
      throw err;
    }
  }

  private onSuccess(): void {
    this.successCount++;
    this.failureCount = 0;
    if (this.state === "HALF_OPEN" && this.successCount >= this.options.successThreshold) {
      this.state = "CLOSED";
      this.successCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;
    this.lastFailureTime = Date.now();
    if (this.state === "HALF_OPEN" || this.failureCount >= this.options.failureThreshold) {
      this.state = "OPEN";
    }
  }
}
```

### Fallback Strategies

| Scenario | Fallback |
|---|---|
| DB is down | Return cached data (stale but available) |
| Recommendation service down | Return popular defaults (no personalization) |
| Auth service slow | Validate cached tokens, reject new logins (graceful degrade) |
| External payment API down | Queue payments for retry, inform user of delay |

---

## Bulkheads (Detailed)

### Thread Pool / Connection Pool Isolation

```typescript
// Good: separate pools per dependency
const dbPool = new Pool({ max: 20 });         // Database
const cachePool = new Pool({ max: 10 });       // Redis
const externalApiPool = new Pool({ max: 5 });  // External API

// ❌ Bad: one pool for everything
const allPool = new Pool({ max: 20 });  // One slow dependency exhausts all
```

### Semaphore-Based Bulkhead

```typescript
class Bulkhead {
  private active = 0;
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) {
        throw new BulkheadFullError();
      }
      await new Promise<void>((resolve, reject) => {
        this.queue.push({ resolve, reject });
      });
    }

    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.active < this.maxConcurrent) {
      const next = this.queue.shift()!;
      next.resolve();
    }
  }
}
```

---

## Graceful Degradation Patterns

### Feature Flag Degradation

```typescript
// Per-feature degradation status
const featureStatus = {
  recommendations: { degraded: false, fallback: "popular_defaults" },
  history: { degraded: false, fallback: "empty" },
  search: { degraded: false, fallback: null }, // no fallback = 503
};

function getRecommendations(userId: string): Recommendation[] {
  if (featureStatus.recommendations.degraded) {
    // Return cached popular items
    return getPopularItems();
  }
  try {
    return fetchPersonalizedRecommendations(userId);
  } catch (err) {
    // Degrade gracefully
    featureStatus.recommendations.degraded = true;
    logger.warn("Recs service failed, degrading to popular", { userId, error: err });
    return getPopularItems();
  }
}
```

### User-Facing Degradation Communication

```json
{
  "data": {
    "items": [/* ... */],
    "_degraded": {
      "recommendations": "Personalized recommendations unavailable. Showing popular items.",
      "search": "Real-time search unavailable. Results may be stale."
    }
  }
}
```

---

## Related Skills

- **[observability](.pi/skills/observability/SKILL.md)** — Monitoring circuit breaker state, alerting on degraded mode
- **[database-patterns](.pi/skills/database-patterns/SKILL.md)** — Connection pool management, query timeouts
- **[api-design](.pi/skills/api-design/SKILL.md)** — Timeout headers, retry-after headers, degraded responses
- **[testing-strategy](.pi/skills/testing-strategy/SKILL.md)** — Chaos testing, failure injection tests
- **[systems-recovery](.pi/skills/systems-recovery/SKILL.md)** — Disaster recovery for when resilience fails
