---
name: general-rules-reference
description: Full reference for general-rules skill (lazy-loaded on demand)
---

# General Rules — Full Reference

## Key Rules

1. **Data splits**: When working with any dataset, maintain explicit separation between training, validation, and test data. Never leak test data into training decisions.
2. **Random seeds**: Set random seeds explicitly for any stochastic operation. Record the seed value for reproducibility.
3. **Validation metrics**: Always validate results against task-specific acceptance criteria. Define what "done" means before declaring a task complete.
4. **Workspace discipline**: Keep all artifacts within the project workspace. Track what files are created, modified, or deleted.
5. **Incremental verification**: After each state-changing operation, verify the result before proceeding. Fail fast on errors.
6. **Dependency management**: Record all dependencies installed. Prefer project-local installations.
7. **Full correction closure**: When the user corrects you, fix both the *task* and your *process* in the same turn. The correction is not complete until: (a) stated issue resolved, (b) root cause identified and recorded, (c) tooling updated to prevent recurrence, (d) fix verified.
8. **Pre-Acceptance Quality Gate**: Before accepting work from any sub-agent or declaring any task complete, run `bash .lemonharness/pre-acceptance-gate.sh [targets...]`. The gate checks: file size ≤ 400 lines, no dead code/debug prints/TODO markers, code compiles, no excessive nesting. Run full quality gate during P3: `bash .lemonharness/quality-gate.sh`.

## Pseudocode

```
SKILL general-rules

INPUTS:
  taskDescription: string   // Full description of the task
  domain: string            // Detected domain
  hasExternalData: boolean  // Whether task uses external datasets

OUTPUTS:
  reproducibilityConfig: object  // seed, split_ratio
  workspaceCheck: boolean        // Whether workspace discipline maintained

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
  - If workspace boundary violated → block the write
  - If seed not set → warn before proceeding
  - If dependency not recorded → log warning
  - If user correction only addressed the task, not the process → re-open
```
