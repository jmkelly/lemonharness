---
name: testing-strategy
description: >
  Production-grade testing beyond TDD: test pyramid, property-based
  testing, contract/integration/snapshot testing, mutation testing,
  fuzzing, and coverage semantics. Use for any software task where
  correctness and regression resistance matter.
---

# Testing Strategy

## Core: The Test Pyramid

> Write tests at the right level. Fast, numerous unit tests at the base.
> Fewer, slower integration tests in the middle. Minimal E2E at the top.

```
        /\
       /  \          E2E (5%)      — critical user journeys
      /    \
     /──────\
    /        \       Integration   — module boundaries, I/O, contracts
   /          \        (20%)
  /────────────\
 /              \    Unit (75%)     — pure logic, fast, deterministic
/________________\
```

**One broken test is worth zero tests if it's flaky.** Prefer deterministic tests over coverage.

## Rule 1: Property-Based Testing Over Example-Based

Example-based tests only cover what you think of. Property-based tests find edge cases you didn't.

```typescript
// ❌ Example-based: only checks the cases you wrote
it("reverses a string", () => {
  expect(reverse("abc")).toBe("cba");
  expect(reverse("")).toBe("");
});

// ✅ Property-based: checks invariants across 1000+ random inputs
it("reverse(reverse(s)) === s for any string", () => {
  fc.assert(fc.property(fc.string(), (s) => {
    expect(reverse(reverse(s))).toBe(s);
  }));
});
```

**Key properties to test:** idempotence, round-trip, commutativity, associativity, ordering, invariants.

## Rule 2: Contract Testing for Boundaries

Every module boundary earns a contract test. Verify that:
- **Inputs**: Invalid data is rejected with clear errors
- **Outputs**: Return types/schemas are stable
- **Side effects**: Expected calls happen exactly once
- **Error modes**: Each failure path produces a documented error

For HTTP APIs: verify OpenAPI schema compliance on every route (use `express-openapi-validator`, `pydantic`, etc.).

## Rule 3: Mutation Testing for Test Quality

A test suite that passes when you mutate the code is a test suite with gaps.
- Run mutation testing periodically (`stryker`, `mutmut`, `pitest`)
- Target: >60% mutation score for critical modules
- Every survived mutant is either dead code (remove it) or a missing test (write it)

## Rule 4: Snapshot Testing for UI/Serialization

Use snapshots for output that changes frequently but should be reviewed:
- UI components, serialized configs, generated files
- **Always review snapshot diffs** — never `--updateSnapshot` blindly
- Store snapshots in version control, review in PRs

## Rule 5: Fuzzing for Unstructured Inputs

Parse untrusted input? Fuzz it:
- Structure-aware fuzzing for JSON/XML/YAML parsers
- Protocol fuzzing for network endpoints
- Run with coverage-guided fuzzers (`libFuzzer`, `cargo-fuzz`, `jqf`)

## Rule 6: Test Isolation & Determinism

- No shared mutable state between tests (no global counters, env vars)
- No test-order dependency: `shuffle=true` in CI, `seed` in CI logs
- Time-dependent code: inject clocks (`Clock` interface), never `Date.now()` directly
- External I/O: test doubles at boundaries, real implementations preferred

## Rule 7: Coverage Semantics

> Coverage tells you what was executed, not what was verified.

- **Line coverage ≥ 80%** is table stakes
- **Branch coverage ≥ 70%** catches logic gaps
- **Mutation score ≥ 60%** proves test quality
- **No coverage gates on generated code, mocks, or config files**

---

## Pseudocode

```
SKILL testing-strategy

INPUTS:
  moduleBoundaries: string[]     // Public APIs, interfaces, I/O points
  criticalProperties: string[]   // Invariants to verify
  inputTypes: string[]           // Types/domains for fuzzing

OUTPUTS:
  testPlan: object
  //   unitTests: number
  //   contractTests: number
  //   integrationTests: number
  //   e2eTests: number
  //   propertyTests: number
  mutationScore: number           // Survived vs. killed mutants
  fuzzHours: number               // Fuzz time needed per input type

PRECONDITIONS:
  - Test framework installed (vitest, pytest, cargo-test, etc.)
  - Module boundaries clearly defined before contract tests
  - Property invariants identified before property tests

POSTCONDITIONS:
  - Unit tests cover all pure logic (fast, deterministic)
  - Contract tests exist at every module boundary
  - Property-based tests cover invariants, not just examples
  - Fuzzing applied to all unstructured input parsers
  - No test-order dependency; tests are parallel-safe

ERROR_HANDLING:
  - Flaky test → quarantine and debug (never --retry in CI)
  - Mutation score < 40% → add tests before new features
  - Snapshot drift → review diff, update intentionally
  - Contract break → treat as API version change
```

Full reference: `.pi/skills/testing-strategy/reference.md`
