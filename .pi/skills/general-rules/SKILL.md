---
name: general-rules
description: >
  Cross-cutting execution guardrails for all tasks: workspace discipline,
  verification closures, quality gates, and data integrity rules.
  Always loaded as the base skill.
---

# General Rules

**Leading word:** _guardrails_ — hard binary checks that fire on every task regardless of domain. Each rule is a pass-or-fail gate. All must clear before the task is complete.

1. **Data splits** — train/val/test are disjoint. Test data never leaks.
2. **Random seeds** — set and record seeds before any stochastic operation.
3. **Validation metrics** — define the _done bar_ before starting the work, not after.
4. **Workspace discipline** — all artifacts in `.lemonharness/`. Track every change.
5. **Incremental verification** — verify after each state change. Fail fast, not late.
6. **Dependency management** — record every dependency. Use project-local installs only.
7. **Full correction closure** — a fix closes four doors: stated fix, root cause diagnosis, tooling update (guardrail/heuristic), and verification it held. Never close fewer.
8. **Quality gate** — run `.lemonharness/pre-acceptance-gate.sh` before accepting sub-agent work. Run `.lemonharness/quality-gate.sh` on P3 entry.

Full reference: `.pi/skills/general-rules/reference.md`
