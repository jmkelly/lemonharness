---
name: harness-memory
description: >
  Dual-representation memory and learning system for code agents.
  Implements event-sourced experience logging, pattern distillation,
  pre-action governance, and risk-sensitive retrieval.
---

# Harness Memory & Learning System

## Core Principles

> *"An agent that doesn't learn from its past is just an expensive random walk."*

The Harness Memory system implements a **dual-representation memory** for
code agents, inspired by Metis (arXiv:2606.24151), ProjectMem (arXiv:2606.12329),
and MemCoder (arXiv:2603.13258).

### Two Memory Representations

1. **Text Memory** — Natural-language descriptions of:
   - Proven solutions and their context
   - Recurring patterns and idioms
   - Environment facts and constraints
   - Common pitfalls and their remediations
   - Architecture decisions and rationale

2. **Code Memory** — Executable crystallized knowledge:
   - Reusable scripts/functions extracted from repeated solutions
   - Validated command sequences
   - Verified build/test procedures

### Memory Lifecycle

```
Experience → Logged as Event → Pattern Detected (3+ repeats) 
  → Crystallized as Text Memory → Reused (3+ successful uses)
  → Promoted to Code Memory (callable tool)
```

### Pre-Action Governance

Before every state-changing operation, the system checks:
1. **Has this action failed before?** — If yes, warn with details of previous failure
2. **Is this a known-fragile operation?** — If yes, proceed with caution
3. **Is there a recorded solution to this problem?** — If yes, suggest it

### Risk-Sensitive Retrieval

Memory retrieval considers:
- **Relevance**: How well does past experience match current context?
- **Confidence**: How reliable is this memory? (based on reuse count + success rate)
- **Risk**: Would a false-positive match be harmful?
- **Abstention**: It's better to not use memory than to use wrong memory

## File Structure

```
.lemonharness/memory/
├── SKILL.md              # This documentation (loaded as a skill)
├── events.jsonl          # Append-only event log
├── events.lock           # Simple lock file for concurrent access
├── index.json            # Fast lookup index (regenerated on read)
├── text/                 # Text memory store
│   └── <id>.md           # One file per text memory entry
└── code/                 # Code memory store
    └── <name>.sh         # Reusable shell scripts
```

## Event Types

| Event Type | When to Log | Structure |
|---|---|---|
| `decision` | Key architectural or design choice | context, choice, rationale, alternatives |
| `solution` | Successfully resolved a problem | problem, approach, commands, outcome |
| `failure` | Attempt that didn't work | attempt, error, root_cause, lesson |
| `pattern` | Reusable approach discovered | context, approach, example, frequency |
| `feedback` | Validation result or correction | source, finding, severity, action |
| `insight` | Project-specific knowledge | domain, observation, implication |

## Usage

The memory system is automatically active. Key operations:

```bash
# Record a memorable event
workspace_memory_record type="solution" summary="Fixed import error" tags="python,import"

# Search memory
workspace_memory_search query="import error" max_results=3

# Get memory stats
workspace_memory_stats

# List crystallized code tools
workspace_memory_list_code
```

The `engineering-practices` and `general-rules` skills remain loaded
alongside this memory skill as base skills.
