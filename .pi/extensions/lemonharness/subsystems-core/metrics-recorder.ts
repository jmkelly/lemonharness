// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * MetricsRecorder — Cross-Session Improvement Metrics
 *
 * Persists metrics per session and computes cross-session trends.
 * Enables improvement velocity tracking across sessions.
 *
 * v3: Harness Evaluation Metrics (arXiv:2605.18747)
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SessionMetrics,
  HarnessMetrics,
  HarnessMetricsSnapshot,
} from "./types";

interface MetricsAggregate {
  totalSessions: number;
  lastUpdated: number;
  recent5Avg: {
    errorRate: number;
    validationPassRate: number;
    budgetUtilization: number;
    filesPerSession: number;
  };
  allTimeAvg: {
    errorRate: number;
    validationPassRate: number;
    budgetUtilization: number;
  };
  trend: string;
}

export class MetricsRecorder {
  private metricsDir: string;
  private currentSession: SessionMetrics | null = null;
  // v3: Harness metrics
  private harnessMetrics: HarnessMetrics = {
    constraintViolations: 0,
    traceCompleteness: 0,
    toolJustificationRate: 0,
    recoveryEfficiency: 0,
    regressionFreeRate: 0,
  };
  private totalToolCallsForJustification: number = 0;
  private justifiedToolCalls: number = 0;
  private totalChanges: number = 0;
  private regressionFreeChanges: number = 0;

  constructor(workspaceDir: string) {
    this.metricsDir = join(workspaceDir, "metrics");
  }

  async init() {
    await mkdir(this.metricsDir, { recursive: true });
  }

  startSession(sessionId: string) {
    this.currentSession = {
      sessionId, timestamp: Date.now(),
      totalToolCalls: 0, totalErrors: 0,
      totalValidations: 0, passedValidations: 0,
      budgetUtilizedPercent: 0, phasesCompleted: [],
      skillsLoaded: [], filesModified: 0, depsInstalled: 0,
    };
    this.harnessMetrics = {
      constraintViolations: 0, traceCompleteness: 0,
      toolJustificationRate: 0, recoveryEfficiency: 0,
      regressionFreeRate: 0,
    };
    this.totalToolCallsForJustification = 0;
    this.justifiedToolCalls = 0;
    this.totalChanges = 0;
    this.regressionFreeChanges = 0;
  }

  recordToolCall(isError: boolean) {
    if (!this.currentSession) return;
    this.currentSession.totalToolCalls++;
    if (isError) this.currentSession.totalErrors++;
  }

  recordValidation(passed: boolean) {
    if (!this.currentSession) return;
    this.currentSession.totalValidations++;
    if (passed) this.currentSession.passedValidations++;
  }

  recordPhaseCompleted(phase: string) {
    if (!this.currentSession) return;
    if (!this.currentSession.phasesCompleted.includes(phase)) {
      this.currentSession.phasesCompleted.push(phase);
    }
  }

  recordSkillLoaded(skill: string) {
    if (!this.currentSession) return;
    if (!this.currentSession.skillsLoaded.includes(skill)) {
      this.currentSession.skillsLoaded.push(skill);
    }
  }

  recordFileModified() { if (this.currentSession) this.currentSession.filesModified++; }
  recordDepInstalled() { if (this.currentSession) this.currentSession.depsInstalled++; }

  // ── v3: Harness Metrics Recording ────────────────────────────────

  recordConstraintViolation() {
    this.harnessMetrics.constraintViolations++;
  }

  recordTraceCompleteness(complete: boolean) {
    if (!this.currentSession) return;
    const totalOps = this.currentSession.totalToolCalls;
    if (totalOps > 0) {
      this.harnessMetrics.traceCompleteness =
        ((this.harnessMetrics.traceCompleteness * (totalOps - 1)) + (complete ? 1 : 0)) / totalOps;
    }
  }

  recordJustifiedCall(justified: boolean) {
    this.totalToolCallsForJustification++;
    if (justified) this.justifiedToolCalls++;
    this.harnessMetrics.toolJustificationRate =
      this.totalToolCallsForJustification > 0
        ? this.justifiedToolCalls / this.totalToolCallsForJustification
        : 0;
  }

  recordRecoveryTime(recoveryTimeMs: number) {
    if (!this.currentSession || this.currentSession.totalToolCalls === 0) return;
    const totalTime = Date.now() - (this.currentSession.timestamp || Date.now());
    this.harnessMetrics.recoveryEfficiency = totalTime > 0
      ? Math.max(0, 1 - (recoveryTimeMs / totalTime))
      : 0;
  }

  recordChange(isRegression: boolean) {
    this.totalChanges++;
    if (!isRegression) this.regressionFreeChanges++;
    this.harnessMetrics.regressionFreeRate =
      this.totalChanges > 0 ? this.regressionFreeChanges / this.totalChanges : 0;
  }

  getHarnessMetrics(): HarnessMetrics {
    return { ...this.harnessMetrics };
  }

  async saveHarnessSnapshot(sessionId: string) {
    const snapshot: HarnessMetricsSnapshot = {
      timestamp: Date.now(),
      sessionId,
      metrics: this.harnessMetrics,
    };
    try {
      await mkdir(join(this.metricsDir, "harness"), { recursive: true });
      const path = join(this.metricsDir, "harness", `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
      await writeFile(path, JSON.stringify(snapshot, null, 2), "utf-8");
    } catch { /* non-critical */ }
  }

  async getHarnessReport(): Promise<string> {
    const m = this.harnessMetrics;
    return [
      `🔬 Harness Evaluation Metrics:`,
      `  Constraint violations: ${m.constraintViolations}`,
      `  Trace completeness: ${(m.traceCompleteness * 100).toFixed(0)}%`,
      `  Tool justification rate: ${(m.toolJustificationRate * 100).toFixed(0)}%`,
      `  Recovery efficiency: ${(m.recoveryEfficiency * 100).toFixed(0)}%`,
      `  Regression-free rate: ${(m.regressionFreeRate * 100).toFixed(0)}%`,
    ].join("\n");
  }

  async finalize(budgetUtilizedPercent: number) {
    if (!this.currentSession) return;
    this.currentSession.budgetUtilizedPercent = budgetUtilizedPercent;
    const safeId = this.currentSession.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = join(this.metricsDir, `${safeId}.json`);
    try {
      await writeFile(filePath, JSON.stringify(this.currentSession, null, 2), "utf-8");
      await this.saveHarnessSnapshot(safeId);
      await this.updateAggregate();
    } catch { /* non-critical */ }
  }

  private async updateAggregate() {
    try {
      const entries = await readdir(this.metricsDir);
      const allMetrics: SessionMetrics[] = [];
      for (const f of entries) {
        if (!f.endsWith(".json") || f === "aggregate.json") continue;
        try {
          const content = await readFile(join(this.metricsDir, f), "utf-8");
          allMetrics.push(JSON.parse(content));
        } catch { /* skip corrupt */ }
      }
      if (allMetrics.length === 0) return;

      const sorted = allMetrics.sort((a, b) => b.timestamp - a.timestamp);
      const last5 = sorted.slice(0, 5);

      const avg = (arr: SessionMetrics[], fn: (m: SessionMetrics) => number) =>
        arr.reduce((s, m) => s + fn(m), 0) / arr.length;

      const aggregate: MetricsAggregate = {
        totalSessions: allMetrics.length,
        lastUpdated: Date.now(),
        recent5Avg: {
          errorRate: avg(last5, m => m.totalToolCalls > 0 ? m.totalErrors / m.totalToolCalls : 0) * 100,
          validationPassRate: avg(last5, m => m.totalValidations > 0 ? m.passedValidations / m.totalValidations : 0) * 100,
          budgetUtilization: avg(last5, m => m.budgetUtilizedPercent),
          filesPerSession: avg(last5, m => m.filesModified),
        },
        allTimeAvg: {
          errorRate: avg(sorted, m => m.totalToolCalls > 0 ? m.totalErrors / m.totalToolCalls : 0) * 100,
          validationPassRate: avg(sorted, m => m.totalValidations > 0 ? m.passedValidations / m.totalValidations : 0) * 100,
          budgetUtilization: avg(sorted, m => m.budgetUtilizedPercent),
        },
        trend: this.computeTrend(sorted),
      };

      await writeFile(
        join(this.metricsDir, "aggregate.json"),
        JSON.stringify(aggregate, null, 2), "utf-8",
      );
    } catch { /* non-critical */ }
  }

  private computeTrend(sorted: SessionMetrics[]): string {
    if (sorted.length < 3) return "insufficient data (need 3+ sessions)";
    const byTime = [...sorted].sort((a, b) => a.timestamp - b.timestamp);
    const mid = Math.ceil(byTime.length / 2);
    const early = byTime.slice(0, mid);
    const late = byTime.slice(mid);

    const earlyErr = early.reduce((s, m) => s + (m.totalToolCalls > 0 ? m.totalErrors / m.totalToolCalls : 0), 0) / early.length;
    const lateErr = late.reduce((s, m) => s + (m.totalToolCalls > 0 ? m.totalErrors / m.totalToolCalls : 0), 0) / late.length;

    if (lateErr < earlyErr * 0.8) return "✅ improving (errors decreasing)";
    if (lateErr > earlyErr * 1.2) return "⚠️ degrading (errors increasing)";
    return "➡️ stable (no significant change)";
  }

  async getAggregateReport(): Promise<string> {
    try {
      const content = await readFile(join(this.metricsDir, "aggregate.json"), "utf-8");
      const agg: MetricsAggregate = JSON.parse(content);
      return [
        `📊 Cross-Session Metrics (${agg.totalSessions} sessions)`,
        `──────────────────────────────────`,
        `Last 5 sessions avg:`,
        `  Error rate: ${agg.recent5Avg.errorRate.toFixed(1)}%`,
        `  Validation pass rate: ${agg.recent5Avg.validationPassRate.toFixed(1)}%`,
        `  Budget utilization: ${agg.recent5Avg.budgetUtilization.toFixed(0)}%`,
        `  Files per session: ${agg.recent5Avg.filesPerSession.toFixed(1)}`,
        `All-time avg:`,
        `  Error rate: ${agg.allTimeAvg.errorRate.toFixed(1)}%`,
        `  Validation pass rate: ${agg.allTimeAvg.validationPassRate.toFixed(1)}%`,
        `Trend: ${agg.trend}`,
      ].join("\n");
    } catch {
      return "📊 No cross-session data yet. Complete a session to generate metrics.";
    }
  }
}
