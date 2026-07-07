---
name: observability
description: >
  Production observability: structured logging (JSON, trace context),
  RED metrics (rate/errors/duration) per endpoint, USE metrics for
  infrastructure, distributed tracing, health checks, SLOs and burn-rate
  alerting. Use for any service-oriented or production-deployed system.
---

# Observability

**Leading word:** _pillars_ — logs, metrics, and traces. Two out of three leaves blind spots.

## Core: The Three Pillars

> Logs tell you what happened. Metrics tell you when it happened. Traces tell you where it happened. All three are required.

```
           Observations
          /      |      \
      Logs    Metrics   Traces
     (events) (counters) (paths)
```

## Rule 1: Structured Logging — JSON, Always

- **JSON format** — machine-parseable, schema-searchable. Never free-text.
- **Context:** `traceId`, `spanId`, `service`, `version`, `environment`.
- **Levels:** `DEBUG` (dev, off in prod), `INFO` (normal ops), `WARN` (recoverable), `ERROR` (needs investigation), `FATAL` (process cannot continue).

```typescript
// ❌ Unstructured, no context
console.log("User logged in: " + userId);

// ✅ Structured, searchable, contextual
logger.info("user.login", { userId, sourceIp, authMethod: "oauth2", durationMs: 42 });
```

- Never log secrets (PII, tokens, passwords).
- Log each request once at the boundary, with full context.

## Rule 2: RED Metrics per Service

**R**ate (requests/second), **E**rrors (failed/second), **D**uration (p50, p95, p99 latency).

Every service exposes these for every endpoint:

```
http_requests_total{method, endpoint, status}
http_requests_errors_total{method, endpoint, code}
http_request_duration_seconds{method, endpoint}
```

## Rule 3: USE Metrics for Infrastructure

**U**tilization (%), **S**aturation (queue depth), **E**rrors (count). Apply to CPU, memory, disk I/O, network, connection pools.

## Rule 4: Health Checks

Every service exposes:
- `GET /healthz` — liveness (process alive, quick, no deps)
- `GET /readyz` — readiness (can serve traffic, checks DB, cache, deps)

Return `200` or `503` with per-check detail.

## Rule 5: Distributed Tracing

- Propagate trace context at every service boundary (W3C TraceContext).
- Span every I/O operation — DB queries, HTTP calls, message publishing.
- Tag spans with meaningful metadata.
- Sample strategically: 100% for high-value paths, adaptive for others.

## Rule 6: SLIs, SLOs & Error Budgets

- **SLI** — actual measured value (e.g., fraction of requests < 200ms).
- **SLO** — target (e.g., 99.9% in < 200ms over 30 days).
- **Error budget** — `(1 - SLO) × total_requests`.
- **Burn rate alerting** — if exhausting 10% of budget in 1 hour, page.

## Rule 7: Alerting

- **Alert on symptoms, not causes** — "API is slow" not "CPU is high".
- **Alert fatigue is dangerous** — every alert must need human action.
- **Runbook every alert** — link to playbook in the alert.
- Silence before fixing: acknowledge, investigate, suppress expected noise.

---

## Pseudocode

```
SKILL observability

INPUTS:
  services: string[]           // Service names to instrument
  endpoints: string[]          // HTTP routes or message handlers
  criticalDeps: string[]       // DB, cache, queue, external APIs
  sloThreshold: number         // Target availability (e.g., 99.9)

OUTPUTS:
  instrumentationPlan: object  // Log/metric/trace per service+endpoint
  dashboardDefinition: object  // Panels, queries, refresh intervals
  alertRules: object[]         // Alert conditions, severity, runbook links

PRECONDITIONS:
  - Structured logging before any metrics
  - RED metrics per endpoint before deployment
  - Health endpoints before load balancer attachment
  - Trace context at every async boundary

POSTCONDITIONS:
  - Every service has /healthz and /readyz
  - Every endpoint has RED metrics (rate, errors, duration)
  - Traces capture all I/O with meaningful span tags
  - Alerts have runbooks, on symptoms not causes
  - Logs are structured JSON with trace context

ERROR_HANDLING:
  - Health check fails → remove from load balancer (readiness)
  - Metric backlog → non-blocking, drop instead of slow down
  - Trace sampling → adaptive: keep traces during errors
  - Log volume high → sample DEBUG, always keep ERROR
```

Full reference: `.pi/skills/observability/reference.md`
