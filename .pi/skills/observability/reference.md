---
name: observability-reference
description: Full reference for observability skill (lazy-loaded on demand)
---

# Observability — Full Reference

## Core Philosophy

> *"You can't optimize what you can't measure. You can't debug what you can't observe."*

Observability is not a tool or a dashboard — it's a **property of the system**: the ability to understand internal states from external outputs.

---

## The Three Pillars (Detailed)

### 1. Structured Logging

**Why structured JSON?** Because grep doesn't scale. Structured logs are queryable, aggregatable, and schema-validatable.

#### Log Schema (Recommended)

```json
{
  "timestamp": "2026-07-07T10:30:00.123Z",
  "level": "INFO",
  "message": "user.login.success",
  "service": "auth-service",
  "version": "2.3.1",
  "environment": "production",
  "traceId": "abc-def-123",
  "spanId": "span-456",
  "userId": "usr_abc123",
  "duration_ms": 42,
  "metadata": {
    "authMethod": "oauth2",
    "sourceIp": "10.0.1.50",
    "mfaRequired": false
  }
}
```

#### Logging Libraries by Language

| Language | Library | Features |
|---|---|---|
| TypeScript | `pino` (fastest), `winston` (most plugins) | JSON by default, redaction, child loggers |
| Python | `structlog`, `loguru` | Structured, easy migration from stdlib |
| Rust | `tracing`, `slog` | Structured, async-aware, spans |
| Go | `slog` (std), `zerolog`, `zap` | Zero-allocation, fast, structured |

#### Log Redaction (Never Log Secrets)

```typescript
// pino redaction example
const logger = pino({
  redact: {
    paths: ['req.headers.authorization', 'req.body.password', 'req.body.ssn'],
    censor: '[REDACTED]'
  }
});
```

### 2. Metrics

#### RED Metrics (Services)

| Metric | Type | Labels | Purpose |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `endpoint`, `status` | Rate |
| `http_requests_errors_total` | Counter | `method`, `endpoint`, `code` | Errors |
| `http_request_duration_seconds` | Histogram | `method`, `endpoint` | Duration |
| `http_requests_inflight` | Gauge | `method` | Concurrency |

**Histogram buckets:** `[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`

#### USE Metrics (Infrastructure)

| Resource | Utilization | Saturation | Errors |
|---|---|---|---|
| CPU | `cpu_utilization_ratio` | `cpu_run_queue_length` | `cpu_errors_total` |
| Memory | `memory_used_bytes / memory_total_bytes` | `memory_swap_usage_bytes` | `memory_errors_total` (OOM) |
| Disk | `disk_used_bytes / disk_total_bytes` | `disk_io_queue_depth` | `disk_io_errors_total` |
| Network | `network_bandwidth_usage` | `network_drop_count` | `network_error_count` |
| Connection pool | `pool_used / pool_max` | `pool_queue_depth` | `pool_timeout_errors` |

### 3. Distributed Tracing

#### Trace Propagation (W3C TraceContext)

```typescript
// Outgoing HTTP: propagate traceparent header
const traceparent = `00-${traceId}-${spanId}-01`;
fetch(url, {
  headers: { traceparent, tracestate }
});
```

#### Span Attributes (Semantic Conventions)

```typescript
// DB query span
span.setAttributes({
  "db.system": "postgresql",
  "db.statement": "SELECT * FROM users WHERE id = ?",
  "db.operation": "SELECT",
  "db.user": "app_user",
};

// HTTP client span
span.setAttributes({
  "http.method": "POST",
  "http.url": "https://api.example.com/v1/users",
  "http.status_code": 200,
});
```

#### Sampling Strategies

| Strategy | When | Cost |
|---|---|---|
| **Head-based** (100%) | Dev, staging | High (all traces) |
| **Head-based** (1-5%) | Production low-traffic | Moderate |
| **Tail-based** (keep on error) | Production high-traffic | Lower (only interesting traces) |
| **Adaptive** (dynamic rate) | Production variable | Optimal |

---

## Health Checks in Depth

### Health Check Implementation

```typescript
// healthz — liveness: is the process running?
app.get("/healthz", (_, res) => {
  res.status(200).json({ status: "ok" });
});

// readyz — readiness: can it serve traffic?
app.get("/readyz", async (_, res) => {
  const checks = {
    database: await checkDB(),
    redis: await checkRedis(),
    disk: checkDisk(),
  };
  const allOk = Object.values(checks).every(c => c.status === "ok");
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    checks,
    uptime: process.uptime(),
  });
});
```

### Health Check Types for Kubernetes

```yaml
# deployment.yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
startupProbe:
  httpGet:
    path: /startupz
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 10
  failureThreshold: 30  # 5 minutes max startup
```

---

## SLO & Error Budget Design

### Choosing SLIs

| Service Type | Good SLI | Target |
|---|---|---|
| HTTP API | `count(requests < 200ms) / total_requests` | 99.9% |
| Data pipeline | `count(successful_records) / total_records` | 99.99% |
| Background worker | `count(jobs_completed < 60s) / total_jobs` | 99% |
| Cache | `cache_hits / (cache_hits + cache_misses)` | 95% |
| Database | `count(queries < 100ms) / total_queries` | 99.95% |

### Burn Rate Alerting

| Burn Rate | Window | Action |
|---|---|---|
| 10x (exhausts 10% budget in 1h) | 1 hour | Page (critical) |
| 2x (exhausts 10% budget in 5h) | 5 hours | Page (warning) |
| 1x (exhausts 10% budget in 10h) | 10 hours | Ticket |

---

## Alerting Rules Patterns

### Good Alert (Symptom-Based)

```
# Alert: API p99 latency > 500ms for 5 minutes
ALERT HighAPILatency
  IF histogram_quantile(0.99, http_request_duration_seconds_bucket) > 0.5
  FOR 5m
  LABELS { severity = "page", runbook = "https://runbooks.example.com/high-latency" }
  ANNOTATIONS {
    summary = "API p99 latency is {{ $value }}s",
    description = "p99 latency has been > 500ms for 5 minutes across all endpoints"
  }
```

### Bad Alert (Cause-Based)

```
# ❌ Alert: CPU is high
ALERT HighCPU
  IF cpu_utilization > 0.9
  # What do I do about this? Is it spiky or sustained? Is it causing errors?
```

---

## Related Skills

- **[error-resilience](.pi/skills/error-resilience/SKILL.md)** — Health probes, degraded mode metrics
- **[api-design](.pi/skills/api-design/SKILL.md)** — Metrics + logging instrumentation per endpoint
- **[security-practices](.pi/skills/security-practices/SKILL.md)** — Security logging and auditing
- **[testing-strategy](.pi/skills/testing-strategy/SKILL.md)** — Observability-driven testing (logs as assertions)
