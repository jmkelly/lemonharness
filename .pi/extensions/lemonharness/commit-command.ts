/**
 * LemonHarness /commit Command — Smart Conventional Commits
 *
 * Analyses git status, groups logical changes, infers type + scope
 * from file paths, and generates commit messages in Conventional
 * Commits format: <type>(<scope>): <description>
 *
 * Usage:
 *   /commit              — Show status, group changes, prompt user
 *   /commit "message"    — Commit all changes with given message
 *   /commit -a "msg"     - Stage all + commit with given message
 *
 * Research basis: conventionalcommits.org, engineering-practices skill
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────

interface ChangeGroup {
  type: CommitType;
  scope: string;
  files: string[];
  description: string;
}

type CommitType =
  | "feat" | "fix" | "docs" | "style" | "refactor"
  | "perf" | "test" | "build" | "ci" | "chore" | "revert";

// ── Type Inference ───────────────────────────────────────────────────

const TYPE_RULES: Array<{ test: (path: string) => boolean; type: CommitType }> = [
  { test: (p) => /\.md$/.test(p),                                    type: "docs" },
  { test: (p) => /\.test\.|\.spec\.|tests?\//.test(p),               type: "test" },
  { test: (p) => /\.github\/|ci\/|\.ci\//.test(p),                    type: "ci" },
  { test: (p) => /package\.json|tsconfig|\.eslint|\.prettier|biome\.json|\.nvmrc|\.gitignore/.test(p), type: "chore" },
  { test: (p) => /Dockerfile|docker-compose|Makefile|\.cfg|\.ini/.test(p), type: "build" },
  { test: (p) => /^docs\//.test(p),                                   type: "docs" },
];

function inferType(files: string[]): CommitType {
  for (const rule of TYPE_RULES) {
    if (files.some(rule.test)) return rule.type;
  }
  // If all files are .ts/.js source and contain no new feature indicators, it's refactor
  const allSource = files.every((f) => /\.(ts|js|tsx|jsx)$/.test(f));
  if (allSource && files.length <= 3) return "refactor";
  // If there's a mix and more than a few files, could be feat
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

function inferScope(files: string[]): string {
  // Find the deepest common directory prefix
  const paths = files.filter((f) => !f.startsWith(".lemonharness/memory"));
  for (const [pattern, scope] of SCOPE_MAP) {
    if (paths.some((f) => pattern.test(f))) return scope;
  }
  // Try common parent directory
  const dirs = paths.map((f) => {
    const parts = f.split("/");
    return parts.length > 1 ? parts[0] : "root";
  });
  const uniqueDirs = [...new Set(dirs)];
  return uniqueDirs.length === 1 ? uniqueDirs[0] : "general";
}

// ── Description Generation ───────────────────────────────────────────

function inferDescription(files: string[], type: CommitType): string {
  // Use the most descriptive filename to build a concise description
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

  // Multiple files: describe the category
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

interface ParsedChange {
  status: string;
  path: string;
}

function getGitStatus(cwd: string): ParsedChange[] {
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

function getDiffStats(cwd: string): string {
  try {
    return execSync("git diff --stat", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

function stageAll(cwd: string): boolean {
  try {
    execSync("git add -A", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function doCommit(cwd: string, message: string): { ok: boolean; hash: string; error?: string } {
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

function groupChanges(changes: ParsedChange[]): ChangeGroup[] {
  if (changes.length === 0) return [];

  // Separate by rough category based on path
  const groups = new Map<string, ParsedChange[]>();

  for (const change of changes) {
    const path = change.path;
    // Determine group key from the primary module/subdirectory
    let key: string;
    if (path.startsWith(".pi/extensions/lemonharness/")) {
      const parts = path.split("/");
      // parts = ['.pi', 'extensions', 'lemonharness', ...]
      // If the file is in a subdirectory (5th segment has no dot), use that
      if (parts.length >= 5 && !parts[4].includes(".")) {
        key = `ext-lemonharness-${parts[4]}`;
      } else {
        key = "ext-lemonharness";
      }
    } else if (path.startsWith(".pi/skills/")) {
      // parts = ['.pi', 'skills', ...]
      const parts = path.split("/");
      const raw = parts[2] || "unknown";
      // If the path is directly in skills/ (like .index.md), use the parent
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

function formatCommitMessage(group: ChangeGroup): string {
  return `${group.type}(${group.scope}): ${group.description}`;
}

function formatGroupPreview(groups: ChangeGroup[]): string {
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

function shouldMergeAll(groups: ChangeGroup[]): boolean {
  if (groups.length <= 1) return true;
  // If all groups have the same type and scope, merge
  const types = new Set(groups.map((g) => g.type));
  const scopes = new Set(groups.map((g) => g.scope));
  if (types.size === 1 && scopes.size === 1) return true;
  // If it's just a few files, merge
  const totalFiles = groups.reduce((s, g) => s + g.files.length, 0);
  if (totalFiles <= 5) return true;
  return false;
}

// ── Extension Setup ──────────────────────────────────────────────────

export function setupCommitCommand(pi: ExtensionAPI) {
  pi.registerCommand("commit", {
    description:
      "Smart commit: groups logical changes, infers conventional type+scope, " +
      "generates messages in <type>(<scope>): <description> format. " +
      "Usage: /commit [message]",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;

      // 1. Get current state
      const changes = getGitStatus(cwd);
      if (changes.length === 0) {
        ctx.ui.notify("📭 No changes to commit. Working tree is clean.", "info");
        return;
      }

      // 2. If user provided a message, use it directly
      const userMessage = args.trim();
      if (userMessage) {
        const result = doCommit(cwd, userMessage);
        if (result.ok) {
          ctx.ui.notify(`✅ Committed as \`${result.hash}\`: ${userMessage}`, "info");
        } else {
          ctx.ui.notify(`❌ Commit failed: ${result.error}`, "error");
        }
        return;
      }

      // 3. Group changes logically
      const groups = groupChanges(changes);

      if (groups.length === 0) {
        ctx.ui.notify("📭 No changes to commit.", "info");
        return;
      }

      // 4. Merge decision
      let finalGroups: ChangeGroup[];
      let merged = false;
      if (shouldMergeAll(groups)) {
        // Merge all into one
        const allFiles = groups.flatMap((g) => g.files);
        const type = inferType(allFiles);
        const scope = inferScope(allFiles);
        const description = inferDescription(allFiles, type);
        finalGroups = [{ type, scope, files: allFiles, description }];
        merged = groups.length > 1;
      } else {
        finalGroups = groups;
      }

      // 5. Show preview
      const preview = formatGroupPreview(finalGroups);
      const diffStats = getDiffStats(cwd);
      const fullMessage = finalGroups.map(formatCommitMessage).join("\n");

      const output: string[] = [
        preview,
      ];
      if (diffStats) {
        output.push("", "📊 Diff stats:", diffStats);
      }
      output.push("", "📝 Commit message(s):", fullMessage);

      ctx.ui.notify(output.join("\n"), "info");

      // 6. Prompt to confirm
      const confirmMsg = merged
        ? `✅ Merged ${groups.length} groups into 1 commit. Proceed? (yes/no)`
        : `✅ ${finalGroups.length} commit(s) detected. Proceed? (yes/no)`;

      ctx.ui.notify(confirmMsg, "info");
      ctx.ui.notify("Type /commit yes to confirm, or /commit <custom message>", "info");
    },
  });

  // Register shorthand: /commit yes — confirm and commit
  pi.on("input", (event, ctx) => {
    const text = event.text.trim().toLowerCase();
    if (text === "/commit yes" || text === "/commit y") {
      const cwd = ctx.cwd;
      const changes = getGitStatus(cwd);
      if (changes.length === 0) {
        ctx.ui.notify("📭 No changes to commit.", "info");
        return { action: "handled" as const };
      }

      const groups = groupChanges(changes);
      let finalGroups: ChangeGroup[];
      if (shouldMergeAll(groups)) {
        const allFiles = groups.flatMap((g) => g.files);
        const type = inferType(allFiles);
        const scope = inferScope(allFiles);
        const description = inferDescription(allFiles, type);
        finalGroups = [{ type, scope, files: allFiles, description }];
      } else {
        finalGroups = groups;
      }

      // Commit each group
      let successCount = 0;
      const hashes: string[] = [];
      for (const group of finalGroups) {
        const message = formatCommitMessage(group);
        const result = doCommit(cwd, message);
        if (result.ok) {
          successCount++;
          hashes.push(result.hash);
        } else {
          ctx.ui.notify(`❌ Commit failed: ${result.error}`, "error");
        }
      }

      if (successCount > 0) {
        ctx.ui.notify(
          `✅ ${successCount}/${finalGroups.length} commit(s) created: ${hashes.join(", ")}`,
          "info",
        );
      }
      return { action: "handled" as const };
    }
    return { action: "continue" as const };
  });
}
