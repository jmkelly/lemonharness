/**
 * LemonHarness Summary Builder — Data collection from singletons.
 * Extracted from summary.ts to keep files under 400 lines.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { SummaryData, SessionSummary } from "./summary-core";

/**
 * External version used by workspace extension.
 */
export async function buildSummaryFromLiveDataExternal(
  summary: SessionSummary,
  workspaceManager: import("./workspace").WorkspaceManager,
  timeDirector: import("./workspace").TimeDirector,
  executionLogger: import("./workspace").ExecutionLogger,
  ctx: { sessionManager?: { getSessionFile?: () => string | undefined } },
  taskDescription: string,
): Promise<string> {
  return buildSummaryFromSingletons(summary, workspaceManager, timeDirector, executionLogger, ctx, taskDescription);
}

/**
 * Core implementation that takes singletons directly.
 * Exported for use by the summary command handler.
 */
export async function buildSummaryFromSingletons(
  summary: SessionSummary,
  workspaceManager: import("./workspace").WorkspaceManager,
  timeDirector: import("./workspace").TimeDirector,
  executionLogger: import("./workspace").ExecutionLogger,
  ctx: any,
  externalTaskDescription: string,
): Promise<string> {
  const wsState = workspaceManager.getWorkspaceState();
  const phase = timeDirector.getCurrentPhase();
  const trail = executionLogger.getExecutionTrail();
  const checkpoints = timeDirector.getPhaseCheckpoints();
  const consecutiveErrors = executionLogger.getConsecutiveErrors();

  // Compute phase durations from checkpoints
  const phaseDurations: Record<string, number> = {};
  const phaseOrder = ["explore", "implement", "validate", "reserve"];
  if (checkpoints.length > 0) {
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const dur = i === 0 ? cp.elapsedMs : cp.timestamp - checkpoints[i - 1].timestamp;
      phaseDurations[cp.phase] = dur;
    }
    const cp = phase.phase;
    if (!phaseDurations[cp]) {
      phaseDurations[cp] = phase.elapsedMs - checkpoints[checkpoints.length - 1].elapsedMs;
    }
  } else {
    phaseDurations[phase.phase] = phase.elapsedMs;
  }
  for (const p of phaseOrder) { if (!phaseDurations[p]) phaseDurations[p] = 0; }

  // Tool stats
  const toolCounts: Record<string, number> = {};
  const errorCounts: Record<string, number> = {};
  let totalErrors = 0;
  for (const entry of trail) {
    const name = entry.toolName || entry.validationName || "unknown";
    toolCounts[name] = (toolCounts[name] || 0) + 1;
    if (entry.isError) { errorCounts[name] = (errorCounts[name] || 0) + 1; totalErrors++; }
  }

  // Validations
  const validations = trail.filter((e: any) => e.type === "validation").map((e: any) => ({
    name: e.validationName || e.command?.slice(0, 60) || "validation",
    command: e.command || "",
    passed: e.passed || false,
    output: e.output || "",
    timestamp: e.timestamp,
  }));

  // Heuristics from disk
  let heuristics: SummaryData["heuristics"] = [];
  try {
    const mod = await import("./subsystems");
    const hm = new mod.HeuristicManager(workspaceManager.getWorkspaceDir());
    await hm.init();
    heuristics = hm.getAllHeuristics().map((h: any) => ({
      rule: h.rule, domain: h.domain, type: h.type, confidence: h.confidence,
      successCount: h.successCount, failureCount: h.failureCount,
    }));
  } catch { /* heuristics unavailable */ }

  // Harness metrics from disk
  let harnessMetrics: Record<string, number | string> | null = null;
  try {
    const mod = await import("./subsystems");
    const mr = new mod.MetricsRecorder(workspaceManager.getWorkspaceDir());
    await mr.init();
    harnessMetrics = mr.getHarnessMetrics() as any;
  } catch { /* metrics unavailable */ }

  // Cross-session metrics
  let crossSessionMetrics: Record<string, unknown> | null = null;
  try {
    const content = await readFile(join(workspaceManager.getWorkspaceDir(), "metrics", "aggregate.json"), "utf-8");
    crossSessionMetrics = JSON.parse(content);
  } catch { /* no aggregate data */ }

  // Confidence estimates
  const vTotal = validations.length;
  const vPassed = validations.filter((v: any) => v.passed).length;
  const validationPassRate = vTotal > 0 ? vPassed / vTotal : 0;
  const errorRate = trail.length > 0 ? totalErrors / trail.length : 0;
  const heuristicConfidence = heuristics.length > 0 ? heuristics.reduce((s, h) => s + h.confidence, 0) / heuristics.length : 0;
  const decisionAdvantage = timeDirector.getDecisionAdvantageDecay();
  const regressions = executionLogger.detectRegression();
  const overallScore = Math.min(1, Math.max(0,
    validationPassRate * 0.30 + (1 - errorRate) * 0.20 + heuristicConfidence * 0.10 +
    decisionAdvantage * 0.25 + (regressions ? 0.0 : 0.15)
  ));

  const sessionId = `session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let taskDescription = externalTaskDescription || "";
  if (!taskDescription) {
    try {
      taskDescription = (ctx.sessionManager?.getSessionFile?.() || "").split("/").pop()?.replace(/\.jsonl?$/i, "")?.replace(/[_-]/g, " ") || "";
    } catch { taskDescription = ""; }
  }

  const data: SummaryData = {
    sessionId, generatedAt: Date.now(), taskDescription,
    phases: {
      current: phase.phase, totalBudgetMs: timeDirector.getBudget(), elapsedMs: phase.elapsedMs,
      totalProgress: phase.totalProgress, phaseProgress: phase.phaseProgress,
      phaseDurations,
      checkpoints: checkpoints.map(cp => ({ phase: cp.phase, timestamp: cp.timestamp, elapsedMs: cp.elapsedMs })),
    },
    files: wsState.files.map((f: any) => ({ path: f.path, action: f.action, timestamp: f.timestamp })),
    validations, heuristics,
    toolStats: { totalCalls: trail.length, totalErrors, consecutiveErrors, toolCounts, errorCounts },
    harnessMetrics, crossSessionMetrics,
    confidence: {
      overall: overallScore, validationPassRate, heuristicConfidence, errorRate,
      decisionAdvantage, regressionFree: regressions === null,
    },
  };

  return summary.generateMarkdown(data);
}
