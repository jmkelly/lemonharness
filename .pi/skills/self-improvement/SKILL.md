---
name: self-improvement
description: >
  Meta-cognitive improvement loop: reflect on errors, learn patterns,
  codify guardrails. The skill that rewrites skills. Always loaded.
---

# Self-Improvement

**Leading word:** _OODA_ — the loop (Observe, Orient, Decide, Act) is the engine of improvement. Every error cycles through it. Every session starts by recalling past lessons. Every error is fuel. The goal: fail differently next time.

## The OODA Improvement Loop

1. **Observe** — Detect failure, inefficiency, rule violation, or user correction.
2. **Orient** — Root cause: lack of knowledge? wrong approach? ignored past experience?
3. **Decide** — Formulate process change. Record as memory pattern. Update the model.
4. **Act** — Apply the improved approach. Verify it held. Close the loop.

## Rules

1. **Every error is data** — record failures as memory events, tagged for retrieval.
2. **One fix, one improvement** — fix both output _and_ process. Call `workspace_memory_record` to save the lesson.
3. **Diminishing returns** — 3 consecutive attempts at the same improvement type with <5% gain: stop. Move to a different axis.
4. **Cross-session recall** — run `workspace_memory_search tags="self-improvement"` at session start to surface past lessons. Read the last handoff from `/tmp/` if one exists.
5. **Bridge between sessions** — at end of session (P4), invoke `handoff` skill to create a bridge document for the next agent. Include what you learned, not just what you did.
6. **Research unknowns** — when you hit a question you can't answer from training data, invoke `research` skill during P1 to investigate primary sources. Add findings to `.lemonharness/research/`.
7. **Reflect when stuck** — `/improvement:reflect` forces structured self-reflection.
8. **Automate after two** — made the same mistake twice? Create an ERL heuristic or quality-gate rule so the guardrail catches it next time.

## Cross-Session Flow

```
Session start → read handoff (if exists) → recall memory → P1 Explore (research unknowns)
  → P2 Implement → P3 Validate → P4 Reserve (write handoff, snapshot) → Session end
```

## Suggested Levers

- Add validation before risky operations.
- Cache expensive recomputation.
- Use more specific memory queries when retrieval is noisy.
- Batch sequential operations.
- When stuck on a bug, log first, fix second.

Full reference: `.pi/skills/self-improvement/reference.md`
