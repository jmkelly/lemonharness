---
name: review-loop
description: >
  Relentless quality loop: alternate between a fresh-context implementer and a
  fresh-context reviewer until only diminishing-return issues remain. The
  reviewer is advisory-only (no state changes). The implementer starts fresh
  each cycle, unanchored from prior attempts. Terminates when max severity ≤ 3
  for two consecutive cycles or the severity trend is flat.
---

# Review Loop

**Leading word:** _relentless_ — the loop doesn't stop at "good enough." It stops when the remaining issues are not worth the switching cost. Every cycle gets two fresh perspectives and a severity-calibrated decision on whether to continue.

## When to Use

Use this skill when:
- Correctness matters more than speed (the loop burns budget in exchange for quality)
- The task is well-specified (a concrete spec or requirements file exists)
- You suspect an implementation will benefit from adversarial review
- You want to ensure every fixable issue is caught before the work surface cools

Do **not** use when:
- The task is exploratory (loop needs a stable spec to judge against)
- Budget is extremely tight (each cycle costs ~60–120s)
- The task is purely mechanical (copy, rename, reformat)

## The Loop

```
┌──────────────────────────────────────────────────────┐
│                     SPEC (immutable)                  │
└──────────────────────────────────────────────────────┘
          │                              ▲
          ▼                              │
┌──────────────────┐           ┌──────────────────┐
│   IMPLEMENTER    │───code───▶│    REVIEWER      │
│  (fresh context) │           │  (fresh context)  │
│                  │◄──notes──│  advisory only    │
└──────────────────┘           └──────────────────┘
          │                              │
          │                         ┌────▼────┐
          │                         │ SEVERITY │
          │                         │  SCORE   │
          │                         └────┬────┘
          │                              │
          │                    ┌─────────▼──────────┐
          │                    │ max ≤ 3 × 2 cycles?│
          │                    │ or trend flat?      │
          │                    └────┬─────┬──────────┘
          │                         │YES  │NO
          │                    ┌────▼──┐  │
          │                    │ STOP  │  │───▶ next cycle
          │                    └───────┘
          ▼
   ┌──────────────┐
   │ FINAL HANDOFF│
   │ + review     │
   │   trail      │
   └──────────────┘
```

### Phase 1: Implement

The implementer is a fresh-context delegate. It receives:
- The original spec (immutable, pinned)
- All prior review notes (the review trail)
- The current implementation on disk (if not cycle 1)

Its job: read the spec, read the review notes, and fix every issue with severity ≥ 4.
It can also improve things the reviewer didn't flag — but it must not change the spec.

### Phase 2: Review

The reviewer is a **different** fresh-context delegate. It receives:
- The original spec
- The current implementation (read-only)
- **None of the prior reviews** — it judges the implementation fresh

Its job: read the spec, read the implementation, and produce a **severity-scored review**.
The reviewer has **advisory authority only** — it cannot write code or change files.

The review must use the structured format (see reference.md for the full rubric):

```json
{
  "findings": [
    {
      "id": 1,
      "description": "Missing input validation on user-provided path",
      "severity": 8,
      "category": "security",
      "fix_suggestion": "Add allowlist validation before file access"
    }
  ],
  "overall_assessment": "Two high-severity security issues remain...",
  "recommended_next_action": "continue"
}
```

### Phase 3: Decide

After each review, the loop checks termination:

| Condition | Threshold |
|---|---|
| **Max severity** | ≤ 3 for two consecutive cycles |
| **Flat trend** | Top-3 severity average slope < 0.5 over 3 cycles |
| **Safety valve** | Max cycles reached (default: 5) |
| **Manual stop** | Reviewer sets `recommended_next_action: "stop"` |

If any condition is met, the loop breaks. Otherwise, review notes become input for the next implementer cycle.

### Phase 4: Final Output

When the loop terminates, produce:
1. The final implementation (on disk)
2. A `REVIEW-LOOP-FINAL.md` file with the full review trail, cycle summaries, severity trends, and termination reason
3. Heuristics extracted from patterns that appeared in multiple cycles (via ERL)

## Severity Scoring

The reviewer assigns each finding a severity from 1–10:

| Range | Label | Action |
|---|---|---|
| **9–10** | Critical | Correctness bug, security vulnerability, data loss risk. Must fix. |
| **7–8** | High | Logic error, missing validation, spec violation. Must fix. |
| **4–6** | Medium | Maintainability, clarity, performance concern. Should fix. |
| **1–3** | Low | Style nitpick, naming preference, minor optimization. Diminishing returns. |

**The threshold for "worth another cycle" is severity ≥ 4.** When all remaining issues are ≤ 3, further cycles yield diminishing returns.

## Rules

1. **Spec is immutable** — neither implementer nor reviewer may change the original spec. The reviewer flags spec violations; the implementer fixes them. If the spec itself is wrong, abort the loop and fix the spec first.
2. **Reviewer is advisory-only** — the reviewer may not modify files, run commands that change state, or install dependencies. It reads, analyzes, and reports.
3. **Fresh context for both** — every implementer and every reviewer gets a clean context. Neither sees the other's reasoning, only the output (code for reviewer, review notes for implementer).
4. **One finding, one score** — each issue gets its own severity score. No "everything is fine" or "everything is broken" blanket assessments.
5. **Concrete fix suggestions** — every finding must include a specific, actionable fix suggestion. "Fix the bug" is not a finding.
6. **Maximum 5 cycles** — safety valve. If the loop hasn't terminated by cycle 5, produce the final handoff with the remaining review trail and note that diminishing returns were not reached.

## Relationship to LemonHarness

| LemonHarness Feature | Review Loop Integration |
|---|---|
| **Phases** | The loop is a P2–P3 microcosm: implement=P2, review=P3, repeated |
| **ERL Heuristics** | Patterns flagged in 2+ cycles are auto-extracted as heuristics |
| **Key Moments** | Breakthrough cycles (severity drops > 3) are tagged as key moments |
| **Delegates** | Both implementer and reviewer use `workspace_delegate` |
| **Handoff** | Final output uses handoff conventions for session bridging |
| **Diminishing Returns** | Loop's termination condition mirrors self-improvement Rule 3 |
| **Quality Gate** | Auto-triggered on each implementer phase before reviewer sees the result |

## Usage

```
/review-loop [spec-file-path] [max-cycles]
```

If no spec path is given, the command auto-discovers one from these locations (in order):
1. `.lemonharness/review-loop/auto-spec.md` — auto-generated on P3 entry
2. `.lemonharness/review-loop/spec.md` — manual spec
3. `.lemonharness/spec.md`
4. `SPEC.md` or `spec.md` in project root
5. `requirements.md`
6. `README.md` — fallback (often describes the task)

The first match is used. If none are found, the command shows an error with the searched paths.

Examples:
```
/review-loop                                         # auto-discover spec
/review-loop .lemonharness/review-loop/auto-spec.md  # explicit auto-spec
/review-loop requirements/api-spec.md 3              # custom spec, 3 cycles max
```

The command spawns sub-agents for each cycle and reports progress. The loop runs synchronously — the main agent waits for each cycle to complete before deciding whether to continue.

---

## Pseudocode Contract

```
SKILL review-loop

INPUTS:
  specPath: string             // Path to spec/requirements file (optional — auto-discovered if omitted)
  maxCycles: number            // Safety valve (default: 5, max: 10)

OUTPUTS:
  reviewTrail: File[]          // One review per cycle, saved to .lemonharness/review-loop/
  finalHandoff: string         // Path to REVIEW-LOOP-FINAL.md
  terminationReason: string    // Why the loop stopped
  cyclesCompleted: number      // How many cycles ran
  heuristics: Heuristic[]      // ERL heuristics extracted

PRECONDITIONS:
  - Spec file exists and is readable
  - workspace_delegate tool is available
  - Project is in P2 (Implement) or P1 (Explore)

POSTCONDITIONS:
  - Final implementation on disk
  - Full review trail saved
  - Termination reason documented
  - ERL heuristics extracted for multi-cycle patterns

TERMINATION:
  - max_severity <= 3 for 2 consecutive cycles
  - || severity_trend_slope < 0.5 over 3 cycles
  - || cycles_completed >= maxCycles
  - || reviewer sets recommended_next_action: "stop"

ERROR_HANDLING:
  - Delegate failure → use partial output, increment cycle count, continue
  - Reviewer produces no JSON → parse text for severity keywords
  - Spec not found → abort with error
  - Loop oscillates → detect via alternating severity patterns, suggest manual resolution
```
