---
name: observability
description: >
  Production observability patterns: structured logging, metrics
  (RED/USE methods), distributed tracing, health checks, SLIs/SLOs,
  alerting, and dashboards. Use for any service-oriented or
  production-deployed software task.
---

# Observability

## Core: The Three Pillars

> Logs tell you what happened. Metrics tell you when it happened. Traces tell you where it happened.

All three are required. Two out of three leaves blind spots.

```
           Observations
          /      |      \
      Logs    Metrics   Traces
     (events)  (counters) (paths)
```

## Rule 1: Structured Logging (Always)

- **JSON format** — machine-parseable, schema-searchable (never free-text)
- **Include context** — `traceId`, `spanId`, `service`, `version`, `environment`
- **Log levels matter**:
  - `DEBUG` — developer details, disabled in production
  - `INFO` — normal operation events (request start/end, state changes)
  - `WARN` — recoverable anomalies (retry happened, degraded mode)
  - `ERROR` — failures needing investigation (exceptions, timeouts)
  - `FATAL` — process cannot continue (unrecoverable state)

```typescript
// ❌ Bad: unstructured, no context
console.log("User logged in: " + userId);

// ✅ Good: structured, searchable, contextual
logger.info("user.login", { userId, sourceIp, authMethod: "oauth2", durationMs: 42 });
```

- **Never log secrets** — PII, tokens, passwords, session IDs
- **Log each request once** at the boundary (middleware), with full context

## Rule 2: RED Metrics for Services

**R**ate — requests per second (traffic)
**E**rrors — failed requests per second (quality)
**D**uration — latency distribution (p50, p95, p99)

Every service exposes these three for every endpoint:

```
http_requests_total{method, endpoint, status}       // Rate
http_requests_errors_total{method, endpoint, code}   // Errors
http_request_duration_seconds{method, endpoint}       // Duration (histogram)
```

## Rule 3: USE Metrics for Infrastructure

**U**tilization — % of resource being used
**S**aturation — queue depth or backlog
**E**rrors — error count for the resource

Apply to: CPU, memory, disk I/O, network, connection pools, thread pools.

## Rule 4: Health Checks & Readiness

Every service exposes two endpoints:

```
GET /healthz     — Liveness: is the process alive? (quick, no deps check)
GET /readyz      — Readiness: can it serve traffic? (checks DB, cache, deps)
```

Return `200 OK` or `503 Service Unavailable` with per-check detail:

```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "ok", "latencyMs": 3 },
    "redis": { "status": "ok", "latencyMs": 1 },
    "disk": { "status": "ok", "usagePercent": 62 }
  },
  "uptime": 3600
}
```

## Rule 5: Distributed Tracing

- **Propagate trace context** at every service boundary (W3C TraceContext)
- **Span every I/O operation** — DB queries, HTTP calls, message publishing
- **Tag spans** with meaningful metadata (`db.statement`, `http.url`, `messaging.destination`)
- **Sample strategically** — 100% of traces for high-value paths, adaptive for others

## Rule 6: SLIs & SLOs

- **SLI** — actual measured value (e.g., "fraction of requests completed in < 200ms")
- **SLO** — target (e.g., "99.9% of requests complete in < 200ms over 30-day window")
- **Error budget** — `(1 - SLO) * total_requests` — your budget for being wrong
- **Burn rate alerting** — if exhausting 10% of budget in 1 hour, page

## Rule 7: Alerting

- **Alert on symptoms, not causes** — "API is slow" not "CPU is high"
- **Alert fatigue is dangerous** — every alert must need human action
- **Use burn-rate alerts** for SLO-based paging
- **Runbook every alert** — link to playbook in the alert
- **Silence before fixing** — acknowledge alert, investigate, silence expected noise

---

## Pseudocode

```
SKILL observability

INPUTS:
  services: string[]           // Service names to instrument
  endpoints: string[]          // HTTP routes or message handlers
  criticalDeps: string[]       // DB, cache, queue, external APIs
  sloThreshold: number         // Target latency or availability (e.g., 99.9)

OUTPUTS:
  instrumentationPlan: object  // Log/metric/trace per service+endpoint
  dashboardDefinition: object  // Panels, queries, refresh intervals
  alertRules: object[]         // Alert conditions, severity, runbook links

PRECONDITIONS:
  - Structured logging configured before any metrics
  - RED metrics defined per endpoint before deployment
  - Health endpoints implemented before load balancer attachment
  - Trace context propagated at every async boundary

POSTCONDITIONS:
  - Every service has /healthz and /readyz
  - Every endpoint has RED metrics (rate, errors, duration)
  - Traces capture all I/O with meaningful span tags
  - Alerts have runbooks and are on symptoms, not causes
  - Logs are structured JSON with trace context

ERROR_HANDLING:
  - Health check fails → remove from load balancer (readiness)
  - Metric backlog → non-blocking, drop instead of slow down
  - Trace sampling → adaptive: keep traces during errors
  - Log volume high → sample DEBUG, always keep ERROR
```

Full reference: `.pi/skills/observability/reference.md`
