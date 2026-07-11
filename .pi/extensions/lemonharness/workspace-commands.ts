/**
 * LemonHarness Workspace Commands - extracted from workspace.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join, resolve } from "node:path";
import { spawn, execSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  WorkspaceManager, TimeDirector, ExecutionLogger,
  ContextBudgetTracker, SnapshotManager, SnapshotFileChange,
  formatDuration,
} from "./workspace-core";

export function setupWorkspaceCommands(
  pi: ExtensionAPI,
  workspaceManager: WorkspaceManager,
  timeDirector: TimeDirector,
  executionLogger: ExecutionLogger,
  contextBudgetTracker: ContextBudgetTracker,
  snapshotManager: SnapshotManager,
  healthChecker: any | null,
) {

  pi.registerCommand("lemonharness:status", {
    description: "Show current workspace state, phase, and budget usage",
    handler: async (_args, ctx) => {
      const ws = workspaceManager;
      const phase = timeDirector.getCurrentPhase();
      const trail = executionLogger.getExecutionTrail();
      const totalCalls = trail.length;
      const errors = trail.filter((t: any) => t.isError).length;
      const validations = trail.filter((t: any) => t.validationName).length;
      const passedValidations = trail.filter((t: any) => t.passed).length;
      const regressions = executionLogger.detectRegression();
      const decisionAdvantage = timeDirector.getDecisionAdvantageDecay();
      const confidenceEntries = trail.filter((e: any) => e.type === "confidence" && e.confidence);
      const avgScore = confidenceEntries.length > 0
        ? (confidenceEntries.reduce((sum: number, e: any) => sum + e.confidence!.score, 0) / confidenceEntries.length).toFixed(1)
        : "N/A";
      const lowConfItems = confidenceEntries.filter((e: any) => e.confidence!.flagForReview);

      const lines = [
        "🍋 LemonHarness Status", "───────────────────────", "",
        `📁 Workspace: ${ws.formatState()}`, "",
        `⏱ Phase: ${phase.phase.toUpperCase()} (${Math.round(phase.totalProgress * 100)}% of budget)`,
        `   Elapsed: ${formatDuration(phase.elapsedMs)} / Remaining: ${formatDuration(phase.remainingMs)}`,
        `   Decision advantage: ${(decisionAdvantage * 100).toFixed(0)}% (decay = exp(-0.3 * ${timeDirector.getPhaseCheckpoints().length} checkpoints))`,
        "", `📊 Tool calls: ${totalCalls} | Errors: ${errors} | Validations: ${validations} (${passedValidations} passed)`,
        regressions ? `⚠ Regression: ${regressions}` : "✓ No regressions detected", "",
        `📊 Confidence: ${confidenceEntries.length} recorded | Avg: ${avgScore}/5 | Flagged: ${lowConfItems.length}`,
      ];
      if (lowConfItems.length > 0) {
        lines.push("", "🔔 Items flagged for human review (confidence < 3):");
        for (const entry of lowConfItems) lines.push(`   ⚠ ${entry.toolName || "unknown"}: ${entry.confidence!.rationale.slice(0, 80)}`);
      }
      const checkpoints = timeDirector.getPhaseCheckpoints();
      if (checkpoints.length > 0) {
        lines.push("", "📍 Phase Checkpoints:");
        for (const cp of checkpoints) lines.push(`   ${cp.phase} at ${Math.round(cp.elapsedMs / 1000)}s (DA: ${(cp.decisionAdvantage * 100).toFixed(0)}%)`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("lemonharness:context", {
    description: "Show context budget estimation",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      ctx.ui.notify(contextBudgetTracker.formatStatus(contextBudgetTracker.getContextStatus(trail)), "info");
    },
  });

  pi.registerCommand("lemonharness:budget", {
    description: "Set time budget. Usage: /lemonharness:budget <seconds>",
    handler: async (args, ctx) => {
      const seconds = parseInt(args.trim(), 10);
      if (isNaN(seconds) || seconds <= 0) { ctx.ui.notify("Provide a valid number of seconds.", "error"); return; }
      timeDirector.setBudget(seconds * 1000);
      timeDirector.start();
      ctx.ui.notify(`🍋 Time budget set to ${formatDuration(seconds * 1000)}`, "info");
    },
  });

  pi.registerCommand("lemonharness:reset", {
    description: "Reset workspace tracking",
    handler: async (_args, ctx) => {
      workspaceManager.reset();
      timeDirector.start();
      executionLogger.getExecutionTrail().length = 0;
      ctx.ui.notify("🍋 Workspace and time tracking reset", "info");
    },
  });

  pi.registerCommand("lemonharness:health", {
    description: "Show health check status",
    handler: async (_args, ctx) => {
      if (!healthChecker) { ctx.ui.notify("Health checker not available", "warning"); return; }
      ctx.ui.notify(healthChecker.getStatus(), "info");
    },
  });

  pi.registerCommand("lemonharness:validate", {
    description: "Run validation command. Usage: /lemonharness:validate <command>",
    handler: async (args, ctx) => {
      const cmd = args.trim();
      if (!cmd) { ctx.ui.notify("Provide a command.", "error"); return; }
      ctx.ui.notify(`🍋 Running validation: ${cmd.slice(0, 80)}`, "info");
      try {
        const proc = spawn("bash", ["-c", cmd], { cwd: workspaceManager.getProjectRoot(), stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("close", (code) => {
          const output = stdout + stderr;
          const passed = code === 0;
          executionLogger.logValidation(cmd.slice(0, 60), cmd, passed, output.slice(0, 500));
          ctx.ui.notify(passed ? `✅ Passed\n${output.slice(0, 1000)}` : `❌ Failed (exit ${code})\n${output.slice(0, 1000)}`, passed ? "info" : "error");
        });
      } catch (e: any) { ctx.ui.notify(`❌ Validation error: ${e.message}`, "error"); }
    },
  });

  pi.registerCommand("lemonharness:confidence", {
    description: "Show confidence scores",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const confidenceEntries = trail.filter((e: any) => e.type === "confidence" && e.confidence);
      if (confidenceEntries.length === 0) {
        ctx.ui.notify("No confidence scores recorded yet.", "info");
        return;
      }
      const lines: string[] = ["📊 Confidence Scores", "─────────────────────"];
      const flagged: string[] = [];
      for (const entry of confidenceEntries) {
        const c = entry.confidence!;
        const label: Record<number, string> = { 1: "🔴 Very Low", 2: "🟠 Low", 3: "🟡 Medium", 4: "🟢 High", 5: "🟢 Very High" };
        lines.push(`\n${label[c.score] || "⚪ Unknown"} (${c.score}/5) ${"★".repeat(c.score)}${"☆".repeat(5 - c.score)}`);
        lines.push(`   Tool: ${entry.toolName || "unknown"}`);
        lines.push(`   Rationale: ${c.rationale}`);
        if (c.flagForReview) { lines.push(`   ⚠ FLAGGED FOR REVIEW`); flagged.push(entry.toolName || "unknown"); }
      }
      lines.push("", "─────────────────────", `Total: ${confidenceEntries.length} | Flagged: ${flagged.length}`);
      if (flagged.length > 0) {
        lines.push("", "🔔 Items needing human review:");
        for (const name of flagged) lines.push(`   ⚠ ${name}`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // Improvement commands
  pi.registerCommand("improvement:reflect", {
    description: "Run structured self-reflection",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const recentTurns = trail.slice(-6);
      const lines = [
        "🌀 Self-Reflection", "─────────────────", "",
        "Step back and consider:", "",
        "1️⃣  What has happened recently?",
        ...recentTurns.map((t: any) => { const icon = t.isError ? "✗" : "✓"; return `   ${icon} ${t.toolName || t.validationName}: ${typeof t.args === "object" ? JSON.stringify(t.args).slice(0, 80) : t.args}`; }),
        "", "2️⃣  What worked well?", "   (Consider recording as solution/pattern)", "",
        "3️⃣  What didn't work?", "   (Consider recording as failure with root cause)", "",
        "4️⃣  What should I do differently going forward?", "   (Consider recording as insight, tag: self-improvement)", "",
        "5️⃣  Is there a process I should automate or change?", "",
        "Use `workspace_memory_record` to save lessons.",
        "Use `workspace_memory_search` to find past lessons.",
      ];
      try {
        const mod = await import("./subsystems");
        const hm = new mod.HeuristicManager(workspaceManager.getWorkspaceDir());
        await hm.init();
        const extracted: string[] = [];
        for (const t of recentTurns) {
          if (t.isError) {
            const h = hm.extractHeuristic("failure", `${t.toolName} failed`, JSON.stringify(t.args || ""), "general");
            if (h) extracted.push(`• "${h.rule}" (${h.type}, confidence: ${h.confidence.toFixed(2)})`);
          }
        }
        if (extracted.length > 0) {
          lines.push("", "🧪 Extracted Heuristics (ERL):");
          lines.push(...extracted);
          lines.push("", `${extracted.length} heuristic(s) saved. Use /lemonharness:heuristics to view all.`);
        }
      } catch (e) { console.error("Workspace: operation failed", e); }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("improvement:review", {
    description: "Review improvement history",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const totalCalls = trail.length;
      const errors = trail.filter((t: any) => t.isError).length;
      const validations = trail.filter((t: any) => t.validationName).length;
      const passedValidations = trail.filter((t: any) => t.passed).length;
      const lines = [
        "📈 Self-Improvement Review", "──────────────────────────",
        "", `Session stats: ${totalCalls} tool calls, ${errors} errors, ${validations} validations`,
        errors > 0 ? `⚠  ${errors} errors detected — review with /improvement:reflect` : "✓ No errors",
        validations > 0 ? `✓ ${passedValidations}/${validations} validations passed` : "ℹ No validations run",
        "", "📋 Checklist:", "",
        "  [ ] Record failures with root cause analysis?",
        "  [ ] Identify patterns to automate?",
        "  [ ] Search memory for relevant past experience?",
        "  [ ] Apply lessons from previous sessions?",
        "  [ ] Run workspace_memory_distill?",
        "", '💡 Tip: Record lessons with workspace_memory_record tags="self-improvement"',
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("improvement:status", {
    description: "Show self-improvement metrics",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const totalCalls = trail.length;
      const errorRate = totalCalls > 0 ? Math.round((trail.filter((t: any) => t.isError).length / totalCalls) * 100) : 0;
      const lines = [
        "🌀 Self-Improvement Status", "──────────────────────────",
        "", `📊 Tool calls: ${totalCalls}  |  Error rate: ${errorRate}%`,
        "", "📋 Rules:", "",
        "  1. Every failure is a learning opportunity",
        "  2. Detect suboptimal patterns proactively",
        "  3. Track improvements with tags=self-improvement",
        "  4. Stop at <5% gain (diminishing returns)",
        "  5. Codify improvements into process changes",
        "  6. Conduct regular self-reviews",
        "  7. Track improvement velocity across sessions",
        "  8. Make improvements portable",
        "  9. Treat user corrections as gold",
        " 10. Self-correct in real-time",
        "", '💡 Use /improvement:reflect', 'See .pi/skills/self-improvement/SKILL.md',
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // Snapshot commands
  pi.registerCommand("lemonharness:snapshot", {
    description: "Create manual snapshot. Usage: /lemonharness:snapshot [description]",
    handler: async (args, ctx) => {
      const state = workspaceManager.getWorkspaceState();
      const files = state.files;
      if (files.length === 0) { ctx.ui.notify("No files tracked yet.", "warning"); return; }
      const desc = args.trim() || `Manual snapshot at ${new Date().toLocaleString()}`;
      const snapshotId = `manual-${Date.now()}`;
      const changedFiles: SnapshotFileChange[] = [];
      for (const file of files) {
        const absPath = resolve(workspaceManager.getProjectRoot(), file.path);
        try {
          const content = await readFile(absPath, "utf-8");
          changedFiles.push({ path: file.path, oldContent: null, newContent: content, action: "modify" });
        } catch { changedFiles.push({ path: file.path, oldContent: null, newContent: null, action: "delete" }); }
      }
      try {
        const meta = await snapshotManager.createSnapshot(snapshotId, desc, changedFiles);
        ctx.ui.notify(`📸 Snapshot: ${snapshotId} — ${desc} (${meta.files?.length ?? 0} files)`, "info");
      } catch (e: any) { ctx.ui.notify(`❌ Snapshot failed: ${e.message}`, "error"); }
    },
  });

  pi.registerCommand("lemonharness:snapshots", {
    description: "List available snapshots",
    handler: async (_args, ctx) => {
      try {
        const snapshots = await snapshotManager.listSnapshots();
        if (snapshots.length === 0) { ctx.ui.notify("No snapshots available.", "info"); return; }
        const lines = ["📸 Available Snapshots", "─────────────────────"];
        for (const snap of snapshots) { lines.push(""); lines.push(snapshotManager.formatSnapshotList(snap)); }
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (e: any) { ctx.ui.notify(`❌ Failed: ${e.message}`, "error"); }
    },
  });

  pi.registerCommand("lemonharness:rollback", {
    description: "Restore workspace to snapshot. Usage: /lemonharness:rollback <id>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) {
        const snapshots = await snapshotManager.listSnapshots();
        if (snapshots.length === 0) { ctx.ui.notify("No snapshots available.", "error"); return; }
        ctx.ui.notify(`Usage: /lemonharness:rollback <id>\nAvailable: ${snapshots.map((s: any) => s.id).join(", ")}`, "info");
        return;
      }
      ctx.ui.notify(`🔄 Restoring "${id}"...`, "info");
      try {
        const result = await snapshotManager.restoreSnapshot(id, workspaceManager.getProjectRoot());
        const lines = [`🔄 Rollback complete for "${id}":`, `   Restored: ${result.restored.length} file(s)`];
        for (const r of result.restored) lines.push(`     ✓ ${r}`);
        if (result.errors.length > 0) {
          lines.push(`   Errors: ${result.errors.length}`);
          for (const e of result.errors) lines.push(`     ✗ ${e}`);
        }
        ctx.ui.notify(lines.join("\n"), result.errors.length === 0 ? "info" : "warning");
      } catch (e: any) { ctx.ui.notify(`❌ Rollback failed: ${e.message}`, "error"); }
    },
  });
}
