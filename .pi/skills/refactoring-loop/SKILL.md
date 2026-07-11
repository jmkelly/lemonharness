---
name: refactoring-loop
description: >
  Iterative quality gate hardening loop — run the gate, parse failures,
  fix each failing category with a fresh-context delegate, re-run until
  all gates pass or diminishing returns are hit.
---

# Refactoring Loop

**Leading word:** _harden_ — make code durable against the quality gate. Every cycle tries to reduce the FAILED count, and the loop stops only when the gate passes clean or further cycles yield no improvement.

## When to Use

Use this skill when:
- Existing code fails the quality gate and needs systematic fixes
- You need to pass `.lemonharness/quality-gate.sh` cleanly (FAILED == 0)
- Multiple gate categories are failing and you want to fix them in priority order
- You want to avoid regressions — fixing one category must not break another

Do **not** use when:
- You're writing new code (use TDD instead — the gate is a post-condition, not the goal)
- The quality gate is not relevant to the task (exploratory work, docs, config)
- Budget is extremely tight (each cycle costs ~60–120s)
- Only one trivial category is failing (just fix it directly)

## The Loop

```
┌──────────────────────────────────────┐
│         QUALITY GATE (immutable)      │
│   .lemonharness/quality-gate.sh      │
└──────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────┐
│       CYCLE START: RUN GATE          │
│   bash .lemonharness/quality-gate.sh │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│     PARSE FAILURES BY CATEGORY       │
│   file-size | factory | syntax       │
│   complexity | lint | tests | types  │
└──────────┬───────────────────────────┘
           │
           ▼
  ┌──────────────────────────────┐
  │  For each FAILING CATEGORY   │
  │  (in priority order):        │
  │  1. Spawn fresh-context      │
  │     delegate to fix ALL      │
  │     issues in this category  │
  │  2. Delegate reads code,     │
  │     fixes, verifies locally  │
  └──────────┬───────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│      RE-RUN QUALITY GATE             │
│   bash .lemonharness/quality-gate.sh │
└──────────┬───────────────────────────┘
           │
     ┌─────▼─────┐
     │  PASSED?  │
     └──┬────┬───┘
        │YES │NO
    ┌───▼┐  │
    │DONE│  │
    └────┘  │
            ▼
   ┌──────────────────┐
   │ TRACK & DECIDE   │
   │ FAILED decreased?│
   │ Regressions?     │
   └──────┬───────────┘
          │
   ┌──────▼──────┐
   │ Continue?   │
   │  YES → next │
   │       cycle │
   │  NO  → stop │
   └─────────────┘
```

### Phase 1: Run & Parse

Run the quality gate and capture its full output:

```bash
bash .lemonharness/quality-gate.sh 2>&1 | tee .lemonharness/refactoring-loop/cycle-N/gate-output.txt
```

Parse the output to identify **failing categories** using the gate's own exit code and output patterns:

| Gate Check | Parse Signal | Details |
|---|---|---|
| **File Size** | `❌ N file(s) exceed 400 lines` | Each large file path is listed |
| **Extension Factory** | `❌ N extension structure issue(s)` | Missing `index.ts` or `export default function` |
| **Syntax Parse** | `❌ N file(s) with parse errors` | Files and their parse errors listed |
| **Cyclomatic Complexity** | `❌ N function(s) exceed complexity threshold` | Functions and their complexity listed |
| **Lint** | `❌ N lint error(s)` | Individual errors listed |
| **Tests** | `❌ No test files found` or `❌ N test(s) failed` | Missing or failing tests |
| **Type Check** | `❌ N type error(s)` | Individual type errors listed |

Save the parsed results as a structured summary:

```json
{
  "cycle": 1,
  "overall_result": "FAILED",
  "failed_count": 7,
  "warning_count": 2,
  "categories": {
    "file_size": { "passed": true, "failures": 0 },
    "factory": { "passed": false, "failures": 2, "details": ["lemonharness-sub/secondary/index.ts — no export default function"] },
    "syntax": { "passed": true, "failures": 0 },
    "complexity": { "passed": true, "failures": 0 },
    "lint": { "passed": false, "failures": 15, "details": ["..."] },
    "tests": { "passed": false, "failures": 1, "details": ["No test files found in tests/"] },
    "types": { "passed": false, "failures": 3, "details": ["..."] }
  }
}
```

### Phase 2: Fix Each Category (Priority Order)

For each failing category, in the specified priority order, spawn a **fresh-context delegate** using `workspace_delegate`.

**Priority order** (most impactful first — failures higher in the list often block or cascade into lower ones):

| Priority | Category | Why This Priority | Typical Fix |
|---|---|---|---|
| **1** | **Syntax Parse** | Parse errors block all tooling (lint, tests, types) | Fix unclosed braces, missing imports, invalid syntax |
| **2** | **Extension Factory** | Missing entry points block extension loading | Add `index.ts` with `export default function` |
| **3** | **File Size** | Oversized files make all other fixes harder | Split into modules, extract helpers |
| **4** | **Type Errors** | Type errors block compilation | Fix type mismatches, add missing types |
| **5** | **Tests** | No/insufficient tests block validation | Add test files, fix failing tests |
| **6** | **Lint Errors** | Style issues (blocking if errors, advisory if warnings) | Auto-fix with linter, manual fixes for rule violations |
| **7** | **Cyclomatic Complexity** | Complex functions affect maintainability | Extract methods, simplify branching |

**Delegate task description template:**

> Fix all quality gate failures in the **{category}** category in {scope}. 
> Current failures:
> {details}
>
> Rules:
> - Do NOT modify files unrelated to this category
> - Do NOT introduce changes that would break other categories
> - Verify locally after each change
> - Report what you fixed

The delegate gets a **fresh context** so it doesn't carry assumptions or baggage from prior cycles.

After all delegates complete, **re-run the quality gate** and capture output.

### Phase 3: Track & Decide

Compare the new gate output with the pre-cycle output:

| Metric | How to Measure | Action |
|---|---|---|
| **FAILED count decreased** | `FAILED_old - FAILED_new > 0` | Good — proceed to next cycle |
| **FAILED count unchanged** | `FAILED_old == FAILED_new` | Check if different categories changed (regression + improvement) |
| **FAILED count increased** | `FAILED_old - FAILED_new < 0` | Regressions introduced. Note which categories regressed. |
| **FAILED == 0** | Gate passed | **Terminate** — done |
| **Same FAILED for 2 cycles** | Two consecutive cycles with identical FAILED | **Terminate** — diminishing returns |

**Regression detection**: If a category that passed before starts failing in the new cycle, log it. The delegate may have altered code that another delegate also touched. This is a sign that future cycles should merge related categories.

### Phase 4: Terminate

| Condition | Threshold | Reason |
|---|---|---|
| **Gate passed** | `FAILED == 0` | All checks pass |
| **Diminishing returns** | `FAILED` unchanged for 2 consecutive cycles | Further cycles unlikely to help |
| **Oscillation** | Alternating FAILED pattern (e.g., 5→3→5→3) | Delegates are breaking each other's fixes |
| **Safety valve** | Max cycles reached (default: 5) | Prevent budget exhaustion |

## Catastrophic Failure Handling

Some gate failures cannot be fixed by code changes alone:

| Failure | Cause | Action |
|---|---|---|
| **Missing language tools** | `⚠ eslint not found` or `⚠ pytest not installed` | Install the tool, then re-run gate |
| **Test runner missing** | `❌ No test runner found (vitest)` | Install the test runner |
| **Config blocking** | ESLint/config errors | Fix config, then re-run |
| **Coverage too low** | `⚠ Coverage below 70%` | Add tests, or adjust config threshold |

If any of these appear as **failures** (❌ with non-zero count) that can't be fixed by changing code, the loop should:
1. Install the missing tool: `workspace_install_dep`
2. Re-run the gate
3. If still failing with tool issues, note them as **infrastructure failures** and abort

## Output

The loop writes to `.lemonharness/refactoring-loop/`:

```
.lemonharness/refactoring-loop/
  cycle-1/
    gate-output.txt         # Raw quality gate output
    gate-summary.json       # Parsed failures by category
    delegate-reports/       # One file per delegate
      fix-file-size.md
      fix-syntax.md
      ...
  cycle-2/
    ...
  REFACTORING-LOOP-FINAL.md # Final assessment
  trend.json                # FAILED count per cycle
  category-history.json     # Per-category pass/fail per cycle
```

## Integration with LemonHarness

| Feature | Integration |
|---|---|
| **Quality Gate** | The loop IS the quality gate process — run it until the gate passes |
| **Phases** | Operates in P2–P3 boundary: fixing is P2, gate re-run is P3 |
| **Delegates** | Each fix category uses `workspace_delegate` with fresh context |
| **ERL Heuristics** | If the same category fails across multiple cycles, extract a heuristic: "Before refactoring category X, check if changes to Y will break it" |
| **Key Moments** | A cycle that reduces FAILED by >50% is a breakthrough — tag it |
| **Validation Auto-Healer** | Can trigger `healLastFailure()` for test category fixes |
| **Self-Improvement** | Record patterns from the loop: which categories were hardest, what regressions occurred |

## Usage

Invoke via the agent when the quality gate is failing:

```
# Auto-parse from last gate run
Run the refactoring-loop skill on the current failing quality gate

# With explicit scope
Apply the refactoring-loop to just the .pi/extensions/ directory
```

The skill reads the quality gate output, parses failures, and cycles until clean or diminishing returns.

## Relationship to Review Loop

| Aspect | Review Loop | Refactoring Loop |
|---|---|---|
| **Spec** | Human-readable spec (immutable) | Quality gate (automated, immutable) |
| **Reviewer** | Fresh-context human/adversarial agent | Automated quality gate script |
| **Scoring** | Severity 1–10 by reviewer | FAILED count from gate |
| **Fix scope** | Any issue with severity ≥ 4 | Only quality gate failures |
| **Termination** | Max severity ≤ 3 × 2 cycles | FAILED == 0 or flat for 2 cycles |
| **Budget per cycle** | ~120s implement + 60s review + 30s overhead | ~90s per category + 15s gate run |
| **Risk** | Reviewer misses issues | Gate is limited to automated checks |

The two loops are **complementary**: use `refactoring-loop` when the gate is the goal (code must pass automated checks), and `review-loop` when the spec is the goal (code must be correct and well-designed). A `review-loop` session typically triggers the quality gate at each implementer phase anyway (as noted in the review-loop skill).

---

## Pseudocode Contract

```
SKILL refactoring-loop

INPUTS:
  scope: string                    // Target directory (default: "src" or auto-detected from gate)
  maxCycles: number                // Safety valve (default: 5, max: 10)
  priority: string[]               // Category priority order (optional, uses default if omitted)

OUTPUTS:
  cycleRecords: File[]             // One per cycle, saved to .lemonharness/refactoring-loop/
  finalReport: string              // Path to REFACTORING-LOOP-FINAL.md
  terminationReason: string        // Why the loop stopped
  cyclesCompleted: number          // How many cycles ran
  categoryHistory: object          // Per-category pass/fail over cycles
  heuristics: Heuristic[]          // ERL heuristics extracted

PRECONDITIONS:
  - bash .lemonharness/quality-gate.sh exists and is executable
  - Workspace state is clean (no active changes in progress)
  - Project is in P2 (Implement) phase

POSTCONDITIONS:
  - Quality gate passes (FAILED == 0) OR diminishing returns documented
  - Full cycle records saved
  - Regression-free (no category that passed regresses without being noted)
  - Termination reason documented

TERMINATION:
  - failed_count == 0
  - || failed_count unchanged for 2 consecutive cycles
  - || oscillation detected (alternating fail counts)
  - || cycles_completed >= maxCycles

ERROR_HANDLING:
  - Quality gate not found → abort with install instructions
  - Delegate failure → log as cycle issue, continue with remaining categories
  - Missing tool dependency → attempt install, re-run gate
  - All categories pass but gate still fails → check for unparseable failures
```
