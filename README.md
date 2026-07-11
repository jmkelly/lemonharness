# 🍋 LemonHarness

> **An Integrated Execution Framework for Long-Horizon LLM Agents**
>
> *Research-grounded optimizations for [pi](https://github.com/earendil-works/pi-coding-agent) — structured execution, persistent memory, domain expertise, and quality assurance.*

[![arXiv](https://img.shields.io/badge/arXiv-2606.24311-b31b1b.svg)](https://arxiv.org/pdf/2606.24311v1)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

LemonHarness is a **pi agent customization package** that transforms
a general-purpose LLM coding agent into a structured, long-horizon
execution platform. It implements the five core optimizations from
[arXiv:2606.24311](https://arxiv.org/pdf/2606.24311v1) — unified runtime
boundary, reusable rule knowledge (skills), time-aware execution,
structured tool boundary, and execution records — and extends them
with a full suite of v2 and v3 enhanced subsystems drawn from the
2026 trustworthy-agent research literature.

---

## The Problem

Long-horizon LLM agents fail in predictable ways:

| Failure Mode | Root Cause |
|---|---|
| **State drift** | Files written anywhere, deps installed globally, no change tracking |
| **Missing domain knowledge** | Agent starts each task from a blank slate |
| **Poor time management** | Over-exploration, stuck commands, last-minute truncation |
| **Lack of quality enforcement** | Code leaves without tests, linting, or verification |
| **No cross-session memory** | Every session is a groundhog day — same mistakes, same discoveries |

LemonHarness closes all five gaps with research-validated mechanisms.

---

## The Five Core Optimizations

| # | Optimization | Mechanism | What It Prevents |
|---|---|---|---|
| **1** | **Unified Runtime Boundary** | All state changes flow through workspace tools → `.lemonharness/` | State drift, untracked deps |
| **2** | **Reusable Rule Knowledge** | 21 domain skills auto-injected by keyword detection | Blank-slate starts |
| **3** | **Time-Aware Execution** | Phased budgeting (P1–P4) with grace bands | Over-exploration, truncation |
| **4** | **Structured Tool Boundary** | Path validation, write blocking, provenance logging | Rogue file writes |
| **5** | **Execution Records & Validation** | Full execution trail + quality gates | Blind changes, regressions |

Each optimization targets a specific failure mode identified in the 2026
Code Harness Survey ([arXiv:2605.18747](https://arxiv.org/abs/2605.18747)).

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    pi Coding Agent                    │
├──────────────────────────────────────────────────────┤
│              LemonHarness Extension Layer             │
├──────────────┬─────────────┬────────────┬────────────┤
│  Workspace   │   Memory    │Subsystems  │    Search   │
│  Extension   │  Extension  │ Extension  │  Extension  │
│              │             │            │            │
│ • TimeDir.   │ • TF-IDF    │ • Metrics  │ • arXiv     │
│ • Workspace  │   Retrieval │ • Checkpt. │ • Web       │
│   Manager    │ • Ebbinghaus│ • Safety   │ • Semantic  │
│ • Snapshot   │   Decay     │   Specs    │   Scholar   │
│   Manager    │ • Key Mom.  │ • ERL      │            │
│ • Format     │ • MemCoder  │ • Privilege│            │
│   Guard      │   Integr.   │   Hierarchy│            │
│ • Rule Know. │             │ • SaP      │            │
│   Manager    │             │   Contracts│            │
├──────────────┴─────────────┴────────────┴────────────┤
│                  21 Domain Skills                     │
│  (general-rules → bio-design → game-logic → ...)     │
├──────────────────────────────────────────────────────┤
│            Persistent Memory (HarnessMem)             │
│     Events · Patterns · Code Tools · Confidence       │
├──────────────────────────────────────────────────────┤
│         Quality Gate · Validation Auto-Healer         │
└──────────────────────────────────────────────────────┘
```

### Execution Phases (P1–P4)

```
 Explore          Implement        Validate         Reserve
◄──────────►◄──────────────►◄────────────►◄────────────►
    0%            30%            60%           90%      100%

 Key actions:
 ┌──────────────────────────────────────────────────────┐
 │ P1 │ Research unknowns, read docs, load skills       │
 │ P2 │ Write files, install deps, build solution       │
 │ P3 │ Run tests ← quality gate auto-triggers          │
 │ P4 │ Write handoff, snapshot workspace, preserve     │
 └──────────────────────────────────────────────────────┘
```

In the grace band (last 5% before each phase boundary), the budget
auto-extends to prevent truncation — no more last-minute cutoffs.

---

## Features

### Workspace & Tooling

- **Unified runtime boundary** — all artifacts in `.lemonharness/`, every write tracked
- **Path validation** — blocks writes outside allowed paths; catches state drift
- **Snapshot & rollback** — full workspace snapshots with `workspace_delegate`-aware restoration
- **Execution logging** — full provenance trail with compression for long sessions
- **Regression detection** — flags 3+ consecutive failures of the same type

### Skills System (21 Domains)

| Category | Skills |
|---|---|
| **Always loaded** | `general-rules`, `engineering-practices`, `self-improvement` |
| **Software engineering** | `api-design`, `database-patterns`, `testing-strategy`, `observability`, `error-resilience`, `security-practices`, `frontend-design` |
| **Meta** | `research`, `review-loop`, `refactoring-loop`, `handoff`, `commit`, `writing-great-skills` |
| **Scientific** | `ml-workflows`, `bio-design`, `vision-media` |
| **Systems** | `systems-recovery`, `game-logic` |

Skills auto-detect from prompts, load on-demand via `/skill:<name>`,
and carry SaP pseudocode contracts (arXiv:2605.27955).

### Memory & Learning (HarnessMem)

| Feature | Research Basis | Description |
|---|---|---|
| **TF-IDF + Jaccard hybrid retrieval** | Hybrid TF-IDF vs. embedding comparisons | 60/40 weighted similarity for memory search |
| **Ebbinghaus forgetting curve** | arXiv:2606.24311 | Confidence decays over configurable half-life (default 30 days) |
| **Key moment detection** | arXiv:2605.14211 (ASH) | Identifies stuck breakthroughs, error recoveries, efficiency gains |
| **MemCoder integration** | arXiv:2603.13258 | Commit-aware memory augmentation + validation-pattern correlation |

### Quality Assurance

- **Quality gate** — auto-triggers on P3 entry; checks file sizes, complexity, lint, tests
- **Validation auto-healer** — retries and repairs failing validations
- **Review loop** — fresh-context implementer/adversarial reviewer cycles until diminishing returns
- **Refactoring loop** — iterative quality gate hardening with delegate-per-failure-category
- **Safety specification mining** — auto-extracts rules from gate failures (arXiv:2604.23210)

### v3 Enhanced Subsystems

| Subsystem | Research Basis | Description |
|---|---|---|
| **Harness Evaluation Metrics** | arXiv:2605.18747 | 5 metrics: constraint violations, trace completeness, justification rate, recovery efficiency, regression-free rate |
| **Phase Checkpoints** | arXiv:2602.06413 | Segment-boundary checkpoints with decision advantage decay |
| **Safety Spec Mining** | arXiv:2604.23210 (EPO-Safe) | Auto-extracts safety rules from quality gate failures |
| **ERL Heuristics** | arXiv:2603.24639 | Experiential Reflective Learning: extracts rules from errors, injects into context |
| **Tool Privilege Hierarchy** | arXiv:2606.20023 | 4-level privilege (READ/SCOPED_WRITE/EXECUTION/MANAGEMENT) with escalation tracking |
| **SaP Pseudocode Contracts** | arXiv:2605.27955 | 4-check verification on skill load (coverage, binding, replacement, risk) |
| **Key Moment Detection** | arXiv:2605.14211 (ASH) | Stuck breakthroughs, error recoveries, efficiency gains, validation milestones |
| **MemCoder Integration** | arXiv:2603.13258 | Commit-aware memory + validation-pattern correlation |

---

## Installation

### As a pi Package (Install Once, Use Everywhere)

```bash
pi install git:github.com/jmkelly/lemonharness
```

### Or from a Local Clone

```bash
cd /path/to/lemonharness
pi install .
```

### Or Project-Local (Share with Team)

```bash
cd /path/to/your-project
pi install -l /path/to/lemonharness
```

### Or Try Without Installing

```bash
pi -e /path/to/lemonharness
```

---

## Quick Start

```bash
# Start a session — LemonHarness loads automatically.
# The workspace is created, skills are discovered, the clock starts.

# Check your status
/lemonharness:status        # phase, budget, files modified, error rate

# Set a custom budget
/lemonharness:budget 600    # 10 minutes

# Load a skill
/skill:database-patterns

# Write tracked files
workspace_write path="src/app.ts" content="..."

# Run the quality gate
/lemonharness:quality-gate

# Search the web from the command line
/search "TypeScript 5.8 best practices"

# Record a memory
workspace_memory_record type="solution" summary="Fixed N+1 with eager loading" tags="database,performance"

# Commit work with conventional commits
/commit

# End the session with a handoff for the next agent
/skill:handoff
```

---

## Commands

| Command | Description |
|---|---|
| `/lemonharness:status` | Show workspace, phase, budget, error rate, regressions |
| `/lemonharness:budget <s>` | Set time budget |
| `/lemonharness:reset` | Reset workspace tracking |
| `/lemonharness:validate <cmd>` | Run validation command |
| `/lemonharness:quality-gate` | Run quality gate |
| `/lemonharness:deps` | Show dependency graph |
| `/lemonharness:metrics` | Show cross-session improvement metrics |
| `/lemonharness:harness` | Show harness evaluation metrics |
| `/lemonharness:safety-specs` | Show discovered safety specs |
| `/lemonharness:heuristics` | Show extracted ERL heuristics |
| `/lemonharness:privilege` | Show tool privilege escalation stats |
| `/lemonharness:key-moments` | Detect and display key moments from memory |
| `/lemonharness:correlation` | Show validation-pattern correlation data |
| `/lemonharness:context` | Show context budget estimation |
| `/lemonharness:confidence` | Show confidence scores and flagged outputs |
| `/lemonharness:health` | Show periodic health check status |
| `/lemonharness:visualize` | Generate execution visualization (HTML + TUI) |
| `/lemonharness:snapshot [desc]` | Create a manual workspace snapshot |
| `/lemonharness:snapshots` | List all available snapshots |
| `/lemonharness:rollback <id>` | Restore workspace to a snapshot |
| `/lemonharness:heal [last\|stats\|list\|reset]` | Show/trigger validation auto-healer |
| `/lemonharness:delegates` | Show status of all spawned delegates |
| `/lemonharness:delegate <id>` | Show detailed delegate result |
| `/search <query>` | Search web or arXiv |
| `/memory:status` | Show memory stats and recent events |
| `/memory:forget <id>` | Remove a memory entry |
| `/commit [message\|yes]` | Smart commit with conventional commits |
| `/skill:<name>` | Load any domain skill |
| `/improvement:reflect` | Run structured self-reflection |
| `/improvement:review` | Review improvement history |
| `/improvement:status` | Show self-improvement metrics |

---

## Custom Tools

| Tool | Description |
|---|---|
| `workspace_write` | Write file within workspace boundary |
| `workspace_append` | Append to file within workspace boundary |
| `workspace_state` | Get workspace state summary |
| `workspace_exec` | Execute command within project |
| `workspace_install_dep` | Install dependency (npm/pip/apt) |
| `workspace_validate` | Run validation command |
| `workspace_create_temp` | Create temporary directory |
| `workspace_delegate` | Spawn an independent sub-agent |
| `workspace_memory_record` | Record an experience (v3: git-augmented) |
| `workspace_memory_search` | Search memory (hybrid TF-IDF + Jaccard) |
| `workspace_memory_stats` | Show memory statistics |
| `workspace_memory_list_code` | List crystallized code tools |
| `workspace_memory_distill` | Force pattern extraction |
| `workspace_memory_feedback` | Provide feedback on memory |
| `web_search` | Search web, arXiv, or Semantic Scholar |

---

## Research Foundation

LemonHarness is grounded in the 2026 trustworthy-agent AI literature:

| Paper | Venue | Used In |
|---|---|---|
| [LemonHarness: An Integrated Execution Framework](https://arxiv.org/pdf/2606.24311v1) | arXiv:2606.24311 | Core framework — all 5 optimizations |
| [Code Harness Survey](https://arxiv.org/abs/2605.18747) | arXiv:2605.18747 | v3 harness evaluation metrics |
| [Stability Limits of Multi-Agent Systems](https://arxiv.org/abs/2602.06413) | arXiv:2602.06413 | v3 phase checkpoints |
| [EPO-Safe: Safety Spec Mining](https://arxiv.org/abs/2604.23210) | arXiv:2604.23210 | v3 safety specification extraction |
| [ERL: Experiential Reflective Learning](https://arxiv.org/abs/2603.24639) | arXiv:2603.24639 | v3 heuristic extraction & injection |
| [Over-Privileged Tool Selection](https://arxiv.org/abs/2606.20023) | arXiv:2606.20023 | v3 tool privilege hierarchy |
| [SaP: Skill-as-Pseudocode Contracts](https://arxiv.org/abs/2605.27955) | arXiv:2605.27955 | v3 pseudocode contract verification |
| [ASH: Key Moment Detection](https://arxiv.org/abs/2605.14211) | arXiv:2605.14211 | v3 key-moment detection |
| [MemCoder: Commit-Aware Memory](https://arxiv.org/abs/2603.13258) | arXiv:2603.13258 | v3 memory augmentation |
| [Trustworthy Agentic AI Survey](https://arxiv.org/abs/2605.23989) | arXiv:2605.23989 | v2 quality gate, safety patterns |

---

## Project Structure

```
lemonharness/
├── package.json              # Pi package manifest
├── AGENTS.md                 # Agent instruction document (this file)
├── DEPLOY.md                 # Deployment and installation guide
├── .pi/
│   ├── extensions/
│   │   └── lemonharness/     # Main extension (index.ts entry point)
│   │       ├── index.ts          # Extension bootstrap
│   │       ├── workspace.ts      # Workspace extension logic
│   │       ├── memory.ts         # Memory extension logic
│   │       ├── subsystems.ts     # Subsystems extension logic
│   │       ├── search.ts         # Web search tool
│   │       ├── summary.ts        # Live documentation generator
│   │       ├── visualization.ts  # Execution visualization
│   │       ├── integration.ts    # Workspace_delegate, review loop
│   │       ├── shared.ts         # Shared utilities
│   │       ├── workspace-core/   # Core workspace classes (11 files)
│   │       ├── memory-core/      # Core memory classes (5 files)
│   │       ├── subsystems-core/  # Core subsystem classes (15 files)
│   │       ├── search-core/      # Search backends (7 files)
│   │       ├── visualization-core/ # HTML/TUI generators (5 files)
│   │       └── integration/      # Integration adapters
│   └── skills/               # 21 domain skills
│       ├── .index.md             # Master skill index
│       ├── general-rules/        # Base rules (always loaded)
│       ├── engineering-practices/# Engineering guardrails
│       ├── self-improvement/     # Meta-cognitive loop
│       ├── api-design/
│       ├── bio-design/
│       ├── database-patterns/
│       ├── error-resilience/
│       ├── frontend-design/
│       ├── game-logic/
│       ├── ml-workflows/
│       ├── observability/
│       ├── research/
│       ├── review-loop/
│       ├── refactoring-loop/
│       ├── security-practices/
│       ├── systems-recovery/
│       ├── testing-strategy/
│       ├── vision-media/
│       ├── writing-great-skills/
│       └── handoff/
├── .lemonharness/            # Runtime workspace (auto-created)
│   ├── quality-gate.sh           # Quality gate script
│   ├── pre-acceptance-gate.sh    # Pre-acceptance gate script
│   ├── delegate-runner.mjs       # Delegate sub-agent runner
│   ├── search.py                 # Python search backend
│   ├── memory/                   # Persistent memory store
│   ├── snapshots/                # Workspace snapshots
│   └── metrics/                  # Evaluation metrics data
├── tests/                    # Test suite
├── src/                      # Example/sample code
└── tsconfig.json             # TypeScript config
```

---

## Settings

Configure via `.pi/settings.json`:

```json
{
  "lemonharness": {
    "enabled": true,
    "workspace": {
      "dir": ".lemonharness",
      "allowedPaths": ["/tmp"],
      "blockOutsideWrites": true
    },
    "timeAwareness": {
      "defaultBudgetMs": 600000,
      "graceBand": 0.05
    },
    "memory": {
      "decayHalfLifeDays": 30,
      "retrievalMethod": "hybrid"
    },
    "qualityGate": {
      "autoTriggerOnP3Entry": true
    },
    "dynamicBudget": { "enabled": true },
    "harnessMetrics": { "enabled": true },
    "phaseCheckpoints": { "enabled": true },
    "safetySpecs": { "enabled": true },
    "heuristics": { "enabled": true },
    "toolPrivilege": { "enabled": true },
    "keyMoments": { "enabled": true },
    "visualization": { "enabled": true }
  }
}
```

---

## Roadmap

- **v1** — Core 5 optimizations from arXiv:2606.24311 ✓
- **v2** — Quality gate, dynamic budget, trail compression, regression detection,
  web search, memory decay, TF-IDF retrieval ✓
- **v3** — Harness metrics, phase checkpoints, safety spec mining, ERL heuristics,
  tool privilege hierarchy, SaP contracts, key moment detection, MemCoder ✓
- **Next** — Multi-agent orchestration, runtime instrumentation dashboards,
  skill marketplace, embedding-based memory retrieval

---

## License

MIT © James

---

*Built on research, documented in code, proven in practice.*
