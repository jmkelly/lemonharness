/**
 * LemonHarness Workspace Extension
 *
 * Implements all 5 optimizations from the LemonHarness plan:
 * 1. Unified Runtime Boundary — controlled workspace, path enforcement
 * 2. Reusable Rule Knowledge (Skills) — domain-specific rule injection
 * 3. Time-Aware Execution — phased execution with budget tracking
 * 4. Structured Tool Boundary — custom tools with validation
 * 5. Execution Records & Validation Feedback — logging and trails
 *
 * v3: Heuristic injection (ERL), Phase Checkpoints (Stability), Privilege monitoring,
 *     SaP Pseudocode Contracts (skill loading)
 *
 * See lemonharness-pi-plan.md for full design reference.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat as fsStat,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawn } from "node:child_process";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
  try { await fsStat(p); return true; } catch { return false; }
}

function detectBashStateChange(command: string): string | null {
  const patterns: RegExp[] = [
    />>?\s+\S+/, /touch\s+\S+/, /mv\s+\S+\s+\S+/, /cp\s+\S+\s+\S+/,
    /mkdir\s+-p\s+\S+/, /npm\s+install/, /pip\s+install/, /apt\s+install/,
    /yarn\s+add/, /pnpm\s+add/, /cargo\s+install/, /go\s+install/, /rm\s+-rf?\s+/,
  ];
  for (const pattern of patterns) { if (pattern.test(command)) return command.slice(0, 80); }
  return null;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}

function estimateBudgetFromPrompt(prompt: string): number {
  const length = prompt.length;
  if (length < 100) return 2 * 60 * 1000;
  if (length < 500) return 5 * 60 * 1000;
  if (length < 2000) return 10 * 60 * 1000;
  return 20 * 60 * 1000;
}

/**
 * Generate a simple unified diff between two strings.
 * Produces a single-hunk unified diff suitable for snapshot recording.
 */
function computeUnifiedDiff(oldStr: string, newStr: string, relPath: string): string {
  if (oldStr === newStr) return "";

  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // Find first differing line
  const minLen = Math.min(oldLines.length, newLines.length);
  let firstDiff = 0;
  while (firstDiff < minLen && oldLines[firstDiff] === newLines[firstDiff]) {
    firstDiff++;
  }

  // Find last differing line (from end)
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > firstDiff && newEnd > firstDiff && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const contextSize = 3;
  const hunkStart = Math.max(0, firstDiff - contextSize);
  const oldHunkEnd = Math.min(oldLines.length, oldEnd + contextSize);
  const newHunkEnd = Math.min(newLines.length, newEnd + contextSize);

  const lines: string[] = [];
  lines.push(`--- a/${relPath}`);
  lines.push(`+++ b/${relPath}`);

  const hdrOldLen = oldHunkEnd - hunkStart;
  const hdrNewLen = newHunkEnd - hunkStart;
  lines.push(`@@ -${hunkStart + 1},${hdrOldLen} +${hunkStart + 1},${hdrNewLen} @@`);

  // Context before first change
  for (let k = hunkStart; k < firstDiff; k++) {
    lines.push(` ${oldLines[k]}`);
  }

  // Deleted lines (from old version)
  for (let k = firstDiff; k < oldEnd; k++) {
    lines.push(`-${oldLines[k]}`);
  }

  // Inserted lines (from new version)
  for (let k = firstDiff; k < newEnd; k++) {
    lines.push(`+${newLines[k]}`);
  }

  // Context after last change (use newLines — same as oldLines for unchanged region)
  const contextEnd = Math.min(oldHunkEnd, newHunkEnd);
  for (let k = oldEnd; k < contextEnd; k++) {
    lines.push(` ${newLines[k]}`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface WorkspaceFileEntry {
  path: string;
  action: "create" | "modify" | "delete";
  timestamp: number;
}

export interface WorkspaceProcessEntry {
  command: string;
  pid: number;
  timestamp: number;
}

export interface WorkspaceState {
  files: WorkspaceFileEntry[];
  processes: WorkspaceProcessEntry[];
  dependencies: string[];
  elapsedMs: number;
  lastReset: number;
}

export interface TimeDirectorConfig {
  totalBudgetMs: number;
  exploreRatio: number;
  implementRatio: number;
  validateRatio: number;
  graceBand: number;
}

export type TimePhaseName = "explore" | "implement" | "validate" | "reserve";

export interface TimePhase {
  phase: TimePhaseName;
  elapsedMs: number;
  remainingMs: number;
  phaseProgress: number;
  totalProgress: number;
}

export interface LogEntry {
  type: "tool_call" | "validation" | "confidence";
  timestamp: number;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  validationName?: string;
  command?: string;
  passed?: boolean;
  output?: string;
  /** Self-assessed confidence for a significant output (score 1-5). */
  confidence?: { score: number; rationale: string; flagForReview: boolean };
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

// ── v3: Phase Checkpoint ──────────────────────────────────────────
// Research basis: arXiv:2602.06413 — Theorem A & Structural Consequence

export interface PhaseCheckpoint {
  phase: string;
  timestamp: number;
  elapsedMs: number;
  totalBudgetMs: number;
  workspaceState: string;
  trailSummary: string;
  decisionAdvantage: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Workspace Manager — Singleton
// ─────────────────────────────────────────────────────────────────────────

export class WorkspaceManager {
  private workspaceDir: string = "";
  private projectRoot: string = "";
  private files: WorkspaceFileEntry[] = [];
  private processes: WorkspaceProcessEntry[] = [];
  private dependencies: string[] = [];
  private allowedPaths: string[] = [];
  private blockOutsideWrites: boolean = true;
  private lastReset: number = Date.now();

  initialize(projectRoot: string, config?: { dir?: string; allowedPaths?: string[]; blockOutsideWrites?: boolean }) {
    this.projectRoot = projectRoot;
    this.workspaceDir = join(projectRoot, config?.dir || ".lemonharness");
    this.allowedPaths = config?.allowedPaths ?? [];
    this.blockOutsideWrites = config?.blockOutsideWrites ?? true;
    this.lastReset = Date.now();
  }

  getWorkspaceDir(): string { return this.workspaceDir; }
  getProjectRoot(): string { return this.projectRoot; }

  getWorkspaceState(): WorkspaceState {
    return {
      files: [...this.files],
      processes: [...this.processes],
      dependencies: [...this.dependencies],
      elapsedMs: Date.now() - this.lastReset,
      lastReset: this.lastReset,
    };
  }

  isInWorkspace(absPath: string): boolean {
    const resolved = resolve(absPath);
    if (resolved.startsWith(join(this.projectRoot, ".pi"))) return true;
    if (resolved.startsWith(this.workspaceDir)) return true;
    if (resolved === this.projectRoot || resolved.startsWith(this.projectRoot + "/")) return true;
    for (const allowed of this.allowedPaths) {
      const resolvedAllowed = resolve(allowed.replace(/^~/, process.env.HOME || ""));
      if (resolved.startsWith(resolvedAllowed)) return true;
    }
    return false;
  }

  wouldBlockWrite(absPath: string): boolean {
    if (!this.blockOutsideWrites) return false;
    const resolved = resolve(absPath);
    if (resolved.startsWith(this.workspaceDir)) return false;
    if (resolved.startsWith(join(this.projectRoot, ".pi"))) return false;
    if (resolved === this.projectRoot) return false;
    if (resolved.startsWith(this.projectRoot + "/")) return false;
    for (const allowed of this.allowedPaths) {
      const resolvedAllowed = resolve(allowed.replace(/^~/, process.env.HOME || ""));
      if (resolved.startsWith(resolvedAllowed)) return false;
    }
    return true;
  }

  trackFileWrite(filePath: string, action: "create" | "modify" | "delete") {
    const existing = this.files.findIndex(f => f.path === filePath);
    if (existing >= 0) {
      this.files[existing] = { path: filePath, action, timestamp: Date.now() };
    } else {
      this.files.push({ path: filePath, action, timestamp: Date.now() });
    }
  }

  trackProcess(command: string, pid: number) {
    this.processes.push({ command: command.slice(0, 120), pid, timestamp: Date.now() });
  }

  trackDependency(name: string) {
    if (!this.dependencies.includes(name)) this.dependencies.push(name);
  }

  formatState(): string {
    const state = this.getWorkspaceState();
    const lines = [
      "📁 Workspace State:",
      `  Files: ${state.files.length} (${state.files.filter(f => f.action === "create").length} created, ${state.files.filter(f => f.action === "modify").length} modified)`,
      `  Processes spawned: ${state.processes.length}`,
      `  Dependencies: ${state.dependencies.length}`,
    ];
    if (state.files.length > 0) {
      lines.push("  Recent files:");
      for (const f of state.files.slice(-5)) {
        lines.push(`    ${f.action === "create" ? "+" : f.action === "delete" ? "-" : "~"} ${f.path}`);
      }
    }
    return lines.join("\n");
  }

  async reset() {
    this.files = [];
    this.processes = [];
    this.dependencies = [];
    this.lastReset = Date.now();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Time Director — Phase Tracking
// ─────────────────────────────────────────────────────────────────────────

export class TimeDirector {
  private startTime: number = 0;
  private config: TimeDirectorConfig;

  // v3: Phase checkpoints
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

  start() {
    this.startTime = Date.now();
  }

  setBudget(budgetMs: number) {
    this.config.totalBudgetMs = budgetMs;
  }

  extendBudget(extraMs: number) {
    this.config.totalBudgetMs += extraMs;
  }

  getBudget(): number {
    return this.config.totalBudgetMs;
  }

  getElapsed(): number {
    return Date.now() - this.startTime;
  }

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

  // ── v3: Phase Checkpoints ──────────────────────────────────────

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

  getPhaseCheckpoints(): PhaseCheckpoint[] {
    return [...this.checkpoints];
  }

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

// ─────────────────────────────────────────────────────────────────────────
// Execution Logger — Trail & Validation Feedback
// ─────────────────────────────────────────────────────────────────────────

export class ExecutionLogger {
  private trail: LogEntry[] = [];
  private consecutiveErrors: number = 0;
  private lastErrorType: string = "";
  private errorSequence: string[] = [];

  logToolCall(toolName: string, args: unknown, result: { content: unknown; isError?: boolean }, isError?: boolean) {
    this.trail.push({
      type: "tool_call",
      timestamp: Date.now(),
      toolName,
      args,
      result: result.content,
      isError: isError ?? result.isError,
    });

    if (isError || result.isError) {
      this.consecutiveErrors++;
      this.lastErrorType = toolName;
      this.errorSequence.push(toolName);
    } else {
      this.consecutiveErrors = 0;
    }

    // Keep trail manageable
    if (this.trail.length > 200) {
      this.trail = this.trail.slice(-100);
    }
  }

  /**
   * Record a self-assessed confidence score for a significant output.
   * Scores: 1=very low, 2=low, 3=medium, 4=high, 5=very high.
   * Scores < 3 are automatically flagged for human review.
   */
  recordConfidence(toolName: string, args: unknown, score: number, rationale: string) {
    const clampedScore = Math.max(1, Math.min(5, Math.round(score)));
    this.trail.push({
      type: "confidence",
      timestamp: Date.now(),
      toolName,
      args,
      confidence: {
        score: clampedScore,
        rationale: rationale.slice(0, 500),
        flagForReview: clampedScore < 3,
      },
    });
    if (this.trail.length > 200) {
      this.trail = this.trail.slice(-100);
    }
  }

  logValidation(validationName: string, command: string, passed: boolean, output: string) {
    this.trail.push({
      type: "validation",
      timestamp: Date.now(),
      validationName,
      command,
      passed,
      output: output.slice(0, 500),
    });
    if (!passed) {
      this.consecutiveErrors++;
      this.errorSequence.push(`validation:${validationName}`);
    } else {
      this.consecutiveErrors = 0;
    }
  }

  getExecutionTrail(): LogEntry[] {
    return [...this.trail];
  }

  getConsecutiveErrors(): number {
    return this.consecutiveErrors;
  }

  /**
   * Detect regression: 3+ consecutive failures of the same type.
   */
  detectRegression(): string | null {
    if (this.errorSequence.length < 3) return null;
    const last3 = this.errorSequence.slice(-3);
    if (last3.every(e => e === last3[0])) {
      return `3 consecutive "${last3[0]}" failures detected`;
    }
    return null;
  }

  summarize(maxEntries: number = 10): string {
    const entries = this.trail.slice(-maxEntries);
    if (entries.length === 0) return "";
    const lines: string[] = [];
    for (const entry of entries) {
      if (entry.type === "validation") {
        const icon = entry.passed ? "✅" : "❌";
        lines.push(`  ${icon} ${entry.validationName}: ${entry.command?.slice(0, 60)}`);
      } else {
        const icon = entry.isError ? "✗" : "→";
        const argsStr = entry.args ? JSON.stringify(entry.args).slice(0, 60) : "";
        lines.push(`  ${icon} ${entry.toolName}: ${argsStr}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * v2: Trail Compression — group older entries by type for long sessions.
   */
  summarizeCompressed(maxEntries: number = 10): string {
    if (this.trail.length <= maxEntries) return this.summarize(maxEntries);

    const recent = this.trail.slice(-maxEntries);
    const older = this.trail.slice(0, -maxEntries);

    const toolCalls = older.filter(e => e.type === "tool_call").length;
    const validations = older.filter(e => e.type === "validation").length;
    const errors = older.filter(e => e.isError).length;
    const passes = older.filter(e => e.type === "validation" && e.passed).length;

    const lines: string[] = [
      `📋 Earlier: ${toolCalls} tool calls, ${validations} validations (${errors} errors, ${passes} passed)`,
      "",
      `📋 Recent (${recent.length} entries):`,
    ];

    for (const entry of recent) {
      if (entry.type === "validation") {
        lines.push(`  ${entry.passed ? "✅" : "❌"} ${entry.validationName}: ${entry.command?.slice(0, 60)}`);
      } else {
        lines.push(`  ${entry.isError ? "✗" : "→"} ${entry.toolName}: ${JSON.stringify(entry.args).slice(0, 60)}`);
      }
    }

    return lines.join("\n");
  }
}

// ── Context Budget Tracker ─────────────────────────────────────────
// Token estimation and context limit monitoring

/**
 * Context budget tracker for monitoring token usage.
 * Uses heuristic: 1 token ≈ 4 chars for text, 1 token ≈ 1 char for code.
 */
export class ContextBudgetTracker {
  private modelContextLimit: number;
  private memoryRetrieved: Array<{ content: string; timestamp: number }> = [];
  private skillsLoaded: Array<{ name: string; content: string }> = [];
  private warnedThresholds: Set<number> = new Set();

  constructor(modelContextLimit: number = 128000) {
    this.modelContextLimit = modelContextLimit;
  }

  setLimit(limit: number): void {
    this.modelContextLimit = limit;
  }

  getLimit(): number {
    return this.modelContextLimit;
  }

  resetWarnings(): void {
    this.warnedThresholds.clear();
  }

  /**
   * Estimate tokens from text content.
   * Heuristic: 1 token ≈ 4 chars for text, 1 token ≈ 1 char for code.
   */
  estimateTokens(text: string, isCode: boolean = false): number {
    if (!text) return 0;
    const chars = text.length;
    if (isCode) return Math.ceil(chars);
    return Math.ceil(chars / 4);
  }

  /**
   * Auto-detect if content looks like code vs natural text.
   */
  private detectIsCode(content: unknown): boolean {
    if (typeof content !== "string") return false;
    const codePatterns = [
      /function\s+\w+\s*\(/, /=>\s*{/, /import\s+.*from/, /export\s+(default\s+)?/,
      /const\s+\w+\s*=/, /let\s+\w+\s*=/, /var\s+\w+\s*=/, /class\s+\w+/,
      /if\s*\(/, /for\s*\(/, /while\s*\(/, /switch\s*\(/, /try\s*{/,
      /\.\w+\(/, /;\s*$/, /```/, /\bdef\s+\w+\s*\(/, /\bclass\s+\w+/,
      /^\s*#\s*include/, /^\s*using\s+namespace/, /^\s*import\s+/, /\bconsole\./,
      /\bmodule\.exports/, /\brequire\(/, /^\s*<\?php/, /^\s*#!/,
    ];
    let matches = 0;
    for (const pattern of codePatterns) {
      if (pattern.test(content)) matches++;
      if (matches >= 2) return true;
    }
    return false;
  }

  /**
   * Estimate tokens from a LogEntry.
   */
  estimateTokensForEntry(entry: LogEntry): number {
    let total = 0;
    if (entry.args) {
      const argsStr = typeof entry.args === "string" ? entry.args : JSON.stringify(entry.args);
      total += this.estimateTokens(argsStr, this.detectIsCode(argsStr));
    }
    if (entry.result) {
      const resultStr = typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result);
      total += this.estimateTokens(resultStr, this.detectIsCode(resultStr));
    }
    if (entry.output) {
      total += this.estimateTokens(entry.output, this.detectIsCode(entry.output));
    }
    return total;
  }

  /**
   * Track a memory retrieval for context estimation.
   */
  trackMemoryRetrieval(content: string): void {
    this.memoryRetrieved.push({ content, timestamp: Date.now() });
    // Keep last 50 retrievals
    if (this.memoryRetrieved.length > 50) {
      this.memoryRetrieved = this.memoryRetrieved.slice(-50);
    }
  }

  /**
   * Track a skill load for context estimation.
   */
  trackSkillLoaded(name: string, content: string): void {
    // Update or add skill
    const existing = this.skillsLoaded.findIndex(s => s.name === name);
    if (existing >= 0) {
      this.skillsLoaded[existing] = { name, content };
    } else {
      this.skillsLoaded.push({ name, content });
    }
  }

  /**
   * Remove a tracked skill.
   */
  untrackSkill(name: string): void {
    this.skillsLoaded = this.skillsLoaded.filter(s => s.name !== name);
  }

  /**
   * Get the list of tracked memory retrievals.
   */
  getMemoryRetrievals(): Array<{ content: string; timestamp: number }> {
    return [...this.memoryRetrieved];
  }

  /**
   * Get the list of tracked skills.
   */
  getSkillsLoaded(): Array<{ name: string; content: string }> {
    return [...this.skillsLoaded];
  }

  /**
   * Get structured context status from live data.
   */
  getContextStatus(
    trail: LogEntry[],
  ): ContextStatusResult {
    const trailTokens = trail.reduce((sum, entry) => sum + this.estimateTokensForEntry(entry), 0);
    const memoryTokens = this.memoryRetrieved.reduce((sum, entry) => sum + this.estimateTokens(entry.content), 0);
    const skillsTokens = this.skillsLoaded.reduce((sum, skill) => sum + this.estimateTokens(skill.content || "", this.detectIsCode(skill.content || "")), 0);

    const totalTokens = trailTokens + memoryTokens + skillsTokens;
    const percentUsed = Math.min(100, Math.round((totalTokens / this.modelContextLimit) * 100));

    // Split trail into recent and compressed (older than the last 10)
    const maxRecent = 10;
    const recentCount = Math.min(trail.length, maxRecent);
    const compressedCount = Math.max(0, trail.length - maxRecent);

    const recentTrail = trail.slice(-maxRecent);
    const olderTrail = trail.slice(0, -maxRecent);
    const recentTok = recentTrail.reduce((sum, entry) => sum + this.estimateTokensForEntry(entry), 0);
    const compressedTok = olderTrail.reduce((sum, entry) => sum + this.estimateTokensForEntry(entry), 0);

    return {
      totalTokens,
      percentUsed,
      modelLimit: this.modelContextLimit,
      trail: {
        totalCount: trail.length,
        recentCount,
        compressedCount,
        recentTokens: recentTok,
        compressedTokens: compressedTok,
        totalTokens: trailTokens,
      },
      memory: {
        count: this.memoryRetrieved.length,
        tokens: memoryTokens,
      },
      skills: {
        count: this.skillsLoaded.length,
        tokens: skillsTokens,
      },
      recommendation: this.getRecommendation(percentUsed, trail.length, this.memoryRetrieved.length, this.skillsLoaded.length),
    };
  }

  /**
   * Get recommendation based on percentage used and component sizes.
   */
  getRecommendation(
    percentUsed: number,
    trailCount?: number,
    memoryCount?: number,
    skillsCount?: number,
  ): string {
    const parts: string[] = [];

    if (percentUsed >= 90) {
      parts.push("⚠️ CRITICAL: Context nearly full. Immediate action recommended:");
    } else if (percentUsed >= 70) {
      parts.push("⚠️ High context usage. Consider compressing:");
    } else if (percentUsed >= 50) {
      parts.push("📋 Moderate context usage. Monitor these areas:");
    } else {
      return "✅ Context usage is healthy — no action needed.";
    }

    if (trailCount && trailCount > 50) {
      parts.push("  • Execution trail: " + trailCount + " entries — consider resetting with /lemonharness:reset");
    } else if (trailCount && trailCount > 20) {
      parts.push("  • Execution trail: " + trailCount + " entries — will be compressed automatically");
    }

    if (memoryCount && memoryCount > 20) {
      parts.push("  • Memory retrieved: " + memoryCount + " entries — use more specific memory queries");
    }

    if (skillsCount && skillsCount > 3) {
      parts.push("  • Skills loaded: " + skillsCount + " — only load essential skills");
    } else if (skillsCount && skillsCount > 0 && percentUsed >= 70) {
      // If few skills but still high usage, suggest trail compression
      if (trailCount && trailCount > 10) {
        parts.push("  • Compress execution trail with summarizeCompressed or /lemonharness:reset");
      }
    }

    if (parts.length === 1) {
      // No specific actions suggested
      parts.push("  • Consider resetting trail with /lemonharness:reset");
      parts.push("  • Narrow memory search scope");
      parts.push("  • Load only essential skills (/skill:<name>)");
    }

    return parts.join("\n");
  }

  /**
   * Format status for display in notifications.
   */
  formatStatus(status: ContextStatusResult): string {
    const lines = [
      "🧠 Context Budget Status",
      "────────────────────────",
      "",
      `Estimated context: ~${this.formatTokens(status.totalTokens)} tokens (${status.percentUsed}% of ${this.formatTokens(status.modelLimit)} limit)`,
      "",
      `📋 Trail entries: ${status.trail.totalCount} total`,
      `   Recent: ${status.trail.recentCount} entries (~${this.formatTokens(status.trail.recentTokens)} tokens)`,
      `   Compressed: ${status.trail.compressedCount} entries (~${this.formatTokens(status.trail.compressedTokens)} tokens)`,
      `   Total: ~${this.formatTokens(status.trail.totalTokens)} tokens`,
      "",
      `💾 Memory retrieved: ${status.memory.count} entries (~${this.formatTokens(status.memory.tokens)} tokens)`,
      `🔧 Skills loaded: ${status.skills.count} skills (~${this.formatTokens(status.skills.tokens)} tokens)`,
      "",
      `📊 Recommendation:`,
      status.recommendation,
    ];
    return lines.join("\n");
  }

  /**
   * Check if any warning thresholds are hit and return messages.
   * Returns an array of {threshold, message} for new threshold hits.
   */
  checkThresholds(percentUsed: number): Array<{ threshold: number; message: string }> {
    const thresholds = [50, 70, 90];
    const hits: Array<{ threshold: number; message: string }> = [];
    for (const threshold of thresholds) {
      if (percentUsed >= threshold && !this.warnedThresholds.has(threshold)) {
        this.warnedThresholds.add(threshold);
        const emoji = threshold >= 90 ? "🔴" : threshold >= 70 ? "⚠️" : "📋";
        hits.push({
          threshold,
          message: `${emoji} Context usage at ${percentUsed}% (exceeded ${threshold}% threshold). Use /lemonharness:context for details.`,
        });
      }
    }
    return hits;
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${tokens}`;
  }
}

/**
 * Structured result from getContextStatus().
 */
export interface ContextStatusResult {
  totalTokens: number;
  percentUsed: number;
  modelLimit: number;
  trail: {
    totalCount: number;
    recentCount: number;
    compressedCount: number;
    recentTokens: number;
    compressedTokens: number;
    totalTokens: number;
  };
  memory: {
    count: number;
    tokens: number;
  };
  skills: {
    count: number;
    tokens: number;
  };
  recommendation: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Snapshot Manager — Workspace Snapshots & Rollback
// ─────────────────────────────────────────────────────────────────────────

export interface SnapshotFileEntry {
  path: string;
  action: "create" | "modify" | "delete";
  diffFile: string;
  oldContentFile?: string;
}

export interface SnapshotMeta {
  id: string;
  timestamp: number;
  description: string;
  files: SnapshotFileEntry[];
}

export interface SnapshotFileChange {
  path: string;
  oldContent: string | null;
  newContent: string | null;
  action: "create" | "modify" | "delete";
}

function sanitizePathForFile(p: string): string {
  return p.replace(/[^a-zA-Z0-9_\-.]/g, "_");
}

export class SnapshotManager {
  private snapshotsDir: string;

  constructor(workspaceDir: string) {
    this.snapshotsDir = join(workspaceDir, "snapshots");
  }

  async init(): Promise<void> {
    await mkdir(this.snapshotsDir, { recursive: true });
  }

  getSnapshotsDir(): string {
    return this.snapshotsDir;
  }

  /**
   * Create a snapshot capturing the diff of changed files.
   * Stores diffs and original content in `.lemonharness/snapshots/<id>/`.
   */
  async createSnapshot(
    id: string,
    description: string,
    changedFiles: SnapshotFileChange[],
  ): Promise<SnapshotMeta> {
    const snapshotDir = join(this.snapshotsDir, id);
    await mkdir(snapshotDir, { recursive: true });

    const meta: SnapshotMeta = {
      id,
      timestamp: Date.now(),
      description,
      files: [],
    };

    for (const file of changedFiles) {
      const safeName = sanitizePathForFile(file.path);
      const diffFileName = `${safeName}.diff`;
      const diffPath = join(snapshotDir, diffFileName);
      const oldContentFileName = `${safeName}.old`;
      const oldContentPath = join(snapshotDir, oldContentFileName);

      // Generate diff between old and new
      const oldStr = file.oldContent ?? "";
      const newStr = file.newContent ?? "";
      const diff = computeUnifiedDiff(oldStr, newStr, file.path);
      if (diff) {
        await writeFile(diffPath, diff, "utf-8");
      }

      // Store old content for reliable rollback
      if (file.oldContent !== null) {
        await writeFile(oldContentPath, file.oldContent, "utf-8");
      }

      const entry: SnapshotFileEntry = {
        path: file.path,
        action: file.action,
        diffFile: diffFileName,
      };
      if (file.oldContent !== null) {
        entry.oldContentFile = oldContentFileName;
      }
      meta.files.push(entry);
    }

    // Write metadata JSON
    const metaPath = join(snapshotDir, "meta.json");
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return meta;
  }

  /**
   * List all available snapshots, newest first.
   */
  async listSnapshots(): Promise<SnapshotMeta[]> {
    try {
      const entries = await readdir(this.snapshotsDir, { withFileTypes: true });
      const snapshots: SnapshotMeta[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = join(this.snapshotsDir, entry.name, "meta.json");
        try {
          const content = await readFile(metaPath, "utf-8");
          snapshots.push(JSON.parse(content));
        } catch {
          // Skip directories without valid meta.json
        }
      }
      snapshots.sort((a, b) => b.timestamp - a.timestamp);
      return snapshots;
    } catch {
      return [];
    }
  }

  /**
   * Get a specific snapshot by ID.
   */
  async getSnapshot(id: string): Promise<SnapshotMeta | null> {
    const metaPath = join(this.snapshotsDir, id, "meta.json");
    try {
      const content = await readFile(metaPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Restore workspace to the state captured in a snapshot.
   * For each file:
   *   - If oldContent exists, restore it (reverse the change)
   *   - If oldContent is null and action was "create", delete the file
   */
  async restoreSnapshot(id: string, projectRoot: string): Promise<{ restored: string[]; errors: string[] }> {
    const meta = await this.getSnapshot(id);
    if (!meta) {
      throw new Error(`Snapshot "${id}" not found`);
    }

    const restored: string[] = [];
    const errors: string[] = [];

    for (const file of meta.files) {
      const absPath = resolve(projectRoot, file.path);
      try {
        if (file.oldContentFile) {
          // Restore from old content backup
          const oldContentPath = join(this.snapshotsDir, id, file.oldContentFile);
          const oldContent = await readFile(oldContentPath, "utf-8");
          await mkdir(dirname(absPath), { recursive: true });
          await writeFile(absPath, oldContent, "utf-8");
          restored.push(file.path);
        } else if (file.action === "create") {
          // File was created — delete it to rollback
          try {
            const { unlink } = await import("node:fs/promises");
            await unlink(absPath);
            restored.push(file.path + " (deleted)");
          } catch {
            // File may already be gone
            restored.push(file.path + " (already removed)");
          }
        }
      } catch (e: any) {
        errors.push(`${file.path}: ${e.message}`);
      }
    }

    return { restored, errors };
  }

  /**
   * Format a snapshot list as a human-readable string.
   */
  formatSnapshotList(meta: SnapshotMeta): string {
    const date = new Date(meta.timestamp);
    const timeStr = date.toLocaleString();
    const lines: string[] = [
      `📸 Snapshot: ${meta.id}`,
      `   When: ${timeStr}`,
      `   Description: ${meta.description}`,
      `   Files: ${meta.files.length}`,
    ];
    for (const f of meta.files) {
      const icon = f.action === "create" ? "+" : f.action === "delete" ? "-" : "~";
      lines.push(`     ${icon} ${f.path}`);
    }
    return lines.join("\n");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Rule Knowledge Manager — Skill Discovery & Domain Detection
// ─────────────────────────────────────────────────────────────────────────

class RuleKnowledgeManager {
  private skills: SkillInfo[] = [];

  async discover(skillsDir: string): Promise<SkillInfo[]> {
    this.skills = [];
    try {
      if (!(await pathExists(skillsDir))) return this.skills;
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(skillsDir, entry.name);
        const skillFile = join(skillPath, "SKILL.md");
        if (await pathExists(skillFile)) {
          const content = await readFile(skillFile, "utf-8");
          const description = this.extractFrontmatterField(content, "description") || entry.name;
          this.skills.push({ name: entry.name, description, path: skillPath });
        }
      }
    } catch { /* Skills directory may not exist yet */ }
    return this.skills;
  }

  getSkills(): SkillInfo[] { return [...this.skills]; }

  getSkill(name: string): SkillInfo | undefined {
    return this.skills.find(s => s.name === name);
  }

  async getSkillContent(name: string): Promise<string | null> {
    const skill = this.getSkill(name);
    if (!skill) return null;
    try { return await readFile(join(skill.path, "SKILL.md"), "utf-8"); } catch { return null; }
  }

  detectDomain(prompt: string): string[] {
    const promptLower = prompt.toLowerCase();
    const matched: string[] = [];

    const patterns: Array<{ name: string; keywords: string[] }> = [
      { name: "ml-workflows", keywords: ["train", "neural network", "deep learning", "machine learning", "model", "dataset", "pytorch", "tensorflow", "loss", "accuracy", "epoch", "batch", "validation", "test set", "random seed"] },
      { name: "bio-design", keywords: ["protein", "dna", "rna", "biological", "genome", "gene", "sequence", "molecular", "drug", "synthesis"] },
      { name: "vision-media", keywords: ["image", "video", "frame", "mask", "pixel", "computer vision", "object detection", "segmentation", "visual", "render"] },
      { name: "systems-recovery", keywords: ["recover", "crash", "backup", "restore", "failover", "disaster", "integrity", "probe", "build system"] },
      { name: "game-logic", keywords: ["game", "player", "score", "move", "state machine", "turn-based", "board", "strategy", "transition"] },
    ];

    for (const pattern of patterns) {
      if (pattern.keywords.filter(kw => promptLower.includes(kw)).length >= 2) {
        matched.push(pattern.name);
      }
    }

    const baseSkills = ["general-rules", "engineering-practices", "self-improvement"];
    for (const base of baseSkills) {
      if (!matched.includes(base)) matched.unshift(base);
    }

    return matched;
  }

  private extractFrontmatterField(content: string, field: string): string | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const line = match[1].split("\n").find(l => l.startsWith(`${field}:`));
    return line ? line.slice(field.length + 1).trim() : null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Settings Helper
// ─────────────────────────────────────────────────────────────────────────

interface LemonHarnessSettings {
  enabled?: boolean;
  workspace?: { dir?: string; allowedPaths?: string[]; blockOutsideWrites?: boolean };
  timeAwareness?: { enabled?: boolean; defaultBudgetMs?: number; exploreRatio?: number; implementRatio?: number; validateRatio?: number; graceBand?: number };
  ruleKnowledge?: { enabled?: boolean; autoDetectDomain?: boolean };
  executionLogging?: { enabled?: boolean; maxTrailEntries?: number; injectTrailInterval?: number };
  structuredTools?: { enabled?: boolean; interceptBuiltins?: boolean };
  heuristics?: { enabled?: boolean; maxHeuristicsPerPrompt?: number };
  contextBudget?: { enabled?: boolean; modelContextLimit?: number; warnThresholds?: number[] };
  skills?: { pseudocodeEnabled?: boolean; verifyOnLoad?: boolean };
  [key: string]: any;
}

let _cachedSettings: LemonHarnessSettings | null = null;

function readLemonHarnessSettings(): LemonHarnessSettings {
  if (_cachedSettings) return _cachedSettings;
  try {
    const settingsPath = join(process.cwd(), ".pi", "settings.json");
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, "utf-8");
      _cachedSettings = JSON.parse(raw).lemonharness || {};
      return _cachedSettings;
    }
  } catch { /* ok */ }
  _cachedSettings = {};
  return {};
}

// ─────────────────────────────────────────────────────────────────────────
// Extension State
// ─────────────────────────────────────────────────────────────────────────

export const workspaceManager = new WorkspaceManager();
export const timeDirector = new TimeDirector();
export const executionLogger = new ExecutionLogger();
export const snapshotManager = new SnapshotManager(
  join(process.cwd(), ".lemonharness"),
);

export const contextBudgetTracker = new ContextBudgetTracker();

// Health checker — periodically checks approach validity, budget, prerequisites
export let healthChecker: any = null;

const ruleKnowledge = new RuleKnowledgeManager();

let previousPhase: TimePhaseName | null = null;
let trailInjectionCounter = 0;

// Stored for session summary generation
export let sessionPromptDescription = "";

// ─────────────────────────────────────────────────────────────────────────
// Extension Export
// ─────────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Session Events ────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const settings = readLemonHarnessSettings();
    workspaceManager.initialize(ctx.cwd, settings.workspace);
    try { await mkdir(workspaceManager.getWorkspaceDir(), { recursive: true }); } catch { /* ok */ }
    // Initialize snapshot manager with actual workspace dir
    const wsDir = workspaceManager.getWorkspaceDir();
    (snapshotManager as any)["snapshotsDir"] = join(wsDir, "snapshots");
    await snapshotManager.init();
    timeDirector.start();
    const budget = settings.timeAwareness?.defaultBudgetMs ?? 300_000;
    timeDirector.setBudget(budget);
    // Initialize context budget tracker with configured limit
    if (settings.contextBudget?.enabled !== false) {
      const limit = settings.contextBudget?.modelContextLimit ?? 128000;
      contextBudgetTracker.setLimit(limit);
      contextBudgetTracker.resetWarnings();
    }
    const skillsDir = join(ctx.cwd, ".pi", "skills");
    await ruleKnowledge.discover(skillsDir);
    // Initialize health checker with default checks
    try {
      const mod = await import("./lemonharness-subsystems");
      healthChecker = new mod.HealthChecker();
      healthChecker.registerDefaultChecks(5);
    } catch { /* subsystems not available — skip health checks */ }

    ctx.ui.setStatus("lemonharness", "🍋 LemonHarness active");
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("lemonharness", undefined);
  });

  // ── Before Agent Start — Inject Knowledge, Time Status, & v3 Heuristics ──

  pi.on("before_agent_start", async (event, ctx) => {
    const settings = readLemonHarnessSettings();
    const systemPromptParts: string[] = [];

    // Store initial prompt description for session summary
    sessionPromptDescription = event.prompt.slice(0, 1000);

    // 1. Workspace boundary instructions
    const wsDir = workspaceManager.getWorkspaceDir();
    systemPromptParts.push(
      `You are running inside a controlled workspace at \`${wsDir}\`.`,
      `All file writes, dependency installations, and artifact creation must`,
      `occur inside this workspace or within the project root. Before each`,
      `state-changing action, check whether the target path is within the`,
      `workspace. The workspace state is available via the \`workspace_state\` tool.`,
    );

    // 2. Time status injection
    if (settings.timeAwareness?.enabled !== false) {
      const budget = estimateBudgetFromPrompt(event.prompt);
      timeDirector.setBudget(budget);
      timeDirector.start();
      systemPromptParts.push("", timeDirector.formatStatus());
    }

    // 3. Rule knowledge injection
    if (settings.ruleKnowledge?.enabled !== false) {
      const autoDetect = settings.ruleKnowledge?.autoDetectDomain !== false;
      if (autoDetect) {
        const domains = ruleKnowledge.detectDomain(event.prompt);
        for (const domain of domains) {
          const content = await ruleKnowledge.getSkillContent(domain);
          if (content) systemPromptParts.push("", `## Relevant Rules: ${domain}`, "", content);
        }
      }
      const skills = ruleKnowledge.getSkills();
      if (skills.length > 0) {
        systemPromptParts.push("", "## Available Skills");
        systemPromptParts.push("Use `/skill:<name>` to load a skill manually. Available skills:");
        for (const skill of skills) {
          systemPromptParts.push(`- \`${skill.name}\`: ${skill.description.slice(0, 120)}`);
        }
      }
    }

    // 4. v3: Heuristic injection (ERL) — load from subsystems if available
    try {
      const mod = await import("./lemonharness-subsystems");
      const settingsFull = readLemonHarnessSettings();
      if (settingsFull.heuristics?.enabled !== false) {
        const workspaceDir2 = workspaceManager.getWorkspaceDir();
        const hm = new mod.HeuristicManager(workspaceDir2);
        await hm.init();
        const domain = ruleKnowledge.detectDomain(event.prompt)[0] || "general";
        const heuristics = hm.getRelevantHeuristics(domain, settingsFull.heuristics?.maxHeuristicsPerPrompt || 5);
        if (heuristics.length > 0) {
          systemPromptParts.push("", hm.formatForPrompt(heuristics));
        }
      }
    } catch { /* subsystems module not available — skip heuristic injection */ }

    // v3: Inject available skill pseudocode contracts (SaP)
    try {
      const mod = await import("./lemonharness-subsystems");
      const settingsFull = readLemonHarnessSettings();
      if (settingsFull.skills?.pseudocodeEnabled !== false) {
        const skills = ruleKnowledge.getSkills();
        const contractLines: string[] = [];
        for (const skill of skills) {
          const sc = await ruleKnowledge.getSkillContent(skill.name);
          if (sc) {
            const pcMatch = sc.match(/## Pseudocode\n\n```[\s\S]*?```/);
            if (pcMatch) {
              const codeBlock = pcMatch[0].replace("## Pseudocode\n\n```\nSKILL ", "").replace("\n```", "").trim();
              contractLines.push("  - " + codeBlock.split("\n")[0] + " — " + skill.description.slice(0, 60));
            }
          }
        }
        if (contractLines.length > 0) {
          systemPromptParts.push("", "📋 Available Skill Contracts (SaP Pseudocode):", ...contractLines);
        }
      }
    } catch { /* SaP contract injection not available */ }

    // 5. Execution trail — with compression for long sessions
    const logInterval = settings.executionLogging?.injectTrailInterval ?? 3;
    trailInjectionCounter++;
    if (trailInjectionCounter % logInterval === 1) {
      const maxEntries = settings.executionLogging?.maxTrailEntries ?? 10;
      const totalEntries = executionLogger.getExecutionTrail().length;
      const trail = totalEntries > maxEntries * 2
        ? executionLogger.summarizeCompressed(maxEntries)
        : executionLogger.summarize(maxEntries);
      if (trail) systemPromptParts.push("", "📋 Recent Execution Trail:", trail);
    }

    return {
      systemPrompt: event.systemPrompt + "\n\n" + systemPromptParts.join("\n"),
    };
  });

  // ── Turn Events — Time Phase Checking ────────────────────────────

  let qualityGateAlreadyTriggered = false;

  pi.on("turn_start", async (_event, ctx) => {
    const settings = readLemonHarnessSettings();
    if (settings.timeAwareness?.enabled === false) return;

    const phase = timeDirector.getCurrentPhase();

    // Auto-extend budget if in grace band with low remaining time
    if (timeDirector.isInGraceBand() && phase.remainingMs < 30_000) {
      const extension = Math.round(phase.remainingMs * 0.2);
      timeDirector.extendBudget(extension);
    }

    const currentPhase = timeDirector.getCurrentPhase();

    // Detect phase transitions
    if (previousPhase && currentPhase.phase !== previousPhase) {
      ctx.ui.notify(
        `🍋 Phase transition: ${previousPhase} → ${currentPhase.phase} (${Math.round(currentPhase.totalProgress * 100)}% budget used)`,
        "info",
      );

      // v3: Record phase checkpoint
      const wsState = workspaceManager.getWorkspaceState();
      const trail = executionLogger.summarize(3);
      const cp = timeDirector.recordPhaseCheckpoint(
        currentPhase.phase,
        JSON.stringify({ files: wsState.files.length, deps: wsState.dependencies.length }),
        trail.replace(/\n/g, " | "),
      );
      ctx.ui.setStatus("lemonharness-checkpoint", `📍 Checkpoint: ${cp.phase} (DA: ${(cp.decisionAdvantage * 100).toFixed(0)}%)`);

      // Auto-generate session summary on P4 (Reserve) entry
      if (currentPhase.phase === "reserve" && previousPhase !== "reserve") {
        try {
          const summaryMod = await import("./lemonharness-summary");
          const summary = new summaryMod.SessionSummary(join(workspaceManager.getWorkspaceDir()));
          const markdown = await summaryMod.buildSummaryFromLiveDataExternal(
            summary,
            workspaceManager,
            timeDirector,
            executionLogger,
            ctx,
            sessionPromptDescription,
          );
          const path = await summary.saveSummary(markdown);
          ctx.ui.notify(`📝 Session summary auto-generated and saved to \`${path}\``, "success");
        } catch (err: any) {
          ctx.ui.notify(`⚠️ Auto-generate summary note: ${err.message}`, "info");
        }

        // Auto-generate confidence summary on P4 (Reserve) entry
        const confTrail = executionLogger.getExecutionTrail().filter(e => e.type === "confidence" && e.confidence);
        if (confTrail.length > 0) {
          const confLines: string[] = [
            "📊 Confidence Summary (P4 Reserve)",
            "─────────────────────────────────────",
            "",
          ];
          const flagged = confTrail.filter(e => e.confidence!.flagForReview);
          const scores = confTrail.map(e => e.confidence!.score);
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

          confLines.push(`Total recorded: ${confTrail.length}`);
          confLines.push(`Average confidence: ${avg.toFixed(1)}/5`);
          confLines.push(`Range: ${Math.min(...scores)}–${Math.max(...scores)}`);
          confLines.push(`Flagged for review: ${flagged.length}`);

          if (flagged.length > 0) {
            confLines.push("", "🔔 OUTPUTS NEEDING HUMAN REVIEW:");
            confLines.push("");
            for (const entry of flagged) {
              const c = entry.confidence!;
              const label: Record<number, string> = { 1: "Very Low", 2: "Low" };
              confLines.push(`   ⚠ [${label[c.score] || c.score}] ${entry.toolName || "unknown"}`);
              confLines.push(`      Rationale: ${c.rationale}`);
            }
            confLines.push("", "Review these outputs before finalizing.");
          } else {
            confLines.push("", "✅ No outputs flagged for review — confidence is acceptable.");
          }

          ctx.ui.notify(confLines.join("\n"), flagged.length > 0 ? "warning" : "success");
        } else {
          ctx.ui.notify("ℹ No confidence scores recorded this session.", "info");
        }
      }

      // Auto-trigger quality gate on P3 (Validate) entry
      if (currentPhase.phase === "validate" && !qualityGateAlreadyTriggered) {
        qualityGateAlreadyTriggered = true;
        const scriptPath = join(workspaceManager.getProjectRoot(), ".lemonharness", "quality-gate.sh");
        pathExists(scriptPath).then(exists => {
          if (!exists) return;
          const qgChild = spawn("bash", ["-c", `bash "${scriptPath}"`], {
            cwd: workspaceManager.getProjectRoot(),
            stdio: ["pipe", "pipe", "pipe"],
          });
          let qgStdout = "", qgStderr = "";
          qgChild.stdout?.on("data", (d: Buffer) => { qgStdout += d.toString(); });
          qgChild.stderr?.on("data", (d: Buffer) => { qgStderr += d.toString(); });
          qgChild.on("close", (code) => {
            const output = qgStdout + qgStderr;
            const passed = code === 0 || output.includes("All checks pass");
            if (passed) ctx.ui.notify("✅ Auto quality gate PASSED — code quality within thresholds", "success");
            else ctx.ui.notify(`⚠️ Auto quality gate FAILED — review issues before continuing\n${output.slice(0, 500)}`, "warning");
          });
        });
      }
    }
    previousPhase = currentPhase.phase;

    // Update status bar
    const elapsed = formatDuration(currentPhase.elapsedMs);
    const remaining = formatDuration(currentPhase.remainingMs);
    ctx.ui.setStatus(
      "lemonharness-time",
      `🍋 ${currentPhase.phase.toUpperCase()} ${Math.round(currentPhase.totalProgress * 100)}% | ${elapsed} / ${remaining}`,
    );
  });

  pi.on("turn_end", async (_event, ctx) => {
    const state = workspaceManager.getWorkspaceState();
    ctx.ui.setStatus(
      "lemonharness-workspace",
      `📁 ${state.files.length} files, ${state.dependencies.length} deps`,
    );

    // Run periodic health checks
    if (healthChecker) {
      const phase = timeDirector.getCurrentPhase();
      const trail = executionLogger.getExecutionTrail();
      const totalToolCalls = trail.filter(t => t.type === "tool_call").length;
      const totalErrors = trail.filter(t => t.isError).length;
      const validationsPassed = trail.filter(t => t.passed === true).length;
      const validationsFailed = trail.filter(t => t.passed === false).length;
      const recentTrail = trail.slice(-10);
      const recentErrors = recentTrail.filter(t => t.isError).length;
      const errorRate = recentTrail.length > 0 ? recentErrors / recentTrail.length : 0;
      const regressionMsg = executionLogger.detectRegression();

      healthChecker.runChecks({
        elapsedMs: timeDirector.getElapsed(),
        totalBudgetMs: timeDirector.getBudget(),
        currentPhase: phase.phase,
        phaseProgress: phase.phaseProgress,
        totalProgress: phase.totalProgress,
        totalToolCalls,
        totalErrors,
        consecutiveErrors: executionLogger.getConsecutiveErrors(),
        errorRate,
        regressionDetected: regressionMsg !== null,
        regressionMessage: regressionMsg,
        filesModified: state.files.length,
        dependencies: state.dependencies,
        dependencyCount: state.dependencies.length,
        validationsPassed,
        validationsFailed,
      });

      // Surface pending alerts
      const alerts = healthChecker.getAlerts();
      for (const alert of alerts) {
        if (alert.severity === "red") {
          ctx.ui.notify(`🔴 [Health Check] ${alert.name}: ${alert.message}`, "error");
        } else if (alert.severity === "yellow") {
          ctx.ui.notify(`⚠️  [Health Check] ${alert.name}: ${alert.message}`, "warning");
        }
      }
    }

    // ── Context Budget Auto-Check ────────────────────────────────
    // Check threshold warnings on every turn end
    const settings = readLemonHarnessSettings();
    if (settings.contextBudget?.enabled !== false) {
      const trail = executionLogger.getExecutionTrail();
      const status = contextBudgetTracker.getContextStatus(trail);
      const thresholdHits = contextBudgetTracker.checkThresholds(status.percentUsed);
      for (const hit of thresholdHits) {
        ctx.ui.notify(hit.message, hit.threshold >= 90 ? "error" : hit.threshold >= 70 ? "warning" : "info");
      }
    }
  });

  // ── Tool Call Interception — Workspace Boundary ──────────────────

  pi.on("tool_call", async (event, ctx) => {
    const settings = readLemonHarnessSettings();

    // Intercept write tool
    if (isToolCallEventType("write", event)) {
      if (!settings.structuredTools?.interceptBuiltins) return;
      const writePath = event.input.path as string;
      const absPath = resolve(ctx.cwd, writePath);
      if (workspaceManager.wouldBlockWrite(absPath)) {
        ctx.ui.notify(`🍋 Blocked write outside workspace: ${writePath}`, "warning");
        return { block: true, reason: `Write target "${writePath}" is outside the workspace boundary. Use the workspace_root or allowed paths.` };
      }
    }

    // Intercept edit tool
    if (isToolCallEventType("edit", event)) {
      if (!settings.structuredTools?.interceptBuiltins) return;
      const editPath = event.input.path as string;
      const absPath = resolve(ctx.cwd, editPath);
      if (workspaceManager.wouldBlockWrite(absPath)) {
        ctx.ui.notify(`🍋 Blocked edit outside workspace: ${editPath}`, "warning");
        return { block: true, reason: `Edit target "${editPath}" is outside the workspace boundary.` };
      }
    }

    // Intercept bash tool — detect state changes
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command as string;
      const stateChange = detectBashStateChange(command);
      if (stateChange) workspaceManager.trackProcess(command, 0);
    }
  });

  // ── Tool Result — Logging ─────────────────────────────────────────

  pi.on("tool_result", async (event, ctx) => {
    executionLogger.logToolCall(
      event.toolName,
      event.input,
      { content: event.content, isError: event.isError },
      event.isError,
    );

    // Track memory retrievals for context budget estimation
    if (event.toolName === "workspace_memory_search") {
      const contentStr = typeof event.content === "string" ? event.content : JSON.stringify(event.content || "");
      contextBudgetTracker.trackMemoryRetrieval(contentStr);
    }

    // Track record tool output too (it gets injected into context)
    if (event.toolName === "workspace_memory_record") {
      const contentStr = typeof event.content === "string" ? event.content : JSON.stringify(event.content || "");
      contextBudgetTracker.trackMemoryRetrieval(contentStr);
    }

    if (event.isError) {
      const regression = executionLogger.detectRegression();
      if (regression) {
        ctx.ui.notify(`🧠 Regression detected: ${regression}`, "warning");
        // Auto-suggest rollback when 3+ consecutive failures detected
        const snapshots = await snapshotManager.listSnapshots();
        if (snapshots.length > 0) {
          const latest = snapshots[0];
          ctx.ui.notify(
            `💡 Auto-suggestion: Consider rollback with /lemonharness:rollback ${latest.id} to restore state before failures`,
            "info",
          );
        }
      }
    }
  });

  // ── P4 Reserve Phase Enforcement ──────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    const settings = readLemonHarnessSettings();
    if (settings.timeAwareness?.enabled === false) return;
    const phase = timeDirector.getCurrentPhase();
    if (phase.phase !== "reserve") return;
    const stateChangingTools = ["write", "edit", "bash"];
    if (stateChangingTools.includes(event.toolName)) {
      return { block: true, reason: "You are in the RESERVE phase (last 10% of time budget). Stop initiating new state-changing actions. Preserve whatever acceptable result is on disk. Only perform minimal validation or output formatting." };
    }
  });

  // ── Custom Tools ──────────────────────────────────────────────────

  pi.registerTool({
    name: "workspace_write",
    label: "Workspace Write",
    description: "Write content to a file within the controlled workspace. Use this instead of the generic write tool for state-changing operations. Paths are relative to the project root.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path within the project" }),
      content: Type.String({ description: "File content to write" }),
      overwrite: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const ws = workspaceManager;
      const absPath = resolve(ws.getProjectRoot(), params.path);
      if (ws.wouldBlockWrite(absPath)) {
        return { content: [{ type: "text" as const, text: `Error: Path "${params.path}" is outside the workspace boundary.` }], isError: true, details: {} };
      }
      await mkdir(dirname(absPath), { recursive: true });
      if (await pathExists(absPath) && !params.overwrite) {
        return { content: [{ type: "text" as const, text: `Error: File "${params.path}" already exists. Set overwrite=true to replace.` }], isError: true, details: {} };
      }
      // Read old content for snapshot before modifying
      let oldContent: string | null = null;
      let fileExisted = false;
      if (await pathExists(absPath)) {
        try { oldContent = await readFile(absPath, "utf-8"); fileExisted = true; } catch { /* ok */ }
      }
      await writeFile(absPath, params.content, "utf-8");
      workspaceManager.trackFileWrite(params.path, fileExisted ? "modify" : "create");
      // Auto-create snapshot for this change
      try {
        const snapshotId = `auto-${Date.now()}`;
        await snapshotManager.createSnapshot(snapshotId, `auto: ${fileExisted ? "write" : "create"} ${params.path}`, [{
          path: params.path,
          oldContent,
          newContent: params.content,
          action: fileExisted ? "modify" : "create",
        }]);
      } catch { /* snapshot best-effort */ }
      return { content: [{ type: "text" as const, text: `Written ${params.path} (${params.content.length} chars)` }], details: { path: params.path, size: params.content.length } };
    },
  });

  pi.registerTool({
    name: "workspace_append",
    label: "Workspace Append",
    description: "Append content to a file within the controlled workspace. Creates the file if it doesn't exist.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path within the project" }),
      content: Type.String({ description: "Content to append" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const ws = workspaceManager;
      const absPath = resolve(ws.getProjectRoot(), params.path);
      if (ws.wouldBlockWrite(absPath)) {
        return { content: [{ type: "text" as const, text: `Error: Path "${params.path}" is outside the workspace boundary.` }], isError: true, details: {} };
      }
      await mkdir(dirname(absPath), { recursive: true });
      // Read old content for snapshot before modifying
      let oldContent: string | null = null;
      let fileExisted = false;
      if (await pathExists(absPath)) {
        try { oldContent = await readFile(absPath, "utf-8"); fileExisted = true; } catch { /* ok */ }
      }
      await appendFile(absPath, params.content, "utf-8");
      // Read new content after append for snapshot diff
      let newContent: string = "";
      try { newContent = await readFile(absPath, "utf-8"); } catch { /* ok */ }
      workspaceManager.trackFileWrite(params.path, "modify");
      // Auto-create snapshot for this change
      try {
        const snapshotId = `auto-${Date.now()}`;
        await snapshotManager.createSnapshot(snapshotId, `auto: append to ${params.path}`, [{
          path: params.path,
          oldContent,
          newContent,
          action: fileExisted ? "modify" : "create",
        }]);
      } catch { /* snapshot best-effort */ }
      return { content: [{ type: "text" as const, text: `Appended to ${params.path}` }], details: { path: params.path } };
    },
  });

  pi.registerTool({
    name: "workspace_state",
    label: "Workspace State",
    description: "Get the current workspace state summary — files modified, processes spawned, dependencies installed.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      return { content: [{ type: "text" as const, text: workspaceManager.formatState() }], details: workspaceManager.getWorkspaceState() };
    },
  });

  pi.registerTool({
    name: "workspace_exec",
    label: "Workspace Exec",
    description: "Execute a shell command within the project directory. Use this instead of the generic bash tool to ensure commands are tracked.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const ws = workspaceManager;
      return new Promise((resolvePromise) => {
        const timeout = (params.timeout ?? 30) * 1000;
        const child = spawn("bash", ["-c", params.command], { cwd: ws.getProjectRoot(), stdio: ["pipe", "pipe", "pipe"], signal });
        const timer = setTimeout(() => { child.kill("SIGTERM"); }, timeout);
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code) => {
          clearTimeout(timer);
          const combined = stdout + stderr;
          resolvePromise({
            content: [{ type: "text" as const, text: combined.slice(0, 5000) || "(no output)" }],
            details: { exitCode: code, stdout: stdout.slice(0, 1000), stderr: stderr.slice(0, 1000) },
            isError: code !== 0,
          });
        });
        child.on("error", () => { clearTimeout(timer); resolvePromise({ content: [{ type: "text" as const, text: "Process failed to start" }], isError: true, details: {} }); });
      });
    },
  });

  pi.registerTool({
    name: "workspace_install_dep",
    label: "Install Dependency",
    description: "Install a dependency in the project environment. Supports npm, pip, and apt package managers.",
    parameters: Type.Object({
      package: Type.String({ description: "Package name to install" }),
      manager: Type.Optional(Type.Union([Type.Literal("npm"), Type.Literal("pip"), Type.Literal("apt")], { description: "Package manager: npm, pip, or apt (default: npm)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const ws = workspaceManager;
      const mgr = params.manager || "npm";
      const cmd = mgr === "npm" ? `npm install --save-dev ${params.package}` :
                  mgr === "pip" ? `pip install ${params.package}` :
                  `sudo apt install -y ${params.package}`;

      return new Promise((resolvePromise) => {
        const child = spawn("bash", ["-c", cmd], { cwd: ws.getProjectRoot(), stdio: ["pipe", "pipe", "pipe"], signal });
        const timer = setTimeout(() => { child.kill("SIGTERM"); }, 120_000);
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code) => {
          clearTimeout(timer);
          ws.trackDependency(params.package);
          resolvePromise({
            content: [{ type: "text" as const, text: code === 0 ? `✅ Installed ${params.package} via ${mgr}` : `❌ Failed to install ${params.package}: ${stderr.slice(0, 300)}` }],
            details: { package: params.package, manager: mgr, exitCode: code },
            isError: code !== 0,
          });
        });
        child.on("error", () => { clearTimeout(timer); resolvePromise({ content: [{ type: "text" as const, text: "Process failed to start" }], isError: true, details: {} }); });
      });
    },
  });

  pi.registerTool({
    name: "workspace_validate",
    label: "Validate",
    description: "Run a validation or verification command and record the result. Use this for testing, validation, and verification steps.",
    parameters: Type.Object({
      command: Type.String({ description: "Validation command to run" }),
      expected: Type.Optional(Type.String({ description: "Expected outcome description" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const cmd = params.command;
      return new Promise((resolvePromise) => {
        const child = spawn("bash", ["-c", cmd], { cwd: workspaceManager.getProjectRoot(), stdio: ["pipe", "pipe", "pipe"], signal });
        const timer = setTimeout(() => { child.kill("SIGTERM"); }, 60_000);
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code) => {
          clearTimeout(timer);
          const output = stdout + stderr;
          const passed = code === 0;
          executionLogger.logValidation(cmd.slice(0, 60), cmd, passed, output.slice(0, 500));
          resolvePromise({
            content: [{ type: "text" as const, text: passed ? `✅ Validation passed\n${output.slice(0, 2000)}` : `❌ Validation failed (exit ${code})\n${output.slice(0, 2000)}` }],
            details: { command: cmd, exitCode: code, passed, expected: params.expected },
            isError: !passed,
          });
        });
        child.on("error", () => { clearTimeout(timer); resolvePromise({ content: [{ type: "text" as const, text: "Validation process failed to start" }], isError: true, details: {} }); });
      });
    },
  });

  pi.registerTool({
    name: "workspace_create_temp",
    label: "Create Temp",
    description: "Create a temporary directory or artifact within the workspace. Use for intermediate files, caches, or build artifacts.",
    parameters: Type.Object({
      prefix: Type.Optional(Type.String({ description: "Optional prefix for the temp directory name" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const prefix = params.prefix || "lemonharness-tmp";
      const dir = join(workspaceManager.getWorkspaceDir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      await mkdir(dir, { recursive: true });
      workspaceManager.trackFileWrite(dir, "create");
      return { content: [{ type: "text" as const, text: `Created temporary directory: ${dir}` }], details: { path: dir } };
    },
  });

  // ── Commands ─────────────────────────────────────────────────────

  pi.registerCommand("lemonharness:status", {
    description: "Show current workspace state, phase, and budget usage",
    handler: async (_args, ctx) => {
      const ws = workspaceManager;
      const phase = timeDirector.getCurrentPhase();
      const trail = executionLogger.getExecutionTrail();
      const totalCalls = trail.length;
      const errors = trail.filter(t => t.isError).length;
      const validations = trail.filter(t => t.validationName).length;
      const passedValidations = trail.filter(t => t.passed).length;
      const regressions = executionLogger.detectRegression();
      const decisionAdvantage = timeDirector.getDecisionAdvantageDecay();

      const confidenceEntries = trail.filter(e => e.type === "confidence" && e.confidence);
      const avgScore = confidenceEntries.length > 0
        ? (confidenceEntries.reduce((sum, e) => sum + e.confidence!.score, 0) / confidenceEntries.length).toFixed(1)
        : "N/A";
      const lowConfItems = confidenceEntries.filter(e => e.confidence!.flagForReview);

      const lines = [
        "🍋 LemonHarness Status",
        "───────────────────────",
        "",
        `📁 Workspace: ${ws.formatState()}`,
        "",
        `⏱ Phase: ${phase.phase.toUpperCase()} (${Math.round(phase.totalProgress * 100)}% of budget)`,
        `   Elapsed: ${formatDuration(phase.elapsedMs)} / Remaining: ${formatDuration(phase.remainingMs)}`,
        `   Decision advantage: ${(decisionAdvantage * 100).toFixed(0)}% (decay = exp(-0.3 * ${timeDirector.getPhaseCheckpoints().length} checkpoints))`,
        "",
        `📊 Tool calls: ${totalCalls} | Errors: ${errors} | Validations: ${validations} (${passedValidations} passed)`,
        regressions ? `⚠ Regression: ${regressions}` : "✓ No regressions detected",
        "",
        `📊 Confidence: ${confidenceEntries.length} recorded | Avg: ${avgScore}/5 | Flagged: ${lowConfItems.length}`,
      ];

      if (lowConfItems.length > 0) {
        lines.push("", "🔔 Items flagged for human review (confidence < 3):");
        for (const entry of lowConfItems) {
          lines.push(`   ⚠ ${entry.toolName || "unknown"}: ${entry.confidence!.rationale.slice(0, 80)}`);
        }
      }

      const checkpoints = timeDirector.getPhaseCheckpoints();
      if (checkpoints.length > 0) {
        lines.push("", "📍 Phase Checkpoints:");
        for (const cp of checkpoints) {
          lines.push(`   ${cp.phase} at ${Math.round(cp.elapsedMs / 1000)}s (DA: ${(cp.decisionAdvantage * 100).toFixed(0)}%)`);
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("lemonharness:context", {
    description: "Show context budget estimation — token usage, trail, memory, skills, and recommendations",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const status = contextBudgetTracker.getContextStatus(trail);
      const message = contextBudgetTracker.formatStatus(status);
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("lemonharness:budget", {
    description: "Set time budget in seconds for the current task. Usage: /lemonharness:budget <seconds>",
    handler: async (args, ctx) => {
      const seconds = parseInt(args.trim(), 10);
      if (isNaN(seconds) || seconds <= 0) {
        ctx.ui.notify("Please provide a valid number of seconds. Usage: /lemonharness:budget <seconds>", "error");
        return;
      }
      timeDirector.setBudget(seconds * 1000);
      timeDirector.start();
      ctx.ui.notify(`🍋 Time budget set to ${formatDuration(seconds * 1000)}`, "success");
    },
  });

  pi.registerCommand("lemonharness:reset", {
    description: "Reset workspace tracking",
    handler: async (_args, ctx) => {
      workspaceManager.reset();
      timeDirector.start();
      executionLogger.getExecutionTrail().length = 0;
      ctx.ui.notify("🍋 Workspace and time tracking reset", "success");
    },
  });

  pi.registerCommand("lemonharness:health", {
    description: "Show periodic health check status: approach validity, budget health, prerequisite changes",
    handler: async (_args, ctx) => {
      if (!healthChecker) {
        ctx.ui.notify("Health checker not available (subsystems module not loaded)", "warning");
        return;
      }
      ctx.ui.notify(healthChecker.getStatus(), "info");
    },
  });

  pi.registerCommand("lemonharness:validate", {
    description: "Run a validation command and record its result. Usage: /lemonharness:validate <command>",
    handler: async (args, ctx) => {
      const cmd = args.trim();
      if (!cmd) { ctx.ui.notify("Please provide a command to run. Usage: /lemonharness:validate <command>", "error"); return; }
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
          ctx.ui.notify(passed ? `✅ Validation passed\n${output.slice(0, 1000)}` : `❌ Validation failed (exit ${code})\n${output.slice(0, 1000)}`, passed ? "success" : "error");
        });
      } catch (e: any) { ctx.ui.notify(`❌ Validation error: ${e.message}`, "error"); }
    },
  });

  pi.registerCommand("lemonharness:confidence", {
    description: "Show all recorded confidence scores, flagging low-confidence outputs for review. Usage: /lemonharness:confidence",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const confidenceEntries = trail.filter(e => e.type === "confidence" && e.confidence);

      if (confidenceEntries.length === 0) {
        ctx.ui.notify("No confidence scores recorded yet. Use workspace_write / workspace_validate / workspace_memory_record to generate outputs, then call recordConfidence().", "info");
        return;
      }

      const lines: string[] = [
        "📊 Confidence Scores",
        "─────────────────────",
      ];

      const lowConfidence = confidenceEntries.filter(e => e.confidence!.flagForReview);
      const flagged: string[] = [];

      for (const entry of confidenceEntries) {
        const c = entry.confidence!;
        const label: Record<number, string> = { 1: "🔴 Very Low", 2: "🟠 Low", 3: "🟡 Medium", 4: "🟢 High", 5: "🟢 Very High" };
        const stars = "★".repeat(c.score) + "☆".repeat(5 - c.score);
        lines.push(`\n${label[c.score] || "⚪ Unknown"} (${c.score}/5) ${stars}`);
        lines.push(`   Tool: ${entry.toolName || "unknown"}`);
        lines.push(`   Rationale: ${c.rationale}`);
        if (c.flagForReview) {
          lines.push(`   ⚠ FLAGGED FOR REVIEW`);
          flagged.push(entry.toolName || "unknown");
        }
      }

      lines.push("", "─────────────────────");
      lines.push(`Total: ${confidenceEntries.length} | Flagged for review: ${flagged.length}`);

      if (flagged.length > 0) {
        lines.push("", "🔔 Items needing human review:");
        for (const name of flagged) {
          lines.push(`   ⚠ ${name}`);
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── /improvement:* Commands ──────────────────────────────────────

  pi.registerCommand("improvement:reflect", {
    description: "Run a structured self-reflection on recent actions, failures, and lessons",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const recentTurns = trail.slice(-6);
      const lines = [
        "🌀 Self-Reflection",
        "─────────────────",
        "",
        "Step back and consider:",
        "",
        "1️⃣  What has happened recently?",
        ...recentTurns.map(t => { const icon = t.isError ? "✗" : "✓"; return `   ${icon} ${t.toolName || t.validationName}: ${typeof t.args === "object" ? JSON.stringify(t.args).slice(0, 80) : t.args}`; }),
        "",
        "2️⃣  What worked well?",
        "   (Consider recording as solution/pattern)",
        "",
        "3️⃣  What didn't work?",
        "   (Consider recording as failure with root cause)",
        "",
        "4️⃣  What should I do differently going forward?",
        "   (Consider recording as insight, tag: self-improvement)",
        "",
        "5️⃣  Is there a process I should automate or change?",
        "",
        "Use `workspace_memory_record` to save any lessons.",
        "Use `workspace_memory_search` to find past lessons.",
      ];

      // v3: Try to extract heuristics using ERL from subsystems
      try {
        const mod = await import("./lemonharness-subsystems");
        const workspaceDir2 = workspaceManager.getWorkspaceDir();
        const hm = new mod.HeuristicManager(workspaceDir2);
        await hm.init();
        const extracted: string[] = [];
        for (const t of recentTurns) {
          if (t.isError) {
            const h = hm.extractHeuristic(
              "failure",
              `${t.toolName} failed`,
              JSON.stringify(t.args || ""),
              "general",
            );
            if (h) extracted.push(`• "${h.rule}" (${h.type}, confidence: ${h.confidence.toFixed(2)})`);
          }
        }
        if (extracted.length > 0) {
          lines.push("", "🧪 Extracted Heuristics (ERL):");
          lines.push(...extracted);
          lines.push("", `   ${extracted.length} heuristic(s) saved. Use /lemonharness:heuristics to view all.`);
        }
      } catch { /* subsystems not available */ }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("improvement:review", {
    description: "Review improvement history and trends from this session",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const totalCalls = trail.length;
      const errors = trail.filter(t => t.isError).length;
      const validations = trail.filter(t => t.validationName).length;
      const passedValidations = trail.filter(t => t.passed).length;
      const lines = [
        "📈 Self-Improvement Review",
        "──────────────────────────",
        "", `Session stats: ${totalCalls} tool calls, ${errors} errors, ${validations} validations`,
        errors > 0 ? `⚠  ${errors} errors detected — review with /improvement:reflect` : "✓ No errors recorded this session",
        validations > 0 ? `✓ ${passedValidations}/${validations} validations passed` : "ℹ No validations run yet",
        "", "📋 Self-Improvement Checklist:",
        "", "  [ ] Have I recorded failures with root cause analysis?",
        "  [ ] Have I identified patterns I should automate?",
        "  [ ] Have I searched memory for relevant past experience?",
        "  [ ] Have I applied lessons from previous sessions?",
        "  [ ] Have I run workspace_memory_distill to promote patterns?",
        "", '💡 Tip: Record lessons with workspace_memory_record tags="self-improvement"',
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("improvement:status", {
    description: "Show self-improvement metrics and recent lessons",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const totalCalls = trail.length;
      const errorRate = totalCalls > 0 ? Math.round((trail.filter(t => t.isError).length / totalCalls) * 100) : 0;
      const lines = [
        "🌀 Self-Improvement Status",
        "──────────────────────────",
        "", `📊 Tool calls: ${totalCalls}  |  Error rate: ${errorRate}%`,
        "", "📋 Self-Improvement Rules (always active):",
        "", "  1. Every failure is a learning opportunity — record it",
        "  2. Detect suboptimal patterns proactively",
        "  3. Track improvements in memory with tags=self-improvement",
        "  4. Stop when improvements yield <5% gain (diminishing returns)",
        "  5. Codify improvements into process changes",
        "  6. Conduct regular self-reviews",
        "  7. Track improvement velocity across sessions",
        "  8. Make improvements portable across sessions",
        "  9. Treat user corrections as gold",
        " 10. Self-correct in real-time",
        "", '💡 Use /improvement:reflect for structured reflection',
        "", 'See .pi/skills/self-improvement/SKILL.md for full guidelines',
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── /lemonharness:snapshot,* Commands ──────────────────────────

  pi.registerCommand("lemonharness:snapshot", {
    description: "Create a manual snapshot of all tracked workspace files. Usage: /lemonharness:snapshot [description]",
    handler: async (args, ctx) => {
      const state = workspaceManager.getWorkspaceState();
      const files = state.files;
      if (files.length === 0) {
        ctx.ui.notify("No files tracked yet. Use workspace_write or workspace_append first.", "warning");
        return;
      }

      const desc = args.trim() || `Manual snapshot at ${new Date().toLocaleString()}`;
      const snapshotId = `manual-${Date.now()}`;
      const changedFiles: SnapshotFileChange[] = [];

      // Read current content of all tracked files
      for (const file of files) {
        const absPath = resolve(workspaceManager.getProjectRoot(), file.path);
        try {
          const content = await readFile(absPath, "utf-8");
          changedFiles.push({
            path: file.path,
            oldContent: null, // old not applicable for full-state snapshot
            newContent: content,
            action: "modify",
          });
        } catch {
          // File may have been deleted
          changedFiles.push({
            path: file.path,
            oldContent: null,
            newContent: null,
            action: "delete",
          });
        }
      }

      try {
        const meta = await snapshotManager.createSnapshot(snapshotId, desc, changedFiles);
        ctx.ui.notify(
          `📸 Snapshot created: ${snapshotId}\n   ${desc}\n   ${meta.files.length} file(s) captured`,
          "success",
        );
      } catch (e: any) {
        ctx.ui.notify(`❌ Failed to create snapshot: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("lemonharness:snapshots", {
    description: "List all available snapshots",
    handler: async (_args, ctx) => {
      try {
        const snapshots = await snapshotManager.listSnapshots();
        if (snapshots.length === 0) {
          ctx.ui.notify("No snapshots available. Use /lemonharness:snapshot to create one, or workspace_write/workspace_append to auto-create.", "info");
          return;
        }
        const lines = [
          "📸 Available Snapshots",
          "─────────────────────",
        ];
        for (const snap of snapshots) {
          lines.push("");
          lines.push(snapshotManager.formatSnapshotList(snap));
        }
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (e: any) {
        ctx.ui.notify(`❌ Failed to list snapshots: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("lemonharness:rollback", {
    description: "Restore workspace to a previous snapshot state. Usage: /lemonharness:rollback <id>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) {
        const snapshots = await snapshotManager.listSnapshots();
        if (snapshots.length === 0) {
          ctx.ui.notify("No snapshots available. Usage: /lemonharness:rollback <snapshot-id>", "error");
          return;
        }
        ctx.ui.notify(
          `Usage: /lemonharness:rollback <snapshot-id>\nAvailable snapshots:\n${snapshots.map(s => s.id).join(", ")}`,
          "info",
        );
        return;
      }

      ctx.ui.notify(`🔄 Restoring snapshot "${id}"...`, "info");

      try {
        const result = await snapshotManager.restoreSnapshot(id, workspaceManager.getProjectRoot());
        const lines = [
          `🔄 Rollback complete for snapshot "${id}":`,
          `   Restored: ${result.restored.length} file(s)`,
        ];
        for (const r of result.restored) {
          lines.push(`     ✓ ${r}`);
        }
        if (result.errors.length > 0) {
          lines.push(`   Errors: ${result.errors.length}`);
          for (const e of result.errors) {
            lines.push(`     ✗ ${e}`);
          }
        }
        ctx.ui.notify(lines.join("\n"), result.errors.length === 0 ? "success" : "warning");
      } catch (e: any) {
        ctx.ui.notify(`❌ Rollback failed: ${e.message}`, "error");
      }
    },
  });

  // /skill:<name> — Manually load skill content (v3: with SaP pseudocode verification)
  pi.on("input", async (event, ctx) => {
    const skillMatch = event.text.match(/^\/skill:([\w-]+)/);
    if (!skillMatch) return { action: "continue" as const };
    const skillName = skillMatch[1];
    const skillContent = await ruleKnowledge.getSkillContent(skillName);
    if (!skillContent) {
      ctx.ui.notify(`🍋 Skill "${skillName}" not found. Available: ${ruleKnowledge.getSkills().map(s => s.name).join(", ")}`, "error");
      return { action: "handled" as const };
    }

    // v3: Extract pseudocode section and verify contract
    let output = skillContent;
    try {
      const mod = await import("./lemonharness-subsystems");
      const verifier = new mod.SaPVerifier();
      const pseudocodeMatch = skillContent.match(/## Pseudocode\n\n```[\s\S]*?```/);
      if (pseudocodeMatch) {
        const pseudocodeBlock = pseudocodeMatch[0];
        // Parse the pseudocode block into a SkillContract
        const lines = pseudocodeBlock.split("\n");
        const inputs: Array<{name: string; type: string; description: string; required: boolean}> = [];
        const outputs: Array<{name: string; type: string; description: string}> = [];
        const preconditions: string[] = [];
        const postconditions: string[] = [];
        const errorHandling: string[] = [];
        let section = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "INPUTS:") section = "inputs";
          else if (trimmed === "OUTPUTS:") section = "outputs";
          else if (trimmed === "PRECONDITIONS:") section = "preconditions";
          else if (trimmed === "POSTCONDITIONS:") section = "postconditions";
          else if (trimmed === "ERROR_HANDLING:") section = "errors";
          else if (section === "inputs" && trimmed.startsWith("  ")) {
            const m = trimmed.match(/(\w+):\s*(\w+)\s*(?:\/\/\s*(.+))?/);
            if (m) inputs.push({ name: m[1], type: m[2], description: (m[3] || "").trim(), required: !trimmed.includes("optional") });
          }
          else if (section === "outputs" && trimmed.startsWith("  ")) {
            const m = trimmed.match(/(\w+):\s*(\w+)\s*(?:\/\/\s*(.+))?/);
            if (m) outputs.push({ name: m[1], type: m[2], description: (m[3] || "").trim() });
          }
          else if (section === "preconditions" && trimmed.startsWith("  -")) preconditions.push(trimmed.replace(/^\s*-\s*/, ""));
          else if (section === "postconditions" && trimmed.startsWith("  -")) postconditions.push(trimmed.replace(/^\s*-\s*/, ""));
          else if (section === "errors" && trimmed.startsWith("  -")) errorHandling.push(trimmed.replace(/^\s*-\s*/, ""));
        }

        if (inputs.length > 0 || outputs.length > 0) {
          const contract: mod.SkillContract = { name: skillName, inputs, outputs, preconditions, postconditions, errorHandling };
          const result = verifier.verifyContract(contract, skillContent);
          const pseudocodeOnly = pseudocodeBlock.replace("## Pseudocode\n\n", "").trim();
          output = `🍋 Loaded skill: ${skillName}\n\n${pseudocodeOnly}\n\n${verifier.formatResult(result)}`;
        }
      }
    } catch { /* SaP not available — show full skill content */ }

    // Track skill load for context budget estimation
    contextBudgetTracker.trackSkillLoaded(skillName, skillContent);

    ctx.ui.notify(`${output.slice(0, 3500)}${output.length > 3500 ? "\n...(truncated)" : ""}`, "info");
    return { action: "handled" as const };
  });

  // ── Resources Discovery — Contribute Skills ──────────────────────

  pi.on("resources_discover", async (event, _ctx) => {
    return { skillPaths: [join(event.cwd, ".pi", "skills")] };
  });
}
