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

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface WorkspaceFileEntry {
  path: string;
  action: "create" | "modify" | "delete";
  timestamp: number;
}

interface WorkspaceProcessEntry {
  command: string;
  pid: number;
  timestamp: number;
}

interface WorkspaceState {
  files: WorkspaceFileEntry[];
  processes: WorkspaceProcessEntry[];
  dependencies: string[];
  elapsedMs: number;
  lastReset: number;
}

interface TimeDirectorConfig {
  totalBudgetMs: number;
  exploreRatio: number;
  implementRatio: number;
  validateRatio: number;
  graceBand: number;
}

type TimePhaseName = "explore" | "implement" | "validate" | "reserve";

interface TimePhase {
  phase: TimePhaseName;
  elapsedMs: number;
  remainingMs: number;
  phaseProgress: number;
  totalProgress: number;
}

interface LogEntry {
  type: "tool_call" | "validation";
  timestamp: number;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  validationName?: string;
  command?: string;
  passed?: boolean;
  output?: string;
}

interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

// ── v3: Phase Checkpoint ──────────────────────────────────────────
// Research basis: arXiv:2602.06413 — Theorem A & Structural Consequence

interface PhaseCheckpoint {
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

class WorkspaceManager {
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

class TimeDirector {
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

class ExecutionLogger {
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

const workspaceManager = new WorkspaceManager();
const timeDirector = new TimeDirector();
const executionLogger = new ExecutionLogger();
const ruleKnowledge = new RuleKnowledgeManager();

let previousPhase: TimePhaseName | null = null;
let trailInjectionCounter = 0;

// ─────────────────────────────────────────────────────────────────────────
// Extension Export
// ─────────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Session Events ────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const settings = readLemonHarnessSettings();
    workspaceManager.initialize(ctx.cwd, settings.workspace);
    try { await mkdir(workspaceManager.getWorkspaceDir(), { recursive: true }); } catch { /* ok */ }
    timeDirector.start();
    const budget = settings.timeAwareness?.defaultBudgetMs ?? 300_000;
    timeDirector.setBudget(budget);
    const skillsDir = join(ctx.cwd, ".pi", "skills");
    await ruleKnowledge.discover(skillsDir);
    ctx.ui.setStatus("lemonharness", "🍋 LemonHarness active");
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("lemonharness", undefined);
  });

  // ── Before Agent Start — Inject Knowledge, Time Status, & v3 Heuristics ──

  pi.on("before_agent_start", async (event, ctx) => {
    const settings = readLemonHarnessSettings();
    const systemPromptParts: string[] = [];

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

    if (event.isError) {
      const regression = executionLogger.detectRegression();
      if (regression) ctx.ui.notify(`🧠 Regression detected: ${regression}`, "warning");
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
      await writeFile(absPath, params.content, "utf-8");
      workspaceManager.trackFileWrite(params.path, "create");
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
      await appendFile(absPath, params.content, "utf-8");
      workspaceManager.trackFileWrite(params.path, "modify");
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
      ];

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

    ctx.ui.notify(`${output.slice(0, 3500)}${output.length > 3500 ? "\n...(truncated)" : ""}`, "info");
    return { action: "handled" as const };
  });

  // ── Resources Discovery — Contribute Skills ──────────────────────

  pi.on("resources_discover", async (event, _ctx) => {
    return { skillPaths: [join(event.cwd, ".pi", "skills")] };
  });
}
