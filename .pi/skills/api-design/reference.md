---
name: api-design-reference
description: Full reference for api-design skill (lazy-loaded on demand)
---

# API Design — Full Reference

## Core Philosophy

> *"APIs should be easy to use correctly and hard to use incorrectly."* — Joshua Bloch

A well-designed API is intuitive, consistent, and backwards-compatible by default. Every breaking change represents a failure of the original design.

---

## Contract-First Development Workflow

```
1. Write the contract     → OpenAPI / protobuf / GraphQL SDL
2. Generate types/schema  → Server stubs + client SDKs
3. Validate contract      → Breaking change detection in CI
4. Implement server       → Driven by contract types
5. Test against contract  → Contract tests in CI
6. Publish contract       → Developer portal / registry
```

**Tooling by contract type:**

| Contract | Spec | Editor | Validation | Breaking Change Detection |
|---|---|---|---|---|
| REST | OpenAPI 3.x | Swagger Editor, Stoplight | `openapi-validator`, `speccy` | `openapi-diff`, `oas-diff` |
| gRPC | Protobuf | `buf`, `protoc` | `buf lint`, `buf breaking` | `buf breaking --against` |
| GraphQL | GraphQL SDL | Apollo Studio, GraphiQL | `graphql-validator` | `graphql-inspector` |

---

## REST API Design Patterns

### URL Structure

```
GET    /v1/users                    # List users
POST   /v1/users                    # Create user
GET    /v1/users/:id                # Get user by ID
PATCH  /v1/users/:id                # Partial update
DELETE /v1/users/:id                # Delete user
GET    /v1/users/:id/orders         # Sub-resource list
POST   /v1/users/:id/orders         # Create sub-resource
```

**Naming conventions:**
- Plural nouns for collections: `/users`, `/orders`
- Singular for singletons: `/profile`, `/config`
- Kebab-case for multi-word: `/order-items`, not `/orderItems`
- Query parameters for filtering: `?status=active&sort=created_at`
- Actions as verbs only for non-CRUD: `/users/:id/activate`, `/orders/:id/cancel`

### Request/Response Format

**Create:**
```json
// POST /v1/users
// Request
{
  "name": "Alice",
  "email": "alice@example.com"
}
// Response 201
{
  "id": "usr_abc123",
  "name": "Alice",
  "email": "alice@example.com",
  "created_at": "2026-01-15T10:30:00Z"
}
```

**List with filtering:**
```json
// GET /v1/users?status=active&limit=20&cursor=eyJpZCI6IDF9
// Response 200
{
  "data": [/* ... */],
  "pagination": {
    "next_cursor": "eyJpZCI6IDIxfQ==",
    "has_more": true
  }
}
```

**Error:**
```json
// Response 422
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "fields": {
        "email": "must be a valid email address",
        "name": "must be between 1 and 100 characters"
      }
    },
    "trace_id": "abc-123-def"
  }
}
```

---

## gRPC Design Patterns

### Service Definition

```protobuf
service UserService {
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
  rpc GetUser(GetUserRequest) returns (User);
  rpc CreateUser(CreateUserRequest) returns (User);
  rpc UpdateUser(UpdateUserRequest) returns (User);
  rpc DeleteUser(DeleteUserRequest) returns (google.protobuf.Empty);
}
```

### Error Handling

```protobuf
// Use standard gRPC codes:
// INVALID_ARGUMENT (3)  — bad input
// NOT_FOUND (5)         — resource doesn't exist
// ALREADY_EXISTS (6)    — conflict
// PERMISSION_DENIED (7) — auth/authorization
// UNAVAILABLE (14)      — service temporarily unavailable
// INTERNAL (13)         — server error (never leak details)
```

---

## GraphQL Design Patterns

### Schema Design

```graphql
type Query {
  users(status: UserStatus, first: Int, after: String): UserConnection!
  user(id: ID!): User
}

type Mutation {
  createUser(input: CreateUserInput!): CreateUserPayload!
  updateUser(id: ID!, input: UpdateUserInput!): UpdateUserPayload!
  deleteUser(id: ID!): DeleteUserPayload!
}

type User {
  id: ID!
  name: String!
  email: EmailAddress!  # Custom scalar
  status: UserStatus!
  orders(first: Int, after: String): OrderConnection!
}
```

### Error Handling in GraphQL

```graphql
interface Error {
  message: String!
  code: String!
}

type ValidationError implements Error {
  message: String!
  code: String!
  field: String!
  constraint: String!
}

type CreateUserPayload {
  user: User
  errors: [Error!]
}
```

---

## Backward Compatibility Checklist

### REST/OpenAPI

- [ ] New fields are optional (not `required` in schema)
- [ ] New response fields appear at the end (not middle) of objects
- [ ] `default` values for new optional fields match existing behavior
- [ ] Enum values are only added, never removed or renamed
- [ ] No endpoint URL changes without redirect
- [ ] Request body changes are additive (new optional fields only)

### gRPC/Protobuf

- [ ] Field numbers are never reused (use `reserved`)
- [ ] New fields are added after existing ones (field number ordering)
- [ ] Never change field types
- [ ] Never change service method signatures
- [ ] Use `google.protobuf.Value` for open-ended structures

### GraphQL

- [ ] Fields are only added, never removed (deprecate instead)
- [ ] `@deprecated(reason: "...")` for old fields, remove after 6+ months
- [ ] New arguments are optional with defaults
- [ ] Enum values are only added (never removed or renamed)

---

## Versioning Strategy

### URL Path Versioning (Recommended for Public APIs)

```
GET /v1/users    → stable v1
GET /v2/users    → next version, both coexist
```

Pros: Explicit, cacheable, easy to route. Cons: URL pollution.

### Header Versioning (Recommended for Internal APIs)

```
Accept: application/vnd.example.v2+json
```

Pros: Clean URLs, flexible. Cons: Harder to cache, less discoverable.

### Sunset Policy

```
# Response header for deprecated endpoints
Sunset: Sat, 15 Jan 2027 00:00:00 GMT
Deprecated: true
```

- Support each version for minimum 6 months (12 months for major version)
- Announce deprecation 3 months before sunset
- Return `Sunset` header on all deprecated endpoints

---

## Pagination Reference

### Cursor-Based (Preferred)

```typescript
// Base64-encoded cursor from last item
function encodeCursor(item: { id: number; created_at: string }): string {
  return Buffer.from(JSON.stringify({
    id: item.id,
    created_at: item.created_at
  })).toString('base64');
}

// SQL: WHERE (created_at, id) > (:lastCreatedAt, :lastId)
// ORDER BY created_at ASC, id ASC
// LIMIT :limit + 1 (fetch N+1 to check hasMore)
```

### Keyset Pagination (Best for High-Write)

```sql
SELECT id, name, created_at
FROM users
WHERE (created_at, id) > ($1, $2)  -- composite key
ORDER BY created_at ASC, id ASC
LIMIT 20;
```

---

## Related Skills

- **[testing-strategy](.pi/skills/testing-strategy/SKILL.md)** — Contract testing, schema validation in tests
- **[security-practices](.pi/skills/security-practices/SKILL.md)** — Input validation, rate limiting, auth
- **[observability](.pi/skills/observability/SKILL.md)** — API metrics, logging, tracing
