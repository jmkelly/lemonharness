# Deploying LemonHarness

LemonHarness is packaged as a **pi package** so you can install it into any project (or globally) and get the full execution framework, skills, and custom tools automatically.

## Installation Methods

### 1. Global Install (recommended for personal use)

Install once, use in every pi session:

```bash
pi install git:github.com/james/lemonharness
```

Or from a local clone:

```bash
cd /path/to/lemonharness
pi install .
```

### 2. Project-Local Install (recommended for teams)

Add to a specific project's `.pi/settings.json` so teammates get it automatically:

```bash
cd /path/to/target-project
pi install -l git:github.com/james/lemonharness
```

The `-l` flag writes to `.pi/settings.json` instead of your global settings.

### 3. Try Without Installing

Test-drive in a single session:

```bash
cd /path/to/target-project
pi -e git:github.com/james/lemonharness
```

## What Gets Installed

| Resource | Location in Package | Loaded By pi |
|----------|---------------------|--------------|
| Extensions (8 files) | `.pi/extensions/*.ts` | Auto-discovered |
| Skills (8 domains) | `.pi/skills/*/SKILL.md` | Auto-discovered |
| Search backend | `.lemonharness/search.py` | Copied to target on first run |
| Quality gate | `.lemonharness/quality-gate.sh` | Copied to target on first run |
| Pre-acceptance gate | `.lemonharness/pre-acceptance-gate.sh` | Copied to target on first run |
| Delegate runner | `.lemonharness/delegate-runner.mjs` | Copied to target on first run |

## First-Run Setup in a New Project

After installing, open pi in the target project. On `session_start`, LemonHarness automatically:

1. Creates `.lemonharness/` in the target project (if missing)
2. Copies `search.py`, `quality-gate.sh`, `pre-acceptance-gate.sh`, and `delegate-runner.mjs` into it
3. Loads all 8 skills and registers custom tools
4. Starts time-aware execution tracking

### Optional: Add Project Settings

Create `.pi/settings.json` in the target project to customize behavior:

```json
{
  "lemonharness": {
    "enabled": true,
    "workspace": {
      "dir": ".lemonharness",
      "blockOutsideWrites": true
    },
    "timeAwareness": {
      "enabled": true,
      "defaultBudgetMs": 900000
    },
    "qualityGate": {
      "enabled": true,
      "autoTriggerOnP3Entry": true,
      "blockOnFailure": false
    },
    "memory": {
      "enabled": true,
      "decayHalfLifeDays": 30,
      "retrievalMethod": "hybrid"
    },
    "harnessMetrics": { "enabled": true },
    "heuristics": { "enabled": true },
    "keyMoments": { "enabled": true },
    "visualization": { "enabled": true }
  }
}
```

> **Note:** If no settings file exists, LemonHarness uses sensible defaults.

### Optional: Python Search Environment

For the `web_search` tool to work, create a one-time Python venv:

```bash
python3 -m venv /tmp/search-env
/tmp/search-env/bin/pip install ddgs requests lxml
```

## Updating

Update to the latest commit:

```bash
pi update lemonharness
```

Or force-reinstall from the latest source:

```bash
pi install git:github.com/james/lemonharness
```

## Uninstalling

```bash
pi remove lemonharness
```

Use `pi remove -l lemonharness` to remove from a project's local settings.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Search script not found` | Run pi once so `session_start` copies assets; or manually copy `.lemonharness/search.py` from the package |
| `Quality gate not found` | Same as above — assets are bootstrapped on first `session_start` |
| Extensions not loading | Ensure the project is trusted (`pi` will prompt) and run `/reload` |
| Skills not appearing | Check `.pi/skills/` exists in the target project; LemonHarness skills load from the package |

## Package Structure

```
lemonharness/
├── package.json          # Pi package manifest
├── .pi/
│   ├── extensions/       # 8 TypeScript extensions
│   └── skills/           # 8 domain-specific skills
├── .lemonharness/
│   ├── search.py         # Python search backend
│   ├── quality-gate.sh   # Language-agnostic quality gate
│   ├── pre-acceptance-gate.sh
│   └── delegate-runner.mjs
└── DEPLOY.md             # This file
```

## Advanced: Filtering Resources

If you want only a subset of LemonHarness, filter in your settings:

```json
{
  "packages": [
    {
      "source": "git:github.com/james/lemonharness",
      "extensions": [".pi/extensions/lemonharness-workspace.ts"],
      "skills": [".pi/skills/general-rules", ".pi/skills/engineering-practices"]
    }
  ]
}
```
