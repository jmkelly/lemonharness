// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * Settings helper functions for LemonHarness Workspace
 */

import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

interface LemonHarnessSettings {
  enabled?: boolean;
  workspace?: { dir?: string; allowedPaths?: string[]; blockOutsideWrites?: boolean };
  timeAwareness?: { enabled?: boolean; defaultBudgetMs?: number };
  ruleKnowledge?: { enabled?: boolean; autoDetectDomain?: boolean };
  executionLogging?: { enabled?: boolean; maxTrailEntries?: number; injectTrailInterval?: number };
  structuredTools?: { enabled?: boolean; interceptBuiltins?: boolean };
  memory?: { enabled?: boolean };
  qualityGate?: { enabled?: boolean; autoTriggerOnP3Entry?: boolean };
  [key: string]: any;
}

let _wsProjectRoot: string = process.cwd();
let _cachedSettings: LemonHarnessSettings | null = null;

export function getProjectRoot(): string { return _wsProjectRoot; }

export function setProjectRoot(root: string): void { _wsProjectRoot = root; _cachedSettings = null; }

export function readLemonHarnessSettings(): LemonHarnessSettings {
  if (_cachedSettings) return _cachedSettings;
  try {
    const settingsPath = join(_wsProjectRoot, ".pi", "settings.json");
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, "utf-8");
      _cachedSettings = JSON.parse(raw).lemonharness || {};
      return _cachedSettings!;
    }
  } catch { /* settings not available */ }
  _cachedSettings = {};
  return {};
}

export async function bootstrapWorkspace(projectRoot: string, extensionDir: string): Promise<void> {
  const wsDir = join(projectRoot, ".lemonharness");
  const pkgRoot = dirname(dirname(extensionDir));
  const assets = ["search.py", "quality-gate.sh", "pre-acceptance-gate.sh", "delegate-runner.mjs"];
  for (const asset of assets) {
    const src = join(pkgRoot, ".lemonharness", asset);
    const dst = join(wsDir, asset);
    if (existsSync(src) && !existsSync(dst)) {
      try {
        const content = readFileSync(src, "utf-8");
        await writeFile(dst, content, { mode: asset.endsWith(".sh") ? 0o755 : 0o644 });
      } catch { /* asset copy failed — skip */ }
    }
  }
}

import { dirname } from "node:path";
