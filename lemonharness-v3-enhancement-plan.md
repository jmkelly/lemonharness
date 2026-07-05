# LemonHarness v3 Enhancement Plan

**Based on 2026 Research Review — Low/Medium Effort, High/Medium Impact**

**Date:** 2026-07-05 | **Last Updated:** 2026-07-05 (Session 2 complete)

---

## Implementation Status

```
🟢 Complete   🟡 Partial   ⚪ Not Started   ❌ Blocked
```

| # | Enhancement | Code | Wiring | CLI | Status |
|---|-------------|------|--------|-----|--------|
| 1.1 | Harness Metrics | ✅ MetricsRecorder methods | ✅ integration.ts hooks | ✅ `/lemonharness:harness` | 🟢 |
| 1.2 | Phase Checkpoints | ✅ TimeDirector methods | ✅ turn_start recording | ✅ In `/lemonharness:status` | 🟢 |
| 1.3 | Safety Specs | ✅ QualityGateManager | ✅ integration.ts hooks | ✅ `/lemonharness:safety-specs` | 🟢 |
| 2.1 | ERL Heuristics | ✅ HeuristicManager class | ✅ before_agent_start + reflect | ✅ `/lemonharness:heuristics` | 🟢 |
| 2.2 | Tool Privilege | ✅ PrivilegeManager class | ✅ integration.ts init | ✅ `/lemonharness:privilege` | 🟢 |
| 2.3 | SaP Pseudocode | ✅ SaPVerifier class | ✅ In `/skill:<name>` + `before_agent_start` | ✅ SaP in skill output | 🟢 |
| 3.1 | Key Moments | ✅ KeyMomentDetector class | ✅ In memory distiller + auto-scan (every 10 turns) | ✅ `/lemonharness:key-moments` | 🟢 |
| 3.2 | MemCoder | ✅ Both classes built | ✅ CommitAwareMemory in `workspace_memory_record`, VerificationRefinement in validate | ✅ `/lemonharness:correlation` | 🟢 |

### Key Files (Post-Session 2)

| File | Lines | v3 Additions |
|------|-------|-------------|
| `lemonharness-subsystems.ts` | 1425 | 6 new classes (HeuristicManager, PrivilegeManager, SaPVerifier, KeyMomentDetector, VerificationRefinement, CommitAwareMemory) |
| `lemonharness-workspace.ts` | 1302 | Phase checkpoints, heuristic injection, ERL in `/improvement:reflect`, decision advantage, SaP in `/skill:<name>` + agent_start |
| `lemonharness-integration.ts` | 312 | 7 new CLI commands, all 6 classes initialized, PrivilegeManager interceptor active |
| `lemonharness-memory.ts` | 1813 | KeyMomentDetector in distill + auto-scan, CommitAwareMemory in `workspace_memory_record` |
| `.pi/settings.json` | — | All v3 config sections present |
| `AGENTS.md` | — | Updated with v3 subsystems, Code Harness mapping, v3 papers, v3 settings |

### New CLI Commands Available

```
/lemonharness:harness        — Show harness evaluation metrics
/lemonharness:safety-specs   — Show safety specs from quality gate failures
/lemonharness:heuristics     — Show ERL heuristics extracted from experience
/lemonharness:privilege      — Show tool privilege escalation statistics
/lemonharness:key-moments    — List key moments detected from memory
/lemonharness:correlation    — Show validation-pattern correlation
```

---

## Overview

This plan implements 8 enhancements from 2026 research papers, organized into
3 phases by dependency and risk. Each phase can be completed independently,
but later phases build on earlier ones.

### Selection Criteria

Items selected by filtering the full research review for:
- **Effort:** Low or Medium (≤~2 hours per item)
- **Impact:** High or Medium (measurable improvement to agent performance, safety, or reliability)

| # | Paper | Enhancement | Effort | Impact | Phase | Status |
|---|-------|-------------|--------|--------|-------|--------|
| 1 | Code Harness (2605.18747) | Harness evaluation metrics | Low | Medium | 🟢 1 | ✅ |
| 2 | Stability (2602.06413) | Segment-boundary checkpoints | Low | Medium | 🟢 1 | ✅ |
| 3 | EPO-Safe (2604.23210) | Safety spec mining | Low | Medium | 🟢 1 | ✅ |
| 4 | **ERL (2603.24639)** | **Heuristic extraction + injection** | **Medium** | **High** | 🟡 2 | ✅ |
| 5 | **ToolPriv (2606.20023)** | **Tool privilege hierarchy** | **Medium** | **High** | 🟡 2 | ✅ |
| 6 | SaP (2605.27955) | Skill pseudocode conversion | Medium | Medium | 🟡 2 | ✅ |
| 7 | ASH (2605.14211) | Key-moment distillation | Medium | Medium | 🟠 3 | ✅ |
| 8 | MemCoder (2603.13258) | Commit-aware + verification refinement | Medium | Medium | 🟠 3 | ✅ |

---

## 🟢 Phase 1: Quick Wins (3 items, ~1.5 hours total) — ✅ COMPLETE

### 1.1 Harness Evaluation Metrics (Code Harness Survey)

**Source:** arXiv:2605.18747 — Section 4 (Harness Evaluation)

**Status: 🟢 Complete**

**Files modified:**
- `.pi/extensions/lemonharness-subsystems.ts` — `HarnessMetrics` interface, `recordConstraintViolation()`, `recordTraceCompleteness()`, `recordJustifiedCall()`, `recordRecoveryTime()`, `recordChange()`, `getHarnessReport()`, `saveHarnessSnapshot()`
- `.pi/extensions/lemonharness-integration.ts` — Auto-tracks constraint violations, trace completeness, justification rate in `tool_result` handler
- `.pi/settings.json` — `"harnessMetrics": { "enabled": true }`

**CLI:** `/lemonharness:harness` — shows 5 metrics

**Remaining:**
- Updated `AGENTS.md` with Code Harness framework mapping ✅

---

### 1.2 Segment-Boundary Checkpoints (Stability Limits)

**Source:** arXiv:2602.06413 — Theorem A & Structural Consequence

**Status: 🟢 Complete**

**Files modified:**
- `.pi/extensions/lemonharness-workspace.ts` — `TimeDirector` class: `checkpoints[]` array, `recordPhaseCheckpoint()`, `getPhaseCheckpoints()`, `getDecisionAdvantageDecay()`, decision advantage in `formatStatus()`
- `.pi/extensions/lemonharness-workspace.ts` — `turn_start` handler: auto-records checkpoint on phase transition

**CLI:** Decision advantage shown in `/lemonharness:status`

**Acceptance criteria met:**
- ✅ Phase transitions automatically record checkpoints
- ✅ `/lemonharness:status` shows decision advantage estimate
- ✅ Decision advantage decays exponentially: `exp(-0.3 * numCheckpoints)`

---

### 1.3 Safety Specification Mining (EPO-Safe)

**Source:** arXiv:2604.23210 — EPO-Safe Framework

**Status: 🟢 Complete**

**Files modified:**
- `.pi/extensions/lemonharness-subsystems.ts` — `QualityGateManager`: `safetySpecs[]`, `extractSafetySpecs()`, `recordValidationOutcome()`, `getActiveSafetySpecs()`, `getTopSafetySpecs()`, `formatSafetySpecs()`, persistence to `.lemonharness/quality-specs.json`
- `.pi/extensions/lemonharness-integration.ts` — CLI command registered

**CLI:** `/lemonharness:safety-specs` — lists discovered specs with confidence scores

**Acceptance criteria met:**
- ✅ After quality gate failures, safety specs are auto-extracted
- ✅ `/lemonharness:safety-specs` lists discovered specs with confidence scores
- ✅ Persisted across sessions in `.lemonharness/quality-specs.json`

---

## 🟢 Phase 2: Core Enhancements (3 items, ~4 hours total) — ✅ COMPLETE

### 2.1 ERL Heuristic Extraction & Injection — ✅ COMPLETE

**Source:** arXiv:2603.24639 — Experiential Reflective Learning

**Status: 🟢 Complete**

**Files modified:**
- `.pi/extensions/lemonharness-subsystems.ts` — `HeuristicManager` class with: `extractHeuristic()`, `getRelevantHeuristics()`, `formatForPrompt()`, `recordOutcome()`, `getAllHeuristics()`, `getStats()`, persistence to `.lemonharness/heuristics.json`
- `.pi/extensions/lemonharness-workspace.ts` — `before_agent_start`: injected after rule knowledge section; `/improvement:reflect`: auto-extracts heuristics from recent errors
- `.pi/extensions/lemonharness-integration.ts` — `HeuristicManager` initialized on session start
- `.pi/settings.json` — `"heuristics": { "enabled": true, ... }`

**CLI:** `/lemonharness:heuristics` — lists all extracted heuristics

**Acceptance criteria met:**
- ✅ After `/improvement:reflect`, heuristics are generated from errors
- ✅ System prompt includes relevant heuristics at session start (via `before_agent_start`)
- ✅ Heuristics persist across sessions (JSON file)
- ✅ Self-improvement SKILL.md updated with ERL methodology as Rule 11

---

### 2.2 Tool Privilege Hierarchy — ✅ COMPLETE

**Source:** arXiv:2606.20023 — Over-Privileged Tool Selection

**Status: 🟢 Complete**

**Files modified:**
- `.pi/extensions/lemonharness-subsystems.ts` — `PrivilegeManager` class with: 16 pre-registered tools, `checkPrivilege()`, `recordEscalation()`, `getEscalationRate()`, `getToolsAtLevel()`, `formatStatus()`
- `.pi/extensions/lemonharness-integration.ts` — `PrivilegeManager` initialized, tracks escalations on errors
- `.pi/settings.json` — `"toolPrivilege": { "enabled": true, ... }`

**CLI:** `/lemonharness:privilege` — shows 16 tools registered, escalation rate, compliance

**Acceptance criteria met:**
- ✅ All tools have registered privilege levels (4 levels: READ, SCOPED_WRITE, EXECUTION, MANAGEMENT)
- ✅ Over-privileged tool calls trigger suggestions (via `checkPrivilege()`)
- ✅ Escalation patterns tracked and visible in `/lemonharness:privilege`
- ✅ Suggestions are advisory, not blocking
- ✅ Privilege-based interceptor active in `integration.ts` `tool_call` handler

---

### 2.3 Skill Pseudocode Conversion (SaP) — ✅ COMPLETE

**Source:** arXiv:2605.27955 — Skill-as-Pseudocode

**Status: 🟢 Complete**

**Files modified:**
- `.pi/extensions/lemonharness-subsystems.ts` — `SaPVerifier` class with: `verifyContract()`, 4-check verifier (coverage, binding, replacement, risk), `formatResult()`
- `.pi/extensions/lemonharness-workspace.ts` — `/skill:<name>` command: extracts pseudocode, builds `SkillContract`, runs verification, shows result; `before_agent_start`: injects available skill contracts

**What's done:**
- ✅ `SaPVerifier` class with all 4 checks (coverage, binding, replacement, risk)
- ✅ `SkillContract` interface defined
- ✅ `SaPVerificationResult` interface defined
- ✅ All 8 skills have `## Pseudocode` sections with full contracts
- ✅ `SaPVerifier.verifyContract()` wired into `/skill:<name>` command
- ✅ Pseudocode and verification shown in `/skill:<name>` output
- ✅ Available skill contracts injected in `before_agent_start`

---

## 🟢 Phase 3: Enhanced Capabilities (2 items, ~3 hours total) — ✅ COMPLETE

### 3.1 Key-Moment Detection in Memory Distillation (ASH) — ✅ COMPLETE

**Source:** arXiv:2605.14211 — ASH self-honing agents

**Status: 🟢 Complete**

**Files modified:**
- `.pi/extensions/lemonharness-subsystems.ts` — `KeyMomentDetector` class with: `detectStuckBreakthrough()`, `detectErrorRecovery()`, `detectEfficiencyGain()`, `detectValidationMilestone()`, `findAllKeyMoments()`, `formatKeyMoments()`
- `.pi/extensions/lemonharness-memory.ts` — `workspace_memory_distill` tool: detects key moments during distillation, promotes as high-confidence memory events; `turn_end` handler: auto-scans for key moments every 10 turns

**CLI:** `/lemonharness:key-moments` — reads memory events, runs detection, displays results

**What's done:**
- ✅ `KeyMomentDetector` class with 4 detection algorithms
- ✅ CLI command registered (reads memory events and runs detection)
- ✅ Wired into `workspace_memory_distill` tool — key moments detected and promoted during distillation
- ✅ Auto-scan for key moments every 10 turns in `turn_end` handler
- ✅ Detected key moments auto-promoted as high-confidence memory insight events

---

### 3.2 Commit-Aware Memory & Verification Refinement (MemCoder) — ✅ COMPLETE

**Source:** arXiv:2603.13258 — MemCoder framework

**Status: 🟢 Complete**

**Files modified:**
- `.pi/extensions/lemonharness-subsystems.ts` — `CommitAwareMemory` class (extractIntentMapping, augmentWithGitContext), `VerificationRefinement` class (promoteOnPass, demoteOnFail, getCorrelationReport)
- `.pi/extensions/lemonharness-memory.ts` — `workspace_memory_record`: now augments with git context when context contains a file path
- `.pi/extensions/lemonharness-integration.ts` — `tool_result` handler: `VerificationRefinement.promoteOnPass`/`demoteOnFail` called on validation results

**CLI:** `/lemonharness:correlation` — shows validation-pattern correlation data

**What's done:**
- ✅ `CommitAwareMemory` class with git context extraction
- ✅ `VerificationRefinement` class with correlation tracking
- ✅ CLI command registered
- ✅ `CommitAwareMemory.augmentWithGitContext()` wired into `workspace_memory_record` — enriches memory events with git history when context contains a file path
- ✅ `VerificationRefinement` wired into `workspace_validate` — correlates validation results with patterns
- ✅ Correlation stats available via `/lemonharness:correlation`

---

## Session 2 Completion Summary

All 8 v3 enhancements are now fully implemented, wired, and documented.

| Item | Status | What was done in Session 2 |
|------|--------|---------------------------|
| SaP Pseudocode | 🟢 | Already wired — SaP in `/skill:<name>` + contract injection in `before_agent_start` |
| Key-Moment Detection | 🟢 | Already wired in distill + turn_end auto-scan at 10-turn intervals |
| CommitAwareMemory | 🟢 | Wired into `workspace_memory_record` with git context augmentation |
| Self-improvement SKILL.md | 🟢 | Added Rule 11: ERL methodology (heuristic extraction, injection, tracking) |
| AGENTS.md | 🟢 | Updated with v3 subsystems table, Code Harness mapping, v3 papers, v3 settings |
| Plan file | 🟢 | Updated status to reflect Session 2 completion |

## Low-Priority Items Already Working

Items 5-8 from the original Session 2 Priority Queue were already implemented during Session 1:

| Item | Status | Notes |
|------|--------|-------|
| VerificationRefinement in validate | 🟢 | Wired in integration.ts `tool_result` handler |
| PrivilegeManager interceptor | 🟢 | Active in integration.ts `tool_call` handler |
| AGENTS.md update | 🟢 | Updated in Session 2 |
| Self-improvement SKILL.md with ERL | 🟢 | Updated in Session 2 |

---

## Implementation Order (Original — kept for reference)

```
Week 1              Week 2              Week 3
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Phase 1       │   │ Phase 2       │   │ Phase 3       │
│               │   │               │   │               │
│ 1.1 Metrics   │──▶│ 2.1 ERL       │──▶│ 3.1 Key-Moment│
│ 1.2 Checkpts  │   │ 2.2 Privilege │   │ 3.2 MemCoder  │
│ 1.3 Safety    │   │ 2.3 SaP       │   │               │
│               │   │               │   │               │
│ ~1.5 hours    │   │ ~4 hours      │   │ ~3 hours      │
└──────────────┘   └──────────────┘   └──────────────┘
```

**Dependencies:**
- Phase 1 items are fully independent — parallelizable
- Phase 2.2 (Privilege) depends on existing tool registration — review first
- Phase 2.3 (SaP) modifies all 8 skills — coordinate carefully
- Phase 3.1 (Key-Moment) depends on execution trail format — stable by Phase 2
- Phase 3.2 (MemCoder) depends on memory store — no hard dependency

---

## Verification

After each phase, run:

```bash
# Check all tools still work
pi -e .pi/extensions/lemonharness-workspace.ts
pi -e .pi/extensions/lemonharness-integration.ts
pi -e .pi/extensions/lemonharness-memory.ts
pi -e .pi/extensions/lemonharness-subsystems.ts

# Verify commands
pi -p "/lemonharness:status"
pi -p "/lemonharness:metrics"

# Phase-specific:
# Phase 1.3 → /lemonharness:safety-specs
# Phase 2.1 → /improvement:reflect
# Phase 2.2 → Check privilege stats in /lemonharness:status
# Phase 2.3 → /skill:ml-workflows (should show pseudocode)
# Phase 3.1 → /lemonharness:key-moments
# Phase 3.2 → workspace_memory_stats (should show correlation)

# Full quality gate
bash .lemonharness/quality-gate.sh
```

---

## Configuration (settings.json additions)

```json
{
  "lemonharness": {
    "harnessMetrics": { "enabled": true },
    "phaseCheckpoints": { "enabled": true, "decayFactor": 0.3 },
    "safetySpecs": { "enabled": true, "minConfidenceForPrompt": 0.4, "maxSpecsInPrompt": 3 },
    "heuristics": { "enabled": true, "maxHeuristicsPerPrompt": 5, "minConfidenceForInjection": 0.3, "reinjectionInterval": 3, "decayHalfLifeDays": 60 },
    "toolPrivilege": { "enabled": true, "suggestAlternatives": true, "escalationAlertThreshold": 0.3 },
    "skills": { "pseudocodeEnabled": true, "verifyOnLoad": true },
    "keyMoments": { "enabled": true, "scanIntervalTurns": 10 },
    "verificationRefinement": { "enabled": true, "passBonus": 0.1, "failPenalty": 0.15 }
  }
}
```
