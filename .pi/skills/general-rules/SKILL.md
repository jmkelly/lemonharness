---
name: general-rules
description: >
  Cross-cutting execution rules and patterns applicable to all tasks:
  data splits, random seeds, validation metrics, workspace discipline.
  Always loaded as a base skill for every task.
---

# General Rules

## Key Rules

1. **Data splits**: When working with any dataset, maintain explicit
   separation between training, validation, and test data. Never leak
   test data into training decisions.
2. **Random seeds**: Set random seeds explicitly for any stochastic
   operation. Record the seed value for reproducibility.
3. **Validation metrics**: Always validate results against task-
   specific acceptance criteria. Define what "done" means before
   declaring a task complete.
4. **Workspace discipline**: Keep all artifacts within the project
   workspace. Track what files are created, modified, or deleted.
5. **Incremental verification**: After each state-changing operation,
   verify the result before proceeding. Fail fast on errors.
6. **Dependency management**: Record all dependencies installed.
   Prefer project-local installations (e.g., `npm install --save-dev`,
   `pip install -r requirements.txt`).

7. **Full correction closure**: When the user corrects you, fix both the
   *task* and your *process* in the same turn. The correction is not
   complete until:
   - ✓ The stated issue is resolved
   - ✓ The root cause is identified and recorded
   - ✓ The tooling (skill/rule/guardrail) is updated to prevent recurrence
   - ✓ The fix is verified
   Do not proceed to a new action without closing all four items. A
   correction that only fixes the task but not the process will repeat.

8. **Pre-Acceptance Quality Gate**: Before accepting work from any sub-agent,
   or before declaring any task complete, you MUST run the pre-acceptance
   quality gate against the affected files:

   ```bash
   bash .lemonharness/pre-acceptance-gate.sh [targets...]
   ```

   The gate checks are:
   - ✓ File size ≤ 400 lines per file  (Rule 5 of engineering-practices)
   - ✓ No dead code, debug prints, or TODO/FIXME/HACK markers
   - ✓ Code compiles / passes syntax check
   - ✓ No excessive nesting (complexity red flags)

   If the gate fails, fix the issues before accepting the work. Do not
   accumulate quality debt across multiple sub-agent runs — check after
   each one.

   Additionally, run the full quality gate during the **Validate** phase (P3):

   ```bash
   bash .lemonharness/quality-gate.sh
   ```

   The quality gate runs deeper checks: cyclomatic complexity analysis,
   lint/style enforcement, test execution with coverage, and type checking.

## Usage

These general rules apply to every task. They are automatically
loaded by the LemonHarness extension.

Specific domain rules (ML workflows, bio-design, vision media, etc.)
provide additional, domain-specific guidance.

---

## Pseudocode

```
SKILL general-rules

INPUTS:
  taskDescription: string   // Full description of the task
  domain: string            // Detected domain (ml, bio, systems, etc.)
  hasExternalData: boolean  // Whether task uses external datasets

OUTPUTS:
  reproducibilityConfig: object
  //   seed: number
  //   split_ratio: [number, number, number]  // train/val/test
  workspaceCheck: boolean   // Whether workspace discipline maintained

PRECONDITIONS:
  - Random seed must be set before any stochastic operation
  - Data splits must be defined if external data is used
  - Workspace boundary must be established

POSTCONDITIONS:
  - Random seed is recorded for reproducibility
  - Train/val/test data never leaks between splits
  - All artifacts are within workspace boundary
  - Dependencies are recorded
  - User corrections produce both task fix and process fix in same turn

ERROR_HANDLING:
  - If workspace boundary violated -> block the write
  - If seed not set -> warn before proceeding
  - If dependency not recorded -> log warning
  - If user correction only addressed the task, not the process ->
    re-open the loop and fix the root cause
```
