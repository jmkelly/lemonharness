---
name: handoff
description: Compact the current conversation into a handoff document for a fresh agent to pick up next session. Includes current phase, workspace state, memory state, and suggested skills.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
source: Matt Pocock (mattpocock/skills) — extended for LemonHarness phases
---

# Handoff

**Leading word:** _bridge_ — this document is a bridge between sessions. The next agent should be able to pick up and continue without re-reading the entire conversation.

Write a handoff document so a fresh agent can continue the work. Save to the OS temporary directory (`/tmp/`), not the workspace — the handoff is a session boundary artifact, not project documentation.

## Required Sections

### 1. Session Summary

- What was accomplished this session (bullet list of completed work)
- What decisions were made (with links to any ADRs, issues, or commits)

### 2. Current State

Capture the LemonHarness execution state so the next agent orients immediately:

- **Phase** — which phase the session ended in (P1/P2/P3/P4) and budget consumed
- **Workspace** — key files modified, snapshots taken (`/lemonharness:snapshots`)
- **Memory** — any memory records written (`/memory:status`), key moments found (`/lemonharness:key-moments`)
- **Quality gate** — last gate result (`/lemonharness:quality-gate`), any failures

### 3. Next Steps

- What remains to be done (ordered by priority)
- What the next session's first action should be
- **Stopping condition** — the concrete signal that the next session is done

### 4. Suggested Skills

List the skills the next agent should invoke, in order of relevance. Include:
- Domain skills (e.g., `database-patterns`, `api-design`)
- Meta-skills (e.g., `self-improvement` for cross-session learning)
- `research` if investigation is still needed
- `writing-great-skills` if skills need maintenance

### 5. Open Questions

- Any unresolved decisions, ambiguous requirements, or blocked items
- What information is still needed and where to find it

## Rules

1. **Don't duplicate** content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.
2. **Redact** sensitive information — API keys, passwords, PII.
3. **Tailor to the next session** — if the user passed arguments, treat them as a description of what the next session will focus on.
4. **Be concrete** — prefer file paths, commit SHAs, and command invocations over vague descriptions. The next agent has no memory of this conversation.

## Relationship to P4 Reserve

The `handoff` skill is the **structured output** of the P4 Reserve phase. When entering P4:
1. Update workspace state via `/lemonharness:status`
2. Record any remaining memory via `workspace_memory_record`
3. Run this handoff skill to produce the bridge document
4. Optionally create a workspace snapshot via `/lemonharness:snapshot`

The handoff is not a replacement for workspace snapshots — snapshots capture file state, handoffs capture conversational and decision state. Use both.
