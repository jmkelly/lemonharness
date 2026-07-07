---
name: engineering-practices-reference
description: Full reference for engineering-practices skill (lazy-loaded on demand)
---

# Engineering Practices — Full Reference

## Core Philosophy

> *"Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away."* — Antoine de Saint-Exupéry

Every line of code is a liability. The best code is the code you don't write. When you do write, write the simplest thing that works. Then make it smaller.

---

## Rule 1: TDD (Test-Driven Development)

**Red → Green → Refactor.** Always.

1. **Red** — Write a failing test first. This forces you to define what "done" means before you write the implementation.
2. **Green** — Write the simplest code that passes the test. No more.
3. **Refactor** — Improve the code while keeping tests green.

**Why:** Tests are not a luxury — they are the specification. If you can't write a test for it, you don't understand what it should do.

**Check:** Before writing any implementation function, ask: *"What test would prove this works?"* If you can't answer, don't write the function yet.

### Automated Enforcement (LemonHarness Guardrails)

TDD is now **structurally enforced** by the following guardrails:

| Trigger | Guardrail | Consequence |
|---|---|---|
| **P2 entry** (Implement phase) | Checks for test runner (`vitest`) and test files (`tests/*.test.*`) | Warning if missing; blocks P3 unless resolved |
| **P3 entry** (Validate phase) | Quality gate checks: test file existence, test runner installed, all tests pass | **FAIL** if no test files found or tests fail |
| **`npm test`** | `pretest` hook checks `tests/` directory exists | Exits with error if no test dir |

The cycle is: P1 Explore → [TDD check on Implement entry] → P2 Implement (with tests first) → P3 Validate (quality gate runs tests) → P4 Reserve

**Before writing any implementation code, you MUST:**
1. Have `vitest` installed (`npm install --save-dev vitest`)
2. Have at least one test file in `tests/` (can be a failing test — that's the Red phase)
3. Run `npm test` to verify the test framework works

If you skip these steps, the quality gate will **fail** and prevent progress to P4 (Reserve).

### Test Philosophy: Prefer Real Implementations Over Mocks

Prefer real implementations in tests. Run against actual databases, file systems, and APIs when feasible. Leave mocking for truly expensive or non-deterministic operations (network calls, random generation seeded). When you do mock, keep it minimal.

---

## Rule 2: Simplicity

### KISS (Keep It Simple, Stupid)

Simple code is:
- **Obvious**: A reader can grasp it in one pass.
- **Short**: 5 lines of clarity > 1 line of cleverness.
- **Flat**: Deep nesting hides bugs. Extract early, extract often.
- **Named**: If you need a comment to explain *what*, extract a function whose name says it.

**Checklist:**
- [ ] Can I remove any parameter?
- [ ] Can I inline any intermediate variable?
- [ ] Can I split this function in two?
- [ ] Is there a testing library function that does this already?

### YAGNI (You Ain't Gonna Need It)

- Solve today's problem. Don't anticipate unknown future requirements.
- The code you don't write has zero bugs, zero maintenance cost, zero cognitive load.
- If you're tempted to add a configuration parameter "just in case" — don't.

---

## Rule 3: Concise Code

### Complexity Budget

| Metric | Threshold | Action |
|---|---|---|
| Lines per file | ≤ 400 | Split at 300 lines proactively |
| Function body lines | ≤ 10 | Extract helper functions |
| Function parameters | ≤ 3 | Use object parameter (`{ a, b, c }`) |
| Cyclomatic complexity | ≤ 10 | Split into smaller functions |
| Nesting depth | ≤ 3 | Extract early returns / guard clauses |

### Specific Prohibitions

- ❌ **Long ternaries**: `a ? b ? c : d : e` — use `if` or extract.
- ❌ **`any` type**: In TypeScript, use `unknown` and narrow with type guards.
- ❌ **Magic numbers**: Name them: `const MAX_RETRIES = 3` not `3`.
- ❌ **Dead code**: No commented-out code, no unreachable branches.

---

## Rule 4: Consistency

### Naming Conventions

| What | Convention | Example |
|---|---|---|
| Files | `kebab-case` | `user-service.ts` |
| Classes / Interfaces | `PascalCase` | `class UserService` |
| Functions / Variables | `camelCase` | `function getUser()` |
| Constants (module-level) | `UPPER_SNAKE_CASE` | `const MAX_RETRIES = 3` |
| Types | `PascalCase` | `type UserRecord` |
| Booleans | `is/has/should/can` prefix | `isActive`, `hasPermission` |

### File Organization

- One primary export per file.
- Group related files in directories.
- Barrel exports (`index.ts`) for public API surfaces.
- Test files mirror source: `src/user.ts` → `tests/user.test.ts`.

---

## Rule 5: Dependencies

- Re-evaluate every dependency on each use. Remove unused imports.
- Prefer native APIs (Node.js 22+) over utility libraries (lodash, etc.) when the native version is sufficient.
- Pin major versions. Use `^` for minor/patch updates.
- Document *why* each dependency exists in the PR or commit message.

---

## Rule 6: Error Handling

- **Never** swallow errors. Every `catch` block must either log, recover, or re-throw.
- Use Result/Option types for recoverable failures (e.g., file not found, network timeout).
- Fail fast on invariant violations (null where object expected, impossible states).
- Distinguish between:
  - **Bugs** (should never happen → `assert` / throw)
  - **Edge cases** (can happen → handle gracefully)
  - **External failures** (expected to fail sometimes → retry with backoff)

---

## Rule 7: Pre-Acceptance Gate

Before declaring any task complete, run the pre-acceptance quality gate:
```bash
bash .lemonharness/pre-acceptance-gate.sh [targets...]
```

Checks:
- ✓ File size ≤ 400 lines per file
- ✓ No dead code, debug prints, or TODO/FIXME/HACK markers
- ✓ Code compiles / passes syntax check
- ✓ No excessive nesting (complexity red flags)

If the gate fails, fix issues before accepting the work. Don't accumulate quality debt.

---

## Pseudocode

```
SKILL engineering-practices

INPUTS:
  files: string[]         // Files being created or modified
  language: string        // Primary language (TypeScript, Python, etc.)
  taskType: string        // "new_feature", "refactor", "bugfix", "test"

OUTPUTS:
  qualityCheck: object    // passed: boolean, violations: string[], score: number
  testCoverage: number    // Fraction of functions with tests (0.0–1.0)

PRECONDITIONS:
  - Test framework must be installed before implementation
  - Each function must have a corresponding test
  - No file may exceed 400 lines
  - Complexity budget must be respected

POSTCONDITIONS:
  - All new code has corresponding tests (passing)
  - No files exceed complexity thresholds
  - Dependencies are documented and justified
  - No dead code or debug artefacts remain

ERROR_HANDLING:
  - Complexity violation → refactor before proceeding
  - Missing tests → block P3 transition
  - Missing error handling → flag for review
  - DRY violation → extract and consolidate
```
