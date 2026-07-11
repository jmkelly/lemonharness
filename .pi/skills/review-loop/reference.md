# Review Loop — Reference

## Severity Scoring Rubric

The reviewer must assign each finding a severity from 1–10. This is a **judgment call** calibrated against impact and fix cost.

### By Category

| Category | 9–10 (Critical) | 7–8 (High) | 4–6 (Medium) | 1–3 (Low) |
|---|---|---|---|---|
| **correctness** | Incorrect output, wrong algorithm | Edge case not handled, off-by-one potential | Redundant code, unnecessary branching | Variable could be const |
| **security** | Unvalidated user input, exposed secret, auth bypass | Missing CSRF/CORS, weak hash | Unpinned dependency, overly broad permission | Comment mentions API key pattern |
| **spec-violation** | Implementation contradicts spec | Missing required behavior | Optional behavior not implemented | Interpretation difference |
| **maintainability** | 400+ line function, no tests at all | N+1 query, missing error handling | Magic number, unclear variable name | Comment punctuation |
| **performance** | O(n²) on hot path with n > 10k | Missing index on queried column | Unnecessary allocation in loop | Micro-optimization with < 1% gain |
| **testing** | No tests for critical path | Missing edge case test | Test name doesn't match behavior | Redundant assertion |

### Calibration Heuristics

- **If you wouldn't block a PR for it**, it's a 1–3.
- **If you'd block a PR but not wake someone up**, it's a 4–6.
- **If you'd wake someone up**, it's a 7–8.
- **If you'd roll back a deploy**, it's a 9–10.

## Termination Mathematics

### Condition 1: Max Severity ≤ 3 for 2 Consecutive Cycles

```
Let S(c) = max severity in cycle c
Terminate when: S(c) ≤ 3 AND S(c-1) ≤ 3
```

This prevents early termination from a single "clean" cycle that follows a dirty one. Two consecutive clean reviews confirm the implementation is stable.

### Condition 2: Flat Severity Trend

```
Let A(c) = average of top-3 severities in cycle c
Let slope = linear regression slope of [A(c-2), A(c-1), A(c)]
Terminate when: |slope| < 0.5 over 3 cycles
```

A flat trend means the review is finding new issues at roughly the same severity each cycle — the loop isn't converging. This detects oscillation (implementer fixes A, introduces B, reviewer flags B, implementer fixes B, reintroduces A).

### Condition 3: Safety Valve

```
Terminate when: cycle count ≥ maxCycles (default: 5)
```

Prevents budget exhaustion. The final handoff notes that diminishing returns were not reached.

### Condition 4: Manual Stop

```
Terminate when: reviewer.recommended_next_action === "stop"
```

The reviewer can explicitly recommend stopping if the remaining issues are all style preferences or the implementation is as good as the spec allows.

## Cycle Budget

Each cycle allocates:
- **Implementer**: 120s default (configurable via `budget_seconds` on delegate)
- **Reviewer**: 60s default (reviewing is faster than implementing)

The main agent adds overhead for parsing review output and deciding. Budget ~30s per cycle.

Total loop budget: `(120 + 60 + 30) × maxCycles` ≈ 1050s for 5 cycles.

## Review Output Format

The reviewer MUST produce JSON in this format. The loop parses it to extract severities.

```jsonc
{
  "cycle": 1,
  "timestamp": "2026-07-11T10:00:00Z",
  "findings": [
    {
      "id": 1,
      "severity": 7,           // 1-10, see rubric
      "category": "security",  // correctness, security, spec-violation, maintainability, performance, testing
      "description": "User-provided file path is used directly in fs.readFile without validation, enabling path traversal.",
      "fix_suggestion": "Resolve the path against a whitelisted base directory and reject paths containing '..'.",
      "location": "src/handler.ts:42"  // optional but recommended
    }
  ],
  "overall_assessment": "Two high-severity security issues and three medium maintainability concerns. The core logic is correct.",
  "recommended_next_action": "continue",  // "continue" or "stop"
  "summary_stats": {
    "total_findings": 5,
    "by_severity": { "critical": 0, "high": 2, "medium": 3, "low": 0 },
    "max_severity": 7,
    "avg_severity": 5.2
  }
}
```

### Fallback Parsing

If the reviewer does not output valid JSON (e.g., wraps it in markdown, adds commentary), the parser falls back to:
1. Extract text between `{` and `}` (first JSON object in the output)
2. If still invalid, scan for severity keywords and estimate scores
3. If no data extractable, treat as "no findings" (max severity = 0)

## Oscillation Detection

The loop monitors for oscillation — alternating high/low severity patterns that suggest the implementer and reviewer are in a stalemate.

```
Pattern: [7, 7, 3, 7, 7] — Cycle 3 looked clean, but Cycle 4 found new high-severity issues.
```

If two alternating patterns are detected (high-low-high), the loop logs a warning and suggests manual resolution. The implementer may be introducing regressions while fixing other issues.

## Heuristic Extraction

When the same category appears with severity ≥ 4 in 2+ cycles, an ERL heuristic is extracted:

```
IF {category} issue persists across multiple review cycles
THEN add a guardrail or linter rule for {category} before next cycle
CONFIDENCE: 0.6 + 0.1 × occurrences
```

For example, if "security" severity-7+ issues appear in cycles 1, 2, and 3, the heuristic would be:
- "Add automated security scanning (npm audit, ESLint security plugin) before review phase"

## File Structure

The loop writes to `.lemonharness/review-loop/`:

```
.lemonharness/review-loop/
  cycle-1/
    review.json          # Parsed review output
    review-raw.md        # Raw reviewer output
    review-notes.md      # Formatted notes for next implementer
  cycle-2/
    review.json
    review-raw.md
    review-notes.md
  ...
  REVIEW-LOOP-FINAL.md   # Final handoff document
  trend.json             # Severity trend data for analysis
  heuristics.json        # Extracted ERL heuristics
```

## Integration Points

| Integration | How |
|---|---|
| **ERL** | `HeuristicManager.extractHeuristic()` called for multi-cycle patterns |
| **Key Moments** | Breakthrough cycles (Δ severity > 3) tagged via `KeyMomentDetector` |
| **Validation Auto-Healer** | Review findings can trigger `healLastFailure()` for test failures |
| **Quality Gate** | Automatically runs before each reviewer phase |
| **Metrics** | Loop cycles recorded in `MetricsRecorder` for cross-session analysis |
| **Handoff** | `REVIEW-LOOP-FINAL.md` follows handoff conventions |
