---
name: general-rules
description: >
  Concise cross-cutting execution rules for all tasks.
  Always loaded as the base skill.
---

# General Rules (Condensed)

1. **Data splits**: Keep train/val/test separate. Never leak test data.
2. **Random seeds**: Set and record seeds for reproducibility.
3. **Validation metrics**: Define "done" before declaring completion.
4. **Workspace discipline**: All artifacts in workspace. Track changes.
5. **Incremental verification**: Verify after each state change. Fail fast.
6. **Dependency management**: Record all deps. Use project-local installs.
7. **Full correction closure**: Fix both the task *and* the process in one turn. Close all four: stated fix, root cause, tooling update, verification.
8. **Quality gate**: Run `.lemonharness/pre-acceptance-gate.sh` before accepting sub-agent work. Run `.lemonharness/quality-gate.sh` in P3.

Full version: `.pi/skills/general-rules/reference.md`
