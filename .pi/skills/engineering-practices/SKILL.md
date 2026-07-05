---
name: engineering-practices
description: >
  Senior-level software engineering guardrails: TDD, KISS, YAGNI, DRY, domain-driven
  design, concise code, complexity reduction, and measurable quality thresholds.
  Always loaded as a base skill for every task alongside general-rules.
---

# Engineering Practices — Guardrails

## Core Philosophy

> *"Perfection is achieved not when there is nothing more to add,
> but when there is nothing left to take away."* — Antoine de Saint-Exupéry

Every line of code is a liability. The best code is the code you don't write.
When you do write, write the simplest thing that works. Then make it smaller.

---

## Rule 1: TDD (Test-Driven Development)

**Red → Green → Refactor.** Always.

1. **Red** — Write a failing test first. This forces you to define what "done"
   means before you write the implementation.
2. **Green** — Write the simplest code that passes the test. No more.
3. **Refactor** — Improve the code while keeping tests green.

**Why:** Tests are not a luxury — they are the specification. If you can't
write a test for it, you don't understand what it should do.

**Check:** Before writing any implementation function, ask: *"What test would
prove this works?"* If you can't answer, don't write the function yet.

---

## Rule 2: KISS — Keep It Simple, Stupid

**The simplest solution is almost always the best.**

- One function = one responsibility. If a function does two things, split it.
- Prefer flat over nested. If you have 3+ levels of indentation, restructure.
- Favor standard library over external dependencies. A builtin is better than
  a package is better than a framework.
- Configuration over code. Can you make it a data structure instead of logic?

**Warning signs:**
- ✗ A function that needs a comment to explain what it does → rename it
- ✗ More than 2 levels of abstraction in one function → split it
- ✗ A class with a single method → it should be a function
- ✗ Inheritance deeper than 2 levels → you've over-engineered

---

## Rule 3: YAGNI — You Ain't Gonna Need It

**Never add code "just in case" you might need it later.**

- If it's not required by the current task, don't write it.
- "Future-proofing" without a concrete future requirement is speculation.
- Abstract only when you have **two** concrete examples, not one.
- Generics, factories, and patterns are solutions to problems you **have**,
  not problems you **might** have.

**Ask:** *"Will removing this code break the tests?"* If no, remove it.

---

## Rule 4: DRY — Don't Repeat Yourself

**Every piece of knowledge must have a single, unambiguous representation.**

- Duplicated code → extract into a function or module.
- Duplicated data structure → define it once and reference it.
- Duplicated configuration → use constants or config files.
- Duplicated logic across modules → build a shared abstraction.

**But:** Prefer duplication over the wrong abstraction. It's better to
have two similar functions than one over-generalized one. Wait until
you see the pattern three times before abstracting (Rule of Three).

---

## Rule 5: Reduce Complexity at Every Opportunity

**Complexity is the enemy of correctness, maintainability, and velocity.**

| Measure | Target | Warning | Failure |
|---|---|---|---|
| Cyclomatic complexity per function | ≤ 5 | 6–10 | > 10 |
| Lines per function | ≤ 15 | 16–30 | > 30 |
| Lines per file | ≤ 200 | 200–400 | > 400 |
| Nesting depth | ≤ 2 | 3 | > 3 |
| Function parameters | ≤ 3 | 4 | > 5 |
| Class public methods | ≤ 7 | 8–12 | > 12 |

**Techniques to reduce complexity:**
- Extract conditionals into named boolean variables
- Replace switch/if chains with lookup tables or polymorphism
- Use early returns to flatten nesting
- Split long functions at natural boundaries
- Prefer composition over inheritance

---

## Rule 6: Domain-Driven Design (DDD) Light

**Name things after the problem domain, not the implementation.**

- Variables, functions, and classes should speak the language of the business
  or scientific domain, not programming constructs.
- A function called `calculateRiskScore()` is better than `processData()`.
- A class called `ProteinSequence` is better than `SequenceHandler`.
- Keep the domain layer free of infrastructure concerns (I/O, formatting, DB).

**Bounded contexts:** If two parts of the system use the same word to mean
different things, they are different bounded contexts. Give them separate
namespaces.

---

## Rule 7: Be Concise — Say It Once, Say It Small

**Every file, function, and comment should earn its keep.**

- Remove dead code. If it's commented out, delete it.
- Remove debug prints before committing.
- Prefer expressive names over comments. A name like `isEligibleForDiscount()`
  is better than `# check if discount applies`.
- If a comment explains *what* the code does, the code needs renaming.
- If a comment explains *why* the code is unusual, that's good — keep it.

**The 5-line rule:** If a function body fits in 5 lines or fewer, it's
probably right. If it's over 30 lines, it's doing too much.

---

## Rule 8: Do the Simplest Thing That Works

**Start with the most naive correct solution. Optimize only when measured.**

1. Write the simplest version that passes the tests.
2. Profile or measure to find real bottlenecks.
3. Optimize only the bottleneck, and only when the data proves it matters.

**Never:**
- ✗ Add caching before you measure a cache miss
- ✗ Add a thread pool before you have a contention problem
- ✗ Use a complex algorithm when a linear scan is fast enough for the data size

---

## Rule 9: Validate Assumptions with Metrics

**Before declaring "done", run the checks.**

Always run the quality gate at the start of the **Validate** phase.
It auto-detects your project language (Python, TypeScript, .NET, etc.)
and runs the appropriate checks:

```bash
# Auto-detect and run everything (recommended)
workspace_validate command="bash .lemonharness/quality-gate.sh" expected="All checks pass"
```

Or run language-specific checks directly:

```bash
# ── Python ──
pip install flake8 radon xenon pytest pytest-cov
flake8 src/ --max-complexity=10 --max-line-length=100
radon cc src/ --min C            # cyclomatic complexity per function
radon mi src/ --min B            # maintainability index
pytest tests/ --cov=src/ --cov-fail-under=70

# ── TypeScript / JavaScript ──
npx eslint src/ --max-warnings=0 --rule 'complexity/max-complexity: ["warn", 10]'
npx tsc --noEmit                 # type checking
npx jest --coverage --coverageThreshold='{"global":{"lines":70}}'

# ── .NET (C#) ──
dotnet format --verify-no-changes  # code style
dotnet build -warnaserror           # catches complexity warnings
dotnet test --collect:"XPlat Code Coverage" --results-directory:TestResults

# ── General (all languages) ──
find src/ -name "*.py" -o -name "*.ts" -o -name "*.cs" | xargs wc -l | sort -n | tail -5
```

These checks are not optional. Run them before declaring a task complete.

See [code-metrics](references/code-metrics.md) for detailed tool setup,
threshold tables, and quality gate configuration.

---

## Rule 10: Prefer Proven Patterns Over Invented Ones

**Use established design patterns, but don't force them.**

- Favor the standard library's built-in solutions first.
- If you need structure, reach for well-known patterns (Strategy, Observer,
  Factory, Repository) before inventing your own.
- But: patterns are tools, not goals. If a pattern makes code harder to
  understand, don't use it.

---

## Rule 11: Ownership & Hygiene

**Leave the codebase cleaner than you found it.**

- If you touch a file, leave it slightly better — fix a naming issue, remove
  a dead comment, consolidate a duplicated constant.
- If a function is tested, keep it tested. Don't comment out tests.
- If you find a bug in code you didn't write, fix it. Don't add a workaround.

---

## Usage

This skill is automatically loaded as a base skill for every task (alongside
`general-rules`). Its rules apply regardless of domain.

See [code-metrics](references/code-metrics.md) for detailed measurement
procedures and tool setup.

---

## Pseudocode

```
SKILL engineering-practices

INPUTS:
  taskType: string          // Type of engineering task (implement, refactor, test)
  language: string          // Primary language (python, typescript, csharp)
  projectType: string       // Library, CLI, web, service

OUTPUTS:
  qualityReport: object     // // Contains pass/fail for each check
  //   tdd_compliant: bool
  //   complexity_ok: bool
  //   conciseness_ok: bool

PRECONDITIONS:
  - Task must have defined acceptance criteria before implementation
  - Tests must be writable before production code
  - Quality thresholds must be defined per project

POSTCONDITIONS:
  - No function exceeds cyclomatic complexity of 10
  - No file exceeds 400 lines
  - All tests pass before task completion
  - Dead code is removed

ERROR_HANDLING:
  - If complexity exceeds 10 -> refactor before proceeding
  - If coverage drops below 70% -> add missing tests
  - If file exceeds 400 lines -> split into modules
```
