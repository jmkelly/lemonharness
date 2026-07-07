---
name: engineering-practices
description: >
  Concise engineering guardrails: TDD, simplicity, complexity control, quality gates.
  Always loaded as a base skill.
---

# Engineering Practices

## Core: Simplicity First
> *"Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away."*

Every line is a liability. Write the simplest thing, then make it smaller. Apply KISS, YAGNI, DRY.

## Rule 1: TDD (Test-Driven Development)

**Red → Green → Refactor.** Always.
1. **Red** — Write a failing test first.
2. **Green** — Write the simplest code that passes the test.
3. **Refactor** — Improve the code while keeping tests green.

> **Pre-check**: Before writing any implementation code, ask yourself: *"What test would prove this works?"* If you can't answer, you don't understand the problem yet.

### Automated Enforcement (LemonHarness Guardrails)
- **P2 entry** (Implement phase): Quality gate checks for test runner (`npm test`) and existing test files. Blocks if missing.
- **P3 entry** (Validate phase): Auto-runs tests. Blocks if any test fails. No manual override.

```
P1 Explore → [TDD check on Implement entry] → P2 Implement → [Auto-test on Validate entry] → P3 Validate → P4 Reserve
```

## Rule 2: Simplicity (KISS, YAGNI)
- Solve today's problem. Don't anticipate unknown futures.
- If you can't write a test for it, don't write it.
- Max 3 levels of indentation. Extract methods beyond that.

## Rule 3: Complexity Control

| Metric | Threshold |
|--------|-----------|
| Cyclomatic complexity per function | ≤ 10 |
| Lines per function | ≤ 10 |
| Lines per file | ≤ 400 (split at 300) |
| Parameters per function | ≤ 3 (use object params beyond) |

- Avoid ternaries longer than one line.
- No `any` type in TypeScript (prefer `unknown`).

## Rule 4: Consistency & Naming
- Files: `kebab-case.ts`. Types/interfaces: `PascalCase`. Everything else: `camelCase`.
- One component/export per file. Group related files in directories.
- Booleans: prefix with `is`, `has`, `should`, `can`.

## Rule 5: Dependencies
- Re-evaluate at each use. Remove unused imports.
- Prefer native APIs over libraries.

## Rule 6: Error Handling
- Never swallow errors. Every `catch` must log, recover, or re-throw.
- Use Result types for recoverable failures.
- Fail fast on invariant violations.
- **Hard-to-diagnose errors**: Add logging statements to narrow the problem before fixing. Log inputs, intermediate state, and the failing expression. Remove or reduce logging once resolved.

## Rule 7: Pre-Acceptance Gate
Before declaring any task complete:
- File size ≤ 400 lines
- No dead code, debug prints, or TODO markers
- Code compiles without errors
- All tests pass
- No excessive nesting (≤ 3 levels)

## Rule 8: Conventional Commits
Use `<type>(<scope>): <description>` format:
- `feat` — New feature
- `fix` — Bug fix
- `test` — Adding/improving tests
- `refactor` — Code change that neither adds nor fixes
- `docs` — Documentation only
- `chore` — Build, deps, tooling, config
- `perf` — Performance improvement
- `style` — Formatting, whitespace (no logic change)

## Rule 9: Code Review Readiness
- Self-review before requesting review: re-read your diff as if you're seeing it for the first time.
- Every PR must include a test that would fail without the change.
- No commented-out code. Delete it.

## Rule 10: Logging & Observability
- Log at entry and exit of every external boundary (API, DB, file I/O).
- Use structured logging (JSON) in production. Use human-readable in development.
- Include correlation IDs for request tracing.

## Rule 11: Security First
- Never log secrets, tokens, passwords, or PII.
- Validate all user input at the boundary.
- Use parameterized queries for all database operations.
- Apply least-privilege principle to dependencies.

## Rule 12: Technical Debt Management
- Leave code cleaner than you found it (Boy Scout Rule).
- File a TODO or issue for intentional shortcuts with a plan to revisit.
- If a fix takes < 15 minutes, do it now rather than tracking it.

---

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
  - conventional_commit_format
```

Full reference: `.pi/skills/engineering-practices/reference.md`
