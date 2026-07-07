// @ts-nocheck — Runtime utility module, not a pi extension

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
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat as fsStat,
  writeFile,
} from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execSync, spawn } from "node:child_process";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

export async function pathExists(p: string): Promise<boolean> {
  try { await fsStat(p); return true; } catch { return false; }
}

export function detectBashStateChange(command: string): string | null {
  const patterns: RegExp[] = [
    />>?\s+\S+/, /touch\s+\S+/, /mv\s+\S+\s+\S+/, /cp\s+\S+\s+\S+/,
    /mkdir\s+-p\s+\S+/, /npm\s+install/, /pip\s+install/, /apt\s+install/,
    /yarn\s+add/, /pnpm\s+add/, /cargo\s+install/, /go\s+install/, /rm\s+-rf?\s+/,
  ];
  for (const pattern of patterns) { if (pattern.test(command)) return command.slice(0, 80); }
  return null;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}

export function estimateBudgetFromPrompt(prompt: string): number {
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
export function computeUnifiedDiff(oldStr: string, newStr: string, relPath: string): string {
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

// ── v4: FormatGuard — Detect format-constrained tasks ────────────
// Detects tasks with strict formatting requirements and suppresses
// non-essential context to avoid violating format constraints.


export class FormatGuard {
  private constraintPatterns = [
    { pattern: /EXACTLY\s+\d+\s+words/i, type: "word_count" as const },
    { pattern: /Output ONLY the/i, type: "strict_output" as const },
    { pattern: /Output ONLY your final/i, type: "strict_output" as const },
    { pattern: /Report ONLY the final/i, type: "strict_output" as const },
    { pattern: /Answer as a single letter/i, type: "single_letter" as const },
    { pattern: /Answer: just the number/i, type: "single_value" as const },
    { pattern: /Answer: just the email/i, type: "single_value" as const },
    { pattern: /Do NOT use the word/i, type: "negative_constraint" as const },
    { pattern: /Do NOT list more than/i, type: "negative_constraint" as const },
    { pattern: /Output ONLY the JSON/i, type: "json_only" as const },
    { pattern: /Output only the code/i, type: "code_only" as const },
  ];

  detected: Set<string> = new Set();

  scan(prompt: string): void {
    this.detected.clear();
    for (const { pattern, type } of this.constraintPatterns) {
      if (pattern.test(prompt)) this.detected.add(type);
    }
  }

  get isConstrained(): boolean {
    return this.detected.size > 0 && !this.detected.has("single_letter");
  }

  get suppressExtras(): boolean {
    // Suppress trail, heuristics, memory for word_count, strict_output, json_only
    return this.detected.has("word_count") || this.detected.has("strict_output") ||
           this.detected.has("json_only") || this.detected.has("code_only");
  }

  formatNote(): string {
    if (this.detected.size === 0) return "";
    return `⚠️ Format constraint detected: ${[...this.detected].join(", ")}. Keep response brief and precise.`;
  }
}

export const formatGuard = new FormatGuard();

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

export function sanitizePathForFile(p: string): string {
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
    } catch (e) { console.error("Workspace: operation failed", e);
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
    } catch (e) { console.error("Workspace: operation failed", e);
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

export class RuleKnowledgeManager {
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
    } catch (e) { console.error("Workspace: operation failed", e); /* Skills directory may not exist yet */ }
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

let _wsProjectRoot: string = process.cwd();
let _cachedSettings: LemonHarnessSettings | null = null;
export function getProjectRoot(): string { return _wsProjectRoot; }
export function setProjectRoot(root: string): void { _wsProjectRoot = root; _cachedSettings = null; }

export function readLemonHarnessSettings(): LemonHarnessSettings {
  if (_cachedSettings) return _cachedSettings;
  try {
    const settingsPath = join(_wsProjectRoot, ".pi", "settings.json");
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, "utf-8");
      _cachedSettings = JSON.parse(raw).lemonharness || {};
      return _cachedSettings!;
    }
  } catch { console.error("Workspace: operation failed"); }
  _cachedSettings = {};
  return {};
}

/**
 * Bootstrap the target project's .lemonharness/ directory with required
 * static assets (search.py, quality-gate.sh, etc.) copied from the
 * LemonHarness package root. This ensures deployed packages work in
 * any target project without manual file setup.
 */
export async function bootstrapWorkspace(projectRoot: string, extensionDir: string): Promise<void> {
  const wsDir = join(projectRoot, ".lemonharness");
  const pkgRoot = resolve(extensionDir, "..", "..");
  const assets = ["search.py", "quality-gate.sh", "pre-acceptance-gate.sh", "delegate-runner.mjs"];
  for (const asset of assets) {
    const src = join(pkgRoot, ".lemonharness", asset);
    const dst = join(wsDir, asset);
    if (existsSync(src) && !existsSync(dst)) {
      try {
        const content = readFileSync(src, "utf-8");
        await writeFile(dst, content, { mode: asset.endsWith(".sh") ? 0o755 : 0o644 });
      } catch { /* asset copy failed — skip silently */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Extension State
// ─────────────────────────────────────────────────────────────────────────
