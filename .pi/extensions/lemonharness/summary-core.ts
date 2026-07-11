/**
 * LemonHarness Summary — Core Types and SessionSummary Class
 */

import { join } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface SummaryData {
  sessionId: string;
  generatedAt: number;
  taskDescription: string;
  phases: {
    current: string;
    totalBudgetMs: number;
    elapsedMs: number;
    totalProgress: number;
    phaseProgress: number;
    phaseDurations: Record<string, number>;
    checkpoints: Array<{ phase: string; timestamp: number; elapsedMs: number }>;
  };
  files: Array<{ path: string; action: string; timestamp: number }>;
  validations: Array<{
    name: string;
    command: string;
    passed: boolean;
    output: string;
    timestamp: number;
  }>;
  heuristics: Array<{
    rule: string;
    domain: string;
    type: string;
    confidence: number;
    successCount: number;
    failureCount: number;
  }>;
  toolStats: {
    totalCalls: number;
    totalErrors: number;
    consecutiveErrors: number;
    toolCounts: Record<string, number>;
    errorCounts: Record<string, number>;
  };
  harnessMetrics: Record<string, number | string> | null;
  crossSessionMetrics: Record<string, unknown> | null;
  confidence: {
    overall: number;
    validationPassRate: number;
    heuristicConfidence: number;
    errorRate: number;
    decisionAdvantage: number;
    regressionFree: boolean;
  };
}

// ── Session Summary Class ────────────────────────────────────────────────

export class SessionSummary {
  private workspaceDir: string;
  private summaryDir: string;
  private archiveDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    this.summaryDir = workspaceDir;
    this.archiveDir = join(workspaceDir, "summaries");
  }

  /** Generate a structured markdown summary from session data. */
  generateMarkdown(data: SummaryData): string {
    const lines: string[] = [];
    const fmtDur = (ms: number): string => {
      const s = Math.round(ms / 1000);
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    };
    const fmtDate = (ts: number): string => new Date(ts).toISOString();

    lines.push("# 🍋 LemonHarness Session Summary", "", `**Session ID**: \`${data.sessionId}\``, `**Generated**: ${fmtDate(data.generatedAt)}`, `**Final Phase**: ${data.phases.current.toUpperCase()}`, "");
    lines.push("## 📋 Task Description", "");
    lines.push(data.taskDescription ? (data.taskDescription.length > 500 ? data.taskDescription.slice(0, 500) + "..." : data.taskDescription) : "*No task description recorded.*", "");

    // Phases
    lines.push("## ⏱ Phases & Budget Utilization", "");
    const bTotal = data.phases.totalBudgetMs;
    const pn: Record<string, string> = { explore: "Explore (P1)", implement: "Implement (P2)", validate: "Validate (P3)", reserve: "Reserve (P4)" };
    const pOrder = ["explore", "implement", "validate", "reserve"];
    const pd = data.phases.phaseDurations;
    lines.push("| Phase | Duration | Budget % |", "|-------|----------|----------|");
    for (const p of pOrder) { const d = pd[p] || 0; lines.push(`| **${pn[p] || p}** | ${d > 0 ? fmtDur(d) : "—"} | ${bTotal > 0 ? ((d / bTotal) * 100).toFixed(0) + "%" : "—"} |`); }
    lines.push(`| **Total** | **${fmtDur(data.phases.elapsedMs)}** | **${(data.phases.totalProgress * 100).toFixed(0)}%** |`, "");
    lines.push(`- **Total Budget**: ${fmtDur(bTotal)}`, `- **Elapsed**: ${fmtDur(data.phases.elapsedMs)}`, `- **Utilization**: ${(data.phases.totalProgress * 100).toFixed(0)}%`);
    if (data.phases.checkpoints.length > 0) lines.push(`- **Phase Transitions**: ${data.phases.checkpoints.map(c => c.phase).join(" → ")}`);
    lines.push("");

    // Files
    lines.push("## 📁 Files Created/Modified", "");
    if (data.files.length === 0) { lines.push("*No files tracked this session.*"); } else {
      lines.push(`Total: **${data.files.length}** files`, "", "| Action | File |", "|--------|------|");
      for (const f of [...data.files].sort((a, b) => a.timestamp - b.timestamp)) {
        lines.push(`| ${f.action === "create" ? "➕ Create" : f.action === "delete" ? "➖ Delete" : "✏️ Modify"} | \`${f.path}\` |`);
      }
    }
    lines.push("");

    // Validations
    lines.push("## ✅ Validations Run", "");
    if (data.validations.length === 0) { lines.push("*No validations recorded.*"); } else {
      lines.push(`Total: **${data.validations.length}** (${data.validations.filter(v => v.passed).length} ✅, ${data.validations.filter(v => !v.passed).length} ❌)`, "");
      for (let i = 0; i < data.validations.length; i++) {
        const v = data.validations[i];
        lines.push(`${i + 1}. ${v.passed ? "✅" : "❌"} \`${v.command.length > 80 ? v.command.slice(0, 80) + "..." : v.command}\``);
        if (v.output) lines.push(`   ${v.output.slice(0, 200)}${v.output.length > 200 ? "..." : ""}`);
      }
    }
    lines.push("");

    // Heuristics
    lines.push("## 🧪 ERL Heuristics Captured", "");
    if (data.heuristics.length === 0) { lines.push("*No heuristics captured.*"); } else {
      lines.push(`Total: **${data.heuristics.length}** heuristics`, "", "| # | Rule | Type | Domain | Confidence | Success |", "|---|------|------|--------|------------|---------|");
      for (let i = 0; i < data.heuristics.length; i++) {
        const h = data.heuristics[i];
        lines.push(`| ${i + 1} | "${h.rule.length > 60 ? h.rule.slice(0, 60) + "..." : h.rule}" | ${h.type} | ${h.domain} | ${(h.confidence * 100).toFixed(0)}% | ${h.successCount}/${h.successCount + h.failureCount} |`);
      }
    }
    lines.push("");

    // Tool stats
    lines.push("## 📊 Tool Call Statistics", "", "| Metric | Value |", "|--------|-------|", `| Total Tool Calls | ${data.toolStats.totalCalls} |`, `| Total Errors | ${data.toolStats.totalErrors} |`, `| Error Rate | ${data.toolStats.totalCalls > 0 ? ((data.toolStats.totalErrors / data.toolStats.totalCalls) * 100).toFixed(1) : "0.0"}% |`, `| Consecutive Errors | ${data.toolStats.consecutiveErrors} |`, "");
    const tNames = Object.keys(data.toolStats.toolCounts).sort();
    if (tNames.length > 0) {
      lines.push("**By tool:**");
      for (const n of tNames) { const e = data.toolStats.errorCounts[n] || 0; lines.push(`- \`${n}\`: ${data.toolStats.toolCounts[n]} calls${e > 0 ? ` (${e} ❌)` : ""}`); }
    }
    lines.push("");

    // Harness metrics
    if (data.harnessMetrics) {
      lines.push("## 🔬 Harness Evaluation Metrics", "", "| Metric | Value |", "|--------|-------|");
      for (const [k, v] of Object.entries(data.harnessMetrics)) {
        const label = k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
        lines.push(`| ${label} | ${typeof v === "number" && (k.includes("Rate") || k.includes("completeness") || k.includes("efficiency")) ? `${(v * 100).toFixed(0)}%` : String(v)} |`);
      }
      lines.push("");
    }

    // Confidence
    const c = data.confidence;
    lines.push("## 🎯 Confidence Estimates", "", "| Factor | Score | Interpretation |", "|--------|-------|----------------|");
    lines.push(`| Overall | **${(c.overall * 100).toFixed(0)}%** | ${this.confidenceLabel(c.overall)} |`);
    lines.push(`| Validation Pass Rate | ${(c.validationPassRate * 100).toFixed(0)}% | ${c.validationPassRate >= 0.8 ? "Good" : c.validationPassRate >= 0.5 ? "Moderate" : "Low"} |`);
    lines.push(`| Heuristic Confidence | ${(c.heuristicConfidence * 100).toFixed(0)}% | ${c.heuristicConfidence >= 0.5 ? "Established" : "Emerging"} |`);
    lines.push(`| Error Rate (inverse) | ${((1 - c.errorRate) * 100).toFixed(0)}% | ${c.errorRate < 0.2 ? "Low" : c.errorRate < 0.5 ? "Moderate" : "High"} |`);
    lines.push(`| Decision Advantage | ${(c.decisionAdvantage * 100).toFixed(0)}% | Decay from ${data.phases.checkpoints.length} checkpoint(s) |`);
    lines.push(`| Regression-Free | ${c.regressionFree ? "✅ Yes" : "⚠️ No"} | ${c.regressionFree ? "No regressions" : "Regressions detected"} |`, "");
    lines.push(`**Overall Assessment**: ${c.overall >= 0.7 ? "🟢 Good" : c.overall >= 0.4 ? "🟡 Moderate" : "🔴 Low"} — ${this.overallAssessment(c)}`, "");
    lines.push("---", `*Generated by LemonHarness Live Documentation Generator at ${fmtDate(data.generatedAt)}*`, "*This summary can be used as context for future sessions.*");
    return lines.join("\n");
  }

  /** Save summary to disk (current + archive). */
  async saveSummary(content: string): Promise<string> {
    await mkdir(this.summaryDir, { recursive: true });
    const cp = join(this.summaryDir, "session-summary.md");
    await writeFile(cp, content, "utf-8");
    await mkdir(this.archiveDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(join(this.archiveDir, `summary-${ts}.md`), content, "utf-8");
    return cp;
  }

  /** List archived summaries newest first. */
  async getHistory(): Promise<Array<{ filename: string; timestamp: string; preview: string }>> {
    try {
      await mkdir(this.archiveDir, { recursive: true });
      const files = (await readdir(this.archiveDir)).filter(f => f.startsWith("summary-") && f.endsWith(".md")).sort().reverse();
      const results: Array<{ filename: string; timestamp: string; preview: string }> = [];
      for (const file of files) {
        try {
          const content = await readFile(join(this.archiveDir, file), "utf-8");
          const lines = content.split("\n");
          const titleLine = lines.find(l => l.startsWith("# ")) || "";
          const dateLine = lines.find(l => l.startsWith("**Generated**")) || "";
          results.push({ filename: file, timestamp: dateLine.replace("**Generated**: ", "").replace("**", ""), preview: titleLine.replace("# ", "").trim() || file });
        } catch { results.push({ filename: file, timestamp: "unknown", preview: "(unreadable)" }); }
      }
      return results;
    } catch { return []; }
  }

  /** Load a specific archived summary. */
  async loadSummary(filename: string): Promise<string | null> {
    try { return await readFile(join(this.archiveDir, filename), "utf-8"); } catch { return null; }
  }

  private confidenceLabel(score: number): string {
    return score >= 0.9 ? "Very high" : score >= 0.7 ? "High" : score >= 0.5 ? "Moderate" : score >= 0.3 ? "Low" : "Very low";
  }

  private overallAssessment(conf: SummaryData["confidence"]): string {
    const f: string[] = [];
    if (conf.validationPassRate >= 0.8) f.push("high validation pass rate");
    else if (conf.validationPassRate < 0.5) f.push("low validation pass rate");
    if (conf.errorRate < 0.2) f.push("low error rate");
    else if (conf.errorRate >= 0.5) f.push("high error rate");
    if (conf.heuristicConfidence >= 0.5) f.push("established heuristic patterns");
    if (conf.decisionAdvantage > 0.5) f.push("strong decision advantage");
    if (conf.regressionFree) f.push("no regressions");
    return f.length === 0 ? "Insufficient data." : f.join("; ") + ".";
  }
}
