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

ERROR_HANDLING:
  - If workspace boundary violated -> block the write
  - If seed not set -> warn before proceeding
  - If dependency not recorded -> log warning
```
