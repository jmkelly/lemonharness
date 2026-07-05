# LemonHarness Usage Guidance

> Based on *LemonHarness: An Integrated Execution Framework for Long-Horizon
> LLM Agents* ([arXiv:2606.24311](https://arxiv.org/pdf/2606.24311v1))
>
> Implemented as **LemonHarness** — a pi agent customization project.

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [The Five Optimizations Overview](#2-the-five-optimizations-overview)
3. [Phase-by-Phase Guidance](#3-phase-by-phase-guidance)
4. [Domain Workflows (Skills)](#4-domain-workflows-skills)
5. [Tool Selection Guide](#5-tool-selection-guide)
6. [Practical Use Patterns](#6-practical-use-patterns)
7. [Troubleshooting](#7-troubleshooting)
8. [Paper Summary & Mapping](#8-paper-summary--mapping)

---

## 1. Quick Start

### First Session

When you start a session with LemonHarness, the extension
automatically:

1. **Creates the workspace** — `.lemonharness/` directory for all artifacts
2. **Detects your task domain** — Scans your prompt for keywords and
   injects relevant skill rules (ML workflows, bio-design, etc.)
3. **Sets a time budget** — Estimated from prompt length (2–20 min)
4. **Starts the clock** — You begin in the **Explore** phase (0–30%)

### Your First Commands

```
# Check where you are and what's tracked
/lemonharness:status

# Set a custom time budget (e.g., 10 minutes)
/lemonharness:budget 600

# Load a skill manually
/skill:ml-workflows
/skill:engineering-practices

# Write a file within the workspace
workspace_write path="src/hello.py" content="print('hello')"

# Run the quality gate (auto-detects your language)
workspace_validate command="bash .lemonharness/quality-gate.sh" expected="All quality checks pass"

# Run project tests (language-specific)
workspace_validate command="pytest tests/"         # Python
# workspace_validate command="npx jest"             # TypeScript
# workspace_validate command="dotnet test"          # .NET
```

### Golden Rule

> **All state-changing operations go through workspace tools.**
> Use `workspace_write`, `workspace_append`, `workspace_exec`,
> and `workspace_install_dep` instead of raw `write`/`bash`/`edit`.
>
> This ensures every change is tracked, validated against the workspace
> boundary, and logged in the execution trail.

---

## 2. The Five Optimizations Overview

LemonHarness targets three core failure modes of long-horizon LLM agents:

| Failure Mode | Root Cause | LemonHarness Fix |
|---|---|---|
| **State drift** | Files written anywhere, deps installed globally, no tracking | Unified Runtime Boundary (Opt 1) + Structured Tool Boundary (Opt 4) |
| **Missing domain knowledge** | Agent starts each task from a blank slate | Reusable Rule Knowledge — Skills (Opt 2) |
| **Poor time management** | Over-exploration, stuck commands, last-minute panic | Time-Aware Execution (Opt 3) + Execution Records (Opt 5) |

### Optimization 1: Unified Runtime Boundary

**What it does:** Constrains all file writes, dependency installs, and
artifact creation to a controlled workspace (`.lemonharness/`).

**What the paper says (Section 3.1):** > "We define a single unified runtime
boundary that encompasses model invocation, tool execution, and rule
knowledge. Operations that change the external state of the system must
pass through this boundary."

**How to use it:**
- Think of `.lemonharness/` as your sandbox. Everything goes here.
- Use `workspace_state` to see what you've created so far.
- If you need to touch a path outside the workspace, check if it's in
  the `allowedPaths` config or rethink your approach.
- When in doubt, create a temp directory with `workspace_create_temp`.

### Optimization 2: Reusable Rule Knowledge (Skills)

**What it does:** Injects domain-specific execution rules into the
agent's context so it doesn't start each task from scratch.

**What the paper says (Section 3.2):** > "We operationalize reusable rule
knowledge by organizing domain-specific execution constraints as structured
skill files... The agent reads relevant skills before beginning execution,
and the rules are embedded in the execution context."

**How to use it:**
- When starting a task in a recognized domain, rules are auto-injected.
- Type `/skill:<name>` to manually load a skill (e.g., `/skill:bio-design`).
- Each skill has a `SKILL.md` with key rules, and a `references/` directory
  with deeper guidance. Read the references when you need details.
- If you're doing cross-domain work (e.g., ML + vision), both skills
  get loaded.

### Optimization 3: Time-Aware Execution

**What it does:** Partitions execution into four phases with budget
tracking, grace bands, and a hard reserve.

**What the paper says (Section 3.3):** > "We partition the total execution
time T into four phases with cumulative ratios: P1 (Explore, 0–30%),
P2 (Implement, 30–60%), P3 (Validate, 60–90%), and P4 (Reserve, 90–100%).
Each transition has a 5% grace band."

**How to use it:**
- Watch the time status that's injected at every turn.
- **Explore phase:** Read files, understand the task, plan. Don't start
  implementing immediately.
- **Implement phase:** Build your solution. Be decisive.
- **Validate phase:** Lock in results. Run tests. Don't start new features.
- **Reserve phase:** Stop writing. Preserve output. Only minimal
  formatting or reporting.

### Optimization 4: Structured Tool Boundary

**What it does:** Wraps all state-changing operations in tools with
defined inputs, outputs, and workspace validation.

**What the paper says (Section 3.4):** > "We replace open-ended environment
operations with structured tool interfaces that have defined inputs, outputs,
and usage constraints... State-changing actions receive stricter treatment."

**How to use it:**
- Prefer workspace tools over built-in tools for state changes.
- `workspace_write` over `write`
- `workspace_exec` over `bash` (for state-changing commands)
- `workspace_install_dep` over raw `pip install` / `npm install`
- The built-in `write` and `edit` tools are intercepted and blocked
  if they target paths outside the workspace.
- `workspace_validate` is specifically for running verification commands
  — it records the result in the execution log.

### Optimization 5: Execution Records & Validation Feedback

**What it does:** Logs all tool calls, validates results, and injects
a compact execution trail into the context at regular intervals.

**What the paper says (Section 3.5):** > "We track all tool interactions in
a structured execution log... Validation commands are recorded as explicit
entries in the execution trail, creating a feedback loop."

**How to use it:**
- Every tool call is automatically logged.
- Use `workspace_validate` to run tests and verification — results are
  recorded with timestamps.
- The execution trail shows the last N operations in a compact summary.
- If something goes wrong, check the trail for the sequence of operations.
- Use `/lemonharness:validate <command>` from the command interface too.

---

## 3. Phase-by-Phase Guidance

### P1: Explore (0–30% of budget)

**Goal:** Understand the task, inspect the environment, plan.

**✅ Do:**
- Read relevant files with the `read` tool
- Check workspace state: `workspace_state`
- Load relevant skills: `/skill:<name>`
- Explore the project structure: `ls`, `find`, `rg`
- Define acceptance criteria before writing code
- Plan your file structure and dependencies

**❌ Don't:**
- Start writing implementation files immediately
- Install dependencies before you know what you need
- Run long-running processes (training, builds)

**Time check:** If you're at 25% and still planning, start wrapping up
exploration.

**Prompt injection example:**
```
⏱ Time Status: EXPLORE phase — 15% of budget used
   - Elapsed: 0m 45s / Total: 5m 0s
   - Remaining: 4m 15s
   - Current phase: Explore (0–30% budget)
```

### P2: Implement (30–60% of budget)

**Goal:** Build the solution. Write files, install deps, run code.

**✅ Do:**
- Write implementation files with `workspace_write`
- Install dependencies with `workspace_install_dep`
- Run commands with `workspace_exec`
- Append to configs with `workspace_append`
- Test incrementally — run small checks after each change
- Use `workspace_create_temp` for intermediate artifacts

**❌ Don't:**
- Rewrite entire projects from scratch — reuse what exists
- Install unnecessary dependencies
- Start exploring new approaches (that was P1's job)

**Time check:** At 55%, start thinking about what validation you'll need.

**Prompt injection example:**
```
⏱ Time Status: IMPLEMENT phase — 42% of budget used
   - Elapsed: 2m 30s / Total: 6m 0s
   - Remaining: 3m 30s
   - Current phase: Implement (30–60% budget)
   - ⚠ Grace window: ~3s before phase transition
```

### P3: Validate (60–90% of budget)

**Goal:** Lock in results, run verification, fix critical bugs only.

**✅ Do:**
- Run `workspace_validate` with test commands
- Read output files to verify correctness
- Fix critical bugs that affect correctness
- Check against acceptance criteria defined in P1

**❌ Don't:**
- Start new features or major refactors
- Add new dependencies
- Rewrite working code "to make it cleaner"
- Explore alternative approaches

**Time check:** At 85%, stop even minor fixes. Start preserving output.

**Prompt injection example:**
```
⏱ Time Status: VALIDATE phase — 75% of budget used
   - Elapsed: 4m 30s / Total: 6m 0s
   - Remaining: 1m 30s
   - Current phase: Validate (60–90% budget)
```

### P4: Reserve (90–100% of budget)

**Goal:** Preserve output, report results. No new state changes.

**✅ Do:**
- Summarize what was accomplished
- Report validation results (pass/fail)
- Read final workspace state with `workspace_state`
- Output a summary for the user

**❌ Don't:**
- Write any new files
- Run any commands that modify state
- Install anything
- Start a new sub-task

**Hard block:** The extension blocks `write`, `edit`, and `bash` in
this phase.

**Prompt injection example:**
```
⏱ Time Status: RESERVE PHASE — 92% of budget used
   - Elapsed: 5m 30s / Total: 6m 0s
   - Remaining: 0m 30s
   - Current phase: RESERVE PHASE — stop new state-changing actions
   - 🛑 STOP initiating new state-changing actions
   - Preserve whatever acceptable result is on disk
   - Only perform minimal validation or output formatting
```

---

## 4. Domain Workflows (Skills)

### Available Skills

| Skill | When It Auto-Loads | Key Focus |
|---|---|---|
| `general-rules` | **Always** (base skill) | Data splits, seeds, validation, workspace discipline |
| `engineering-practices` | **Always** (base skill) | TDD, KISS, YAGNI, DRY, complexity reduction, code metrics |
| `ml-workflows` | ML/DL keywords: train, model, dataset, epoch | Artifact separation, reproducibility, checkpointing |
| `bio-design` | Biology keywords: protein, DNA, RNA, genome | API stability, biological constraints, synthesis |
| `vision-media` | Vision keywords: image, video, frame, pixel | CLI stability, mask alignment, output validation |
| `systems-recovery` | Recovery keywords: crash, backup, restore | Controlled paths, probes, backup-first |
| `game-logic` | Game keywords: game, player, move, state | Formal rules, immutable state, bounded search |

### How Skills Work

1. **Auto-detection:** When you give a prompt containing domain keywords
   (≥2 matches), the relevant skill's `SKILL.md` is injected into context.
2. **Manual loading:** Type `/skill:<name>` at any time to load a skill.
3. **Reference docs:** Each skill has a `references/` directory with
   deeper guidance. Read these files when tackling complex tasks.
4. **Cross-domain:** Multiple skills can be active simultaneously (e.g.,
   ML + Vision for image classification).

### Example: ML Workflow

```
Prompt: "Train a neural network on the Iris dataset"

Auto-loaded skills:
  general-rules    (always)
  ml-workflows     (keywords: train, neural network, dataset)

The agent sees:
  ## Relevant Rules: general-rules
  1. Data splits: train/val/test separation
  2. Random seeds: set explicitly
  ...

  ## Relevant Rules: ml-workflows
  1. Artifact separation: training vs. validation dirs
  2. Reproducibility: set all random seeds
  3. Metric validation: don't trust loss alone
  4. Checkpointing: save best by validation metric
  ...
```

### Example: Bio-design Workflow

```
Prompt: "Design a protein sequence for antimicrobial activity"

Auto-loaded skills:
  general-rules    (always)
  bio-design       (keywords: protein, sequence)

The agent sees bio-design rules about:
  - API rate limiting for UniProt/PDB queries
  - Biological validity (20-letter amino acid code)
  - Synthesis constraints (GC content, repeats)
  - Data provenance tracking
```

---

## 5. Tool Selection Guide

### When to Use Which Tool

| You Want To... | Use This Tool | Instead Of |
|---|---|---|
| Create a new file | `workspace_write` | `write` |
| Edit an existing file (find/replace) | `edit` (intercepted, checked) | `write` with overwrite |
| Append to a file | `workspace_append` | `workspace_write` + re-read |
| Run a command | `workspace_exec` | `bash` |
| Install a package | `workspace_install_dep` | `bash` with pip/npm |
| Run a test/validation | `workspace_validate` | `workspace_exec` |
| Check workspace state | `workspace_state` | complex bash |
| Create a temp directory | `workspace_create_temp` | `bash mkdir` |
| Read a file | `read` | `bash cat` |
| Search files | `bash` with `rg`/`grep`/`find` | (OK to use bash for reads) |

### Tool Decision Flow

```
State-changing operation?
├── Writing a file → workspace_write or workspace_append
├── Editing a file → edit (automatically validated)
├── Running a command
│   ├── State-changing (build, test, run) → workspace_exec
│   ├── Installing a dependency → workspace_install_dep
│   └── Read-only (ls, grep, find) → bash
├── Creating temp artifacts → workspace_create_temp
├── Running validation → workspace_validate
└── Checking state → workspace_state
```

### Why the Distinction Matters

The workspace tools:
1. **Validate paths** — prevent accidental writes outside the workspace
2. **Track operations** — every write, exec, and install is logged
3. **Provide structured return values** — exit codes, output lengths
4. **Enable phase enforcement** — P4 blocks state-changing tools

The built-in `write` and `edit` tools are still intercepted and
path-validated, but they don't provide the structured tracking that
workspace tools do. Use workspace tools for the best experience.

---

## 6. Practical Use Patterns

### Pattern 1: Task Execution (Standard)

```
P1: Explore
  read existing files
  workspace_state
  /skill:relevant-domain
  define acceptance criteria

P2: Implement
  workspace_write src/main.py (implementation)
  workspace_write src/utils.py (helpers)
  workspace_install_dep package="pytest" manager="pip"
  workspace_exec command="python -c 'import main; print(main.run())'"

P3: Validate
  workspace_validate command="pytest tests/"
  workspace_validate command="python src/main.py --test"

P4: Reserve
  workspace_state
  summarize results to user
```

### Pattern 2: Debugging / Fixing

```
P1: Explore
  read the failing file(s)
  workspace_exec command="python -c 'import buggy; buggy.test()'"
  look at logs: workspace_exec command="cat logs/error.log"
  /skill:systems-recovery (for crash recovery)
  identify root cause

P2: Implement
  edit (targeted fix to the bug)
  workspace_exec command="python -c 'import buggy; buggy.test()'"

P3: Validate
  workspace_validate command="pytest tests/"
  workspace_validate command="python -m mypy ."

P4: Reserve
  workspace_state
  report what was fixed
```

### Pattern 3: ML Training

```
P1: Explore
  read data files to understand columns/shape
  workspace_exec command="head -5 data/train.csv"
  /skill:ml-workflows
  read /home/james/Documents/code/HolyCow/.pi/skills/ml-workflows/references/reproducibility.md
  plan: train.py, eval.py, split data

P2: Implement
  workspace_write src/train.py    (set seeds, split data, train loop)
  workspace_write src/eval.py     (validation metrics)
  workspace_install_dep package="torch" manager="pip"
  workspace_exec command="python src/train.py" timeout=120

P3: Validate
  workspace_validate command="python src/eval.py" expected="accuracy > 0.9"

P4: Reserve
  workspace_state
  report metrics
```

### Pattern 4: Multi-file Feature Implementation

```
P1: Explore
  read existing source files
  workspace_state
  identify where new code integrates

P2: Implement
  workspace_append path="src/config.py" content="NEW_FEATURE_ENABLED = True"
  workspace_write src/new_feature.py
  workspace_exec command="python -m tests.test_new_feature"

P3: Validate
  workspace_validate command="pytest tests/ -x"
  workspace_validate command="python -c 'from src import *; print(\"OK\")'"

P4: Reserve
  workspace_state
  summary
```

### Pattern 5: Quality-First Development (Language-Agnostic)

Replace `pytest`/`jest`/`dotnet test` with your project's test runner.
The quality gate script auto-detects your language.

```
P1: Explore
  read existing files
  /skill:engineering-practices (auto-loaded, but re-read if needed)
  read .pi/skills/engineering-practices/references/code-metrics.md
  define acceptance criteria and quality thresholds

P2: Implement (TDD style)
  # RED: write a failing test first
  workspace_write tests/test_feature.ext
  workspace_exec command="pytest tests/test_feature.py"   # Python
  # or: workspace_exec command="npx jest test/feature.test.ts"     # TS
  # or: workspace_exec command="dotnet test --filter Feature"         # .NET
  
  # GREEN: simplest implementation that passes
  workspace_write src/feature.ext
  workspace_exec command="pytest tests/test_feature.py"   # verify it passes
  
  # REFACTOR: improve code while keeping tests green
  edit src/feature.ext (simplify, reduce complexity)
  workspace_exec command="pytest tests/test_feature.py"   # still green

P3: Validate (quality gate — auto-detects language)
  workspace_validate command="bash .lemonharness/quality-gate.sh" expected="All checks pass"
  # The gate checks: file sizes, complexity, lint, tests, coverage
  # Fix any issues found, then re-run:
  workspace_validate command="bash .lemonharness/quality-gate.sh" expected="All checks pass"

P4: Reserve
  workspace_state
  report metrics: "12 functions, avg complexity 3.2, coverage 85%"
```

### Pattern 6: Cross-Domain Task (e.g., ML + Vision)

```
P1: Explore
  read image data info
  /skill:ml-workflows
  /skill:vision-media
  plan training pipeline

P2: Implement
  workspace_write src/dataset.py    (image loading + transforms)
  workspace_write src/train.py      (training loop)
  workspace_install_dep package="torchvision" manager="pip"
  workspace_exec command="python src/train.py" timeout=300

P3: Validate
  workspace_validate command="python src/eval.py"
  workspace_validate command="python -c 'check_output_dimensions()'"

P4: Reserve
  workspace_state
  output metrics and visual checks
```

---

## 7. Troubleshooting

### "Write target is outside the workspace boundary"

**Cause:** You tried to use `write` or `edit` on a path outside the
project root or `.lemonharness/` directory.

**Fix:** Use `workspace_write` instead, which routes through workspace
tooling. If you genuinely need to write to an allowed path (like `/tmp`),
check that it's listed in `lemonharness.workspace.allowedPaths` in
`.pi/settings.json`.

### "File already exists. Set overwrite=true to replace"

**Cause:** Using `workspace_write` without the `overwrite` flag on an
existing file.

**Fix:** Add `overwrite: true` to the parameters:
```
workspace_write path="src/main.py" content="..." overwrite=true
```

### "You are in the RESERVE phase... Stop initiating new state-changing actions"

**Cause:** You tried to write/install/run a state-changing command when
>90% of the time budget is used.

**Fix:** Accept that you're in preservation mode. Summarize what you have.
If you really need more time, use `/lemonharness:budget <seconds>` to
_extend_ the budget (this restarts the timer).

### Skill not auto-detecting

**Cause:** Your prompt doesn't contain at least 2 keywords from the
skill's keyword list.

**Fix:** Manually load it: `/skill:ml-workflows`. You can also adjust
the keyword patterns in `RuleKnowledgeManager.detectDomain()` in the
extension.

### Execution trail is empty

**Cause:** Only tool calls are logged. If you haven't called any
workspace tools, the trail will be empty.

**Fix:** Use workspace tools for your operations. Even `workspace_state`
counts as a tool call and will appear in the trail.

### Workspace state doesn't show my changes

**Cause:** The workspace manager only tracks operations performed
through workspace tools and intercepted built-in tools. If you used
raw `bash` with state-changing commands, they might not be tracked.

**Fix:** Re-run the operation through the appropriate workspace tool.
Use `workspace_state` to verify tracking.

### Phase transition feels wrong

**Cause:** The default budget may not match your task complexity.

**Fix:** Set an explicit budget at the start:
```
/lemonharness:budget 600   # 10 minutes
```
This resets the phase timer with the new budget.

### Command timeout in workspace_exec

**Cause:** The default timeout is 30 seconds.

**Fix:** Increase it:
```
workspace_exec command="python train.py" timeout=300
```

---

## 8. Paper Summary & Mapping

### Paper Structure

The paper at [arXiv:2606.24311](https://arxiv.org/pdf/2606.24311v1)
is structured as:

| Section | Content | LemonHarness Equivalent |
|---|---|---|
| 1. Introduction | Problem: long-horizon agent failures | AGENTS.md overview |
| 2. Related Work | Frameworks (SWE-bench, ToolEmu, etc.) | (background context) |
| 3. LemonHarness | The 5 optimizations in detail | This guidance + validation report |
| 3.1 Unified Runtime Boundary | Workspace constraint | `WorkspaceManager` in extension |
| 3.2 Reusable Rule Knowledge | Skill files with execution rules | `.pi/skills/` with SKILL.md files |
| 3.3 Time-Aware Execution | 4 phases, grace bands, P4 | `TimeDirector` class |
| 3.4 Structured Tool Boundary | Wrapped environment operations | 7 custom workspace tools |
| 3.5 Execution Records & Validation | Logging, trails, feedback | `ExecutionLogger` + validation commands |
| 4. Evaluation | Benchmarks on varied tasks | (future work) |
| 5. Conclusion | Summary and limitations | Project roadmap |

### Key Paper Insights Applied Here

1. **State drift is the #1 enemy.** The workspace boundary (Opt 1) and
   structured tools (Opt 4) work together to prevent scattered changes.
   Every file you write, every dep you install is tracked.

2. **Domain knowledge reduces trial-and-error.** The skills (Opt 2)
   encode hard-won patterns so you don't rediscover them each time.
   If ML workflows always need reproducibility and data splits, why
   learn that every session?

3. **Time pressure improves focus.** The phase system (Opt 3) creates
   a gentle but firm structure: explore first, then implement, then
   validate. The grace bands prevent abrupt cutoffs. The P4 reserve
   prevents last-minute chaos.

4. **Validation is a first-class operation.** The execution records (Opt 5)
   treat validation commands as tracked artifacts, not afterthoughts.
   Every `workspace_validate` call creates a timestamped record.

### When to Re-read the Paper

- If you're extending LemonHarness with new features
- If you want to understand the theoretical motivation for a design choice
- If you're evaluating whether to adopt these patterns in other projects

For day-to-day usage, this guidance document plus the skill files
should be sufficient.

---

## 9. Self-Improvement — Relentless Meta-Cognition

> *"The best agent is not the one that never fails, but the one that fails differently
> each time — because it learned from last time."*

The self-improvement system is a **meta-cognitive layer** that sits above all
domain tasks. It is implemented as a skill (`.pi/skills/self-improvement/SKILL.md`)
that is **always loaded** as a base skill alongside `general-rules` and
`engineering-practices`.

### The Improvement Loop

The system follows an OODA-inspired cycle applied continuously:

| Phase | What It Means | When It Happens |
|---|---|---|
| **Observe** | Detect suboptimal behavior | On error, repeated pattern, user correction |
| **Orient** | Analyze root cause | After detection, before retry |
| **Decide** | Formulate process change | Record as memory pattern, update approach |
| **Act** | Apply improved process | Execute with new approach, verify |

### Key Behaviors

1. **Every failure is a learning opportunity** — Before retrying after an error,
   record the failure with root cause analysis. A failure that produces a lesson
   is more valuable than a success that teaches nothing.

2. **Proactive inefficiency detection** — If you're repeating the same command
   sequence for the third time, script it. If you made the same mistake twice,
   create a guardrail. If you're unsure about an approach, search memory first.

3. **Memory integration** — All improvements are recorded via the memory system
   with `tags="self-improvement"`. This makes them retrievable across sessions.
   Use `workspace_memory_search tags="self-improvement"` to find past lessons.

4. **Diminishing returns** — Stop improving a process when gains fall below 5%.
   If you've improved the same process 3 times with marginal gains each time,
   stop — the remaining gains aren't worth the effort.

5. **User corrections are gold** — If a user corrects you on the same issue
   twice, that's a failure to learn. Create a specific guardrail to prevent
   a third occurrence.

### Commands

| Command | Purpose |
|---|---|
| `/improvement:reflect` | Run a structured self-reflection on recent actions |
| `/improvement:review` | Summarize session stats and show improvement checklist |
| `/improvement:status` | Show self-improvement rules and current metrics |

### Recording Workflow

When you detect something worth improving:

```bash
# 1. Record the lesson
workspace_memory_record type="insight" \
  summary="Process improvement: check memory before editing" \
  details="Before: I edited a file without checking if the approach had failed before.\nAfter: I now search memory before any state-changing operation." \
  tags="self-improvement,process"

# 2. Search for related past lessons
workspace_memory_search query="self-improvement edit" tags="self-improvement"

# 3. Promote repeated patterns to permanent memory
workspace_memory_distill
```

### Configuration

The self-improvement system can be configured in `.pi/settings.json`:

```json
{
  "lemonharness": {
    "selfImprovement": {
      "enabled": true,
      "autoReflectOnErrors": true,
      "diminishingReturnsThreshold": 0.05,
      "maxImprovementsPerProcess": 3,
      "autoRecordCorrections": true
    }
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Enable self-improvement guidelines |
| `autoReflectOnErrors` | `true` | Automatically reflect after errors |
| `diminishingReturnsThreshold` | `0.05` | Stop threshold (<5% gain) |
| `maxImprovementsPerProcess` | `3` | Max 3 improvement cycles per process |
| `autoRecordCorrections` | `true` | Auto-record user corrections |

### When to Stop Improving

The self-improvement loop is powerful, but it can become a trap. Signs that you
should stop improving a particular process:

- The fix takes longer than the problem cost
- The improvement is more complex than the original approach
- You're improving for the sake of improving (not because of a concrete problem)
- The metric hasn't moved after 3 improvement cycles
- You're spending budget on optimizing instead of delivering

When you hit diminishing returns, **record the decision to stop** as a memory
insight. This prevents future cycles on the same process.

---

*See also: [Implementation Plan](lemonharness-pi-plan.md) for design decisions,
[Validation Report](.lemonharness/lemonharness-validation-report.md) for current
status, and [AGENTS.md](AGENTS.md) for quick reference.*
