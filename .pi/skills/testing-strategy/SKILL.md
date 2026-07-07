---
name: testing-strategy
description: >
  Testing pyramid strategy: property-based over example-based,
  contract testing at boundaries, mutation coverage, fuzzing for
  unstructured inputs. Use when correctness and regression
  resistance matter.
---

# Testing Strategy

**Leading word:** _pyramid_ — tests at the right level: wide base of fast unit tests, narrow peak of slow E2E. Every rule places a layer of the pyramid.

## Core: The **Pyramid**

> Write tests at the right level. Fast unit tests at the base, fewer integration in the middle, minimal E2E at the peak.

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

**Flaky breaks trust.** One flaky test is worse than no test — it teaches the agent to ignore failures. Prefer deterministic tests over coverage.

## Rule 1: Property-Based Over Example-Based

Example-based tests only cover what you thought of. Property-based tests find what you didn't.

```typescript
// ❌ Example-based: only checks the cases you wrote
it("reverses a string", () => {
  expect(reverse("abc")).toBe("cba");
  expect(reverse("")).toBe("");
});

// ✅ Property-based: checks invariants across random inputs
it("reverse(reverse(s)) === s for any string", () => {
  fc.assert(fc.property(fc.string(), (s) => {
    expect(reverse(reverse(s))).toBe(s);
  }));
});
```

**Properties to test:** idempotence, round-trip, commutativity, ordering, invariants.

## Rule 2: Contract Tests at Boundaries

Every module boundary earns a contract test. Verify:
- **Inputs** — invalid data rejected with clear errors
- **Outputs** — return types/schemas are stable
- **Side effects** — expected calls happen exactly once
- **Error modes** — every failure path documented

For HTTP APIs: verify OpenAPI schema compliance on every route.

## Rule 3: Mutation for Test Quality

A suite that passes when code is mutated has gaps.
- Run mutation testing periodically (`stryker`, `mutmut`, `pitest`)
- Target: >60% mutation score for critical modules
- Survived mutant = dead code (remove) or missing test (add)

## Rule 4: Snapshot for UI/Serialization

Use for output that changes frequently but should be reviewed. **Always review snapshot diffs** — never `--updateSnapshot` blindly.

## Rule 5: Fuzz Unstructured Inputs

Parse untrusted input? Fuzz it: structure-aware for JSON/XML/YAML parsers, protocol fuzzing for network endpoints. Use coverage-guided fuzzers (`libFuzzer`, `cargo-fuzz`, `jqf`).

## Rule 6: Isolation & Determinism

- No shared mutable state between tests.
- No test-order dependency: `shuffle=true` in CI, log the seed.
- Inject clocks for time-dependent code (never `Date.now()` directly).
- Test doubles at I/O boundaries.

## Rule 7: Coverage Semantics

> Coverage tells you what was executed, not what was verified.

- Line ≥ 80%, branch ≥ 70%, mutation score ≥ 60%.
- No coverage gates on generated code, mocks, or configs.

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

PRECONDITIONS:
  - Test framework installed
  - Module boundaries defined before contract tests
  - Property invariants identified before property tests

POSTCONDITIONS:
  - Unit tests cover all pure logic (fast, deterministic)
  - Contract tests at every module boundary
  - Property-based tests cover invariants, not just examples
  - Fuzzing on all unstructured input parsers
  - No test-order dependency; tests are parallel-safe

ERROR_HANDLING:
  - Flaky test → quarantine and debug (never --retry in CI)
  - Mutation score < 40% → add tests before new features
  - Snapshot drift → review diff, update intentionally
  - Contract break → treat as API version change
```

Full reference: `.pi/skills/testing-strategy/reference.md`
