// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * TimeDirector — Phase Tracking & Budget Management
 *
 * Tracks execution phase (Explore/Implement/Validate/Reserve),
 * manages time budget, and records phase checkpoints.
 *
 * v3: Phase Checkpoints (arXiv:2602.06413)
 */

import type { TimeDirectorConfig, TimePhase, TimePhaseName, PhaseCheckpoint } from "./types";
import { formatDuration } from "./helpers";

export class TimeDirector {
  private startTime: number = 0;
  private config: TimeDirectorConfig;
  private checkpoints: PhaseCheckpoint[] = [];

  constructor(config?: Partial<TimeDirectorConfig>) {
    this.config = {
      totalBudgetMs: config?.totalBudgetMs ?? 300_000,
      exploreRatio: config?.exploreRatio ?? 0.3,
      implementRatio: config?.implementRatio ?? 0.6,
      validateRatio: config?.validateRatio ?? 0.9,
      graceBand: config?.graceBand ?? 0.05,
    };
  }

  start() { this.startTime = Date.now(); }

  setBudget(budgetMs: number) { this.config.totalBudgetMs = budgetMs; }

  extendBudget(extraMs: number) { this.config.totalBudgetMs += extraMs; }

  getBudget(): number { return this.config.totalBudgetMs; }

  getElapsed(): number { return Date.now() - this.startTime; }

  getCurrentPhase(): TimePhase {
    const elapsed = this.getElapsed();
    const total = this.config.totalBudgetMs;
    const progress = Math.min(elapsed / total, 1);
    const remaining = Math.max(total - elapsed, 0);

    let phase: TimePhaseName;
    let phaseProgress: number;

    if (progress <= this.config.exploreRatio) {
      phase = "explore";
      phaseProgress = progress / this.config.exploreRatio;
    } else if (progress <= this.config.implementRatio) {
      phase = "implement";
      phaseProgress = (progress - this.config.exploreRatio) / (this.config.implementRatio - this.config.exploreRatio);
    } else if (progress <= this.config.validateRatio) {
      phase = "validate";
      phaseProgress = (progress - this.config.implementRatio) / (this.config.validateRatio - this.config.implementRatio);
    } else {
      phase = "reserve";
      phaseProgress = (progress - this.config.validateRatio) / (1 - this.config.validateRatio);
    }

    return {
      phase,
      elapsedMs: elapsed,
      remainingMs: remaining,
      phaseProgress: Math.min(phaseProgress, 1),
      totalProgress: progress,
    };
  }

  isInGraceBand(): boolean {
    const progress = this.getElapsed() / this.config.totalBudgetMs;
    return progress >= 1 - this.config.graceBand;
  }

  recordPhaseCheckpoint(phase: string, wsState: string, trailSummary: string): PhaseCheckpoint {
    const cp: PhaseCheckpoint = {
      phase,
      timestamp: Date.now(),
      elapsedMs: this.getElapsed(),
      totalBudgetMs: this.config.totalBudgetMs,
      workspaceState: wsState,
      trailSummary,
      decisionAdvantage: Math.exp(-0.3 * (this.checkpoints.length + 1)),
    };
    this.checkpoints.push(cp);
    return cp;
  }

  getPhaseCheckpoints(): PhaseCheckpoint[] { return [...this.checkpoints]; }

  getDecisionAdvantageDecay(): number {
    if (this.checkpoints.length === 0) return 1;
    return Math.exp(-0.3 * this.checkpoints.length);
  }

  formatStatus(): string {
    const phase = this.getCurrentPhase();
    const pct = Math.round(phase.totalProgress * 100);
    const phaseNames: Record<string, string> = {
      explore: "Explore (0–30% budget)",
      implement: "Implement (30–60% budget)",
      validate: "Validate (60–90% budget)",
      reserve: "Reserve (90–100% budget)",
    };
    return [
      `⏱ Time Status: ${phase.phase.toUpperCase()} phase — ${pct}% of budget used`,
      `   - Elapsed: ${formatDuration(phase.elapsedMs)} / Total: ${formatDuration(this.config.totalBudgetMs)}`,
      `   - Remaining: ${formatDuration(phase.remainingMs)}`,
      `   - Current phase: ${phaseNames[phase.phase] || phase.phase}`,
    ].join("\n");
  }
}
