/**
 * LemonHarness Live Documentation Generator
 *
 * Generates structured session summaries at session end or on demand.
 * Captures task description, key decisions, files, validations, heuristics,
 * phase/budget utilization, and confidence estimates.
 *
 * Provides:
 *   - SessionSummary class with generate/save/history
 *   - /lemonharness:summary command (on-demand)
 *   - /lemonharness:history command (cross-session)
 *   - Auto-generation hook for P4 (reserve) entry
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join, dirname } from "node:path";
import { mkdir, readFile, readdir, writeFile, stat as fsStat } from "node:fs/promises";
import { existsSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface SummaryData {
  /** Session identifier (ISO timestamp-based) */
  sessionId: string;
  /** When the summary was generated */
  generatedAt: number;
  /** Task description (from initial prompt) */
  taskDescription: string;
  /** Phase information */
  phases: {
    current: string;
    totalBudgetMs: number;
    elapsedMs: number;
    totalProgress: number;
    phaseProgress: number;
    phaseDurations: Record<string, number>;
    checkpoints: Array<{ phase: string; timestamp: number; elapsedMs: number }>;
  };
  /** Workspace file changes */
  files: Array<{ path: string; action: string; timestamp: number }>;
  /** Validation runs */
  validations: Array<{
    name: string;
    command: string;
    passed: boolean;
    output: string;
    timestamp: number;
  }>;
  /** ERL heuristics */
  heuristics: Array<{
    rule: string;
    domain: string;
    type: string;
    confidence: number;
    successCount: number;
    failureCount: number;
  }>;
  /** Tool call statistics */
  toolStats: {
    totalCalls: number;
    totalErrors: number;
    consecutiveErrors: number;
    toolCounts: Record<string, number>;
    errorCounts: Record<string, number>;
  };
  /** Harness evaluation metrics */
  harnessMetrics: Record<string, number | string> | null;
  /** Cross-session metrics */
  crossSessionMetrics: Record<string, unknown> | null;
  /** Confidence estimates derived from data */
  confidence: {
    overall: number;
    validationPassRate: number;
    heuristicConfidence: number;
    errorRate: number;
    decisionAdvantage: number;
    regressionFree: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Session Summary Class
// ─────────────────────────────────────────────────────────────────────────

export class SessionSummary {
  private workspaceDir: string;
  private summaryDir: string;
  private archiveDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    this.summaryDir = workspaceDir; // .lemonharness
    this.archiveDir = join(workspaceDir, "summaries");
  }

  /**
   * Generate a structured markdown summary from session data.
   * Takes raw data objects and produces human+agent readable markdown.
   */
  generateMarkdown(data: SummaryData): string {
    const lines: string[] = [];
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const fmtDur = (ms: number): string => {
      const totalSec = Math.round(ms / 1000);
      if (totalSec < 60) return `${totalSec}s`;
      return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
    };
    const fmtDate = (ts: number): string => new Date(ts).toISOString();

    // ── Header ──────────────────────────────────────────────────────
    lines.push("# 🍋 LemonHarness Session Summary");
    lines.push("");
    lines.push(`**Session ID**: \`${data.sessionId}\``);
    lines.push(`**Generated**: ${fmtDate(data.generatedAt)}`);
    lines.push(`**Final Phase**: ${data.phases.current.toUpperCase()}`);
    lines.push("");

    // ── Task Description ────────────────────────────────────────────
    lines.push("## 📋 Task Description");
    lines.push("");
    if (data.taskDescription) {
      // Truncate to first 500 chars for readability
      const desc = data.taskDescription.length > 500
        ? data.taskDescription.slice(0, 500) + "..."
        : data.taskDescription;
      lines.push(desc);
    } else {
      lines.push("*No task description recorded.*");
    }
    lines.push("");

    // ── Phases & Budget Utilization ─────────────────────────────────
    lines.push("## ⏱ Phases & Budget Utilization");
    lines.push("");
    const budgetTotal = data.phases.totalBudgetMs;
    const budgetElapsed = data.phases.elapsedMs;
    const phaseNames: Record<string, string> = {
      explore: "Explore (P1)",
      implement: "Implement (P2)",
      validate: "Validate (P3)",
      reserve: "Reserve (P4)",
    };
    const phaseOrder = ["explore", "implement", "validate", "reserve"];

    // Build phase timing table from checkpoints
    const checkpoints = data.phases.checkpoints;
    const phaseDurations = data.phases.phaseDurations;

    lines.push("| Phase | Duration | Budget % |");
    lines.push("|-------|----------|----------|");
    for (const phase of phaseOrder) {
      const durMs = phaseDurations[phase] || 0;
      const durStr = durMs > 0 ? fmtDur(durMs) : "—";
      const budgetPct = budgetTotal > 0 ? ((durMs / budgetTotal) * 100).toFixed(0) + "%" : "—";
      const label = phaseNames[phase] || phase;
      lines.push(`| **${label}** | ${durStr} | ${budgetPct} |`);
    }
    lines.push(`| **Total** | **${fmtDur(budgetElapsed)}** | **${(data.phases.totalProgress * 100).toFixed(0)}%** |`);
    lines.push("");

    // Additional budget info
    lines.push(`- **Total Budget**: ${fmtDur(budgetTotal)}`);
    lines.push(`- **Elapsed**: ${fmtDur(budgetElapsed)}`);
    lines.push(`- **Utilization**: ${(data.phases.totalProgress * 100).toFixed(0)}%`);
    if (checkpoints.length > 0) {
      lines.push(`- **Phase Transitions**: ${checkpoints.map(c => c.phase).join(" → ")}`);
    }
    lines.push("");

    // ── Files Created/Modified ──────────────────────────────────────
    lines.push("## 📁 Files Created/Modified");
    lines.push("");
    if (data.files.length === 0) {
      lines.push("*No files tracked this session.*");
    } else {
      lines.push(`Total: **${data.files.length}** files`);
      lines.push("");
      lines.push("| Action | File |");
      lines.push("|--------|------|");
      const sorted = [...data.files].sort((a, b) => a.timestamp - b.timestamp);
      for (const f of sorted) {
        const icon = f.action === "create" ? "➕ Create" : f.action === "delete" ? "➖ Delete" : "✏️ Modify";
        lines.push(`| ${icon} | \`${f.path}\` |`);
      }
    }
    lines.push("");

    // ── Validations Run ─────────────────────────────────────────────
    lines.push("## ✅ Validations Run");
    lines.push("");
    if (data.validations.length === 0) {
      lines.push("*No validations recorded this session.*");
    } else {
      const passed = data.validations.filter(v => v.passed).length;
      const failed = data.validations.filter(v => !v.passed).length;
      lines.push(`Total: **${data.validations.length}** (${passed} ✅ passed, ${failed} ❌ failed)`);
      lines.push("");

      // Show each validation
      for (let i = 0; i < data.validations.length; i++) {
        const v = data.validations[i];
        const icon = v.passed ? "✅" : "❌";
        const cmdShort = v.command.length > 80 ? v.command.slice(0, 80) + "..." : v.command;
        lines.push(`${i + 1}. ${icon} \`${cmdShort}\``);
        if (v.output) {
          const outPreview = v.output.slice(0, 200);
          lines.push(`   ${outPreview}${v.output.length > 200 ? "..." : ""}`);
        }
      }
    }
    lines.push("");

    // ── ERL Heuristics Captured ─────────────────────────────────────
    lines.push("## 🧪 ERL Heuristics Captured");
    lines.push("");
    if (data.heuristics.length === 0) {
      lines.push("*No heuristics captured this session.*");
    } else {
      lines.push(`Total: **${data.heuristics.length}** heuristics`);
      lines.push("");
      lines.push("| # | Rule | Type | Domain | Confidence | Success |");
      lines.push("|---|------|------|--------|------------|---------|");
      const sortedH = [...data.heuristics].sort((a, b) => b.confidence - a.confidence);
      for (let i = 0; i < sortedH.length; i++) {
        const h = sortedH[i];
        const ruleShort = h.rule.length > 60 ? h.rule.slice(0, 60) + "..." : h.rule;
        lines.push(`| ${i + 1} | "${ruleShort}" | ${h.type} | ${h.domain} | ${(h.confidence * 100).toFixed(0)}% | ${h.successCount}/${h.successCount + h.failureCount} |`);
      }
    }
    lines.push("");

    // ── Tool Call Statistics ────────────────────────────────────────
    lines.push("## 📊 Tool Call Statistics");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Tool Calls | ${data.toolStats.totalCalls} |`);
    lines.push(`| Total Errors | ${data.toolStats.totalErrors} |`);
    lines.push(`| Error Rate | ${data.toolStats.totalCalls > 0 ? ((data.toolStats.totalErrors / data.toolStats.totalCalls) * 100).toFixed(1) : "0.0"}% |`);
    lines.push(`| Consecutive Errors (peak) | ${data.toolStats.consecutiveErrors} |`);

    // Tool breakdown
    const toolNames = Object.keys(data.toolStats.toolCounts).sort();
    if (toolNames.length > 0) {
      lines.push("");
      lines.push("**By tool:**");
      for (const name of toolNames) {
        const count = data.toolStats.toolCounts[name];
        const errCount = data.toolStats.errorCounts[name] || 0;
        const errMark = errCount > 0 ? ` (${errCount} ❌)` : "";
        lines.push(`- \`${name}\`: ${count} calls${errMark}`);
      }
    }
    lines.push("");

    // ── Harness Metrics ─────────────────────────────────────────────
    if (data.harnessMetrics) {
      lines.push("## 🔬 Harness Evaluation Metrics");
      lines.push("");
      lines.push("| Metric | Value |");
      lines.push("|--------|-------|");
      for (const [key, val] of Object.entries(data.harnessMetrics)) {
        const label = key
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, s => s.toUpperCase())
          .trim();
        const formatted = typeof val === "number"
          ? key.includes("Rate") || key.includes("completeness") || key.includes("efficiency")
            ? `${(val * 100).toFixed(0)}%`
            : String(val)
          : String(val);
        lines.push(`| ${label} | ${formatted} |`);
      }
      lines.push("");
    }

    // ── Confidence Estimates ────────────────────────────────────────
    lines.push("## 🎯 Confidence Estimates");
    lines.push("");
    const conf = data.confidence;
    lines.push("| Factor | Score | Interpretation |");
    lines.push("|--------|-------|----------------|");
    lines.push(`| Overall Confidence | **${(conf.overall * 100).toFixed(0)}%** | ${this.confidenceLabel(conf.overall)} |`);
    lines.push(`| Validation Pass Rate | ${(conf.validationPassRate * 100).toFixed(0)}% | ${conf.validationPassRate >= 0.8 ? "Good reliability" : conf.validationPassRate >= 0.5 ? "Moderate reliability" : "Low reliability"} |`);
    lines.push(`| Heuristic Confidence | ${(conf.heuristicConfidence * 100).toFixed(0)}% | ${conf.heuristicConfidence >= 0.5 ? "Established patterns" : "Emerging patterns"} |`);
    lines.push(`| Error Rate (inverse) | ${((1 - conf.errorRate) * 100).toFixed(0)}% | ${conf.errorRate < 0.2 ? "Low error rate" : conf.errorRate < 0.5 ? "Moderate errors" : "High error rate"} |`);
    lines.push(`| Decision Advantage | ${(conf.decisionAdvantage * 100).toFixed(0)}% | Decay from ${data.phases.checkpoints.length} checkpoint(s) |`);
    lines.push(`| Regression-Free | ${conf.regressionFree ? "✅ Yes" : "⚠️ No"} | ${conf.regressionFree ? "No regression pattern detected" : "Regression(s) detected"} |`);

    // Overall assessment
    lines.push("");
    const overallLabel = conf.overall >= 0.7 ? "🟢 Good Confidence" : conf.overall >= 0.4 ? "🟡 Moderate Confidence" : "🔴 Low Confidence";
    lines.push(`**Overall Assessment**: ${overallLabel} — ${this.overallAssessment(conf)}`);
    lines.push("");

    // ── Footer ──────────────────────────────────────────────────────
    lines.push("---");
    lines.push(`*Generated by LemonHarness Live Documentation Generator at ${fmtDate(data.generatedAt)}*`);
    lines.push("*This summary can be used as context for future sessions.*");

    return lines.join("\n");
  }

  /**
   * Save a summary to disk. Saves both as the current session-summary.md
   * and archives it in the summaries/ subdirectory.
   */
  async saveSummary(content: string): Promise<string> {
    await mkdir(this.summaryDir, { recursive: true });

    // Save as current
    const currentPath = join(this.summaryDir, "session-summary.md");
    await writeFile(currentPath, content, "utf-8");

    // Archive with timestamp
    await mkdir(this.archiveDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = join(this.archiveDir, `summary-${timestamp}.md`);
    await writeFile(archivePath, content, "utf-8");

    return currentPath;
  }

  /**
   * List all archived session summaries, newest first.
   * Returns metadata: filename, timestamp, first line summary.
   */
  async getHistory(): Promise<Array<{ filename: string; timestamp: string; preview: string }>> {
    try {
      await mkdir(this.archiveDir, { recursive: true });
      const entries = await readdir(this.archiveDir);
      const summaryFiles = entries
        .filter(f => f.startsWith("summary-") && f.endsWith(".md"))
        .sort()
        .reverse();

      const results: Array<{ filename: string; timestamp: string; preview: string }> = [];
      for (const file of summaryFiles) {
        try {
          const content = await readFile(join(this.archiveDir, file), "utf-8");
          const lines = content.split("\n");
          // Extract title and date for preview
          const titleLine = lines.find(l => l.startsWith("# ")) || "";
          const dateLine = lines.find(l => l.startsWith("**Generated**")) || "";
          const taskStart = content.indexOf("## 📋 Task Description");
          let preview = "";
          if (taskStart >= 0) {
            const taskSection = content.slice(taskStart + 23, taskStart + 300).trim();
            preview = taskSection.split("\n").filter(l => l && !l.startsWith("##"))[0] || "";
            if (preview.length > 100) preview = preview.slice(0, 100) + "...";
          }
          results.push({
            filename: file,
            timestamp: dateLine.replace("**Generated**: ", "").replace("**", ""),
            preview: titleLine.replace("# ", "").trim() || file,
          });
        } catch (err) {
          console.error(`🍋 Summary: failed to parse ${file}:`, err instanceof Error ? err.message : err);
          results.push({ filename: file, timestamp: "unknown", preview: "(unreadable)" });
        }
      }
      return results;
    } catch (err) {
      console.error(`🍋 Summary: failed to read history directory:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * Load a specific archived summary by filename.
   */
  async loadSummary(filename: string): Promise<string | null> {
    try {
      return await readFile(join(this.archiveDir, filename), "utf-8");
    } catch (err) {
      console.error(`🍋 Summary: failed to load ${filename}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private confidenceLabel(score: number): string {
    if (score >= 0.9) return "Very high confidence";
    if (score >= 0.7) return "High confidence";
    if (score >= 0.5) return "Moderate confidence";
    if (score >= 0.3) return "Low confidence";
    return "Very low confidence";
  }

  private overallAssessment(conf: SummaryData["confidence"]): string {
    const factors: string[] = [];
    if (conf.validationPassRate >= 0.8) factors.push("high validation pass rate");
    else if (conf.validationPassRate < 0.5) factors.push("low validation pass rate");

    if (conf.errorRate < 0.2) factors.push("low error rate");
    else if (conf.errorRate >= 0.5) factors.push("high error rate");

    if (conf.heuristicConfidence >= 0.5) factors.push("established heuristic patterns");
    if (conf.decisionAdvantage > 0.5) factors.push("strong decision advantage");
    if (conf.regressionFree) factors.push("no regressions");

    if (factors.length === 0) return "Insufficient data for qualitative assessment.";
    return factors.join("; ") + ".";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Extension Export
// ─────────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const sessionSummaries: SessionSummary[] = [];
  let currentSummary: SessionSummary | null = null;

  pi.on("session_start", async (_event, ctx) => {
    const workspaceDir = join(ctx.cwd, ".lemonharness");
    currentSummary = new SessionSummary(workspaceDir);
    sessionSummaries.push(currentSummary);
    ctx.ui.setStatus("lemonharness-summary", "📝 Live documentation active");
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("lemonharness-summary", undefined);
  });

  // ── /lemonharness:summary — Generate on-demand summary ───────────
  //
  // NOTE: Auto-generation on P4 entry is handled by the workspace extension
  // (lemonharness-workspace.ts) which calls buildSummaryFromLiveDataExternal().
  // This command provides manual trigger.

  pi.registerCommand("lemonharness:summary", {
    description: "Generate a structured session summary markdown document",
    handler: async (_args, ctx) => {
      try {
        const wsMod = await import("./lemonharness-workspace");
        const summary = currentSummary || new SessionSummary(join(ctx.cwd, ".lemonharness"));

        const markdown = await buildSummaryFromSingletons(
          summary,
          wsMod.workspaceManager,
          wsMod.timeDirector,
          wsMod.executionLogger,
          ctx,
          wsMod.sessionPromptDescription || "",
        );
        const path = await summary.saveSummary(markdown);

        ctx.ui.notify(
          `📝 Session summary generated\n\n${markdown.slice(0, 3000)}${markdown.length > 3000 ? "\n\n...(truncated, see file for full document)" : ""}\n\n---\nSaved to: \`${path}\``,
          "info",
        );
      } catch (err: any) {
        ctx.ui.notify(`⚠️ Failed to generate summary: ${err.message}`, "error");
      }
    },
  });

  // ── /lemonharness:history — Show past summaries ──────────────────

  pi.registerCommand("lemonharness:history", {
    description: "List past session summaries available for review",
    handler: async (_args, ctx) => {
      try {
        const workspaceDir = join(ctx.cwd, ".lemonharness");
        const summary = new SessionSummary(workspaceDir);
        const history = await summary.getHistory();

        if (history.length === 0) {
          ctx.ui.notify("📚 No past session summaries found. Generate one with `/lemonharness:summary`.", "info");
          return;
        }

        const lines = [
          "📚 Session Summary History",
          "──────────────────────────",
          "",
          `Found **${history.length}** past session summary/summaries:`,
          "",
        ];

        for (let i = 0; i < Math.min(history.length, 20); i++) {
          const h = history[i];
          const dateDisplay = h.timestamp !== "unknown"
            ? new Date(h.timestamp).toLocaleString()
            : "unknown date";
          lines.push(`${i + 1}. **${h.preview}** — ${dateDisplay}`);
          lines.push(`   \`/lemonharness:summary\` to generate a new one.`);
        }

        if (history.length > 20) {
          lines.push(`\n... and ${history.length - 20} more.`);
        }

        lines.push("", "💡 Each summary is archived in \`.lemonharness/summaries/\`.");

        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err: any) {
        ctx.ui.notify(`⚠️ Failed to load history: ${err.message}`, "error");
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Data Collection Helper
// ─────────────────────────────────────────────────────────────────────────

/**
 * External version for use by the workspace extension.
 * Takes individual singletons directly instead of requiring the module.
 * Also used by the /lemonharness:summary command.
 */
export async function buildSummaryFromLiveDataExternal(
  summary: SessionSummary,
  workspaceManager: import("./lemonharness-workspace").WorkspaceManager,
  timeDirector: import("./lemonharness-workspace").TimeDirector,
  executionLogger: import("./lemonharness-workspace").ExecutionLogger,
  ctx: { sessionManager?: { getSessionFile?: () => string } },
  taskDescription: string,
): Promise<string> {
  return buildSummaryFromSingletons(
    summary, workspaceManager, timeDirector, executionLogger, ctx, taskDescription,
  );
}

/**
 * Core implementation that takes singletons directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildSummaryFromSingletons(
  summary: SessionSummary,
  workspaceManager: import("./lemonharness-workspace").WorkspaceManager,
  timeDirector: import("./lemonharness-workspace").TimeDirector,
  executionLogger: import("./lemonharness-workspace").ExecutionLogger,
  ctx: any,
  externalTaskDescription: string,
): Promise<string> {
  // 1. Gather session data from singletons
  const wsState = workspaceManager.getWorkspaceState();
  const phase = timeDirector.getCurrentPhase();
  const trail = executionLogger.getExecutionTrail();
  const checkpoints = timeDirector.getPhaseCheckpoints();
  const consecutiveErrors = executionLogger.getConsecutiveErrors();

  // 2. Compute phase durations from checkpoints
  const phaseDurations: Record<string, number> = {};
  const phaseOrder = ["explore", "implement", "validate", "reserve"];
  if (checkpoints.length > 0) {
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const prevTime = i > 0 ? checkpoints[i - 1].timestamp : 0;
      // The phase duration is from the last checkpoint to this one
      const dur = i === 0
        ? cp.elapsedMs  // first checkpoint: time from start
        : cp.timestamp - checkpoints[i - 1].timestamp;
      phaseDurations[cp.phase] = dur;
    }
    // Estimate remaining phase duration for the current phase
    const currentPhase = phase.phase;
    if (!phaseDurations[currentPhase]) {
      const lastCp = checkpoints[checkpoints.length - 1];
      phaseDurations[currentPhase] = phase.elapsedMs - lastCp.elapsedMs;
    }
  } else {
    // No checkpoints — all time is in current phase
    phaseDurations[phase.phase] = phase.elapsedMs;
  }

  // Default durations for phases not visited
  for (const p of phaseOrder) {
    if (!phaseDurations[p]) phaseDurations[p] = 0;
  }

  // 3. Compute tool statistics
  const toolCounts: Record<string, number> = {};
  const errorCounts: Record<string, number> = {};
  let totalErrors = 0;
  for (const entry of trail) {
    const name = entry.toolName || entry.validationName || "unknown";
    toolCounts[name] = (toolCounts[name] || 0) + 1;
    if (entry.isError) {
      errorCounts[name] = (errorCounts[name] || 0) + 1;
      totalErrors++;
    }
  }

  // 4. Extract validations
  const validations = trail
    .filter((e): e is any => e.type === "validation")
    .map(e => ({
      name: e.validationName || e.command?.slice(0, 60) || "validation",
      command: e.command || "",
      passed: e.passed || false,
      output: e.output || "",
      timestamp: e.timestamp,
    }));

  // 5. Read heuristics from disk
  let heuristics: Array<{
    rule: string;
    domain: string;
    type: string;
    confidence: number;
    successCount: number;
    failureCount: number;
  }> = [];
  try {
    const subsystemsMod = await import("./lemonharness-subsystems");
    const hm = new subsystemsMod.HeuristicManager(workspaceManager.getWorkspaceDir());
    await hm.init();
    const allH = hm.getAllHeuristics();
    heuristics = allH.map(h => ({
      rule: h.rule,
      domain: h.domain,
      type: h.type,
      confidence: h.confidence,
      successCount: h.successCount,
      failureCount: h.failureCount,
    }));
  } catch (err) {
    console.error(`🍋 Summary: heuristics unavailable:`, err instanceof Error ? err.message : err);
  }

  // 6. Read harness metrics from disk
  let harnessMetrics: Record<string, number | string> | null = null;
  try {
    const subsystemsMod = await import("./lemonharness-subsystems");
    const metricsRecorder = new subsystemsMod.MetricsRecorder(workspaceManager.getWorkspaceDir());
    await metricsRecorder.init();
    const hm = metricsRecorder.getHarnessMetrics();
    harnessMetrics = hm as unknown as Record<string, number | string>;
  } catch (err) {
    console.error(`🍋 Summary: harness metrics unavailable:`, err instanceof Error ? err.message : err);
  }

  // 7. Read cross-session metrics aggregate
  let crossSessionMetrics: Record<string, unknown> | null = null;
  try {
    const aggPath = join(workspaceManager.getWorkspaceDir(), "metrics", "aggregate.json");
    const content = await readFile(aggPath, "utf-8");
    crossSessionMetrics = JSON.parse(content);
  } catch (err) {
    console.error(`🍋 Summary: no aggregate data:`, err instanceof Error ? err.message : err);
  }

  // 8. Compute confidence estimates
  const validationsTotal = validations.length;
  const validationsPassed = validations.filter(v => v.passed).length;
  const validationPassRate = validationsTotal > 0 ? validationsPassed / validationsTotal : 0;
  const errorRate = trail.length > 0 ? totalErrors / trail.length : 0;
  const heuristicConfidence = heuristics.length > 0
    ? heuristics.reduce((s, h) => s + h.confidence, 0) / heuristics.length
    : 0;
  const decisionAdvantage = timeDirector.getDecisionAdvantageDecay();

  // Detect regressions
  const regressions = executionLogger.detectRegression();

  // Overall confidence: weighted combination
  const overallScore = (
    validationPassRate * 0.30 +        // 30% weight on validation pass rate
    (1 - errorRate) * 0.20 +            // 20% inverse error rate
    heuristicConfidence * 0.10 +        // 10% heuristic quality
    decisionAdvantage * 0.25 +          // 25% decision quality (with checkpoint decay)
    (regressions ? 0.0 : 0.15)          // 15% regression-free
  );

  // 9. Get session ID
  const sessionId = `session-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  // 10. Use task description — prefer the external one from workspace extension,
  // fall back to parsing session file name
  let taskDescription = externalTaskDescription || "";
  if (!taskDescription) {
    try {
      taskDescription = (ctx.sessionManager?.getSessionFile?.() || "")
        .split("/")
        .pop()
        ?.replace(/\.jsonl?$/i, "")
        ?.replace(/[_-]/g, " ") || "";
    } catch (err) {
      console.error(`🍋 Summary: failed to determine session ID:`, err instanceof Error ? err.message : err);
      taskDescription = "";
    }
  }

  // Build the data object
  const data: SummaryData = {
    sessionId,
    generatedAt: Date.now(),
    taskDescription,
    phases: {
      current: phase.phase,
      totalBudgetMs: timeDirector.getBudget(),
      elapsedMs: phase.elapsedMs,
      totalProgress: phase.totalProgress,
      phaseProgress: phase.phaseProgress,
      phaseDurations,
      checkpoints: checkpoints.map(cp => ({
        phase: cp.phase,
        timestamp: cp.timestamp,
        elapsedMs: cp.elapsedMs,
      })),
    },
    files: wsState.files.map(f => ({
      path: f.path,
      action: f.action,
      timestamp: f.timestamp,
    })),
    validations,
    heuristics,
    toolStats: {
      totalCalls: trail.length,
      totalErrors,
      consecutiveErrors,
      toolCounts,
      errorCounts,
    },
    harnessMetrics,
    crossSessionMetrics,
    confidence: {
      overall: Math.min(1, Math.max(0, overallScore)),
      validationPassRate,
      heuristicConfidence,
      errorRate,
      decisionAdvantage,
      regressionFree: regressions === null,
    },
  };

  return summary.generateMarkdown(data);
}
