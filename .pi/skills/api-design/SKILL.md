---
name: api-design
description: >
  Contract-first API design: schema-first (OpenAPI/gRPC/GraphQL),
  backward compatibility, consistent error responses, idempotency,
  cursor pagination, versioning. Use when designing or evolving
  an HTTP, gRPC, or GraphQL API.
---

# API Design

**Leading word:** _contract_ — the schema is the source of truth. Write it first, implement it second. Every rule below preserves the contract's integrity.

## Core: **Contract-First**

> Write the contract before the implementation. The contract is the source of truth. Clients and servers are implementations of the same document.

**Choose your contract type:**
- **OpenAPI 3.x** — RESTful HTTP (broadest ecosystem)
- **Protobuf/gRPC** — internal microservices, streaming, polyglot
- **GraphQL SDL** — consumer-driven data fetching, subscriptions

## Rule 1: Backward Compatibility

Every change must be backward-compatible unless the major version bumps:

| Change | Compatible? | Notes |
|---|---|---|
| Adding optional field | ✅ Always | Stored procedures must handle missing |
| Adding endpoint | ✅ Always | New capability |
| Widening input type | ✅ Safe | `int32` → `int64` |
| Narrowing output | ❌ Breaking | Removes data clients may use |
| Renaming field | ❌ Breaking | Use `x-deprecated` + migration period |
| Changing enum values | ❌ Breaking | Add new values, never remove |
| Changing default behavior | ❌ Breaking | New defaults need opt-in endpoint |

**CI tooling:** `openapi-diff`, `buf breaking`, `graphql-inspector`.

## Rule 2: Uniform Error Responses

All errors return the same structure:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Retry after 30s.",
    "details": { "retryAfter": 30 },
    "traceId": "abc-123"
  }
}
```

HTTP status codes — precise, never `200` for errors:
- `400` — bad input (include which field)
- `401` — missing/invalid auth
- `403` — authenticated but unauthorized
- `404` — not found (don't reveal existence)
- `409` — conflict (idempotency collision, optimistic lock)
- `422` — validation failure (structured field errors)
- `429` — rate limited (include `Retry-After`)
- `500` — server error (never leak stack traces)

## Rule 3: Idempotency

Every mutating endpoint should support idempotency keys:
- Client sends `Idempotency-Key: <uuid>` header
- Server deduplicates identical keys within TTL (24h default)
- First request processes; subsequent return cached response
- Return `409` if same key, different request body

## Rule 4: Cursor Pagination

Cursor-based pagination is preferred (stable under write load):

```json
GET /items?cursor=eyJpZCI6IDEyM30=&limit=20

{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6IDE0M30=",
    "hasMore": true
  }
}
```

- **Cursor** — stable, efficient. Default choice.
- **Offset** — only for static/append-only datasets.
- **Keyset** — best for high-write tables with indexed columns.

## Rule 5: Versioning

- **URL path** (`/v1/`) for public APIs (most explicit).
- **Header** (`Accept: application/vnd.example.v2+json`) for internal.
- Support each version ≥ 6 months. Deprecate with `Sunset` + `X-Deprecated` headers.

---

## Pseudocode

```
SKILL api-design

INPUTS:
  apiStyle: string          // rest, grpc, graphql
  contractFormat: string    // openapi, protobuf, sdl
  endpoints: string[]       // Endpoint paths/methods
  authScheme: string        // bearer, oauth2, apikey, mtls

OUTPUTS:
  contractDoc: object       // Generated/validated contract
  compatReport: object      // Breaking changes vs. previous version
  paginationPlan: object    // cursor/offset/keyset per endpoint

PRECONDITIONS:
  - Contract written before implementation
  - Idempotency key support on all mutating endpoints
  - Uniform error response structure defined

POSTCONDITIONS:
  - All endpoints have documented error modes
  - Pagination is cursor-based unless data is append-only
  - Breaking changes detected before deployment
  - Rate limiting is per-client, per-endpoint

ERROR_HANDLING:
  - Breaking change → require major version bump
  - Validation fails → 422 with structured field errors
  - Rate limit exceeded → 429 with Retry-After
  - Idempotency key collision → 409 with existing response
```

Full reference: `.pi/skills/api-design/reference.md`
