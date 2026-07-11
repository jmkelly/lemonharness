// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * Commit Core — Pure logic for smart conventional commits.
 *
 * Types, inference, git operations, grouping, and formatting.
 * Extracted from commit-command.ts for file-size compliance.
 */

import { execSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────

export type CommitType =
  | "feat" | "fix" | "docs" | "style" | "refactor"
  | "perf" | "test" | "build" | "ci" | "chore" | "revert";

export interface ChangeGroup {
  type: CommitType;
  scope: string;
  files: string[];
  description: string;
}

interface ParsedChange {
  status: string;
  path: string;
}

// ── Type Inference ───────────────────────────────────────────────────

const TYPE_RULES: Array<{ test: (path: string) => boolean; type: CommitType }> = [
  { test: (p) => /\.md$/.test(p),                                    type: "docs" },
  { test: (p) => /\.test\.|\.spec\.|tests?\//.test(p),               type: "test" },
  { test: (p) => /\.github\/|ci\/|\.ci\//.test(p),                    type: "ci" },
  { test: (p) => /package\.json|tsconfig|\.eslint|\.prettier|biome\.json|\.nvmrc|\.gitignore/.test(p), type: "chore" },
  { test: (p) => /Dockerfile|docker-compose|Makefile|\.cfg|\.ini/.test(p), type: "build" },
  { test: (p) => /^docs\//.test(p),                                   type: "docs" },
];

export function inferType(files: string[]): CommitType {
  for (const rule of TYPE_RULES) {
    if (files.some(rule.test)) return rule.type;
  }
  const allSource = files.every((f) => /\.(ts|js|tsx|jsx)$/.test(f));
  if (allSource && files.length <= 3) return "refactor";
  const hasSource = files.some((f) => /\.(ts|js|tsx|jsx)$/.test(f));
  if (hasSource) return "feat";
  return "chore";
}

// ── Scope Inference ──────────────────────────────────────────────────

const SCOPE_MAP: Array<[RegExp, string]> = [
  [/\.pi\/extensions\/lemonharness\/memory/, "memory"],
  [/\.pi\/extensions\/lemonharness\/workspace/, "workspace"],
  [/\.pi\/extensions\/lemonharness\/search/, "search"],
  [/\.pi\/extensions\/lemonharness\/html/, "ui"],
  [/\.pi\/extensions\/lemonharness\/visual/, "ui"],
  [/\.pi\/extensions\/lemonharness\/summary/, "summary"],
  [/\.pi\/extensions\/lemonharness\/delegate/, "delegate"],
  [/\.pi\/extensions\/lemonharness\/quality/, "quality-gate"],
  [/\.pi\/extensions\/lemonharness\/integration/, "integration"],
  [/\.pi\/extensions\/lemonharness\/commit/, "commit"],
  [/\.pi\/extensions\/lemonharness\/subsystems/, "subsystems"],
  [/\.pi\/extensions\/lemonharness\//, "lemonharness"],
  [/\.pi\/skills\//, "skill"],
  [/\.pi\/settings/, "settings"],
  [/\.lemonharness\//, "harness"],
  [/\.github\//, "ci"],
  [/^tests?\//, "tests"],
  [/^docs?\//, "docs"],
];

export function inferScope(files: string[]): string {
  const paths = files.filter((f) => !f.startsWith(".lemonharness/memory"));
  for (const [pattern, scope] of SCOPE_MAP) {
    if (paths.some((f) => pattern.test(f))) return scope;
  }
  const dirs = paths.map((f) => {
    const parts = f.split("/");
    return parts.length > 1 ? parts[0] : "root";
  });
  const uniqueDirs = [...new Set(dirs)];
  return uniqueDirs.length === 1 ? uniqueDirs[0] : "general";
}

// ── Description Generation ───────────────────────────────────────────

export function inferDescription(files: string[], type: CommitType): string {
  const names = files.map((f) => {
    const base = f.split("/").pop() || f;
    return base
      .replace(/\.(ts|js|tsx|jsx|md|json|yml|yaml)$/, "")
      .replace(/[-_]/g, " ")
      .toLowerCase();
  });
  const uniqueNames = [...new Set(names)].filter(Boolean);

  if (uniqueNames.length === 0) return "update files";
  if (uniqueNames.length === 1) {
    const name = uniqueNames[0];
    switch (type) {
      case "feat":   return `add ${name}`;
      case "fix":    return `fix ${name}`;
      case "docs":   return `update ${name} documentation`;
      case "test":   return `add tests for ${name}`;
      case "refactor": return `refactor ${name}`;
      case "perf":   return `improve ${name} performance`;
      case "chore":  return `update ${name}`;
      default:       return `update ${name}`;
    }
  }

  const extensions = [...new Set(files.map((f) => f.split(".").pop() || ""))];
  if (extensions.every((e) => e === "md") || files.every((f) => f.startsWith("docs/") || f.endsWith(".md"))) {
    return "update documentation";
  }
  if (files.every((f) => /\.test\.|\.spec\./.test(f) || f.startsWith("tests/"))) {
    return "add and update tests";
  }
  return `update ${uniqueNames.slice(0, 3).join(", ")}${uniqueNames.length > 3 ? ` and ${uniqueNames.length - 3} more` : ""}`;
}

// ── Git Status Parsing ───────────────────────────────────────────────

export function getGitStatus(cwd: string): ParsedChange[] {
  try {
    const output = execSync("git status --porcelain", { cwd, encoding: "utf-8", stdio: "pipe" });
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3).trim(),
      }));
  } catch {
    return [];
  }
}

export function getDiffStats(cwd: string): string {
  try {
    return execSync("git diff --stat", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

export function doCommit(cwd: string, message: string): { ok: boolean; hash: string; error?: string } {
  try {
    execSync("git add -A", { cwd, stdio: "pipe" });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, stdio: "pipe" });
    const hash = execSync("git rev-parse --short HEAD", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
    return { ok: true, hash };
  } catch (err: any) {
    return { ok: false, hash: "", error: err.message };
  }
}

// ── Grouping Logic ───────────────────────────────────────────────────

export function groupChanges(changes: ParsedChange[]): ChangeGroup[] {
  if (changes.length === 0) return [];

  const groups = new Map<string, ParsedChange[]>();

  for (const change of changes) {
    const path = change.path;
    let key: string;
    if (path.startsWith(".pi/extensions/lemonharness/")) {
      const parts = path.split("/");
      if (parts.length >= 5 && !parts[4].includes(".")) {
        key = `ext-lemonharness-${parts[4]}`;
      } else {
        key = "ext-lemonharness";
      }
    } else if (path.startsWith(".pi/skills/")) {
      const parts = path.split("/");
      const raw = parts[2] || "unknown";
      const skillName = raw.startsWith(".") ? "index" : raw;
      key = `skill-${skillName}`;
    } else if (path.startsWith(".lemonharness/")) {
      const sub = path.split("/")[1] || "harness";
      key = `harness-${sub}`;
    } else if (path.startsWith(".pi/")) {
      key = "pi-config";
    } else if (path.startsWith("tests/") || /\.test\.|\.spec\./.test(path)) {
      key = "tests";
    } else if (path.startsWith("docs/")) {
      key = "docs";
    } else {
      key = "other";
    }

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(change);
  }

  return [...groups.entries()].map(([key, groupChanges]) => {
    const files = groupChanges.map((c) => c.path);
    const type = inferType(files);
    const scope = inferScope(files);
    const description = inferDescription(files, type);
    return { type, scope, files, description };
  });
}

// ── Formatting ───────────────────────────────────────────────────────

export function formatCommitMessage(group: ChangeGroup): string {
  return `${group.type}(${group.scope}): ${group.description}`;
}

export function formatGroupPreview(groups: ChangeGroup[]): string {
  if (groups.length === 0) return "No changes detected.";

  const lines: string[] = [
    "📦 Changes grouped into logical commits:",
    "",
  ];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const msg = formatCommitMessage(g);
    lines.push(`  ${i + 1}. ${msg}`);
    for (const file of g.files) {
      lines.push(`       ${file}`);
    }
    lines.push("");
  }

  lines.push(`Total: ${groups.reduce((s, g) => s + g.files.length, 0)} file(s) across ${groups.length} commit(s)`);
  return lines.join("\n");
}

// ── Auto-merge heuristic ────────────────────────────────────────────

export function shouldMergeAll(groups: ChangeGroup[]): boolean {
  if (groups.length <= 1) return true;
  const types = new Set(groups.map((g) => g.type));
  const scopes = new Set(groups.map((g) => g.scope));
  if (types.size === 1 && scopes.size === 1) return true;
  const totalFiles = groups.reduce((s, g) => s + g.files.length, 0);
  if (totalFiles <= 5) return true;
  return false;
}
