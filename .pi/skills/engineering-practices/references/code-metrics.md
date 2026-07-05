# Code Metrics & Quality Thresholds

> Language-agnostic reference for measurable software quality checks.
> Use these during the **Validate** phase (P3) and in CI/CD pipelines.
>
> Supported ecosystems: **Python** · **TypeScript/JavaScript** · **.NET (C#)**

---

## Quick-Start Health Checks

```bash
# Auto-detect language and run everything
bash .lemonharness/quality-gate.sh
```

```bash
# ── Python ──
pip install flake8 radon xenon pytest pytest-cov 2>/dev/null
flake8 src/ --max-complexity=10 --max-line-length=100 --statistics
radon cc src/ --min C --show-complexity
radon mi src/ --min B
pytest tests/ --cov=src/ --cov-fail-under=70
```

```bash
# ── TypeScript / JavaScript ──
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin typescript jest
npx eslint src/ --max-warnings=0
npx tsc --noEmit
npx jest --coverage --coverageThreshold='{"global":{"branches":70,"functions":70,"lines":70,"statements":70}}'
```

```bash
# ── .NET (C#) ──
dotnet format --verify-no-changes
dotnet build --no-restore -warnaserror
dotnet test --collect:"XPlat Code Coverage" --results-directory:TestResults
dotnet tool install -g dotnet-reportgenerator-globaltool 2>/dev/null
reportgenerator "-reports:TestResults/**/coverage.cobertura.xml" "-targetdir:TestResults/report" "-reporttypes:TextSummary"
```

---

## Metric Tables

### Function-Level Metrics

| Metric | Great | Warning | Fail | Python Tool | TS/JS Tool | .NET Tool |
|---|---|---|---|---|---|---|
| **Cyclomatic complexity** | 1–5 | 6–10 | > 10 | `radon cc`, `flake8` | `eslint complexity` | Roslyn CA1502, `dotnet-codelyzer` |
| **Lines of code** | 1–15 | 16–30 | > 30 | `radon cc` | `eslint max-lines-per-function` | `MeasureCommander`, VS Metrics |
| **Nesting depth** | 1–2 | 3 | > 3 | `radon cc` (raw) | `eslint max-depth` | Roslyn analyzers |
| **Parameter count** | 0–3 | 4 | > 5 | `flake8 max-args` | `eslint max-params` | Roslyn CA1021 |
| **Return points** | 1 | 2–3 | > 3 | `radon cc` | — | — |
| **Cognitive complexity** | 0–5 | 6–10 | > 10 | `flake8-cognitive-complexity` | `eslint-plugin-cognitive-complexity` | SonarAnalyzer (C#) |

### File-Level Metrics

| Metric | Great | Warn | Fail | Python | TS/JS | .NET |
|---|---|---|---|---|---|---|
| **Lines per file** | ≤ 200 | 200–400 | > 400 | `wc -l` | `wc -l` | `wc -l` |
| **Functions/classes per file** | 1–3 | 4–7 | > 7 | `radon cc` | eslint `max-statements` | VS Code Metrics |
| **Imports/usings** | 1–5 | 6–10 | > 10 | `flake8 F401` | eslint `no-duplicate-imports` | IDE analysis |
| **Duplicate lines (%)** | 0–3% | 3–10% | > 10% | `pylint duplicate-code` | `jscpd` | `Simian` |

### Project-Level Metrics

| Metric | Great | Warn | Fail | Python | TS/JS | .NET |
|---|---|---|---|---|---|---|
| **Maintainability Index** | A (> 85) | B (65–84) | C (< 65) | `radon mi` | VS Code Metrics | VS → Analyze → Calculate Code Metrics |
| **Test coverage** | > 90% | 70–90% | < 70% | `pytest --cov` | `jest --coverage` | `dotnet test` + `coverlet` |
| **Coupling** | Low | Moderate | High | `pylint` | `dependency-cruiser` | Roslyn CA1506 |
| **Comment density** | 15–25% | 10–15% or > 30% | < 10% or > 30% | `radon raw` | `eslint no-warning-comments` | VS Code Metrics |
| **Public API symbols** | ≤ 10 | 11–20 | > 20 | `radon` | `api-extractor` | `dotnet api` |

---

## Tool Setup by Language

### Python

```bash
# Install
pip install flake8 radon xenon coverage pytest pytest-cov ruff

# Cyclomatic complexity per function (shows functions graded C or worse)
radon cc src/ --min C --show-complexity

# Average complexity across codebase
radon cc src/ --average

# Maintainability Index per module (A = great, B = moderate, C = bad)
radon mi src/ --min B

# Raw metrics (LOC, comments, blank lines)
radon raw src/

# Lint (PEP8 + complexity gate)
flake8 src/ --max-complexity=10 --max-line-length=100 --statistics

# Faster lint with ruff (drop-in replacement for flake8)
ruff check src/

# Test coverage with threshold
pytest tests/ --cov=src/ --cov-report=term-missing --cov-fail-under=70

# Quality gate — exits non-zero if threshold exceeded
xenon --max-absolute C --max-modules B --max-average A
```

### TypeScript / JavaScript

```bash
# Install
npm install --save-dev \
  eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
  typescript jest ts-jest @types/jest

# Alternatively with vitest
npm install --save-dev vitest @vitest/coverage-v8

# Lint (with complexity rule)
npx eslint src/ --max-warnings=0 \
  --rule 'complexity/max-complexity: ["warn", 10]' \
  --rule 'max-lines-per-function: ["warn", { max: 30 }]' \
  --rule 'max-depth: ["warn", { max: 3 }]'

# Type check
npx tsc --noEmit

# Tests + coverage (Jest)
npx jest --coverage --coverageThreshold='{"global":{"branches":70,"functions":70,"lines":70,"statements":70}}'

# Tests + coverage (Vitest)
npx vitest run --coverage --coverage.thresholds.lines=70

# Install additional complexity plugin
npm install --save-dev eslint-plugin-complexity
npx eslint src/ --rule 'complexity/max-complexity: ["warn", 10]'

# File size distribution
find src/ -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -n | tail -5
```

### .NET (C#)

```bash
# Prerequisites: .NET SDK 6.0+ installed

# Code style / formatting
dotnet format --verify-no-changes

# Build with warnings-as-errors (catches complexity CA1502, maintainability CA1505, coupling CA1506)
dotnet build -warnaserror

# To enable complexity analysis, add these to your .csproj:
#   <PackageReference Include="Microsoft.CodeAnalysis.NetAnalyzers" Version="8.0.0" />
#   <PackageReference Include="SonarAnalyzer.CSharp" Version="9.*" />
#
# Then configure thresholds in .editorconfig:
#   dotnet_diagnostic.CA1502.severity = warning   # cyclomatic complexity
#   dotnet_diagnostic.CA1505.severity = warning   # maintainability index
#   dotnet_diagnostic.CA1506.severity = warning   # class coupling
#   sonar.cs.cognitive_complexity.threshold = 15

# Tests + coverage (requires coverlet.collector package in test project)
dotnet test --collect:"XPlat Code Coverage" --results-directory:TestResults --no-restore

# Coverage report (install globally first)
dotnet tool install -g dotnet-reportgenerator-globaltool
reportgenerator "-reports:TestResults/**/coverage.cobertura.xml" \
  "-targetdir:TestResults/report" "-reporttypes:Html"

# File sizes
find src/ -name "*.cs" | xargs wc -l | sort -n | tail -5

# (Optional) Install third-party complexity tool
dotnet tool install -g dotnet-codelyzer
dotnet-codelyzer src/
```

### General (All Languages)

```bash
# File size distribution
find src/ -name "*.py" -o -name "*.ts" -o -name "*.cs" | xargs wc -l | sort -n | tail -10

# Duplicate detection (Python)
pylint src/ --disable=all --enable=duplicate-code

# Duplicate detection (any language)
npm install -g jscpd
jscpd src/ --threshold 10

# Dependency count
pip list | wc -l                                # Python
jq '.dependencies | keys | length' package.json # Node
find . -name "*.csproj" | xargs grep -c PackageReference | awk -F: '{s+=$2} END {print s}' # .NET
```

---

## Quality Gate Usage

Run the quality gate during **Validate** phase (P3):

```bash
# Auto-detects language and runs all checks
workspace_validate command="bash .lemonharness/quality-gate.sh" expected="All quality checks pass"

# Or run language-specific checks manually:
workspace_validate command="bash .lemonharness/quality-gate.sh src/" expected="All quality checks pass"
```

The script auto-detects the project language (Python, TypeScript, .NET, Go, Rust) and runs the appropriate toolchain. See `.lemonharness/quality-gate.sh` for details.

---

## Threshold Reference

All thresholds are language-agnostic — they apply equally whether you're writing
Python, TypeScript, C#, Go, or Rust:

| Check | Threshold | Rationale |
|---|---|---|
| **Cyclomatic complexity** | ≤ 10 per function | Above 10 → untestable paths, hidden branches |
| **Lines per function** | ≤ 30 | Above 30 → multiple responsibilities, god function |
| **Lines per file** | ≤ 400 | Above 400 → merge conflict magnet, context loss |
| **Nesting depth** | ≤ 3 levels | Deeper → arrow code, untestable paths |
| **Function parameters** | ≤ 5 | More → object/struct should be extracted |
| **Test coverage** | ≥ 70% lines | Below → regressions slip through |
| **Maintainability Index** | ≥ 65 (grade B) | Below → module rots faster than it's maintained |
| **Duplicate code** | ≤ 10% | Above → fix one, miss the copy |

---

## When to Check

### Every Turn (P1–P2) — Keep in Peripheral Vision

- **Function length** — if it scrolls, split it
- **Nesting** — at level 3+, restructure
- **Duplication** — pasted the same code twice? Extract it.
- **Parameter count** — 5+ params? Pack into an object/struct.

These are lightweight checks you can do by sight without running tools.

### Validate Phase (P3) — Run the Full Gate

```bash
workspace_validate command="bash .lemonharness/quality-gate.sh" expected="All metrics within threshold"
```

This runs every check the toolchain supports. Fix any failures.

### Reserve Phase (P4) — Don't Run Checks

Preserve the last known good output. Only report.

---

## Configuration (Future)

Per-project threshold overrides can be placed in `.pi/settings.json`:

```json
{
  "lemonharness": {
    "qualityGate": {
      "maxComplexity": 10,
      "maxFunctionLength": 30,
      "maxFileLength": 400,
      "maxNestingDepth": 3,
      "maxParams": 5,
      "minTestCoverage": 70,
      "minMaintainabilityIndex": 65,
      "maxDuplicatePct": 10
    }
  }
}
```

---

## Why These Metrics?

| Metric | What It Prevents |
|---|---|
| Cyclomatic complexity | Hard-to-test functions, hidden conditional branches |
| Lines per function | God functions, multiple responsibilities in one place |
| Nesting depth | Arrow-code antipattern, paths too deep to reason about |
| Maintainability Index | Modules that rot faster than they're maintained |
| Test coverage | Regressions, untested edge cases, fear of refactoring |
| Duplication | Bug-fix gaps — fix one occurrence, miss the copy |
| File length | Merge conflicts, loss of context, slow review |
| Parameter count | Hidden data coupling, implicit dependencies |

---

*See [SKILL.md](../SKILL.md) for the engineering practices guardrails
that these metrics enforce.*
