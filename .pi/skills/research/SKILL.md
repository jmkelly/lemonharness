---
name: research
description: >
  Investigate a question against primary sources (official docs, arXiv
  papers, Semantic Scholar, source code, specs, first-party APIs) using
  the web_search tool. Writes structured findings as a Markdown file.
  Use when the user wants a topic researched, docs gathered, API facts
  investigated, or reading legwork delegated. Maps to P1 Explore phase.
source: Matt Pocock (mattpocock/skills) — extended for LemonHarness
---

# Research

**Leading word:** _primary_ — chase every claim back to the source that owns it. Secondary write-ups cost time, misrepresent nuance, and introduce stale information. Only primary sources go into the findings.

## When to Use

Use this skill during **P1 Explore** (0–30% budget) when you need:
- Documentation or API facts that aren't in your training data
- Current best practices, academic papers, or library APIs
- Validation of an approach before implementing
- Background research to inform architecture decisions

The `web_search` tool provides the raw results. This skill gives the _process_ — how to structure the investigation, what to capture, and where to save it.

## Process

### 1. Delegate to a background agent

Spin up a **background agent** to do the reading, so you keep working while it runs. Its job:

> 1. Investigate the question against **primary sources** — official docs, source code, specs, arXiv papers, Semantic Scholar, first-party APIs. Not a secondary write-up of them. Follow every claim back to the source that owns it.
> 2. Write the findings to a single Markdown file, citing each claim's source (URL, date accessed).
> 3. Save it where the repo already keeps such notes; if there is none, save to `.lemonharness/research/`.

### 2. Search Strategy

Use the `web_search` tool with targeted queries:

```bash
# For academic research (arXiv)
web_search query="<topic> agent systems 2026" source="arxiv"

# For documentation and best practices
web_search query="<library> API documentation" source="web"

# For recent developments
web_search query="<topic> latest research" source="recent"
```

**Chain searches** — start broad, then narrow based on what you find. If a paper or library names a specific technique, search for that technique directly.

### 3. Record Findings

Write findings as a structured Markdown file:

```markdown
# Research: <Question>

**Date:** YYYY-MM-DD

## Sources Consulted

- [Title](url) — Primary source (accessed YYYY-MM-DD)
- [Title](url) — Primary source (accessed YYYY-MM-DD)

## Key Findings

1. **Finding one** — with citation to source.
2. **Finding two** — with citation to source.

## Implications

- How this affects the current task or architecture.
- What decisions it unblocks or invalidates.

## Further Questions

- What this investigation left unanswered that could be researched next.
```

### 4. Save to the Repo

Save findings to `.lemonharness/research/<topic-slug>.md`. If that directory doesn't exist, create it. This keeps research artifacts inside the workspace boundary alongside other execution records.

---

## Rules

1. **Primary sources only** — official docs, source code, specs, arXiv, first-party APIs. If you can't reach the source that owns the claim, note it as unverified.
2. **Cite every claim** — each finding must include its URL and access date. Uncited claims are not findings.
3. **One topic, one file** — a single Markdown file per research question. If a topic spawns subtopics, link them.
4. **Keep working** — delegate the reading to a background agent so the main thread keeps making progress.
5. **Research is not implementation** — findings inform decisions. They don't replace prototyping or implementation.

## Relationship to P1 Explore

Research is the primary activity of the **P1 Explore** phase. When entering P1:
1. Load this skill
2. Identify what you need to learn before you can plan
3. Run the research process for each open question
4. Review findings before committing to an approach in P2

---

## Pseudocode

```
SKILL research

INPUTS:
  question: string           // What to investigate
  domain: string             // arxiv, web, recent, docs, source
  depth: string              // quick, thorough, exhaustive

OUTPUTS:
  findingsFile: string       // Path to .lemonharness/research/<topic>.md
  sourcesConsulted: string[] // URLs accessed
  keyFindings: string[]      // Findings with citations

PRECONDITIONS:
  - web_search tool is available
  - Question is specific enough to search (not "tell me everything about X")
  - Primary source is preferred over secondary

POSTCONDITIONS:
  - Findings saved to .lemonharness/research/ as Markdown
  - Every finding includes URL and access date
  - Background agent delegated for reading work

ERROR_HANDLING:
  - No primary source found → note as unverified, list what was tried
  - Search returns nothing → broaden query, try different source
  - Background agent unavailable → do the reading inline but flag the overhead
```
