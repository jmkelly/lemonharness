# Refactoring Loop — Reference

## Category Fix Strategies

### 1. Syntax Parse (Priority 1)

**Gate check**: `node --check file.ts` on all `.ts` files in `.pi/extensions/`.

**Common failures**:
- Unclosed braces `{`, brackets `[`, or parentheses `(`
- Missing type imports
- Invalid TypeScript syntax (e.g., using runtime JS syntax that TS doesn't accept)
- Trailing commas in places TS disallows them
- Missing `;` in multi-statement lines (rare in TS with ASI, but can happen)

**Fix strategy**:
```
1. Read the file that failed parse
2. Look at the specific error — the error message usually tells you the exact line
3. Fix the syntax issue
4. Re-run node --check on just that file: node --check .pi/extensions/<file>.ts
```

**Tips**:
- Run `node --check` on the specific file to verify before re-running the full gate
- Parse errors are usually on a single line — don't overcomplicate the fix
- If the error is cryptic, read the file around the reported line number

---

### 2. Extension Factory (Priority 2)

**Gate check**: Every subdirectory in `.pi/extensions/` must have:
- An `index.ts` file
- With `export default function` in it
- No `.ts` files directly in `.pi/extensions/` root

**Common failures**:
- Missing `index.ts` entirely in a subdirectory
- `index.ts` exists but doesn't export a default function
- `.ts` file(s) sitting in `.pi/extensions/` root instead of a subdirectory

**Fix strategy for missing index.ts**:
```
1. Check what the missing subdirectory should export
2. Create index.ts with:
     export default function myExtension() {
       return { name: "my-extension", setup() { /* ... */ } };
     }
3. Ensure it follows the pi extension pattern (name + setup)
```

**Fix strategy for .ts in root**:
```
1. Create a subdirectory: .pi/extensions/<name>/
2. Move the file into it
3. Rename to index.ts (or create index.ts that re-exports)
```

**Pattern** — a valid extension factory:

```typescript
// .pi/extensions/lemonharness/index.ts
export default function lemonharnessExtension() {
  return {
    name: "lemonharness",
    setup() {
      // register commands, hooks, custom tools
    }
  };
}
```

---

### 3. File Size (Priority 3)

**Gate check**: Any file > 400 lines is flagged as a failure. Files > 200 lines get a warning.

**Fix strategy**:
```
1. Read the oversized file to understand its structure
2. Identify logical groupings of functions/classes/interfaces
3. Extract each grouping into its own file in the same directory
4. Import from the new files in the original
5. Verify no imports are broken
```

**Extraction patterns**:

| Source File Contains | Extract Into |
|---|---|
| Multiple classes | `classA.ts`, `classB.ts` |
| Helper/utility functions | `helpers.ts` or `utils.ts` |
| Type definitions | `types.ts` |
| Constants/enums | `constants.ts` |
| Configuration | `config.ts` |
| Test data/fixtures | `fixtures.ts` |

**Rules**:
- When extracting from a TS file, maintain all imports in both source and target files
- The original file keeps the "entry point" role — it re-exports from its extracted parts
- Don't create circular dependencies between extracted files
- Aim for each extracted file to be 100–250 lines

**Example** — splitting an oversized file:

```typescript
// Before: integration.ts (523 lines)
// Contains: classA, classB, 3 helper functions, 2 interfaces, 4 constants

// After:
// integration/constants.ts — 4 constants
// integration/types.ts — 2 interfaces
// integration/classA.ts — classA + helperFns
// integration/classB.ts — classB
// integration/index.ts — re-exports everything, keeps integration entry point
```

---

### 4. Type Errors (Priority 4)

**Gate check**: `npx tsc --noEmit` — any `error TS...` is a failure.

**Fix strategy**:
```
1. Read the type error — TS errors are verbose and tell you exactly what's wrong
2. Check interfaces/types for mismatches
3. Fix the type, not the value (prefer correct typing over `as any`)
4. Verify with npx tsc --noEmit on just the affected file(s) if possible
```

**Never use**:
- `as any` — prefer `unknown` + type guard
- `// @ts-ignore` or `// @ts-expect-error` — the error should be fixed, not hidden
- `!` (non-null assertion) — prefer proper null checking

**Common fixes**:

| Error Pattern | Fix |
|---|---|
| `Type 'X' is not assignable to type 'Y'` | Check interface compatibility, add missing properties |
| `Property 'x' does not exist on type 'Y'` | Extend the type, or access via a type guard |
| `Object is possibly 'undefined'` | Add null check or default value |
| `Cannot find module 'X'` | Install the package or fix the import path |
| `Parameter 'x' implicitly has an 'any' type` | Add explicit type annotation |

---

### 5. Tests (Priority 5)

**Gate check**: 
- Test files must exist in `tests/` (TDD enforcement)
- If vitest is available, tests must pass
- Coverage >= 70% (advisory, non-blocking for v8 coverage tool)

**Fix strategy for missing tests**:
```
1. Read the source files that lack tests
2. Create at least one test file per source module (tests/<module>.test.ts)
3. Write tests that cover the exported functions
4. Run vitest to verify
```

**Fix strategy for failing tests**:
```
1. Read the failing test output to understand what's breaking
2. Fix the test (if the implementation is correct) or fix the implementation (if the test is right)
3. Re-run: npx vitest run --reporter=verbose
```

**Minimal test template**:

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../src/my-module';

describe('myFunction', () => {
  it('should return the correct result for valid input', () => {
    expect(myFunction('valid')).toBe('expected');
  });

  it('should handle edge cases', () => {
    expect(myFunction('')).toBe('fallback');
    expect(myFunction(null)).toBe('fallback');
  });
});
```

**Rules**:
- Don't add trivial tests just to pass the gate — each test should assert real behavior
- At minimum, test the main export path and one edge case per module
- Coverage 70% is advisory — don't add meaningless tests just for coverage

---

### 6. Lint Errors (Priority 6)

**Gate check**: ESLint errors are blocking (counted as FAILED). Warnings are advisory.

**Fix strategy**:
```
1. Run npx eslint .pi/extensions/ --format compact to see all errors at once
2. Fix each category of error systematically:
   - Auto-fixable: npx eslint .pi/extensions/ --fix (careful — verify after)
   - Manual: read each rule violation and fix
3. Re-run lint to verify
```

**Common ESLint rules and fixes**:

| Rule | Error Pattern | Fix |
|---|---|---|
| `no-unused-vars` | `'x' is defined but never used` | Remove the variable, or prefix with `_` |
| `no-explicit-any` | `Unexpected any. Use unknown instead` | Change `any` to `unknown` + type guard |
| `no-var` | `Unexpected var, use let or const` | Replace `var` with `const` or `let` |
| `prefer-const` | `'x' is never reassigned, use const` | Change `let` to `const` |
| `no-console` | `Unexpected console statement` | Remove or replace with structured logging |
| `@typescript-eslint/no-unused-vars` | Same as no-unused-vars for TS | Same fix |
| `eqeqeq` | `Expected === and instead saw ==` | Replace `==` with `===` |

**⚠️ Caution**: Running `--fix` can change formatting and import order. Always review the diff after auto-fixing. If the gate also checks lint warnings (non-blocking), consider fixing them too for cleanliness.

---

### 7. Cyclomatic Complexity (Priority 7)

**Gate check**: ESLint `complexity/max-complexity: ["error", 10]` — any function with cyclomatic complexity > 10 is a failure.

**Fix strategy**:
```
1. Read the flagged function(s) — understand the branching logic
2. Extract conditional branches into named helper functions
3. Use early returns to reduce nesting
4. Consider a lookup table (object map) instead of if/else chains
5. Re-run eslint to verify
```

**Complexity reduction patterns**:

**Before** (complexity: 12):
```typescript
function process(input: string): string {
  if (input === 'a') {
    return 'alpha';
  } else if (input === 'b') {
    return 'beta';
  } else if (input === 'c') {
    return 'gamma';
  } else if (input === 'd') {
    return 'delta';
  } else {
    return 'unknown';
  }
}
```

**After** (complexity: 1):
```typescript
const LOOKUP: Record<string, string> = {
  a: 'alpha', b: 'beta', c: 'gamma', d: 'delta',
};

function process(input: string): string {
  return LOOKUP[input] ?? 'unknown';
}
```

**Before** (complexity: 11):
```typescript
function validate(config: Config): string[] {
  const errors: string[] = [];
  if (!config.name) errors.push('name required');
  if (!config.age || config.age < 0) errors.push('invalid age');
  if (config.email && !config.email.includes('@')) errors.push('invalid email');
  if (config.type === 'admin' && !config.role) errors.push('admin needs role');
  if (config.type === 'user' && !config.permissions) errors.push('user needs permissions');
  return errors;
}
```

**After** (complexity: 6):
```typescript
function validate(config: Config): string[] {
  const errors: string[] = [];
  addError(errors, !config.name, 'name required');
  addError(errors, !config.age || config.age < 0, 'invalid age');
  addError(errors, config.email && !config.email.includes('@'), 'invalid email');
  addError(errors, config.type === 'admin' && !config.role, 'admin needs role');
  addError(errors, config.type === 'user' && !config.permissions, 'user needs permissions');
  return errors;
}

function addError(errors: string[], condition: boolean, message: string): void {
  if (condition) errors.push(message);
}
```

**Rules**:
- Extract methods when complexity is > 10. Aim for < 7.
- Each extracted function should have a clear name that explains WHAT it checks
- Don't over-extract — a function that's 3 lines with complexity 1 doesn't need extraction
- Prefer lookup tables over if/else chains for string-to-value mappings

---

## Termination Mathematics

### Condition 1: Gate Passed

```
Terminate when: FAILED == 0
```

The gate reports: `Results: ● N passed  ✗ 0 failed  ⚠ M warnings`

### Condition 2: Diminishing Returns

```
Let F(c) = FAILED count in cycle c
Terminate when: F(c) == F(c-1)   # Two consecutive cycles with same FAILED count
```

Same FAILED count across two cycles means the fixes in one category either:
- Were ineffective (same failures)
- Fixed some but regressed others in different categories (different failures, same count)

Either way, the loop is not converging. Stop to avoid burning budget.

### Condition 3: Oscillation

```
Detect when: F(c) alternates (e.g., 5→3→5→3 or 7→4→7→4)
```

Oscillation means delegates are breaking each other's work. Common when:
- Two categories affect the same files (e.g., lint + complexity)
- A fix in one category introduces a failure in another

**Action**: Consider merging the oscillating categories into one delegate in the next cycle.

### Condition 4: Safety Valve

```
Terminate when: cycle count >= maxCycles (default: 5)
```

Prevents budget exhaustion when the gate is particularly stubborn.

---

## Category Interdependencies

Some categories are independent; others touch the same files. Understanding this
helps avoid regressions:

| Category | Touches | May Affect |
|---|---|---|
| **Syntax** | Individual files with parse errors | Only syntax — but other fixes can cause it |
| **Extension Factory** | `.pi/extensions/` structure | Only factory — independent of code |
| **File Size** | File content, imports | Types (new files need imports), tests (if test files split too) |
| **Type Errors** | Type annotations, imports | Lint (if types change usage), Tests (if interfaces change) |
| **Tests** | `tests/` directory, test files | Only tests — independent of production code if adding, dependent if fixing |
| **Lint** | Code style across all files | Complexity (if extracting functions), Types (if removing unused vars) |
| **Complexity** | Function logic | Lint (newly extracted functions), Tests (if logic changes affect behavior) |

**Watch for**: File Size + Lint + Complexity all touch the same region of code.
If all three are failing, consider merging them into a single delegate.

---

## Diff Validation

After each cycle, verify that fixes in one category didn't break previously-passing categories.
Use `git diff --stat` (or check the cycle log) to see which files changed:

```bash
git diff --stat HEAD 2>/dev/null || echo "No git history available"
```

If files from a different category were modified, flag them for review.

---

## Category History Format

```jsonc
{
  // Per-cycle tracking of which categories pass/fail
  "cycles": [
    {
      "cycle": 1,
      "overall": "FAILED",
      "categories": {
        "syntax": { "passed": false, "count": 2 },
        "factory": { "passed": true, "count": 0 },
        "file_size": { "passed": true, "count": 0 },
        "types": { "passed": true, "count": 0 },
        "tests": { "passed": true, "count": 0 },
        "lint": { "passed": false, "count": 8 },
        "complexity": { "passed": true, "count": 0 }
      }
    }
  ],
  "regressions": [
    // Any category that passed in cycle N but failed in cycle N+1
    { "category": "lint", "from_cycle": 2, "to_cycle": 3, "files": ["index.ts"] }
  ]
}
```

---

## Suggested Fix Order for Common Scenarios

### Scenario: New code was just merged and gate fails everywhere

```
Priority: Syntax → Factory → File Size → Types → Tests → Lint → Complexity
Rationale: Syntax and Factory block loading, Types block compilation, everything else is secondary
```

### Scenario: After a large refactor, most categories fail

```
Priority: Tests → Types → Lint → Complexity → File Size → Syntax → Factory
Rationale: If the refactor changed logic, tests catch correctness. Then fix types, lint, and structure.
```

### Scenario: Only lint and complexity are failing

```
Priority: Lint → Complexity
Rationale: Fix lint first (wider surface), then complexity (deeper in specific functions).
Consider merging into one delegate if they affect the same files.
```

### Scenario: Only file size is failing (one file is 500+ lines)

```
Single fix, no loop needed.
Delegate: Split the file, then re-run gate.
```

### Scenario: Tests are missing entirely (new project)

```
Priority: Tests (add minimal coverage) → Lint → Complexity → File Size
Rationale: Tests are blocking. Add enough tests to pass the gate, then polish code quality.
```
