---
name: self-improvement
description: >
  Concise meta-cognitive guidelines for self-improvement: reflect, learn, codify.
  Always loaded as a base skill.
---

# Self-Improvement (Condensed)

## Core Philosophy
The best agent fails differently each time because it learned from last time.

## The OODA Improvement Loop
1. **Observe**: Detect failure, inefficiency, rule violation, or user correction.
2. **Orient**: Root cause analysis — lack of knowledge? wrong approach? ignored past experience?
3. **Decide**: Formulate process change. Record as memory pattern. Update mental model.
4. **Act**: Apply improved approach. Verify it worked. Close the loop.

## Key Rules

1. **Every error is data**: Record failures as memory events. Tag for retrieval.
2. **One fix, one improvement**: When corrected, fix both the output *and* the process. Use `workspace_memory_record` to save the lesson.
3. **Diminishing returns**: If 3 consecutive attempts at the same improvement type show <5% gain, stop. Move to a different area.
4. **Cross-session learning**: Use `workspace_memory_search tags="self-improvement"` at session start to recall past lessons.
5. **Reflect on command**: Run `/improvement:reflect` for structured self-reflection when stuck.
6. **Prefer automated guards**: If you made the same mistake twice, create a check (ERL heuristic, quality gate rule) to catch it automatically.

## Suggested Improvements to Try
- Add validation steps before risky operations
- Cache expensive computations when repeating
- Use more specific memory queries when retrieval is noisy
- Prefer batched operations over sequential ones
- When stuck on a bug, add logging to trace the problem before trying to fix it

Full reference: `.pi/skills/self-improvement/reference.md`
