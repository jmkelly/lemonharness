---
name: database-patterns
description: >
  Reliable database engineering: schema migration strategies,
  query optimization & indexing, N+1 prevention, connection
  management, data integrity constraints, transactions, and
  replication patterns. Use for any task involving SQL/NoSQL
  databases, ORMs, or data persistence.
---

# Database Patterns

## Core: Data Integrity First

> Schema is the source of truth for data shape. Constraints enforce
> correctness at the database level — the only place they're guaranteed.
> Migrations are code: version-controlled, reviewed, tested.

## Rule 1: Migration Strategy

- **Every schema change is a migration file** — timestamped, versioned, repeatable
- **Migrations are additive only** — never modify or delete a migration that's been applied
- **Roll-forward, not roll-back** — write a new migration to undo a previous one
- **Test migrations** against a copy of production data before deploying
- **Zero-downtime migrations** require expand-migrate-contract pattern:

```
Phase 1 (Expand):    Add new column/table; old code ignores it
Phase 2 (Migrate):   Backfill data; both old and new columns active
Phase 3 (Contract):  Drop old column after all code uses new one
```

## Rule 2: N+1 Query Prevention

The N+1 problem: 1 query to fetch N entities, then N queries to fetch related data.

```typescript
// ❌ N+1: loads authors one-by-one
const books = await db.Book.findAll();
for (const book of books) {
  const author = await db.Author.findByPk(book.authorId);  // N queries!
}

// ✅ Eager load: 1-2 queries total
const books = await db.Book.findAll({ include: [Author] });
```

**Detect N+1:** Watch for repeated identical queries in logs. Use `bullet` (Node), `nplusone` (Python), `db:prepare` warnings in dev.

## Rule 3: Indexing Discipline

- **Index foreign keys** — every `WHERE`, `JOIN`, `ORDER BY`, `GROUP BY` column
- **Composite indexes** — order by selectivity (most selective first)
- **Covering indexes** — include all selected columns to avoid table lookups
- **Avoid over-indexing** — each index slows writes; monitor index usage
- **Use `EXPLAIN ANALYZE`** before and after adding indexes
- **Partial indexes** for sparse data: `CREATE INDEX ... WHERE status = 'active'`

## Rule 4: Connection Management

- **Connection pooling** — never open/close connections per request
- **Pool sizing** — `(core_count * 2) + effective_spindle_count` (PostgreSQL formula)
- **Monitor pool utilization** — 80% saturation = add more connections or optimize queries
- **Set statement timeout** — kill runaway queries (30s default, adjust per endpoint)
- **Set connection timeout** — fail fast if pool exhausted (5s)
- **Health check connections** — test before use, discard stale ones

## Rule 5: Transaction Boundaries

- **Transactions are for consistency, not performance**
- **Keep transactions short** — hold locks for minimal time
- **Never do I/O inside a transaction** (HTTP calls, file writes, message sends)
- **Use optimistic locking** for high-contention rows (version column)
- **Retry on serialization failures** — `40001` / `23505` with exponential backoff

```typescript
// ❌ Bad: I/O inside transaction
await db.transaction(async (tx) => {
  await tx.update(account, { balance: newBalance });
  await sendEmail(account.email, receipt);  // holds lock during I/O!
});

// ✅ Good: transaction for data, I/O after commit
await db.transaction(async (tx) => {
  await tx.update(account, { balance: newBalance });
  pendingEmails.push({ to: account.email, receipt });
});
// Send emails outside transaction
```

## Rule 6: Data Integrity Constraints

- **NOT NULL** — required fields at the database level, not just the application
- **UNIQUE** — enforce uniqueness in the schema (don't check-then-insert — race condition)
- **FOREIGN KEY** — referential integrity at database level (unless sharded)
- **CHECK constraints** — domain invariants (`CHECK (age >= 0)`)
- **ENUMs or reference tables** — constrain valid values at schema level

## Rule 7: Read Path Optimization

- **Measure query latency by endpoint** (see `observability` skill)
- **Add caching where reads >> writes** (Redis, CDN, application cache)
- **Use read replicas** for reporting, analytics, and non-critical reads
- **Materialized views** for expensive aggregations refreshed on schedule
- **Denormalize sparingly** — always have a migration plan if you do

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
  migrationPlan: object[]     // Ordered migrations with expand/migrate/contract phases
  indexRecommendations: object[]  // Suggested indexes with EXPLAIN ANALYZE data
  n1Warnings: string[]        // Detected N+1 patterns in query paths

PRECONDITIONS:
  - Schema constraints (NOT NULL, UNIQUE, FK) defined at database level
  - Connection pool configured with timeout limits
  - Migrations are additive and version-controlled

POSTCONDITIONS:
  - All hot paths have EXPLAIN ANALYZE results
  - N+1 patterns eliminated from critical query paths
  - Transactions are short and never contain I/O
  - Index usage monitored and over-indexing avoided
  - Connection pool utilization < 80% at peak

ERROR_HANDLING:
  - Migration fails → roll forward (never roll back); fix forward
  - N+1 detected → rewrite to eager load or batch
  - Deadlock → retry with exponential backoff (up to 3 times)
  - Pool exhaustion → fail fast with clear error, don't queue
```

Full reference: `.pi/skills/database-patterns/reference.md`
