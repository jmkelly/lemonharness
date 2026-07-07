---
name: api-design
description: >
  Contract-first API design for maintainable distributed systems:
  schema-first (OpenAPI/gRPC/GraphQL), versioning, backward
  compatibility, consistent error responses, idempotency,
  pagination, and rate limiting patterns.
---

# API Design

## Core: Contract-First Development

> Write the contract before the implementation. The contract is the source of truth.
> Clients and servers are just implementations of the same document.

**Choose your contract type:**
- **OpenAPI 3.x** — RESTful HTTP APIs (most ecosystem support)
- **Protobuf/gRPC** — Internal microservices, streaming, polyglot
- **GraphQL SDL** — Consumer-driven data fetching, real-time subscriptions

## Rule 1: Backward Compatibility (Always)

Every change must be backward-compatible unless a major version bump:

| Change | Compatible? | Notes |
|---|---|---|
| Adding optional field | ✅ Always safe | Stored procedures must handle missing |
| Adding endpoint | ✅ Safe | New capability |
| Widening input type | ✅ Safe | `int32` → `int64` |
| Narrowing output | ❌ Breaking | Removes data clients may use |
| Renaming field | ❌ Breaking | Use `x-deprecated` + migration period |
| Changing enum values | ❌ Breaking | Add new values, never remove/rename |
| Changing default behavior | ❌ Breaking | New defaults need opt-in endpoint |

**Tooling:** Use `openapi-diff`, `buf breaking`, `graphql-inspector` in CI.

## Rule 2: Consistent Error Responses

All errors return a uniform structure:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Retry after 30s.",
    "details": { "retryAfter": 30 },
    "traceId": "abc-123",
    "docsUrl": "https://api.example.com/errors#RATE_LIMITED"
  }
}
```

HTTP status codes: use precisely, don't `200 OK` for errors:
- `400` — client sent bad data (include which field)
- `401` — missing/invalid authentication
- `403` — authenticated but not authorized
- `404` — resource not found (don't reveal existence of other resources)
- `409` — conflict (idempotency key collision, optimistic lock fail)
- `422` — validation error (use with structured field errors)
- `429` — rate limited (always include `Retry-After` header)
- `500` — server error (never leak stack traces)

## Rule 3: Idempotency

Every mutating endpoint should support idempotency keys:
- Client sends `Idempotency-Key: <uuid>` header
- Server deduplicates identical keys within TTL (24h default)
- First request processes; subsequent return cached response
- Return `409 CONFLICT` if same key, different request body

## Rule 4: Pagination Patterns

Cursor-based pagination is preferred (stable under write load):

```json
// Request
GET /items?cursor=eyJpZCI6IDEyM30=&limit=20

// Response
{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6IDE0M30=",
    "hasMore": true,
    "estimatedTotal": 150
  }
}
```

- **Cursor-based** — stable, efficient, recommended for most APIs
- **Offset-based** — only for static/append-only datasets
- **Keyset pagination** — best for high-write tables (use indexed column)

## Rule 5: Versioning Strategy

- **URL path versioning** (`/v1/`) for public APIs (most explicit)
- **Header versioning** (`Accept: application/vnd.example.v2+json`) for internal
- **No version = v1** — default to latest stable
- Support each version for minimum 6 months
- Deprecate with `Sunset` header and `X-Deprecated: true` response header

## Rule 6: Input Validation & Security

- Validate all inputs against the contract schema before business logic
- Reject unknown fields by default (not silently ignored)
- Rate limit by client, endpoint, and tenant
- Never return internal IDs (use UUIDs opaque to the client)
- Sanitize all free-text inputs (XSS, SQL injection, NoSQL injection)

---

## Pseudocode

```
SKILL api-design

INPUTS:
  apiStyle: string          // rest, grpc, graphql
  contractFormat: string    // openapi, protobuf, sdl
  endpoints: string[]       // List of endpoint paths/methods
  authScheme: string        // bearer, oauth2, apikey, mtls

OUTPUTS:
  contractDoc: object       // Generated/validated contract
  compatReport: object      // Breaking changes vs. previous version
  paginationPlan: object    // cursor/offset/keyset per endpoint

PRECONDITIONS:
  - Contract written before implementation starts
  - Idempotency key support on all mutating endpoints
  - Uniform error response structure defined
  - Input validation happens before business logic

POSTCONDITIONS:
  - All endpoints have documented error modes
  - Pagination is cursor-based unless data is append-only
  - Breaking changes detected before deployment
  - Rate limiting is per-client, per-endpoint

ERROR_HANDLING:
  - Breaking change detected → require major version bump
  - Validation fails → return 422 with structured field errors
  - Rate limit exceeded → return 429 with Retry-After
  - Idempotency key collision → return 409 with existing response
```

Full reference: `.pi/skills/api-design/reference.md`
