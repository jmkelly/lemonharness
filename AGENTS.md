# LemonHarness

LemonHarness is a pi agent customization project implementing the
LemonHarness execution framework for long-horizon LLM agents.

## LemonHarness

This project implements the [LemonHarness](https://arxiv.org/pdf/2606.24311v1)
optimizations for pi:

1. **Unified Runtime Boundary** — All state-changing operations constrained
   within a controlled workspace (`.lemonharness/`)
2. **Reusable Rule Knowledge (Skills)** — Domain-specific execution rules
   organized as pi skills in `.pi/skills/`
3. **Time-Aware Execution** — Phased execution with budget tracking,
   grace bands, and P4 reserve phase
4. **Structured Tool Boundary** — Custom workspace tools with path
   validation and state tracking
5. **Execution Records & Validation Feedback** — Full execution logging
   and validation command recording

## Enhanced Subsystems (v2)

| Subsystem | File | Description | Research Basis |
|---|---|---|---|
| **Quality Gate Auto-Trigger** | `lemonharness-workspace.ts` | Auto-runs `.lemonharness/quality-gate.sh` on P3 entry | VerifAI patterns; arXiv:2605.23989 safety survey |
| **Dynamic Budget** | `lemonharness-workspace.ts` | Extends budget in grace bands to prevent truncation | Adaptive time management (2025-26) |
| **Trail Compression** | `lemonharness-workspace.ts` | Groups older execution entries by type for long sessions | Hierarchical execution summaries |
| **Regression Detection** | `lemonharness-workspace.ts` | Detects 3+ consecutive failures of same type | Fail-fast agent patterns |
| **Web Search Tool** | `lemonharness-search.ts` | Search arXiv, web, Semantic Scholar from agent | Enables live research during tasks |
| **Memory Decay** | `lemonharness-memory.ts` | Ebbinghaus forgetting curve for confidence scores | Forgetting-curve agent memory |
| **TF-IDF Retrieval** | `lemonharness-memory.ts` | Hybrid TF-IDF + Jaccard similarity (60/40) | TF-IDF vs embedding comparisons |
| **Subsystems Module** | `lemonharness-subsystems.ts` | DependencyGraph, MetricsRecorder, QualityGateManager | ProjectMem, agent benchmarks |
| **Integration Adapter** | `lemonharness-integration.ts` | Hooks new subsystems into existing extensions | Modular architecture |

## Enhanced Subsystems (v3)

| Subsystem | File | Description | Research Basis |
|---|---|---|---|
| **Harness Evaluation Metrics** | `lemonharness-subsystems.ts` | 5 process-quality metrics (constraint violations, trace completeness, justification rate, recovery efficiency, regression-free rate) | arXiv:2605.18747 — Code Harness Survey |
| **Phase Checkpoints** | `lemonharness-workspace.ts` | Segment-boundary checkpoints with decision advantage decay | arXiv:2602.06413 — Stability Limits |
| **Safety Specification Mining** | `lemonharness-subsystems.ts` | Auto-extracts safety rules from quality gate failures with confidence scoring | arXiv:2604.23210 — EPO-Safe |
| **ERL Heuristic Extraction** | `lemonharness-subsystems.ts` | Experiential Reflective Learning: auto-extracts heuristics from errors, injects into context | arXiv:2603.24639 — ERL |
| **Tool Privilege Hierarchy** | `lemonharness-subsystems.ts` | 4-level tool privilege (READ/SCOPED_WRITE/EXECUTION/MANAGEMENT) with escalation tracking | arXiv:2606.20023 — Over-Privileged Tool Selection |
| **SaP Pseudocode Contracts** | `lemonharness-workspace.ts` | Skill-as-Pseudocode: 4-check contract verification (coverage, binding, replacement, risk) | arXiv:2605.27955 — SaP |
| **Key Moment Detection** | `lemonharness-memory.ts` | Detects stuck breakthroughs, error recoveries, efficiency gains, validation milestones | arXiv:2605.14211 — ASH |
| **MemCoder Integration** | `lemonharness-memory.ts` | Commit-aware memory augmentation + validation-pattern correlation | arXiv:2603.13258 — MemCoder |

## Key Files

| File | Purpose |
|---|---|
| `.pi/extensions/lemonharness-workspace.ts` | Main extension (all 5 optimizations + enhanced v2 + v3) |
| `.pi/extensions/lemonharness-memory.ts` | Memory & Learning extension (dual-representation + TF-IDF + decay + v3 key moments + MemCoder) |
| `.pi/extensions/lemonharness-subsystems.ts` | v3 capability modules (all 6 new classes) |
| `.pi/extensions/lemonharness-integration.ts` | Integration adapter for v3 subsystems |
| `.pi/extensions/lemonharness-search.ts` | Web search tool (arXiv, web, Semantic Scholar) |
| `.lemonharness/search.py` | Python search backend (DDGS, arXiv API, Semantic Scholar API) |
| `.pi/skills/` | Domain-specific rule knowledge (8 domains) |
| `.pi/settings.json` | Project settings with full LemonHarness config |
| `lemonharness-pi-plan.md` | Full implementation plan |
| `lemonharness-guidance.md` | Usage guidance |
| `.lemonharness/memory/SKILL.md` | Memory system documentation (auto-loaded as skill) |
| `.lemonharness/quality-gate.sh` | Quality gate script |
| `.lemonharness/heuristics.json` | Persisted ERL heuristics across sessions |
| `.lemonharness/quality-specs.json` | Persisted safety specs across sessions |

## Commands

| Command | Description |
|---|---|
| `/lemonharness:status` | Show workspace, phase, budget, error rate, regressions |
| `/lemonharness:budget <seconds>` | Set time budget |
| `/lemonharness:reset` | Reset workspace tracking |
| `/lemonharness:validate <cmd>` | Run validation command |
| `/lemonharness:quality-gate` | Run quality gate manually |
| `/lemonharness:deps` | Show dependency graph |
| `/lemonharness:metrics` | Show cross-session improvement metrics |
| `/lemonharness:harness` | Show harness evaluation metrics (v3) |
| `/lemonharness:safety-specs` | Show discovered safety specs with confidence (v3) |
| `/lemonharness:heuristics` | Show all extracted ERL heuristics (v3) |
| `/lemonharness:privilege` | Show tool privilege escalation statistics (v3) |
| `/lemonharness:key-moments` | Detect and display key moments from memory (v3) |
| `/lemonharness:correlation` | Show validation-pattern correlation data (v3) |
| `/search <query>` | Search web or arXiv from command line |
| `/search arxiv:<query>` | Search arXiv specifically |
| `/memory:status` | Show memory stats and recent events |
| `/memory:forget <id>` | Remove a memory entry |
| `/skill:<name>` | Load any skill (8 available) |
| `/improvement:reflect` | Run structured self-reflection (auto-extracts ERL heuristics) |
| `/improvement:review` | Review improvement history this session |
| `/improvement:status` | Show self-improvement metrics |

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
| `workspace_memory_record` | Record an experience (v3: git-augmented via CommitAwareMemory) |
| `workspace_memory_search` | Search memory (hybrid TF-IDF + Jaccard) |
| `workspace_memory_stats` | Show memory statistics |
| `workspace_memory_list_code` | List crystallized code tools |
| `workspace_memory_distill` | Force pattern extraction (v3: detects key moments) |
| `workspace_memory_feedback` | Provide feedback on memory |
| `web_search` | Search web, arXiv, or Semantic Scholar for research |

### v3 Harness Evaluation Metrics

Research basis: arXiv:2605.18747 — Code Harness Survey

| Metric | Description | Tracking |
|---|---|---|
| **Constraint Violations** | Times agent violated workspace boundaries | Auto-tracked on errors |
| **Trace Completeness** | % of operations with logged provenance | Every tool call is traceable |
| **Tool Justification Rate** | % of tool calls with explicit reasoning | Tracked via memory records |
| **Recovery Efficiency** | Time recovering vs. productive work | Computed from error timing |
| **Regression-Free Rate** | % of changes without regressions | Tracked on consecutive errors |

View with `/lemonharness:harness`

## Quality Gate

The quality gate triggers **automatically** when entering P3 (Validate phase),
based on enforced verification research. Manual trigger always available:

```bash
/lemonharness:quality-gate
```

Checks: file size limits, cyclomatic complexity, maintainability index,
lint errors, test coverage. See engineering-practices skill for thresholds.

Three skills are **always loaded**: `general-rules`, `engineering-practices`,
and `self-improvement`.

## 2026 Research Integration

The following 2026 papers inform LemonHarness enhancements:

### v2 Papers
- **arXiv:2605.23989** — Comprehensive survey of trustworthy agentic AI (safety, robustness, tool use, memory, long-horizon interactions)
- **arXiv:2606.19390** — Execution-bound advisory automation with runtime telemetry
- **arXiv:2605.23023** — Human-LLM collaborative planning for multi-agent systems
- **arXiv:2606.24311** — LemonHarness (original framework)
- **arXiv:2606.24151** — Metis (dual text + code memory)
- **arXiv:2606.12329** — ProjectMem (event-sourced execution provenance)

### v3 Papers
- **arXiv:2605.18747** — Code Harness Survey: 5 evaluation metrics (constraint violations, trace completeness, justification rate, recovery efficiency, regression-free rate)
- **arXiv:2602.06413** — Stability Limits: segment-boundary checkpoints, decision advantage decay
- **arXiv:2604.23210** — EPO-Safe: safety specification mining from quality gate failures
- **arXiv:2603.24639** — ERL: experiential reflective learning, heuristic extraction and injection
- **arXiv:2606.20023** — Over-Privileged Tool Selection: 4-level tool privilege hierarchy
- **arXiv:2605.27955** — SaP: skill-as-pseudocode contract verification (coverage, binding, replacement, risk)
- **arXiv:2605.14211** — ASH: key-moment detection in memory distillation
- **arXiv:2603.13258** — MemCoder: commit-aware memory augmentation + validation-pattern correlation

## Settings

See `.pi/settings.json` for full configuration. Key v2 settings:
- `lemonharness.qualityGate.autoTriggerOnP3Entry` — Auto-run quality gate
- `lemonharness.qualityGate.blockOnFailure` — Block on gate failure
- `lemonharness.dynamicBudget.enabled` — Adaptive budget extension
- `lemonharness.memory.decayHalfLifeDays` — Ebbinghaus memory decay half-life
- `lemonharness.memory.retrievalMethod` — "hybrid" or "jaccard"

Key v3 settings:
- `lemonharness.harnessMetrics.enabled` — Harness evaluation metrics tracking
- `lemonharness.phaseCheckpoints.enabled` — Phase checkpoint recording
- `lemonharness.safetySpecs.enabled` — Safety spec extraction from gate failures
- `lemonharness.heuristics.enabled` — ERL heuristic extraction and injection
- `lemonharness.toolPrivilege.enabled` — Tool privilege monitoring
- `lemonharness.skills.pseudocodeEnabled` — SaP contract verification on skill load
- `lemonharness.keyMoments.enabled` — Key-moment detection in memory

## Quick Reference

| Phase | Budget | Goal | Key Action |
|---|---|---|---|
| **Explore** P1 | 0–30% | Understand & plan | Read files, load skills, search research |
| **Implement** P2 | 30–60% | Build solution | Write files, install deps, run code |
| **Validate** P3 | 60–90% | Verify & lock in | Run tests ← **quality gate auto-triggers** |
| **Reserve** P4 | 90–100% | Preserve output | Summarize, no new changes |

## Commit Convention

Use `<type>(<scope>): <description>` ([Conventional Commits](https://www.conventionalcommits.org/)).

| Type     | Usage                                  |
|----------|----------------------------------------|
| `feat`   | New feature                            |
| `fix`    | Bug fix                                |
| `refactor` | Code change that neither adds nor fixes |
| `docs`   | Documentation only                     |
| `test`   | Adding/improving tests                 |
| `chore`  | Build, deps, tooling, config           |
| `perf`   | Performance improvement                |
| `style`  | Formatting, whitespace (no logic)      |
| `ci`     | CI pipeline changes                    |

Scope examples: `memory`, `workspace`, `search`, `quality-gate`, `skill`, `ui`.

See `engineering-practices` skill (Rule 12) for full details.
