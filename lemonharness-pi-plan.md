# LemonHarness Optimizations for Pi Agent — Implementation Plan

**Reference Paper:** [LemonHarness Technical Report (arXiv:2606.24311)](https://arxiv.org/pdf/2606.24311v1)
**Project:** LemonHarness — pi agent customization
**Date:** 2026-07-05

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Optimization 1: Unified Runtime Boundary](#2-optimization-1-unified-runtime-boundary)
3. [Optimization 2: Reusable Rule Knowledge (Skills)](#3-optimization-2-reusable-rule-knowledge-skills)
4. [Optimization 3: Time-Aware Execution](#4-optimization-3-time-aware-execution)
5. [Optimization 4: Structured Tool Boundary](#5-optimization-4-structured-tool-boundary)
6. [Optimization 5: Execution Records & Validation Feedback](#6-optimization-5-execution-records--validation-feedback)
7. [File Structure](#7-file-structure)
8. [Implementation Order & Dependencies](#8-implementation-order--dependencies)
9. [Testing & Validation](#9-testing--validation)

---

## 1. Overview & Architecture

### What LemonHarness Does

LemonHarness is an integrated execution framework for long-horizon LLM agents. It addresses three core problems:

1. **State drift** — Agents modify files, install dependencies, create artifacts without a clear workspace boundary, leading to scattered state changes that are hard to track.
2. **Missing domain knowledge** — Agents start each task from scratch, unaware of recurring execution rules and acceptance criteria.
3. **Poor time management** — Agents spend too long exploring, get stuck on long commands, or over-validate near deadlines, causing timeouts.

### Mapping to Pi Agent Concepts

| LemonHarness Feature | Pi Implementation Mechanism |
|---|---|
| Unified Runtime Boundary | Extension (events, custom tools, workspace management) |
| Reusable Rule Knowledge | Skills (SKILL.md files per domain) + Extension (rule injection) |
| Time-Aware Execution | Extension (before_agent_start, turn hooks, timer state) |
| Structured Tool Boundary | Extension (custom tools wrapping state-changing ops) |
| Execution Records & Validation | Extension (context hooks, tool_result events, logging) |

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Pi Agent (LemonHarness)                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         lemonharness-workspace extension             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │ Workspace│  │ Time     │  │ Rule Knowledge    │   │   │
│  │  │ Boundary │  │ Director │  │ Injector          │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  │  ┌──────────┐  ┌──────────┐                         │   │
│  │  │ Structured│  │ Execution │                        │   │
│  │  │ Tools    │  │ Logger   │                         │   │
│  │  └──────────┘  └──────────┘                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Skills (Rule Knowledge Domains)                     │   │
│  │  ml-workflows  bio-design  vision-media              │   │
│  │  systems-recovery  game-logic  general-rules         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Optimization 1: Unified Runtime Boundary

### Concept

LemonHarness constrains all state-changing operations within a clearly defined workspace, bringing model invocation, tool execution, and rule knowledge under a single controlled boundary.

### Implementation: `.pi/extensions/lemonharness-workspace.ts`

#### 2.1 Workspace Manager (Core Module)

A singleton that manages the controlled workspace directory and tracks all state changes.

**Responsibilities:**
- Create a `.lemonharness/` workspace directory at project root on session start
- Track files created, modified, or deleted within the workspace
- Track external processes spawned
- Track dependency installations
- Provide a `workspace_state` tool that the model can call to inspect current workspace state
- Block writes outside the workspace (configurable)

**Key APIs:**
```typescript
interface WorkspaceManager {
  getWorkspaceDir(): string;
  getWorkspaceState(): WorkspaceState;
  trackFileWrite(path: string, action: 'create' | 'modify' | 'delete'): void;
  trackProcess(cmd: string, pid: number): void;
  trackDependencyInstall(pkg: string): void;
  isWithinWorkspace(path: string): boolean;
  reset(): void;
}

interface WorkspaceState {
  files: Array<{ path: string; action: string; timestamp: number }>;
  processes: Array<{ command: string; pid: number }>;
  dependencies: string[];
  elapsedMs: number;
  lastReset: number;
}
```

#### 2.2 Pi Extension Events

| Event | Handler |
|---|---|
| `session_start` | Initialize workspace directory, load previous state if resuming |
| `session_shutdown` | Persist workspace state snapshot |
| `before_agent_start` | Inject workspace boundary instructions into system prompt |
| `tool_call` (bash, write, edit) | Validate paths are within workspace; block writes outside boundary |
| `tool_result` | Update workspace state tracker based on tool output |
| `turn_end` | Record workspace state changes in session for traceability |

#### 2.3 Workspace Boundary Enforcer

- Intercept `write` tool calls → validate path is within workspace or `.lemonharness/`
- Intercept `edit` tool calls → validate file is within workspace
- Intercept `bash` commands that write files → parse command for output redirection, `touch`, `mv`, `cp`, `mkdir`, `npm install`, `pip install` etc.
- Allow configurable exceptions via settings (e.g., `allowedPaths: ["/tmp", "~/.cache"]`)

#### 2.4 System Prompt Injection

In `before_agent_start`, add the following to the system prompt:

```
You are running inside a controlled workspace at {workspaceDir}.
All file writes, dependency installations, and artifact creation must
occur inside this workspace. Before each state-changing action, check
whether the target path is within the workspace. The workspace state
is available via the workspace_state tool.
```

---

## 3. Optimization 2: Reusable Rule Knowledge (Skills)

### Concept

LemonHarness organizes reusable execution rules and acceptance criteria as runtime knowledge, so the model does not start each task from a blank slate. It covers ML workflows, bio-design, vision media, systems recovery, and game logic.

### Implementation: Skills in `.pi/skills/`

Each skill is a directory with a `SKILL.md` file containing frontmatter and markdown instructions.

#### Skill Domains (from Table 1 of the paper)

| Domain | Skill Name | Focus |
|---|---|---|
| ML Workflows | `ml-workflows` | Training/validation/submission separation, reproducibility, metric validation |
| Bio-design | `bio-design` | Stable API data retrieval, biological validity, synthesis constraints |
| Vision Media | `vision-media` | Command interface stability, row/frame/mask alignment, visual output validation |
| Systems Recovery | `systems-recovery` | Controlled paths, recoverable artifacts, build/integrity/runtime probes |
| Game Logic | `game-logic` | Formal rules, state transitions, bounded strategic search, final state verification |
| General Rules | `general-rules` | Cross-cutting patterns: data splits, random seeds, validation metrics |

#### Skill File Structure

```
.pi/skills/
├── ml-workflows/
│   ├── SKILL.md
│   └── references/
│       ├── reproducibility.md
│       └── metric-definitions.md
├── bio-design/
│   ├── SKILL.md
│   └── references/
│       └── synthesis-constraints.md
├── vision-media/
│   ├── SKILL.md
│   └── references/
│       └── output-validation.md
├── systems-recovery/
│   ├── SKILL.md
│   └── references/
│       └── probe-strategies.md
├── game-logic/
│   ├── SKILL.md
│   └── references/
│       └── state-transitions.md
└── general-rules/
    └── SKILL.md
```

#### Skill SKILL.md Template

Each `SKILL.md` follows this structure:

```markdown
---
name: ml-workflows
description: >
  Best practices for ML/deep learning tasks: training/validation/submission
  artifact separation, reproducibility (random seeds, data splits), metric
  validation against task goals. Use for any ML, DL, or data science task.
---

# ML Workflows

## Key Rules

1. **Artifact separation**: Keep training outputs, validation results, and
   submission artifacts in separate directories.
2. **Reproducibility**: Always set random seeds (torch, numpy, python built-in
   `random`) before training. Record the seed value and data split used.
3. **Metric validation**: Validate final metrics against the task specification.
   Do not assume that a decreasing loss alone indicates task completion.
4. **Data splits**: Use explicit train/val/test splits; do not leak test data
   into training.
5. **Checkpointing**: Save model checkpoints periodically; keep the best
   checkpoint based on validation metrics, not training loss.

## Setup

Run once before first use:

```bash
# No special setup needed; rules are loaded into agent context.
```

## Usage

When the model detects an ML-related task, it should read this skill's
references for detailed guidance on reproducibility and metrics.
```

#### Rule Knowledge Injector (Extension)

In the `lemonharness-workspace.ts` extension, add logic to:

1. Detect which skills are available (scan `.pi/skills/` at startup)
2. In `before_agent_start`, analyze the user prompt to determine domain
3. Prepend relevant rule knowledge as a system message or inject into system prompt
4. Make all skill rules available as a tool-callable knowledge base

---

## 4. Optimization 3: Time-Aware Execution

### Concept

LemonHarness partitions execution into four phases using cumulative budget ratios:
- **P1: Explore** (0–30%) — Inspection, planning, environment setup
- **P2: Implement** (30–60%) — Primary solution construction
- **P3: Validate** (60–90%) — Lock in result, targeted verification
- **P4: Reserve** (90–100%) — Preserve output, no new state-changing actions

Each transition has a 5% grace band. Elapsed and remaining time are surfaced to the model at every turn.

### Implementation: Inside `lemonharness-workspace.ts` Extension

#### 4.1 Time Director Module

```typescript
interface TimeDirectorConfig {
  totalBudgetMs: number;          // T (total time budget)
  exploreRatio: number;           // 0.3
  implementRatio: number;         // 0.6
  validateRatio: number;          // 0.9
  graceBand: number;              // 0.05 (5%)
}

interface TimePhase {
  phase: 'explore' | 'implement' | 'validate' | 'reserve';
  elapsedMs: number;
  remainingMs: number;
  phaseProgress: number;          // 0.0 to 1.0 within current phase
  totalProgress: number;          // 0.0 to 1.0 overall
}

class TimeDirector {
  private startTime: number;
  private config: TimeDirectorConfig;

  constructor(config: TimeDirectorConfig) { ... }

  getCurrentPhase(): TimePhase { ... }
  getElapsedMs(): number { ... }
  getRemainingMs(): number { ... }
  isInGraceBand(): boolean { ... }
  shouldTransitionToNextPhase(): boolean { ... }
  formatStatus(): string { ... }
}
```

#### 4.2 Phase Transition Logic

- Track elapsed time from the first `turn_start` event
- On each `turn_start` and `turn_end`, check current phase
- When crossing a boundary (e.g., 0.3T), allow 0.05T grace window before instructing the model
- Transitions are monotonic (no rolling back)
- P4 (final 0.1T) is a hard reserve: inject instructions to stop new state-changing actions

#### 4.3 System Prompt Injection

At each turn, inject time status into the system prompt:

```
⏱ Time Status: Explore phase (42% of budget used, 58% remaining)
   - Elapsed: 2m 30s / Total: 6m 0s
   - Current phase: Explore (0-30% budget)
   - Grace remaining: 12s before phase transition
```

In P4:
```
⏱ Time Status: RESERVE PHASE — 92% of budget used
   - STOP initiating new state-changing actions
   - Preserve whatever acceptable result is on disk
   - Only perform minimal validation or output formatting
```

#### 4.4 Budget Assignment

The total time budget should be configurable:

| Task Type | Default Budget |
|---|---|
| Quick task (lint, format, small edit) | 2 minutes |
| Standard task (implement feature, refactor) | 5 minutes |
| Complex task (multi-file, dependencies, tests) | 10 minutes |
| Long-horizon task (ML training, system setup) | 20 minutes |

Configurable via:
- `settings.json`: `{ "lemonharness": { "timeBudgetMs": 600000 } }`
- User prompt analysis (heuristic: longer prompts → larger budgets)
- `/lemonharness:budget <seconds>` command

---

## 5. Optimization 4: Structured Tool Boundary

### Concept

LemonHarness wraps environment operations through structured tool interfaces with defined inputs, outputs, and usage constraints. State-changing actions (file writes, dependency installs, temporary artifacts, background processes) receive stricter treatment.

### Implementation: Custom Tools via Extension

#### 5.1 Custom Tools

Register these as custom tools accessible to the LLM:

| Tool Name | Description | Parameters |
|---|---|---|
| `workspace_write` | Write file within workspace boundary | `path` (relative), `content`, `overwrite?` |
| `workspace_append` | Append to file within workspace boundary | `path`, `content` |
| `workspace_exec` | Execute command within workspace directory | `command`, `timeout?`, `captureOutput?` |
| `workspace_install_dep` | Install dependency in workspace env | `package`, `manager` (npm/pip/apt) |
| `workspace_create_temp` | Create temporary directory/artifact | `prefix?` |
| `workspace_state` | Get current workspace state summary | (none) |
| `workspace_validate` | Run validation/verification command | `command`, `expected?` |

#### 5.2 Tool Logic

Each custom tool:
1. Validates all paths are within workspace
2. Executes the operation
3. Records the operation in workspace state tracker
4. Returns structured feedback as observations

**Example: `workspace_write`**
```typescript
pi.registerTool({
  name: "workspace_write",
  label: "Workspace Write",
  description: "Write content to a file within the controlled workspace. Use this instead of the generic write tool for state-changing operations.",
  parameters: Type.Object({
    path: Type.String({ description: "Relative path within workspace" }),
    content: Type.String({ description: "File content" }),
    overwrite: Type.Optional(Type.Boolean({ default: false })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const ws = getWorkspaceManager();
    const absPath = path.join(ws.getWorkspaceDir(), params.path);
    if (!ws.isWithinWorkspace(absPath)) {
      return { content: [{ type: "text", text: "Error: Path is outside workspace boundary" }], isError: true, details: {} };
    }
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    // Check overwrite
    if (await fs.exists(absPath) && !params.overwrite) {
      return { content: [{ type: "text", text: "Error: File exists. Set overwrite=true to replace." }], isError: true, details: {} };
    }
    await fs.writeFile(absPath, params.content, "utf-8");
    ws.trackFileWrite(params.path, 'create');
    return { content: [{ type: "text", text: `Written ${params.path} (${params.content.length} chars)` }], details: { path: params.path, size: params.content.length } };
  },
});
```

#### 5.3 Built-in Tool Interception

Intercept the built-in `write`, `edit`, and `bash` tools to redirect them through the structured boundary:

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("write", event)) {
    // Check if path is within workspace
    const ws = getWorkspaceManager();
    if (!ws.isWithinWorkspace(event.input.path)) {
      return { block: true, reason: "Write target is outside workspace boundary. Use workspace_write instead." };
    }
    // Auto-track the write
    ws.trackFileWrite(event.input.path, 'create');
  }
  if (isToolCallEventType("bash", event)) {
    // Detect state-changing patterns (npm install, pip install, etc.)
    trackBashStateChanges(event.input.command);
  }
});
```

---

## 6. Optimization 5: Execution Records & Validation Feedback

### Concept

LemonHarness records model outputs, tool calls, and execution feedback in runtime logs. Validation feedback is treated as part of the execution process — commands used for testing, verifier checks, file modification results, and error messages are kept as traceable records.

### Implementation: Extension Event Handlers

#### 6.1 Execution Logger

```typescript
class ExecutionLogger {
  private entries: LogEntry[] = [];

  logToolCall(toolName: string, args: any, result: any): void { ... }
  logValidation(name: string, command: string, passed: boolean, output: string): void { ... }
  getExecutionTrail(): LogEntry[] { ... }
  getLastNEntries(n: number): LogEntry[] { ... }
  summarize(): string { ... }
}
```

#### 6.2 Event Handlers

```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  executionLogger.logToolCall(event.toolName, event.args, null);
});

pi.on("tool_result", async (event, ctx) => {
  executionLogger.logToolCall(event.toolName, event.input, { content: event.content, isError: event.isError });
  // Optionally annotate result with execution metadata
  return {
    content: event.content,
    details: {
      ...event.details,
      executionTrail: executionLogger.getLastNEntries(5),
    },
  };
});

pi.on("turn_end", async (event, ctx) => {
  // Summarize the turn's execution records for the model
  const summary = executionLogger.summarize();
  // Inject as system message or context annotation
});
```

#### 6.3 Validation Feedback Loop

Add a `/lemonharness:validate` command that:
1. Runs a specified validation command
2. Records the result in the execution log
3. Feeds the validation feedback back into the model's context

```typescript
pi.registerCommand("lemonharness:validate", {
  description: "Run a validation command and record results. Usage: /lemonharness:validate <command>",
  handler: async (args, ctx) => {
    const result = await executeCommand(args);
    executionLogger.logValidation("manual", args, result.exitCode === 0, result.output);
    ctx.ui.notify(`Validation ${result.exitCode === 0 ? 'PASSED' : 'FAILED'}`, result.exitCode === 0 ? "success" : "error");
  },
});
```

#### 6.4 Execution Trail Injection

At the start of each turn, inject a compact execution trail into the context:

```
📋 Recent Execution Trail:
  ✓ write src/train.py (2.3 KB) 
  ✓ pip install torch --quiet (exit 0, 12s)
  ✓ python train.py (exit 0, 45s, loss: 0.23)
  ✗ python validate.py (exit 1, "Metric below threshold")
  → workspace_state: 5 files modified, 2 deps installed
```

---

## 7. File Structure

```
LemonHarness/
├── .pi/
│   ├── extensions/
│   │   └── lemonharness-workspace.ts    # Main extension (all 5 optimizations)
│   ├── skills/
│   │   ├── ml-workflows/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   │       ├── reproducibility.md
│   │   │       └── metric-definitions.md
│   │   ├── bio-design/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   │       └── synthesis-constraints.md
│   │   ├── vision-media/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   │       └── output-validation.md
│   │   ├── systems-recovery/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   │       └── probe-strategies.md
│   │   ├── game-logic/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   │       └── state-transitions.md
│   │   └── general-rules/
│   │       └── SKILL.md
│   └── settings.json                    # Project-level settings
├── lemonharness-pi-plan.md              # This document
└── AGENTS.md                            # Project context file
```

### File Purposes

| File | Purpose |
|---|---|
| `.pi/extensions/lemonharness-workspace.ts` | Main extension implementing workspace boundary, time-aware execution, structured tools, execution logger, and rule knowledge injection |
| `.pi/skills/*/SKILL.md` | Domain-specific reusable rule knowledge per Agent Skills standard |
| `.pi/skills/*/references/*.md` | Detailed reference docs loaded on-demand by the agent |
| `.pi/settings.json` | Project-level pi settings enabling LemonHarness features |
| `AGENTS.md` | Project context file that tells pi about LemonHarness and its setup |

---

## 8. Implementation Order & Dependencies

### Phase 1: Foundation (Day 1)
1. **Create project structure** — directories, settings.json, AGENTS.md
2. **Implement Workspace Manager** — core class for workspace boundary tracking
3. **Implement basic extension skeleton** — `lemonharness-workspace.ts` with `session_start`, `session_shutdown` handlers
4. **Verify** — extension loads without errors, workspace dir created on session start

### Phase 2: Structured Tools & Boundary Enforcement (Day 2)
5. **Register custom tools** — `workspace_write`, `workspace_exec`, `workspace_state`, `workspace_install_dep`, `workspace_create_temp`, `workspace_validate`
6. **Intercept built-in tools** — block writes outside workspace via `tool_call` event
7. **Track state changes** — file writes, dependency installs, process spawns
8. **Verify** — model cannot write outside workspace, workspace_state tool works

### Phase 3: Time-Aware Execution (Day 3)
9. **Implement TimeDirector** — phase tracking, budget calculations, grace bands
10. **Wire into turn events** — check phase at `turn_start`/`turn_end`
11. **Inject time status** — add time status to system prompt in `before_agent_start`
12. **Phase transition logic** — grace window, monotonic transitions, P4 hard reserve
13. **Verify** — time status appears in prompts, phases transition correctly

### Phase 4: Rule Knowledge Base (Day 4)
14. **Write General Rules skill** — cross-cutting patterns
15. **Write ML Workflows skill** — training/validation/submission rules
16. **Write Bio-design skill** — biological validity rules
17. **Write Vision Media skill** — output validation rules
18. **Write Systems Recovery skill** — probe strategies
19. **Write Game Logic skill** — state transition rules
20. **Implement Rule Knowledge Injector** — scan skills, detect domain from prompt, inject relevant rules
21. **Verify** — agent loads relevant rules for domain-specific tasks

### Phase 5: Execution Records & Validation (Day 5)
22. **Implement ExecutionLogger** — stateful logging of all tool calls and validations
23. **Wire tool_execution_start/tool_result events** — log all operations
24. **Implement execution trail injection** — compact summary at each turn
25. **Implement `/lemonharness:validate` command** — manual validation with recording
26. **Verify** — full execution trail visible in context, validation commands recorded

### Phase 6: Integration & Polish (Day 6)
27. **Settings integration** — `lemonharness` section in settings.json
28. **Commands** — `/lemonharness:status`, `/lemonharness:budget`, `/lemonharness:reset`
29. **UI feedback** — footer status showing phase, budget, workspace state
30. **Error handling** — graceful degradation if any component fails
31. **Documentation** — inline comments, README for each skill

---

## 9. Testing & Validation

### Test Scenarios

| Scenario | What to Test |
|---|---|
| **Workspace boundary** | Try writing to `/etc/passwd`, `../outside`, `/tmp/outside` — should be blocked |
| **Workspace tracking** | Write 3 files, run 2 commands, install 1 dep → `workspace_state` shows all 6 changes |
| **Time phases** | Simulate a 60s budget; verify P1→P2 transition at 18s, P2→P3 at 36s, P3→P4 at 54s |
| **Grace band** | At 29% budget (just before P2), start a command that takes 4% more budget → should complete in grace band |
| **P4 hard reserve** | At 91% budget, instruct model to stop new state-changing actions |
| **Rule knowledge injection** | Prompt "train a neural network" → ML workflows skill rules appear in context |
| **Execution trail** | After 5 tool calls, context includes a compact trail summary |
| **Validation command** | Run `/lemonharness:validate python test.py` → recorded and shown in next trail |

### Debugging

```bash
# Check extension is loaded
pi -e .pi/extensions/lemonharness-workspace.ts

# Check skills are discovered
pi --verbose 2>&1 | grep -i skill

# Check settings
pi -p "list all loaded extensions and skills"
```

---

## Appendix A: Settings Schema

Add to `.pi/settings.json`:

```json
{
  "lemonharness": {
    "enabled": true,
    "workspace": {
      "dir": ".lemonharness",
      "allowedPaths": ["/tmp", "/home/james/.cache"],
      "blockOutsideWrites": true
    },
    "timeAwareness": {
      "enabled": true,
      "defaultBudgetMs": 300000,
      "exploreRatio": 0.3,
      "implementRatio": 0.6,
      "validateRatio": 0.9,
      "graceBand": 0.05
    },
    "ruleKnowledge": {
      "enabled": true,
      "autoDetectDomain": true
    },
    "executionLogging": {
      "enabled": true,
      "maxTrailEntries": 10,
      "injectTrailInterval": 3
    },
    "structuredTools": {
      "enabled": true,
      "interceptBuiltins": true
    }
  }
}
```

## Appendix B: Commands Reference

| Command | Description |
|---|---|
| `/lemonharness:status` | Show current workspace state, phase, budget usage |
| `/lemonharness:budget <seconds>` | Set time budget for current task |
| `/lemonharness:reset` | Reset workspace state (clean workspace) |
| `/lemonharness:validate <cmd>` | Run validation command and record result |
| `/skill:ml-workflows` | Manually load ML workflows skill |
| `/skill:bio-design` | Manually load bio-design skill |
| `/skill:vision-media` | Manually load vision media skill |
| `/skill:systems-recovery` | Manually load systems recovery skill |
| `/skill:game-logic` | Manually load game logic skill |
| `/skill:general-rules` | Manually load general rules skill |
