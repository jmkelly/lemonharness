---
name: testing-strategy-reference
description: Full reference for testing-strategy skill (lazy-loaded on demand)
---

# Testing Strategy — Full Reference

## Core Philosophy

> *"Program testing can be used to show the presence of bugs, but never to show their absence."* — Edsger Dijkstra

Tests are not a safety net — they are a **design tool**. If writing a test is hard, the design is wrong. If tests are slow or flaky, the architecture is wrong.

---

## The Test Pyramid (Detailed)

```
              /\          E2E (5%)
             /  \         - Critical user journeys
            /    \        - One per happy path per major feature
           /──────\
          /        \      Integration (20%)
         /          \     - Module boundaries
        /            \    - API contracts (your service boundary)
       /──────────────\
      /                \  Unit (75%)
     /                  \ - Pure functions, business logic
    /                    \ - Fast (< 1ms each), deterministic
   /──────────────────────\ - No I/O, no network, no filesystem
```

### Unit Tests (75%)

- Test **pure business logic** in isolation
- Inject dependencies, stub at boundaries
- Must be **fast** (< 1ms per test) — run in CI on every commit
- Cover: input validation, business rules, state transitions, edge cases

**What NOT to unit test:**
- Framework behavior (express routes, ORM queries — test those in integration)
- Configuration loading (test once, not per config)
- Trivial getters/setters

### Integration Tests (20%)

- Test **module boundaries** where I/O happens
- Real database (test container preferred over mocks)
- Real file system (temp directory per test)
- HTTP client → test server (use `supertest`, `httpx`)

**Contract tests** are a subset of integration tests: verify that a service's API matches its documented contract. Use `pact.io`, `schemathesis`, or `express-openapi-validator`.

### E2E Tests (5%)

- Test **critical user journeys** end-to-end
- One per major feature, one per critical user path
- Focus on things unit+integration can't catch: auth flows, payment, data pipeline end-to-end
- Run in CI on main branch only (not per commit)

**When E2E tests fail:**
1. Is it a real regression? → fix it
2. Is it a flaky test? → quarantine, fix the flakiness, then un-quarantine
3. Is it a test data issue? → make test data hermetic

---

## Property-Based Testing In Depth

### When to Use Property-Based Tests

| Situation | Example Property |
|---|---|
| Pure transformations | `encode(decode(s)) === s` (round-trip) |
| Idempotent operations | `deduplicate(deduplicate(xs)) === deduplicate(xs)` |
| Commutative operations | `merge(a, b) === merge(b, a)` |
| Sorting/ordering | `isSorted(sort(xs))` for any input |
| Data validation | `validate(x) ⇒ valid | invalid` for any structured input |
| Serialization | `deserialize(serialize(x)) === x` |

### Framework Suggestions

| Language | Framework |
|---|---|
| TypeScript | `fast-check` |
| Python | `hypothesis` |
| Rust | `proptest`, `quickcheck` |
| Go | `rapid` |
| Java | `jqwik`, `quickcheck` |
| C# | `FsCheck` |

### Example: Testing a URL Slug Generator (TypeScript)

```typescript
import * as fc from "fast-check";

describe("toSlug", () => {
  it("produces valid slugs for any string", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const slug = toSlug(input);
        // Slug is never empty (though input could be)
        expect(slug.length).toBeGreaterThan(0);
        // Slug contains only lowercase, digits, hyphens
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        // No leading or trailing hyphens
        expect(slug).not.toMatch(/^-|-$/);
      })
    );
  });
});
```

---

## Mutation Testing

Mutation testing modifies your code (mutants) and checks if tests catch the change. Surviving mutants are untested code paths.

### Framework Suggestions

| Language | Tool | Target Score |
|---|---|---|
| TypeScript/JS | `stryker` | ≥ 60% |
| Python | `mutmut`, `cosmic-ray` | ≥ 60% |
| Rust | `cargo-mutants` | ≥ 50% |
| Java | `pitest` | ≥ 60% |

### Common Mutant Types

- Remove a method call
- Swap `<` and `>` in conditionals
- Replace `&&` with `||`
- Remove `if` body
- Inline constant changes
- Remove exception handling

**When a mutant survives:**
1. Is the mutation equivalent (semantically identical)? If so, mark it as equivalent and suppress it.
2. Is the mutant actually a missing test? Write one.
3. Is the code dead? Remove it.

---

## Fuzzing Integration

Run fuzzers as part of CI for any module that parses untrusted input:

```bash
# TypeScript/JS: no native fuzzer, use fast-check property tests with fc.string()
# Python: hypothesis + coverage guided
python -m pytest tests/ --hypothesis-show-statistics

# Rust: cargo-fuzz
cargo fuzz run parse_input -- -runs=100000
```

### CI Fuzzing Strategy

- **Pre-commit:** quick property tests (100 runs, < 1s)
- **CI (per commit):** moderate property tests (1000 runs, < 10s)
- **Nightly:** deep fuzzing (1M+ runs, unlimited time)

---

## Snapshot Testing Best Practices

### Do's

- ✅ Use for: UI components, serialized configs, generated files, error messages
- ✅ Review diffs carefully in PRs
- ✅ Keep snapshots in version control
- ✅ Name snapshots descriptively

### Don'ts

- ❌ `--updateSnapshot` without review
- ❌ Large snapshots (> 50 lines — split them)
- ❌ Snapshots containing dates, random values, or machine-specific data
- ❌ Snapshotting entire API responses (use contract tests instead)

---

## Test Isolation Checklist

- [ ] No shared mutable state between tests
- [ ] No test-order dependency (CI runs with `shuffle: true`)
- [ ] Time-dependent code uses an injectable clock
- [ ] Random-dependent code uses a seeded RNG
- [ ] Tests clean up after themselves (temp files, DB records)
- [ ] Parallel-safe: tests can run concurrently
- [ ] Deterministic: same seed + same input → same result
- [ ] Each test covers exactly one behavior

---

## Per-Language Test Configuration

### TypeScript (vitest)

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      lines: 80,
      branches: 70,
    },
    sequence: { shuffle: true, seed: process.env.CI ? undefined : 'fixed' },
  },
});
```

### Python (pytest)

```ini
# pytest.ini
[pytest]
testpaths = tests
python_files = test_*.py
addopts = --strict-markers -v --tb=short
```

---

## Related Skills

- **[engineering-practices](.pi/skills/engineering-practices/SKILL.md)** — TDD fundamentals (Red-Green-Refactor)
- **[api-design](.pi/skills/api-design/SKILL.md)** — Contract testing for HTTP APIs
- **[error-resilience](.pi/skills/error-resilience/SKILL.md)** — Testing failure modes (chaos testing)
