---
name: self-improvement-reference
description: Full reference for self-improvement skill (lazy-loaded on demand)
---

# Self-Improvement — Full Reference

## Core Philosophy

> *"The illiterate of the 21st century will not be those who cannot read and write, but those who cannot learn, unlearn, and relearn."* — Alvin Toffler

> *"The best agent is not the one that never fails, but the one that fails differently each time — because it learned from last time."*

This skill defines a **meta-cognitive loop** that sits above any domain task. While other skills tell you *what to do*, this skill tells you how to *get better at doing it*.

---

## The Improvement Loop (OODA for Agents)

The relentless improvement cycle has four phases, applied continuously:

```
┌──────────────────────────────────────┐
│  OBSERVE: Detect suboptimal behavior  │
│    • Failure / error                  │
│    • Inefficiency / slowness          │
│    • Violation of own rules           │
│    • User correction / feedback       │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  ORIENT: Analyze root cause           │
│    • Why did this happen?             │
│    • Did I lack knowledge?            │
│    • Did I use wrong approach?        │
│    • Did I ignore past experience?    │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  DECIDE: Formulate process change     │
│    • What should I do differently?    │
│    • Record as memory pattern         │
│    • Update mental model              │
│    • Create check / guardrail         │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  ACT: Apply improved process          │
│    • Execute with new approach        │
│    • Verify improvement               │
│    • Close the loop                   │
└──────────────────────────────────────┘
```

---

## Key Operational Rules

### Rule 1: Every Error Is Data

When something goes wrong — whether it's a tool error, a validation failure, or user correction — treat it as a learning opportunity.

**Action:**
- Record the error in memory: `workspace_memory_record type="failure" summary="..." details="..." tags="error,<domain>"`
- Extract a heuristic via `/improvement:reflect` or manual analysis
- If the error repeats, create a guardrail (skill update, quality gate check, or heuristic)

### Rule 2: One Fix, One Improvement

When the user corrects you:
- **Fix the output** — resolve the stated issue
- **Fix the process** — record why it happened and how to prevent it
- Both must be done in the same turn

**Checklist for corrections:**
- [ ] Stated issue is resolved
- [ ] Root cause is identified and recorded (memory event or heuristic)
- [ ] Tooling is updated (skill/rule/guardrail) to prevent recurrence
- [ ] Fix is verified

### Rule 3: Diminishing Returns

Stop refining when improvements become marginal:
- Track improvement magnitude per type (speed, accuracy, safety)
- If 3 consecutive attempts in the same area yield <5% gain, stop
- Focus on the next biggest gap instead

### Rule 4: Cross-Session Learning

At the start of each session:
- Run `workspace_memory_search tags="self-improvement"` to recall past lessons
- Check `heuristics.json` for extracted rules from previous sessions
- Review the last session's summary (`.lemonharness/sessions/`)

### Rule 5: Reflect When Stuck

When blocked or uncertain:
1. Run `/improvement:reflect` for structured analysis
2. Consider: am I repeating a known mistake? Do I need more information?
3. Search memory for similar situations
4. If truly novel, record the new situation for future reference

### Rule 6: Automate Guards

If you made the same mistake twice, create a guardrail:
- ERL heuristic: extracted from error patterns, auto-injected in future sessions
- Quality gate rule: add a check to `.lemonharness/quality-gate.sh`
- Skill update: add a rule to the relevant `.pi/skills/` skill
- Memory entry: record with high priority tags for retrieval

---

## Common Improvement Patterns

| Problem | Fix | Automation |
|---|---|---|
| Forgot to set random seed | Always set seed in data pipeline | Add to general-rules checklist |
| Test failed because of missing mock | Mock external calls explicitly | ERL heuristic: "check mocks before test" |
| Wrote too much code before testing | Write test before implementation | P2 guardrail: check test files exist |
| Memory search returned noise | Use more specific tags | Skill rule: prefer 3+ tag queries |
| Command failed due to missing dep | Install before using | Workspace tool: auto-install check |

---

## Pseudocode

```
SKILL self-improvement

INPUTS:
  events: LogEntry[]      // Recent execution events (errors, warnings, successes)
  userCorrections: string[]  // Recent user corrections
  sessionHistory: object     // Past session summaries and metrics

OUTPUTS:
  improvements: object[]  // List of applied improvements with metrics
  //   { type, description, beforeMetric, afterMetric, confidence }
  guardrails: string[]    // New guardrails created this session

PRECONDITIONS:
  - Every error is logged as a memory event
  - Corrections produce both task fix and process fix
  - Improvement effectiveness is measured before/after

POSTCONDITIONS:
  - At least one improvement applied per session (or diminishing returns declared)
  - Failure patterns are extracted as heuristics
  - Guardrails are created for repeated failures
  - Cross-session learning occurs at start of each session

ERROR_HANDLING:
  - If improvement has no measurable effect → revert and try different approach
  - If diminishing returns detected → switch improvement domain
  - If correction is not fully closed → re-open the improvement loop
```
