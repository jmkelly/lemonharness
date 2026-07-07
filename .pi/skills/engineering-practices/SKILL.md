---
name: engineering-practices
description: >
  Concise engineering guardrails: TDD, simplicity, complexity control, quality gates.
  Always loaded as a base skill.
---

# Engineering Practices (Condensed)

## Core: Simplicity First
> *"Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away."*

Every line is a liability. Write the simplest thing, then make it smaller. Apply KISS, YAGNI, DRY.

## Rule 1: TDD — Red → Green → Refactor
1. **Red**: Write a failing test first (define "done").
2. **Green**: Simplest code that passes. No more.
3. **Refactor**: Improve while keeping tests green.

Automated enforcement: P2 entry checks for test runner & test files. P3 quality gate blocks if tests fail.

## Rule 2: Simplicity (KISS, YAGNI)
- Solve today's problem. Don't anticipate unknown futures.
- If you can't write a test for it, don't write it.
- Max 3 levels of indentation. Extract methods beyond that.

## Rule 3: Complexity Control
- Max **400 lines** per file. Split at 300 lines proactively.
- Max **10 lines** per function body.
- Max **3 parameters** per function (use object params beyond that).
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
Before declaring any task complete: file size ≤ 400 lines, no dead code/debug prints/TODO markers, code compiles, no excessive nesting.

Full reference: `.pi/skills/engineering-practices/reference.md`
