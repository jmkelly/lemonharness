---
name: database-patterns-reference
description: Full reference for database-patterns skill (lazy-loaded on demand)
---

# Database Patterns — Full Reference

## Core Philosophy

> *"The database is the source of truth. The schema is the contract. Constraints are the enforcement."*

---

## Migration Patterns (Detailed)

### Migration Naming Convention

```bash
# Timestamp-prefixed, descriptive
YYYYMMDDHHMMSS_description.sql

# Examples:
20260707000000_create_users_table.sql
20260707000001_add_email_unique_index.sql
20260707000002_add_role_column_to_users.sql
20260707000003_backfill_user_roles.sql
```

### Migration File Structure

```sql
-- 20260707000002_add_role_column_to_users.sql
-- Add role column with default value

-- UP: Apply migration
ALTER TABLE users ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'member';
CREATE INDEX idx_users_role ON users(role);

-- DOWN: Rollback (roll-forward preferred, but keep for local dev)
-- ALTER TABLE users DROP COLUMN role;
```

### Expand-Migrate-Contract Pattern (Zero-Downtime)

```mermaid
Phase 1 (Expand):    Add column, old code ignores it
Phase 2 (Migrate):   Backfill data for existing rows
Phase 3 (Contract):  Deploy code that uses new column, then drop old
```

**Example: Renaming a column**

```sql
-- Phase 1 (Expand): Add new column alongside old
ALTER TABLE users ADD COLUMN display_name VARCHAR(100);
-- (Old code still writes to `name`)

-- Phase 2 (Migrate): Backfill
UPDATE users SET display_name = name WHERE display_name IS NULL;

-- Phase 2.5 (Deploy): Deploy code that writes to both `name` AND `display_name`
--                      Reads from `display_name` when available

-- Phase 3 (Contract): Remove old column
ALTER TABLE users DROP COLUMN name CASCADE;
```

---

## Query Optimization Patterns

### Using EXPLAIN ANALYZE

```sql
EXPLAIN ANALYZE
SELECT u.name, COUNT(o.id) as order_count
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.status = 'active'
GROUP BY u.id
ORDER BY order_count DESC
LIMIT 10;
```

**What to look for:**
- **Seq Scan on large tables** → needs index
- **Sort (uses disk)** → memory budget too small, or missing index
- **Nested Loop (many rows)** → consider Hash Join or index
- **Rows Removed by Filter** → expensive; add index or restructure query

### Index Selection Guide

```sql
-- B-tree (default): equality + range queries, ORDER BY
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created ON users(created_at);

-- Hash: exact equality only (faster than B-tree for =)
CREATE INDEX idx_users_id_hash ON users USING HASH (id);

-- GiST: full-text search, geometric, range types
CREATE INDEX idx_docs_content ON docs USING GIN (to_tsvector('english', content));

-- GIN: array contains, JSONB queries, full-text
CREATE INDEX idx_users_tags ON users USING GIN (tags);
CREATE INDEX idx_users_data ON users USING GIN (data jsonb_path_ops);

-- Partial: index only subset (saves space, faster writes)
CREATE INDEX idx_users_active ON users(id) WHERE status = 'active';

-- Covering (INCLUDE columns): index-only scans
CREATE INDEX idx_users_email_include ON users(email) INCLUDE (name, created_at);
```

### Common Query Anti-Patterns

| Anti-Pattern | Symptom | Fix |
|---|---|---|
| **N+1 queries** | Repeated identical queries in loop | Eager load |
| **`SELECT *`** | Fetching unused columns | Select only needed columns |
| **No LIMIT** | Full table scan when 10 rows needed | Always LIMIT |
| **`WHERE func(column) = x`** | No index used (function breaks index) | Use expression index or computed column |
| **OR conditions on different indexed columns** | Index merge | UNION ALL or composite index |
| **`LIKE '%term%'`** | Full scan | Full-text search (GIN index) |
| **Implicit type conversion** | Index not used | Match types in WHERE clause |
| **Counting large tables** | Slow sequential count | Use approximate count (pg_class, or hyperloglog) |

---

## Connection Pool Configuration

### PostgreSQL (with `pg-pool` / `psycopg2`)

```typescript
const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: "myapp",
  max: 20,                    // Max connections: (core_count * 2) + disk_spindles
  idleTimeoutMillis: 30_000,  // Close idle connections after 30s
  connectionTimeoutMillis: 5_000,  // Fail fast if pool exhausted
  maxUses: 10_000,            // Refresh connection after N uses (memory leak defense)
});
```

### Statement Timeout

```sql
-- Set at session level
SET statement_timeout = '30s';

-- Set at transaction level
BEGIN;
SET LOCAL statement_timeout = '5s';
-- critical query here
COMMIT;

-- Set per connection in pool
ALTER DATABASE myapp SET statement_timeout = '30s';
```

---

## Transaction Patterns

### Optimistic Locking

```typescript
// Schema: users table has `version INTEGER NOT NULL DEFAULT 1`

async function updateUserName(userId: string, newName: string, currentVersion: number) {
  const result = await db.query(`
    UPDATE users
    SET name = $1, version = version + 1
    WHERE id = $2 AND version = $3
    RETURNING version
  `, [newName, userId, currentVersion]);

  if (result.rows.length === 0) {
    // Conflict! Another transaction modified this row
    throw new ConflictError("User was modified by another request");
  }
  return result.rows[0].version;
}
```

### Transaction Retry on Serialization Failure

```typescript
async function withTransactionRetry<T>(
  fn: (client: DBClient) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (err) {
      // 40001 = serialization_failure, 40P01 = deadlock_detected
      if (err.code === '40001' || err.code === '40P01') {
        if (attempt === maxRetries) throw err;
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 3000);
        await sleep(delay + Math.random() * delay); // with jitter
        continue;
      }
      throw err;
    }
  }
}
```

---

## Read Path Optimization Patterns

### Caching Layers

```mermaid
Client → CDN (static assets, cached responses)
       → Application Cache (Redis) → Cache-Aside Pattern
       → Database (PostgreSQL) with read replicas
```

### Cache-Aside Pattern

```typescript
async function getUser(id: string): Promise<User> {
  // 1. Try cache
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  // 2. Fall back to DB
  const user = await db.users.findByPk(id);
  if (!user) return null;

  // 3. Populate cache (with TTL)
  await redis.setEx(`user:${id}`, 300, JSON.stringify(user)); // 5 min TTL

  return user;
}
```

### Materialized View Pattern

```sql
-- For expensive aggregations
CREATE MATERIALIZED VIEW monthly_sales AS
SELECT
  date_trunc('month', order_date) as month,
  product_id,
  SUM(quantity) as total_quantity,
  SUM(amount) as total_revenue
FROM orders
GROUP BY month, product_id
WITH DATA;

-- Refresh on schedule (not per-insert)
REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_sales;
```

---

## Related Skills

- **[api-design](.pi/skills/api-design/SKILL.md)** — API response shape for paginated/list endpoints
- **[observability](.pi/skills/observability/SKILL.md)** — DB query metrics, connection pool monitoring
- **[error-resilience](.pi/skills/error-resilience/SKILL.md)** — DB connection retry, circuit breaker for DB
- **[testing-strategy](.pi/skills/testing-strategy/SKILL.md)** — Integration tests with test containers
