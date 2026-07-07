---
name: database-patterns
description: >
  Database engineering: schema migrations (expand-migrate-contract),
  N+1 prevention, indexing discipline, connection pooling, transaction
  boundaries, and data integrity constraints. Use for SQL/NoSQL tasks
  involving persistence, ORMs, or data modelling.
---

# Database Patterns

**Leading word:** _constraint_ — the database is the last place correctness is guaranteed. Enforce everything at schema level.

## Core: Integrity at Schema Level

> Schema is the source of truth for data shape. Constraints enforce correctness at the database level — the only place they're guaranteed. Migrations are code: version-controlled, reviewed, tested.

## Rule 1: Migration Strategy

- Every schema change is a **timestamped migration file** — additive, version-controlled, repeatable.
- **Roll forward, never roll back** — write a new migration to undo.
- **Zero-downtime pattern:** Expand → Migrate → Contract:

```
Phase 1 (Expand):    Add new column/table; old code ignores it.
Phase 2 (Migrate):   Backfill data; both old and new columns active.
Phase 3 (Contract):  Drop old column after all code uses the new one.
```

## Rule 2: N+1 Prevention

One query for N entities, then N queries for related data — the classic N+1. Detect it by watching for repeated identical queries in logs.

```typescript
// ❌ N+1: loads authors one-by-one
const books = await db.Book.findAll();
for (const book of books) {
  const author = await db.Author.findByPk(book.authorId); // N queries!
}

// ✅ Eager load: 1-2 queries total
const books = await db.Book.findAll({ include: [Author] });
```

**Detection tools:** `bullet` (Node), `nplusone` (Python), ORM query logs.

## Rule 3: Indexing Discipline

- **Index every** `WHERE`, `JOIN`, `ORDER BY`, `GROUP BY` column.
- **Composite indexes** — order by selectivity (most selective first).
- **Covering indexes** — include all selected columns to avoid table lookups.
- **Partial indexes** for sparse data: `CREATE INDEX ... WHERE status = 'active'`.
- **Use `EXPLAIN ANALYZE`** before and after. Monitor index usage — each index slows writes.

## Rule 4: Connection Management

- **Connection pooling** — never open/close per request.
- **Pool sizing:** `(core_count * 2) + effective_spindle_count` (PostgreSQL formula).
- **Set timeouts:** statement timeout (30s default), connection timeout (5s).
- **Health check** connections before use; discard stale ones.
- **Monitor utilization** — 80% saturation = add connections or optimize queries.

## Rule 5: Transaction Boundaries

- Transactions for **consistency**, not performance.
- **Keep them short** — hold locks minimally. Never do I/O inside a transaction (HTTP calls, file writes).
- **Optimistic locking** for high-contention rows (version column).
- **Retry serialization failures** (`40001` / `23505`) with exponential backoff.

```typescript
// ❌ Bad: I/O inside transaction
await db.transaction(async (tx) => {
  await tx.update(account, { balance: newBalance });
  await sendEmail(account.email, receipt); // holds lock during I/O!
});

// ✅ Good: transaction for data, I/O after commit
await db.transaction(async (tx) => {
  await tx.update(account, { balance: newBalance });
  pendingEmails.push({ to: account.email, receipt });
});
// Send emails here, outside transaction
```

## Rule 6: Integrity Constraints

- **NOT NULL** — at the database level, not just the application.
- **UNIQUE** — in the schema (don't check-then-insert — race condition).
- **FOREIGN KEY** — referential integrity at database level (unless sharded).
- **CHECK** — domain invariants (`CHECK (age >= 0)`).
- **ENUMs or reference tables** — constrain valid values at schema level.

## Rule 7: Read Path

- **Measure** query latency by endpoint (see `observability` skill).
- **Cache** where reads >> writes (Redis, CDN, application cache).
- **Read replicas** for reporting and analytics.
- **Materialized views** for expensive aggregations, refreshed on schedule.
- **Denormalize sparingly** — always have a migration plan.

---

## Pseudocode

```
SKILL database-patterns

INPUTS:
  dbType: string              // postgres, mysql, sqlite, mongodb, etc.
  schemaPath: string          // Location of schema/migration files
  criticalQueries: string[]   // Hot paths to optimize
  expectedScale: string       // dev, staging, production

OUTPUTS:
  migrationPlan: object[]     // Ordered migrations with phases
  indexRecommendations: object[]  // Suggested indexes with EXPLAIN ANALYZE
  n1Warnings: string[]        // Detected N+1 patterns

PRECONDITIONS:
  - Schema constraints at database level (NOT NULL, UNIQUE, FK)
  - Connection pool configured with timeouts
  - Migrations additive and version-controlled

POSTCONDITIONS:
  - All hot paths have EXPLAIN ANALYZE results
  - N+1 eliminated from critical query paths
  - Transactions short, no I/O inside
  - Index usage monitored, over-indexing avoided
  - Connection pool utilization < 80% at peak

ERROR_HANDLING:
  - Migration fails → roll forward (never back); fix forward
  - N+1 detected → rewrite to eager load or batch
  - Deadlock → retry with exponential backoff (up to 3 times)
  - Pool exhaustion → fail fast with clear error, don't queue
```

Full reference: `.pi/skills/database-patterns/reference.md`
