// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * HealthChecker — Periodic Scheduled Health Checks
 *
 * Registers interval-based hooks that fire every N turns to check
 * approach validity, budget health, and prerequisite changes.
 */

import type { HealthCheckResult, HealthCheckState, HealthCheckRegistration } from "./types";

export class HealthChecker {
  private checks: Map<string, HealthCheckRegistration> = new Map();
  private turnIndex: number = 0;
  private alerts: Array<{
    name: string;
    severity: "yellow" | "red";
    message: string;
    timestamp: number;
    dismissed: boolean;
  }> = [];

  registerCheck(name: string, interval: number, checkFn: (state: HealthCheckState) => HealthCheckResult): void {
    this.checks.set(name, { name, interval, checkFn, lastRunTurn: 0, lastResult: null });
  }

  registerDefaultChecks(interval: number = 5): void {
    this.registerCheck("approach_validity", interval, (state) => {
      if (state.consecutiveErrors >= 3) {
        return {
          passed: false, severity: "yellow",
          message: `Approach may be drifting: ${state.consecutiveErrors} consecutive errors detected`,
          details: `Check if current approach needs adjustment; consider pivoting or re-evaluating assumptions`,
        };
      }
      if (state.regressionDetected) {
        return {
          passed: false, severity: "yellow",
          message: `Approach validity concern: ${state.regressionMessage || "Regression detected (3+ consecutive failures of same type)"}`,
          details: `Repeated failures of same type suggest the current approach is not working`,
        };
      }
      if (state.errorRate > 0.5 && state.totalToolCalls >= 5) {
        return {
          passed: false, severity: "yellow",
          message: `High error rate (${(state.errorRate * 100).toFixed(0)}% of recent calls) — approach may need revision`,
          details: `More than half of recent tool calls resulted in errors; consider a different approach`,
        };
      }
      return { passed: true, severity: "green", message: "Approach appears valid given current execution context" };
    });

    this.registerCheck("budget_health", interval, (state) => {
      const remainingPct = Math.max(0, 1 - state.totalProgress);
      if (remainingPct < 0.1 && state.currentPhase !== "reserve") {
        return {
          passed: false, severity: "red",
          message: `Budget overrun risk: only ${(remainingPct * 100).toFixed(0)}% of budget remains in ${state.currentPhase} phase`,
          details: `Immediately wrap up current work and transition to reserve phase to preserve results`,
        };
      }
      if (remainingPct < 0.2 && (state.currentPhase === "explore" || state.currentPhase === "implement")) {
        return {
          passed: false, severity: "yellow",
          message: `Budget running low: ${(remainingPct * 100).toFixed(0)}% remaining in ${state.currentPhase} phase`,
          details: `Accelerate execution or adjust scope to fit within the remaining budget`,
        };
      }
      if (state.currentPhase === "explore" && state.totalProgress > 0.35) {
        return {
          passed: false, severity: "yellow",
          message: `Spent ${(state.totalProgress * 100).toFixed(0)}% of budget but still in explore phase`,
          details: `Consider transitioning to implementation phase to make progress on the task`,
        };
      }
      return { passed: true, severity: "green", message: `Budget on track (${(remainingPct * 100).toFixed(0)}% remaining)` };
    });

    this.registerCheck("prerequisite_change", interval, (state) => {
      if (state.consecutiveErrors >= 2 && state.totalProgress > 0.3) {
        return {
          passed: false, severity: "yellow",
          message: `Prerequisites may have changed: ${state.consecutiveErrors} errors suggest underlying assumptions may be invalid`,
          details: `Check if dependencies, file paths, or environment configuration have changed since the start`,
        };
      }
      const depInfo = state.dependencyCount > 0
        ? `${state.dependencyCount} dependencies installed` : "no dependencies";
      const fileInfo = state.filesModified > 0
        ? `${state.filesModified} files modified` : "no files modified yet";
      return { passed: true, severity: "green", message: `Prerequisites stable — ${depInfo}, ${fileInfo}` };
    });
  }

  runChecks(state: Partial<HealthCheckState>): void {
    this.turnIndex++;
    const fullState: HealthCheckState = {
      turnIndex: this.turnIndex,
      elapsedMs: state.elapsedMs ?? 0,
      totalBudgetMs: state.totalBudgetMs ?? 600_000,
      currentPhase: state.currentPhase ?? "explore",
      phaseProgress: state.phaseProgress ?? 0,
      totalProgress: state.totalProgress ?? 0,
      totalToolCalls: state.totalToolCalls ?? 0,
      totalErrors: state.totalErrors ?? 0,
      consecutiveErrors: state.consecutiveErrors ?? 0,
      errorRate: state.errorRate ?? 0,
      regressionDetected: state.regressionDetected ?? false,
      regressionMessage: state.regressionMessage ?? null,
      filesModified: state.filesModified ?? 0,
      dependencies: state.dependencies ?? [],
      dependencyCount: state.dependencyCount ?? 0,
      validationsPassed: state.validationsPassed ?? 0,
      validationsFailed: state.validationsFailed ?? 0,
    };

    for (const [name, check] of this.checks) {
      if (this.turnIndex - check.lastRunTurn >= check.interval) {
        check.lastRunTurn = this.turnIndex;
        const result = check.checkFn(fullState);
        check.lastResult = result;
        if (result.severity === "yellow" || result.severity === "red") {
          const hasActive = this.alerts.some(
            a => !a.dismissed && a.name === name && a.severity === result.severity && a.message === result.message
          );
          if (!hasActive) {
            this.alerts.push({
              name, severity: result.severity, message: result.message,
              timestamp: Date.now(), dismissed: false,
            });
          }
        }
      }
    }
  }

  getAlerts(): Array<{ name: string; severity: "yellow" | "red"; message: string }> {
    const pending = this.alerts.filter(a => !a.dismissed);
    for (const alert of pending) { alert.dismissed = true; }
    return pending.map(({ name, severity, message }) => ({ name, severity, message }));
  }

  getStatus(): string {
    const lines: string[] = [
      "🩺 Health Check Status",
      "─────────────────────",
      `Turn index: ${this.turnIndex}`,
      `Registered checks: ${this.checks.size}`,
      "",
    ];
    if (this.checks.size === 0) {
      lines.push("No health checks registered.");
      return lines.join("\n");
    }
    for (const [name, check] of this.checks) {
      const result = check.lastResult;
      const icon = !result ? "⚪" : result.severity === "green" ? "✅" : result.severity === "yellow" ? "⚠️" : "🔴";
      const lastRunStr = !result ? "Pending (first check on next cycle)" : `Last: ${result.message}`;
      lines.push(`  ${icon} ${name}`);
      lines.push(`     ${lastRunStr}`);
      if (result?.details) lines.push(`     ${result.details}`);
      lines.push(`     (every ${check.interval} turns, next in ${check.interval - (this.turnIndex - check.lastRunTurn)} turns)`);
      lines.push("");
    }
    const activeAlerts = this.alerts.filter(a => !a.dismissed);
    if (activeAlerts.length > 0) {
      lines.push("⚠️ Active Alerts:");
      for (const alert of activeAlerts) {
        const prefix = alert.severity === "red" ? "🔴" : "⚠️";
        lines.push(`  ${prefix} [${alert.name}] ${alert.message}`);
      }
    } else {
      lines.push("✅ No active alerts");
    }
    return lines.join("\n");
  }

  getCheckCount(): number { return this.checks.size; }
  getTurnIndex(): number { return this.turnIndex; }

  reset(): void {
    this.checks.clear();
    this.turnIndex = 0;
    this.alerts = [];
  }
}

/**
 * Create a standalone approach-validity check function for use outside HealthChecker.
 */
export function createApproachValidityCheck(config?: {
  maxConsecutiveErrors?: number;
  maxErrorRate?: number;
}): (state: HealthCheckState) => HealthCheckResult {
  const maxConsecutiveErrors = config?.maxConsecutiveErrors ?? 3;
  const maxErrorRate = config?.maxErrorRate ?? 0.5;
  return (state: HealthCheckState) => {
    if (state.consecutiveErrors >= maxConsecutiveErrors) {
      return { passed: false, severity: "yellow", message: `Approach may be drifting: ${state.consecutiveErrors} consecutive errors` };
    }
    if (state.regressionDetected) {
      return { passed: false, severity: "yellow", message: `Approach validity concern: ${state.regressionMessage || "Regression detected"}` };
    }
    if (state.errorRate > maxErrorRate && state.totalToolCalls >= 5) {
      return { passed: false, severity: "yellow", message: `High error rate (${(state.errorRate * 100).toFixed(0)}%)` };
    }
    return { passed: true, severity: "green", message: "Approach appears valid" };
  };
}

/**
 * Create a standalone budget-health check function for use outside HealthChecker.
 */
export function createBudgetHealthCheck(): (state: HealthCheckState) => HealthCheckResult {
  return (state: HealthCheckState) => {
    const remainingPct = Math.max(0, 1 - state.totalProgress);
    if (remainingPct < 0.1 && state.currentPhase !== "reserve") {
      return { passed: false, severity: "red", message: `Budget overrun risk: only ${(remainingPct * 100).toFixed(0)}% of budget remains` };
    }
    if (remainingPct < 0.2 && (state.currentPhase === "explore" || state.currentPhase === "implement")) {
      return { passed: false, severity: "yellow", message: `Budget running low: ${(remainingPct * 100).toFixed(0)}% remaining in ${state.currentPhase} phase` };
    }
    return { passed: true, severity: "green", message: "Budget on track" };
  };
}
