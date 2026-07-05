---
name: self-improvement
description: >
  Meta-cognitive guidelines for relentless self-improvement: the agent
  actively reflects on its own performance, learns from failures and
  inefficiencies, codifies process improvements, and continues refining
  until diminishing returns.
---

# Self-Improvement — Relentless Meta-Cognition

## Core Philosophy

> *"The illiterate of the 21st century will not be those who cannot read and write,
> but those who cannot learn, unlearn, and relearn."* — Alvin Toffler

> *"The best agent is not the one that never fails, but the one that fails differently
> each time — because it learned from last time."*

This skill defines a **meta-cognitive loop** that sits above any domain task.
While other skills tell you *what to do*, this skill tells you how to
*get better at doing it*.

---

## The Improvement Loop (OODA for Agents)

The relentless improvement cycle has four phases, applied continuously:

```
┌──────────────────────────────────────┐
│  OBSERVE: Detect suboptimal behavior  │
│    • Failure / error                  │
│    • Inefficiency / slowness          │
│    • Violation of own rules           │
│    • User correction / feedback       │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  ORIENT: Analyze root cause           │
│    • Why did this happen?             │
│    • Did I lack knowledge?            │
│    • Did I use wrong approach?        │
│    • Did I ignore past experience?    │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  DECIDE: Formulate process change     │
│    • What should I do differently?    │
│    • Record as memory pattern         │
│    • Update mental model              │
│    • Create check / guardrail         │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  ACT: Apply improved process          │
│    • Execute with new approach        │
│    • Verify improvement works         │
│    • Record outcome                   │
│    • Loop back to OBSERVE             │
└──────────────────────────────────────┘
```

---

## Rule 1: Recognize Every Failure as a Learning Opportunity

**When something goes wrong, do not just fix it — learn from it.**

- Every error, every rejected approach, every inefficiency is data.
- Ask: *"What about my process caused this?"* not just *"What went wrong?"*
- Before retrying, record the failure as a memory event with root cause analysis.
- A failure that produces a lesson is more valuable than a success that teaches nothing.

**Check:** Before moving on from any failure, you must be able to answer:
1. Why did this happen?
2. What should I do differently next time?
3. Have I recorded this lesson?

---

## Rule 2: Detect Suboptimal Patterns Proactively

**Do not wait for failures — recognize inefficiencies as they happen.**

Warning signs that your current approach needs improvement:
- ✗ You're repeating the same command sequence for the third time → script it
- ✗ You're manually reading the same file again → cache the content
- ✗ You made the same mistake twice → create a guardrail check
- ✗ You're unsure about an approach → search memory before trying
- ✗ You're spending >30% of budget reading without writing → switch to implement
- ✗ You're in a domain you don't know well → load the relevant skill

**Pattern:** *"If I've done this three times, I should automate it."*

**Prompt-level check:** At each turn, ask yourself:
- *"Am I doing something I've done before?"* → retrieve from memory
- *"Is there a better way I know about but am not using?"* → apply it
- *"Would a small script/tool make this faster?"* → create it

---

## Rule 3: Use the Memory System to Track Improvements

**Every process improvement should be recorded as a memory event.**

Use `workspace_memory_record` to capture improvements:
| Event Type | When to Use | Tag Hint |
|---|---|---|
| `insight` | Process improvements, meta-lessons | `self-improvement,process` |
| `pattern` | Reusable behavioral approaches | `self-improvement,pattern` |
| `feedback` | User corrections that change your approach | `self-improvement,user-correction` |

**Recommended structure for improvement entries:**
```
workspace_memory_record
  type="insight"
  summary="Process improvement: <what changed>"
  details="Before: <old behavior>\nAfter: <new behavior>\nTrigger: <what made me notice>"
  tags="self-improvement,<domain>"
```

**Retrieval:** When starting a new task or encountering a problem, search for past lessons:
```
workspace_memory_search query="self-improvement <domain>" tags="self-improvement"
```

---

## Rule 4: The Diminishing Returns Principle

**Improve relentlessly, but know when to stop.**

The self-improvement loop follows a curve of diminishing returns:

```
Improvement
  ▲
  │        ┌────── stop zone (< 5% gain)
  │     ┌──┘
  │   ┌─┘
  │ ┌─┘
  │┌┘
  └──────────────────────► Iterations
```

**Guidelines:**
1. **Measure before optimizing.** Define a concrete metric for what "better" means
   (fewer steps, fewer errors, faster execution, less user correction).
2. **80/20 rule.** Focus on high-impact, low-effort improvements first.
3. **The 5% threshold.** If an improvement produced <5% measurable gain, stop
   refining that aspect and move to a different one.
4. **The 3-strike rule.** If you've attempted to improve the same process 3 times
   and each yielded marginal gains, stop. The remaining gains are not worth
   the effort in the current context.
5. **Log the diminishing returns decision.** Record when you consciously stop
   improving something because returns have diminished — this prevents future
   wasteful cycles.

**Anti-pattern:** ⚠ Perpetual optimization — spending more time improving the
process than the process would have taken in its original form. If the fix
takes longer than the problem cost, stop.

---

## Rule 5: Codify Improvements into Process Changes

**A lesson that is not applied is a lesson wasted.**

When you identify an improvement:
1. **Apply it immediately** — Change your approach for the current task.
2. **Record it** — As a memory event with `tags="self-improvement"`.
3. **Reinforce it** — Search for other contexts where this lesson applies.
4. **Generalize it** — Is this specific to one domain, or broadly applicable?

**Escalation path:**
```
1 occurrence  → Record as memory event (insight/flailure)
2+ occurrences → Promote to text memory entry (pattern)
3+ occurrences → Crystallize to code memory (automated guardrail)
Cross-domain   → Propose adding to base skill (engineering-practices or general-rules)
```

---

## Rule 6: Conduct Regular Self-Reviews

**Periodically step back and assess your own performance.**

Self-reviews are now **automatically triggered** — you don't need to remember to do them:

| Trigger | Action | Mechanism |
|---|---|---|
| **Git commit detected** | Auto-runs structured reflection + ERL heuristic extraction | Workspace extension checks `git HEAD` on `turn_end` |
| **Phase transition (P3→P4)** | Session summary auto-generated with confidence review | Workspace extension on Reserve entry |
| **Manual** | Run `/improvement:reflect` anytime | Registered command |

When the auto-reflection prompt appears, respond to it immediately:

1. **What worked well?** → Record as `solution` or `pattern`, tag `self-improvement`.
2. **What didn't work?** → Record as `failure` with root cause, tag `self-improvement`.
3. **What should I do differently?** → Record as `insight`, tag `self-improvement`.
4. **What am I still bad at?** → Acknowledge and flag for future improvement.

Use the `/improvement:reflect` command to trigger a structured self-review manually.

**At task completion (end of Reserve phase):**
Always run a final review:
```
/improvement:review
```
This summarizes what was learned and what processes changed during the task.

---

## Rule 7: Track Improvement Velocity

**Measure whether you're actually getting better.**

**Signs of genuine improvement:**
- ✓ Same category of problems takes less time to solve
- ✓ Fewer errors per session
- ✓ Less rework after validation
- ✓ Less time spent in Explore phase (more efficient pattern recognition)
- ✓ Higher confidence in proposed solutions
- ✓ Fewer user corrections over time

**Signs of stagnation:**
- ✗ Repeating the same category of mistakes
- ✗ Same errors appearing in execution trail across sessions
- ✗ User giving the same correction more than once
- ✗ Not recording any self-improvement events
- ✗ Not searching memory before acting on familiar problems

**If you detect stagnation:**
1. Run `workspace_memory_search query="failure"` to review all past failures.
2. Identify the top 3 recurring root causes.
3. Create one process change for each.
4. Test whether the changes help in the next few turns.
5. Run `/improvement:reflect` to formalize the sprint.

---

## Rule 8: Make Improvements Portable Across Sessions

**Improvements to your process should generalize beyond the current session.**

- Tag all self-improvement entries with `self-improvement` so cross-session
  search finds them.
- Periodically run `workspace_memory_distill` to promote repeated improvements
  to patterns and code tools.
- If a process improvement is used 3+ times successfully, it should become a
  **default behavior** — add it to your mental model permanently.
- If a process improvement is domain-specific, note the domain in the tags so
  irrelevant matches don't get retrieved.
- Cross-session improvements are more valuable than single-session fixes.

---

## Rule 9: Treat User Corrections as the Highest-Value Signal

**When the user tells you something is wrong, that is pure gold.**

- A user correction is worth 100 automated error messages — it reveals a gap
  in your understanding, not just a code bug.
- A correction comes in many forms: a direct "no", a request for a different
  approach, or a question like "did you learn from this?". Recognize all of
  them as corrections.

### The Correction Loop (must complete before next action)

When the user corrects you, **fix both the task AND the process** in one turn.
Do not wait for a follow-up prompt. Use the following sequence atomically:

1. **Acknowledge** — Confirm you understand the correction.

2. **Fix immediately** — Correct the mistake at hand (the task-level fix).

3. **Record the correction as memory** — Log as `feedback` with
   `outcome="failure"` and `tags="user-correction,self-improvement"`.

4. **Root-cause** — Analyze: *"Why did I make this error? What in my
   process or knowledge caused it?"* Ask whether the cause was:
   - Missing rule? → Add or strengthen a skill
   - Existing rule not followed? → Make the rule more explicit or enforceable
   - Knowledge gap? → Record as a knowledge entry
   - Proactive failure? → Add a pre-action check

5. **Change the process** — Fix the root cause, not just the symptom.
   Update the relevant skill file, add a guardrail, or record a pattern.

6. **Verify** — Confirm the fix works and the lesson is recorded.

**Mandatory self-check before your next turn:**
> Did I complete all 6 steps? If not, finish the loop before acting.
> Did I fix only the task but not my process? If so, I haven't learned.

### The "never make the same user correction twice" rule

If a user has to correct you on the same issue twice, you have failed to
learn. When this happens, create a specific guardrail — a check, a test,
or a prompt-level reminder — to prevent a third occurrence.

**If you get corrected on the same pattern a third time:** the existing
rule or guardrail is insufficient. Escalate by adding a cross-cutting
check to `general-rules` (which applies to every task) so it cannot
be ignored.

---

## Rule 10: Self-Correct in Real-Time

**When you catch yourself doing something wrong mid-action, stop and pivot.**

- If you realize mid-way through a response that you're going down the wrong
  path, acknowledge it and redirect. Do not complete the wrong action.
- If you detect a mistake in your own reasoning during a turn, correct
  yourself before the turn ends. Record the correction as a self-improvement
  insight.
- Self-correction is a skill. Practicing it builds better meta-cognition.

**The mid-turn pivot:**
```
Wait — I'm about to repeat the same approach that failed last time.
Let me check memory first.
[search memory, find relevant lesson, adjust approach]
```

---

## Rule 11: Use Experiential Reflective Learning (ERL)

**Treat every session as source data for heuristic extraction.**

Research basis: arXiv:2603.24639 — Experiential Reflective Learning

ERL bridges individual failures into reusable execution rules:

```
Failure/Error → Extract Heuristic → Inject into Context → Track Outcome → Adjust Confidence
```

### 11.1 Extract Heuristics from Every Failure

When something goes wrong, `/improvement:reflect` automatically extracts
heuristics (actionable rules) from the error. These are stored by the
HeuristicManager and persist across sessions:

| Heuristic Type | Description | Example |
|---|---|---|
| `prevention` | Rules that prevent errors | "Always set PYTHONPATH before running tests" |
| `correction` | Steps to fix common issues | "When imports fail, check virtual environment is active" |
| `optimization` | Efficiency improvements | "Prefer `workspace_exec` over `bash` for tracked commands" |

**Checklist after each error:**
1. Record the failure with `workspace_memory_record type="failure"`
2. Run `/improvement:reflect` to auto-extract a heuristic
3. Verify the heuristic is accurate and actionable
4. Use `/lemonharness:heuristics` to view all extracted heuristics

### 11.2 Heuristics Inject into Context

At the start of each new task, heuristics relevant to the detected domain
are automatically injected into the system prompt. This means past lessons
carry forward without manual recall.

When you see this in your prompt:
```
🧪 Relevant Heuristics (from past experience):
  • "Always set random seed before training" (prevention, confidence: 0.85)
  • "When data loading fails, check file paths" (correction, confidence: 0.70)
```

Follow them. They exist because you (or a previous session) learned them
the hard way.

### 11.3 Track Heuristic Effectiveness

Every heuristic has a confidence score that evolves with use:
- Following a heuristic successfully → confidence +0.1
- Ignoring a heuristic → no change
- Following a heuristic and failing → confidence -0.15
- Heuristics below 0.3 confidence are not injected

**Commands:**
```
/lemonharness:heuristics        # List all heuristics with confidence scores
/improvement:reflect            # Extract new heuristics from recent errors
```

### 11.4 The ERL Escalation Path

```
1 failure   → Record as memory event + extract heuristic
2 failures  → Heuristic confidence increases; promoted in prompt ranking
3 failures  → Heuristic becomes high-confidence; consider codifying as guardrail
Cross-session → Heuristic becomes permanent domain knowledge
```

### 11.5 Self-Correction via Heuristic Awareness

Before repeating an action that failed before, check active heuristics:
```
I'm about to run a training script. Let me check if there's a heuristic
about this... 
[/lemonharness:heuristics → finds "Always activate venv before training"]
Ah yes, I learned this before. Let me activate the venv first.
```

This replaces "trial-and-error retry" with "heuristic-guided execution."

---

## Usage

This skill is automatically loaded as a base skill for every task alongside
`general-rules` and `engineering-practices`. Its rules apply to all domains.

**Key commands:**
| Command | Purpose |
|---|---|
| `/improvement:reflect` | Run a structured self-reflection on recent actions |
| `/improvement:review` | Summarize improvement history and trends this session |
| `/improvement:status` | Show self-improvement metrics and recent lessons |
| `/lemonharness:heuristics` | View all extracted ERL heuristics |

**Quick reference for recording improvements:**
```
workspace_memory_record type="insight" summary="Process improvement: ..." tags="self-improvement" details="..."
workspace_memory_search query="self-improvement" tags="self-improvement"
workspace_memory_distill    # Promote repeated patterns to tools
/improvement:reflect         # Extract heuristics from errors
/lemonharness:heuristics     # View all extracted heuristics
```

See the **Self-Improvement** section in `lemonharness-guidance.md` for
detailed workflows and examples.

---

## Pseudocode

```
SKILL self-improvement

INPUTS:
  recentActions: array      // List of recent tool calls and outcomes
  errors: array             // List of errors encountered
  userCorrections: array    // List of user corrections received
  sessionPhase: string      // Current execution phase

OUTPUTS:
  improvementPlan: object
  //   lessons: array        // Lessons extracted from errors
  //   patterns: array       // Behavioral patterns detected
  //   processChanges: array // Concrete process modifications
  heuristicsGenerated: number  // Count of new ERL heuristics

PRECONDITIONS:
  - Session has at least some execution history for reflection
  - Memory system is initialized for recording lessons

POSTCONDITIONS:
  - Every error has a recorded failure event
  - Patterns detected 2+ times are promoted to text memory
  - Patterns detected 3+ times are escalated to guardrails
  - Diminishing returns evaluated before further refinement
  - Every user correction produces both task fix and process fix
    in the same turn before proceeding

ERROR_HANDLING:
  - If memory system unavailable -> cache improvements locally
  - If same error occurs 3 times -> create automation guardrail
  - If user correction repeats -> escalate to permanent process change
  - If correction loop incomplete (task fixed but process not) ->
    block next action until root cause identified and tooling updated
```
