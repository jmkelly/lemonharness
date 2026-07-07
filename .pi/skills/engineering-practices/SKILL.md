---
name: engineering-practices
description: >
  Engineering guardrails for every task: TDD (red-green-refactor),
  simplicity (KISS/YAGNI), complexity thresholds, and code review
  readiness checks. Always loaded.
---

# Engineering Practices

**Leading word:** _guardrails_ — these aren't suggestions, they're hard bounds that every line of code must pass through.

The **guardrails** that apply to every line of code. These are the four non-negotiables: write a test first, keep it simple, bound complexity, and leave it clean.

## 1. TDD: Red → Green → Refactor

The sequence binds every change:
1. **Red** — Write a failing test _before_ any implementation code.
2. **Green** — Write the simplest code that passes the test.
3. **Refactor** — Improve the code while keeping tests green.

**Pre-check**: If you can't name the test that proves it works, you don't understand the problem yet.

**LemonHarness enforcement**:
- P2 entry: quality gate checks for test runner and existing tests. Blocks if missing.
- P3 entry: auto-runs tests. Blocks on any failure.

## 2. Simplicity (KISS, YAGNI)

- Solve today's problem, not tomorrow's.
- Max 3 levels of indentation. Extract methods past that.
- If you can't write a test for it, don't write it.

## 3. Complexity Thresholds

| Metric | Ceiling |
|--------|---------|
| Cyclomatic complexity per function | ≤ 10 |
| Lines per function | ≤ 10 |
| Lines per file | ≤ 400 (split at 300) |
| Parameters per function | ≤ 3 (use object param) |

- No `any` in TypeScript (prefer `unknown`).
- No ternaries longer than one line.

## 4. Naming Convention

- Files: `kebab-case.ts`. Types/interfaces: `PascalCase`. Everything else: `camelCase`.
- Booleans: prefix `is`, `has`, `should`, `can`.
- One export per file. Group related files in directories.

## 5. Code Review Readiness

Before requesting review, self-review your diff as if seeing it for the first time. Delete commented-out code. Every PR must include a test that fails without the change.

## 6. Error Handling

- Every `catch` must log, recover, or re-throw. No silent swallows.
- Use Result types for recoverable failures. Fail fast on invariants.
- **Hard errors**: log inputs and intermediate state before fixing. Remove logs once resolved.

## 7. Technical Debt

- Leave code cleaner than you found it (Boy Scout Rule).
- File an issue for intentional shortcuts. If a fix takes < 15 min, do it now.

---

See also:
- **Observability** (structured logging, tracing) → `observability` skill
- **Security** (input validation, secrets) → `security-practices` skill
- **Quality gate** → `general-rules`
- **Commit conventions** → `general-rules/reference.md`

## Pseudocode Contract

```
SKILL engineering-practices
PRECONDITIONS:
  - agent_is_implementing
  - language_is_typescript_or_python
POSTCONDITIONS:
  - tests_pass
  - complexity_within_thresholds
  - tdd_compliant
```

Full reference: `.pi/skills/engineering-practices/reference.md`
