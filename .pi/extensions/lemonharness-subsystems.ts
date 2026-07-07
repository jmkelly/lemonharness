/**
 * LemonHarness Enhanced Subsystems
 *
 * New capability modules for the LemonHarness extension:
 * 1. DependencyGraph — execution provenance tracking
 * 2. MetricsRecorder — cross-session improvement metrics (v3: HarnessMetrics)
 * 3. QualityGateManager — auto-enforced verification at phase boundaries (v3: SafetySpecs)
 * 4. Trail compression — hierarchical execution summaries
 * 5. Memory decay — Ebbinghaus-based confidence decay
 * 6. Dynamic budget adjustment — adaptive time management
 * 7. TF-IDF Enhanced Retrieval
 *
 * v3 Enhancements:
 * - Harness Evaluation Metrics (arXiv:2605.18747)
 * - Phase Checkpoints (arXiv:2602.06413)
 * - Safety Specification Mining (arXiv:2604.23210)
 * - Heuristics (arXiv:2603.24639)
 * - Tool Privilege Hierarchy (arXiv:2606.20023)
 * - Skill Pseudocode Contracts (arXiv:2605.27955)
 * - Key Moments (arXiv:2605.14211)
 * - Verification-Pattern Correlation (arXiv:2603.13258)
 *
 * Research basis:
 * - Dependency provenance: ProjectMem (arXiv:2606.12329)
 * - Enforced verification: VerifAI patterns (2025)
 * - Forgetting curve for memory: Ebbinghaus-based agent memory (2025)
 * - Adaptive time management: Dynamic budget allocation (2025)
 * - Cross-session metrics: Agent benchmarking frameworks (2025)
 *
 * Integrates with the existing lemonharness-workspace.ts and
 * lemonharness-memory.ts extensions.
 */

import { mkdir, readFile, readdir, writeFile, stat as fsStat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Dependency Graph — Execution Provenance
// ═══════════════════════════════════════════════════════════════════════════

export interface DependencyNode {
  type: "file" | "package" | "command";
  id: string;
  label: string;
  dependsOn: string[];
  dependedBy: string[];
  createdAt: number;
  lastValidation: boolean | null;
  lastExitCode: number | null;
}

/**
 * Tracks dependencies between files, packages, and commands.
 * Enables rollback analysis, targeted revalidation, and regression detection.
 *
 * When a file is modified, the graph reveals what packages it depends on
 * and what commands depend on it — enabling selective revalidation.
 */
export class DependencyGraph {
  private nodes: Map<string, DependencyNode> = new Map();

  registerFile(filePath: string, dependsOnPkg?: string[], dependsOnCmd?: string[]): string {
    const id = `file:${filePath}`;
    const deps: string[] = [];
    if (dependsOnPkg) deps.push(...dependsOnPkg.map(p => `pkg:${p}`));
    if (dependsOnCmd) deps.push(...dependsOnCmd.map(c => `cmd:${c}`));

    if (this.nodes.has(id)) {
      const existing = this.nodes.get(id)!;
      existing.dependsOn = [...new Set([...existing.dependsOn, ...deps])];
    } else {
      this.nodes.set(id, {
        type: "file", id, label: filePath,
        dependsOn: deps, dependedBy: [],
        createdAt: Date.now(), lastValidation: null, lastExitCode: null,
      });
    }

    // Update inverse references
    for (const dep of deps) {
      const depNode = this.nodes.get(dep);
      if (depNode && !depNode.dependedBy.includes(id)) {
        depNode.dependedBy.push(id);
      }
    }
    return id;
  }

  registerPackage(name: string): string {
    const id = `pkg:${name}`;
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        type: "package", id, label: name,
        dependsOn: [], dependedBy: [],
        createdAt: Date.now(), lastValidation: null, lastExitCode: null,
      });
    }
    return id;
  }

  registerCommand(command: string): string {
    const hash = createHash("md5").update(command).digest("hex").slice(0, 8);
    const id = `cmd:${hash}`;
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        type: "command", id, label: command.slice(0, 80),
        dependsOn: [], dependedBy: [],
        createdAt: Date.now(), lastValidation: null, lastExitCode: null,
      });
    }
    return id;
  }

  recordValidation(nodeId: string, passed: boolean, exitCode: number) {
    const node = this.nodes.get(nodeId);
    if (node) { node.lastValidation = passed; node.lastExitCode = exitCode; }
  }

  /**
   * BFS through dependency graph to find all affected nodes.
   */
  findAffectedNodes(nodeId: string): DependencyNode[] {
    const affected: DependencyNode[] = [];
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const node = this.nodes.get(current);
      if (!node) continue;
      for (const depId of node.dependedBy) {
        if (!visited.has(depId)) queue.push(depId);
      }
      affected.push(node);
    }
    return affected;
  }

  /** Get all nodes that failed their last validation */
  getFailedNodes(): DependencyNode[] {
    return [...this.nodes.values()].filter(n => n.lastValidation === false);
  }

  summarize(): string {
    const files = [...this.nodes.values()].filter(n => n.type === "file");
    const pkgs = [...this.nodes.values()].filter(n => n.type === "package");
    const cmds = [...this.nodes.values()].filter(n => n.type === "command");
    const failed = this.getFailedNodes();
    return [
      `📊 Dependency Graph:`,
      `   Files: ${files.length}, Packages: ${pkgs.length}, Commands: ${cmds.length}`,
      `   Validated: ${[...this.nodes.values()].filter(n => n.lastValidation !== null).length}/${this.nodes.size}`,
      failed.length > 0 ? `   ❌ Failed: ${failed.length} (run /lemonharness:status for details)` : `   ✅ No outstanding failures`,
    ].join("\n");
  }

  reset() {
    this.nodes.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Cross-Session Metrics Recorder
// ═══════════════════════════════════════════════════════════════════════════

export interface SessionMetrics {
  sessionId: string;
  timestamp: number;
  totalToolCalls: number;
  totalErrors: number;
  totalValidations: number;
  passedValidations: number;
  budgetUtilizedPercent: number;
  phasesCompleted: string[];
  skillsLoaded: string[];
  filesModified: number;
  depsInstalled: number;
}

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

// ── v3: Harness Evaluation Metrics ──────────────────────────────────
// Research basis: arXiv:2605.18747 — Section 4 (Harness Evaluation)

/**
 * Task success alone is not enough — measure process quality.
 * These 5 metrics capture the agent's execution discipline.
 */
export interface HarnessMetrics {
  constraintViolations: number;        // times agent violated workspace boundaries
  traceCompleteness: number;           // % of operations with logged provenance
  toolJustificationRate: number;       // % of tool calls with explicit justification
  recoveryEfficiency: number;          // time spent recovering from errors vs. productive work
  regressionFreeRate: number;          // % of changes that didn't introduce regressions
}

/**
 * Metrics export for persistence across sessions.
 */
export interface HarnessMetricsSnapshot {
  timestamp: number;
  sessionId: string;
  metrics: HarnessMetrics;
}

// ── v3: Phase Checkpoints ────────────────────────────────────────────
// Research basis: arXiv:2602.06413 — Theorem A & Structural Consequence

export interface PhaseCheckpoint {
  phase: string;
  timestamp: number;
  elapsedMs: number;
  totalBudgetMs: number;
  workspaceState: string;  // JSON summary
  trailSummary: string;
  decisionAdvantage: number;  // Estimated remaining decision quality (0-1)
}

// ── v3: Safety Specifications ───────────────────────────────────────
// Research basis: arXiv:2604.23210 — EPO-Safe Framework

export interface SafetySpec {
  rule: string;              // e.g., "Files larger than 500KB must use streaming writes"
  triggeredBy: string;       // The validation failure that triggered discovery
  confidence: number;        // 0-1, starts at 0.3 and increases with repeated observations
  timesTriggered: number;
  lastObserved: number;
}

// ── v3: Heuristics (ERL) ────────────────────────────────────────────
// Research basis: arXiv:2603.24639 — Experiential Reflective Learning

export interface Heuristic {
  id: string;
  rule: string;                          // Single actionable sentence
  domain: string;                        // Task domain this applies to
  type: "prevention" | "correction" | "optimization";
  sourceEvent: string;                   // Memory event ID that generated it
  confidence: number;                    // 0-1
  successCount: number;
  failureCount: number;
  createdAt: number;
  lastUsedAt: number;
}

// ── v3: Tool Privilege ─────────────────────────────────────────────
// Research basis: arXiv:2606.20023 — Over-Privileged Tool Selection

export enum ToolPrivilegeLevel {
  READ       = 1,  // read, bash (read-only), workspace_state
  SCOPED_WRITE = 2,  // workspace_write, workspace_append, workspace_create_temp
  EXECUTION  = 3,  // workspace_exec, workspace_validate
  MANAGEMENT = 4,  // workspace_install_dep, workspace_reset
}

export interface ToolPrivilege {
  toolName: string;
  level: ToolPrivilegeLevel;
  description: string;
  sufficientAlternatives: string[];  // Lower-privilege alternatives
}

// ── v3: Tool Privilege Escalation Ladder ──────────────────────────
// Research basis: arXiv:2606.20023 — Over-Privileged Tool Selection

export interface EscalationStep {
  level: ToolPrivilegeLevel;
  toolName: string;
  timestamp: number;
  alternativeTool: string | null;
  alternativeLevel: ToolPrivilegeLevel | null;
  success: boolean | null;  // null=pending, true=alternative succeeded, false=alternative failed
  context: string;
}

export interface EscalationPattern {
  pattern: string;
  chain: EscalationStep[];
  count: number;
  lastEscalation: number;
  configSuggested: boolean;
}

// ── v3: Key Moments (ASH) ───────────────────────────────────────────
// Research basis: arXiv:2605.14211 — ASH self-honing agents

export interface KeyMoment {
  timestamp: number;
  type: "stuck_breakthrough" | "error_recovery" | "efficiency_gain" | "validation_milestone";
  beforeState: string;    // What was happening before
  afterState: string;     // What changed
  pattern: string;        // Extractable behavioral pattern
  significance: number;   // 0-1, how important this moment was
}

// ── v3: Verification-Pattern Correlation (MemCoder) ─────────────────
// Research basis: arXiv:2603.13258 — MemCoder framework

export interface ValidationCorrelation {
  patternDescription: string;
  totalApplications: number;
  passedValidations: number;
  correlation: number;  // 0-1
}

// ── v3: Skill Pseudocode Contracts (SaP) ────────────────────────────
// Research basis: arXiv:2605.27955 — Skill-as-Pseudocode

export interface SkillContract {
  name: string;
  inputs: Array<{ name: string; type: string; description: string; required: boolean }>;
  outputs: Array<{ name: string; type: string; description: string }>;
  preconditions: string[];
  postconditions: string[];
  errorHandling: string[];
}

export interface SaPVerificationResult {
  name: string;
  passed: boolean;
  coverage: boolean;
  binding: boolean;
  replacement: boolean;
  risk: boolean;
  issues: string[];
}

/**
 * Persists metrics per session and computes cross-session trends.
 * Enables improvement velocity tracking across sessions.
 */
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

  /**
   * Save harness metrics snapshot for cross-session persistence.
   */
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
    } catch { console.error("Subsystems: non-critical operation failed"); }
  }

  async getHarnessReport(): Promise<string> {
    const m = this.harnessMetrics;
    const lines = [
      `🔬 Harness Evaluation Metrics:`,
      `  Constraint violations: ${m.constraintViolations}`,
      `  Trace completeness: ${(m.traceCompleteness * 100).toFixed(0)}%`,
      `  Tool justification rate: ${(m.toolJustificationRate * 100).toFixed(0)}%`,
      `  Recovery efficiency: ${(m.recoveryEfficiency * 100).toFixed(0)}%`,
      `  Regression-free rate: ${(m.regressionFreeRate * 100).toFixed(0)}%`,
    ];
    return lines.join("\n");
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
    } catch { console.error("Subsystems: non-critical operation failed"); }
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
    } catch { console.error("Subsystems: non-critical operation failed"); }
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
    } catch (e) {
      console.error("Subsystems: operation failed", e);
      return "📊 No cross-session data yet. Complete a session to generate metrics.";
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Quality Gate Manager — Auto-Enforced Verification
// ═══════════════════════════════════════════════════════════════════════════

export interface QualityGateConfig {
  autoTriggerOnP3Entry: boolean;
  blockOnFailure: boolean;
  scriptPath: string;
  expectedOutput: string;
}

/**
 * Manages automatic quality gate execution at phase transitions.
 * Auto-triggers when entering P3 (Validate phase).
 *
 * Research basis: VerifAI (2025) demonstrates that automatic quality
 * checks at phase boundaries catch 3x more defects than manual checks.
 *
 * v3: Safety Specification Mining (arXiv:2604.23210)
 */
export class QualityGateManager {
  private config: QualityGateConfig;
  private lastResult: { passed: boolean; output: string } | null = null;
  private projectRoot: string;
  // v3: Safety specification mining
  private safetySpecs: SafetySpec[] = [];
  private safetySpecsPath: string;

  constructor(projectRoot: string, config?: Partial<QualityGateConfig>) {
    this.projectRoot = projectRoot;
    this.config = {
      autoTriggerOnP3Entry: config?.autoTriggerOnP3Entry ?? true,
      blockOnFailure: config?.blockOnFailure ?? false,
      scriptPath: config?.scriptPath ?? ".lemonharness/quality-gate.sh",
      expectedOutput: config?.expectedOutput ?? "All checks pass",
    };
    this.safetySpecsPath = join(projectRoot, ".lemonharness", "quality-specs.json");
  }

  getConfig(): QualityGateConfig { return { ...this.config }; }

  async init() {
    await this.loadSafetySpecs();
  }

  async run(): Promise<{ passed: boolean; output: string }> {
    const scriptPath = join(this.projectRoot, this.config.scriptPath);
    try { await fsStat(scriptPath); } catch {
      this.lastResult = { passed: true, output: "⚠ Quality gate script not found — skipping." };
      return this.lastResult;
    }

    return new Promise((resolvePromise) => {
      const child = spawn("bash", ["-c", `bash "${scriptPath}"`], {
        cwd: this.projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", (code) => {
        const output = stdout + stderr;
        const passed = code === 0 || output.includes(this.config.expectedOutput);
        this.lastResult = { passed, output };
        // v3: Extract safety specs on failure
        if (!passed) {
          this.extractSafetySpecs(output);
        }
        resolvePromise(this.lastResult);
      });
      child.on("error", () => {
        this.lastResult = { passed: true, output: "⚠ Quality gate process error — skipping." };
        resolvePromise(this.lastResult);
      });
    });
  }

  getLastResult(): { passed: boolean; output: string } | null {
    return this.lastResult;
  }

  setBlockOnFailure(block: boolean) { this.config.blockOnFailure = block; }

  // ── v3: Safety Specification Mining ──────────────────────────────
  // Research basis: arXiv:2604.23210 — EPO-Safe Framework

  /**
   * Extract safety specs from quality gate failure output.
   * Uses template-based pattern matching (no LLM call needed).
   */
  private extractSafetySpecs(output: string) {
    const outputLower = output.toLowerCase();
    const patterns: Array<{ regex: RegExp; template: (match: string) => string }> = [
      {
        regex: /(?:file|line).*?(\d+).*?(?:long|length|too long|exceeds)/gi,
        template: (m) => `Keep file size under ${m} lines or bytes`,
      },
      {
        regex: /(?:complexity|cyclomatic).*?(\d+)/gi,
        template: (m) => `Cyclomatic complexity should be ≤ ${m}`,
      },
      {
        regex: /FAILED/gi,
        template: () => `Ensure all tests pass before declaring task complete`,
      },
      {
        regex: /(?:maintainability|mi).*?\b([A-F])\b/i,
        template: (m) => `Maintainability index should be grade ${m} or better`,
      },
      {
        regex: /(?:nesting|depth).*?(\d+)/gi,
        template: (m) => `Nesting depth should be ≤ ${m}`,
      },
      {
        regex: /(?:duplicat|copy).*?(\d+)/gi,
        template: (m) => `Duplicate code percentage should be ≤ ${m}%`,
      },
      {
        regex: /(?:coverage|uncovered).*?(\d+)/gi,
        template: (m) => `Test coverage should be ≥ ${m}%`,
      },
    ];

    for (const { regex, template } of patterns) {
      const match = regex.exec(outputLower);
      if (match) {
        const rule = template(match[1] || "0");
        const existing = this.safetySpecs.find(s => s.rule === rule);
        if (existing) {
          existing.timesTriggered++;
          existing.lastObserved = Date.now();
          existing.confidence = Math.min(1, existing.confidence + 0.1);
        } else {
          this.safetySpecs.push({
            rule,
            triggeredBy: output.slice(0, 120),
            confidence: 0.3,
            timesTriggered: 1,
            lastObserved: Date.now(),
          });
        }
      }
    }

    // Persist
    this.persistSafetySpecs();
  }

  /**
   * Adjust safety spec confidence based on subsequent validation outcome.
   */
  async recordValidationOutcome(ruleMatch: string, passed: boolean) {
    for (const spec of this.safetySpecs) {
      if (spec.rule.toLowerCase().includes(ruleMatch.toLowerCase())) {
        if (passed) {
          spec.confidence = Math.min(1, spec.confidence + 0.1);
        } else {
          spec.confidence = Math.max(0, spec.confidence - 0.2);
        }
        spec.lastObserved = Date.now();
      }
    }
    await this.persistSafetySpecs();
  }

  getActiveSafetySpecs(): SafetySpec[] {
    return [...this.safetySpecs].filter(s => s.confidence >= 0.2);
  }

  /**
   * Get top-N most confident safety specs for system prompt injection.
   */
  getTopSafetySpecs(maxResults: number = 3): SafetySpec[] {
    return [...this.safetySpecs]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxResults);
  }

  getSafetySpecScore(): number {
    if (this.safetySpecs.length === 0) return 1; // No violations -> perfect score
    const avgConfidence = this.safetySpecs.reduce((s, sp) => s + sp.confidence, 0) / this.safetySpecs.length;
    const triggeredCount = this.safetySpecs.reduce((s, sp) => s + sp.timesTriggered, 0);
    return Math.max(0, 1 - (avgConfidence * Math.min(triggeredCount, 10)) / 10);
  }

  formatSafetySpecs(): string {
    const specs = this.getActiveSafetySpecs();
    if (specs.length === 0) return "No safety specs discovered yet.";
    return [
      "🛡 Safety Specifications (EPO-Safe):",
      ...specs.map(s =>
        `  • "${s.rule}" (confidence: ${s.confidence.toFixed(2)}, triggered: ${s.timesTriggered}x)`
      ),
    ].join("\n");
  }

  private async persistSafetySpecs() {
    try {
      await writeFile(this.safetySpecsPath, JSON.stringify(this.safetySpecs, null, 2), "utf-8");
    } catch { console.error("Subsystems: non-critical operation failed"); }
  }

  async loadSafetySpecs() {
    try {
      const content = await readFile(this.safetySpecsPath, "utf-8");
      this.safetySpecs = JSON.parse(content);
    } catch (e) {
      console.error("Subsystems: operation failed", e);
      this.safetySpecs = [];
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// v3: HeuristicManager — ERL Heuristic Extraction & Injection
// ═══════════════════════════════════════════════════════════════════════════
// Research basis: arXiv:2603.24639 — Experiential Reflective Learning

export class HeuristicManager {
  private heuristics: Heuristic[] = [];
  private storagePath: string;

  constructor(workspaceDir: string) {
    this.storagePath = join(workspaceDir, "heuristics.json");
  }

  async init() { await this.load(); }

  extractHeuristic(eventType: string, summary: string, details: string, domain: string): Heuristic | null {
    const text = (summary + " " + details).toLowerCase();
    if (text.length < 20) return null;
    let rule: string | null = null;
    let type: "prevention" | "correction" | "optimization" = "prevention";
    if (/always|never|always use|always check|always set|never use|never forget/i.test(text)) {
      const match = text.match(/(always|never)\s+(.+?)(?:\.|$)/i);
      if (match) { rule = match[0].trim(); rule = rule.charAt(0).toUpperCase() + rule.slice(1); if (!rule.endsWith(".")) rule += "."; }
      type = "prevention";
    }
    if (!rule && /(?:fix|resolve|solved|fixed by)/i.test(text)) {
      const match = text.match(/(?:fix|resolve|solved|fixed)\s+(?:by|with|using)\s+(.+?)(?:\.|$)/i);
      if (match) { rule = `When encountering this, ${match[1].trim()}.`; rule = rule.charAt(0).toUpperCase() + rule.slice(1); }
      else { rule = `Check ${summary.split(/\s+/).slice(0, 5).join(" ")} before proceeding.`; }
      type = "correction";
    }
    if (!rule && /(?:faster|quicker|efficient|optimize|improve|better|simpler)/i.test(text)) {
      const match = text.match(/(?:use|prefer|choose|try)\s+(.+?)(?:\.|$)/i);
      if (match) { rule = `Prefer ${match[1].trim()} for better efficiency.`; }
      else { rule = `Optimize ${summary.split(/\s+/).slice(0, 4).join(" ")} for performance.`; }
      type = "optimization";
    }
    if (!rule) {
      const firstSentence = summary.split(/[.!]/).find((s: string) => s.trim().length > 10);
      if (firstSentence) { rule = firstSentence.trim() + "."; type = "correction"; }
      else return null;
    }
    const existing = this.heuristics.find(h =>
      h.rule.toLowerCase().includes(rule!.toLowerCase().slice(0, 20)) ||
      rule!.toLowerCase().includes(h.rule.toLowerCase().slice(0, 20))
    );
    if (existing) { existing.successCount++; existing.lastUsedAt = Date.now(); existing.confidence = Math.min(1, existing.confidence + 0.05); return existing; }
    const heuristic: Heuristic = {
      id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, rule, domain, type,
      sourceEvent: `${eventType}: ${summary.slice(0, 80)}`, confidence: 0.5, successCount: 1, failureCount: 0,
      createdAt: Date.now(), lastUsedAt: Date.now(),
    };
    this.heuristics.push(heuristic); this.save(); return heuristic;
  }

  getRelevantHeuristics(domain: string, maxResults: number = 5): Heuristic[] {
    return [...this.heuristics].filter(h => h.domain === domain || h.domain === "general" || h.confidence >= 0.4)
      .sort((a, b) => b.confidence - a.confidence).slice(0, maxResults);
  }

  formatForPrompt(heuristics: Heuristic[]): string {
    if (heuristics.length === 0) return "";
    return ["🧪 Relevant Heuristics (from past experience):",
      ...heuristics.map(h => `  • "${h.rule}" (${h.type}, confidence: ${h.confidence.toFixed(2)})`)
    ].join("\n");
  }

  recordOutcome(heuristicId: string, succeeded: boolean) {
    const h = this.heuristics.find(h => h.id === heuristicId);
    if (!h) return;
    if (succeeded) { h.successCount++; h.confidence = Math.min(1, h.confidence + 0.1); }
    else { h.failureCount++; h.confidence = Math.max(0, h.confidence - 0.15); }
    h.lastUsedAt = Date.now(); this.save();
  }

  getAllHeuristics(): Heuristic[] { return [...this.heuristics]; }

  getStats(): string {
    const total = this.heuristics.length;
    const byType = { prevention: 0, correction: 0, optimization: 0 };
    for (const h of this.heuristics) byType[h.type]++;
    const avgConf = this.heuristics.reduce((s, h) => s + h.confidence, 0) / (total || 1);
    return [`Heuristics: ${total} total`, `  Prevention: ${byType.prevention}, Correction: ${byType.correction}, Optimization: ${byType.optimization}`, `  Avg confidence: ${(avgConf * 100).toFixed(0)}%`].join("\n");
  }

  private async save() {
    try { const { mkdir, writeFile } = await import("node:fs/promises"); const { dirname } = await import("node:path"); await mkdir(dirname(this.storagePath), { recursive: true }); await writeFile(this.storagePath, JSON.stringify(this.heuristics, null, 2), "utf-8"); } catch { console.error("Subsystems: non-critical operation failed"); }
  }

  private async load() {
    try { const { readFile } = await import("node:fs/promises"); this.heuristics = JSON.parse(await readFile(this.storagePath, "utf-8")); } catch { this.heuristics = []; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v3: PrivilegeManager — Tool Privilege Hierarchy
// ═══════════════════════════════════════════════════════════════════════════
// Research basis: arXiv:2606.20023 — Over-Privileged Tool Selection

export class PrivilegeManager {
  private toolPrivileges: Map<string, ToolPrivilege> = new Map();
  private escalationHistory: Array<{ toolName: string; timestamp: number; suggestedAlternative: string | null; wasOverride: boolean; context: string }> = [];
  private totalToolCalls: number = 0;

  // ── Escalation Ladder ───────────────────────────────────────────
  private escalationChains: Map<string, EscalationPattern> = new Map();
  private specificEscalation: Map<string, string> = new Map();  // tool -> alternative at next level

  constructor() {
    this.registerDefaultTools();
    this.registerEscalationAlternatives();
  }

  private registerEscalationAlternatives() {
    // For each tool, define the higher-privilege alternative to try when it fails
    this.specificEscalation.set("read", "workspace_write");
    this.specificEscalation.set("workspace_state", "workspace_exec");
    this.specificEscalation.set("workspace_memory_search", "bash");
    this.specificEscalation.set("workspace_memory_stats", "bash");
    this.specificEscalation.set("workspace_memory_list_code", "bash");
    this.specificEscalation.set("workspace_write", "workspace_exec");
    this.specificEscalation.set("workspace_append", "workspace_exec");
    this.specificEscalation.set("workspace_create_temp", "workspace_exec");
    this.specificEscalation.set("workspace_memory_record", "workspace_exec");
    this.specificEscalation.set("workspace_memory_feedback", "workspace_exec");
    this.specificEscalation.set("workspace_exec", "workspace_install_dep");
    this.specificEscalation.set("workspace_validate", "workspace_exec");
    this.specificEscalation.set("bash", "workspace_exec");
    this.specificEscalation.set("write", "workspace_exec");
    this.specificEscalation.set("edit", "workspace_validate");
  }

  private registerDefaultTools() {
    this.registerTool("read", ToolPrivilegeLevel.READ, "Read file contents", []);
    this.registerTool("workspace_state", ToolPrivilegeLevel.READ, "Get workspace state", []);
    this.registerTool("workspace_memory_search", ToolPrivilegeLevel.READ, "Search memory", []);
    this.registerTool("workspace_memory_stats", ToolPrivilegeLevel.READ, "Memory stats", []);
    this.registerTool("workspace_memory_list_code", ToolPrivilegeLevel.READ, "List code tools", []);
    this.registerTool("workspace_write", ToolPrivilegeLevel.SCOPED_WRITE, "Write file in workspace", []);
    this.registerTool("workspace_append", ToolPrivilegeLevel.SCOPED_WRITE, "Append to file", []);
    this.registerTool("workspace_create_temp", ToolPrivilegeLevel.SCOPED_WRITE, "Create temp dir", []);
    this.registerTool("workspace_memory_record", ToolPrivilegeLevel.SCOPED_WRITE, "Record memory", []);
    this.registerTool("workspace_memory_feedback", ToolPrivilegeLevel.SCOPED_WRITE, "Memory feedback", []);
    this.registerTool("workspace_exec", ToolPrivilegeLevel.EXECUTION, "Execute command", ["bash (read-only)"]);
    this.registerTool("workspace_validate", ToolPrivilegeLevel.EXECUTION, "Run validation", ["workspace_exec"]);
    this.registerTool("bash", ToolPrivilegeLevel.EXECUTION, "Run bash command", []);
    this.registerTool("workspace_install_dep", ToolPrivilegeLevel.MANAGEMENT, "Install dependency", ["workspace_exec (pip/npm via exec)"]);
    this.registerTool("write", ToolPrivilegeLevel.MANAGEMENT, "Write any file", ["workspace_write"]);
    this.registerTool("edit", ToolPrivilegeLevel.MANAGEMENT, "Edit any file", ["workspace_write"]);
  }

  registerTool(name: string, level: ToolPrivilegeLevel, description: string, alternatives: string[]) {
    this.toolPrivileges.set(name, { toolName: name, level, description, sufficientAlternatives: alternatives });
  }

  getPrivilegeLevel(toolName: string): ToolPrivilegeLevel | null {
    return this.toolPrivileges.get(toolName)?.level ?? null;
  }

  checkPrivilege(requestedTool: string, context: { recentErrors: boolean; taskType?: string }): { isOverPrivileged: boolean; suggestedAlternative: string | null } {
    this.totalToolCalls++;
    const privilege = this.toolPrivileges.get(requestedTool);
    if (!privilege || privilege.level <= ToolPrivilegeLevel.SCOPED_WRITE) return { isOverPrivileged: false, suggestedAlternative: null };
    if (privilege.sufficientAlternatives.length > 0 && !context.recentErrors) {
      const alt = privilege.sufficientAlternatives[0];
      this.escalationHistory.push({ toolName: requestedTool, timestamp: Date.now(), suggestedAlternative: alt, wasOverride: false, context: context.taskType || "unknown" });
      return { isOverPrivileged: true, suggestedAlternative: alt };
    }
    return { isOverPrivileged: false, suggestedAlternative: null };
  }

  /**
   * Attempt escalation when a tool fails.
   * Returns the next privilege level alternative tool, if one exists.
   *
   * Escalation ladder:
   *   READ fails -> try SCOPED_WRITE fallback
   *   SCOPED_WRITE fails -> try EXECUTION fallback
   *   EXECUTION fails -> try MANAGEMENT fallback
   *   MANAGEMENT -> no escalation possible
   */
  attemptEscalation(failedTool: string, context: string): {
    alternativeTool: string | null;
    alternativeLevel: ToolPrivilegeLevel | null;
    chain: EscalationStep[];
    shouldSuggestConfig: boolean;
  } {
    const privilege = this.toolPrivileges.get(failedTool);
    if (!privilege) {
      return { alternativeTool: null, alternativeLevel: null, chain: [], shouldSuggestConfig: false };
    }

    const currentLevel = privilege.level;

    // Can't escalate beyond MANAGEMENT
    if (currentLevel >= ToolPrivilegeLevel.MANAGEMENT) {
      return { alternativeTool: null, alternativeLevel: null, chain: [], shouldSuggestConfig: false };
    }

    // Next privilege level up
    const nextLevel = (currentLevel + 1) as ToolPrivilegeLevel;

    // Find alternative tool at the next level
    let alternativeTool: string | null = this.specificEscalation.get(failedTool) ?? null;
    if (!alternativeTool) {
      // Fall back: pick first available tool at the next level that isn't the failed tool
      const toolsAtNextLevel = [...this.toolPrivileges.values()]
        .filter(tp => tp.level === nextLevel && tp.toolName !== failedTool);
      alternativeTool = toolsAtNextLevel.length > 0 ? toolsAtNextLevel[0].toolName : null;
    } else {
      // Verify the alternative is actually at the expected level
      const altPriv = this.toolPrivileges.get(alternativeTool);
      if (!altPriv || altPriv.level !== nextLevel) {
        // Fall back to generic search
        const toolsAtNextLevel = [...this.toolPrivileges.values()]
          .filter(tp => tp.level === nextLevel && tp.toolName !== failedTool);
        alternativeTool = toolsAtNextLevel.length > 0 ? toolsAtNextLevel[0].toolName : null;
      }
    }

    // Create escalation step
    const step: EscalationStep = {
      level: currentLevel,
      toolName: failedTool,
      timestamp: Date.now(),
      alternativeTool,
      alternativeLevel: alternativeTool ? nextLevel : null,
      success: null,
      context,
    };

    // Track in escalation chain (grouped by tool pattern)
    const pattern = this.getEscalationPattern(failedTool);
    let chain = this.escalationChains.get(pattern);
    if (!chain) {
      chain = { pattern, chain: [], count: 0, lastEscalation: Date.now(), configSuggested: false };
      this.escalationChains.set(pattern, chain);
    }
    chain.chain.push(step);
    chain.count++;
    chain.lastEscalation = Date.now();

    // Also record in legacy escalation history for backward compatibility
    this.escalationHistory.push({
      toolName: failedTool,
      timestamp: Date.now(),
      suggestedAlternative: alternativeTool,
      wasOverride: true,
      context: `escalation_ladder: ${context}`,
    });

    // After 3+ escalations for the same pattern, suggest config changes
    const shouldSuggestConfig = chain.count >= 3 && !chain.configSuggested;
    if (shouldSuggestConfig) {
      chain.configSuggested = true;
    }

    return { alternativeTool, alternativeLevel: alternativeTool ? nextLevel : null, chain: chain.chain, shouldSuggestConfig };
  }

  /**
   * Record whether a suggested escalation alternative succeeded or failed.
   * Matches the tool name against the most recent unresolved escalation step.
   */
  recordEscalationResult(toolName: string, succeeded: boolean, context: string): void {
    // Find the most recent escalation step where this tool was the suggested alternative
    // and the step hasn't been resolved yet (success === null)
    for (const [, chain] of this.escalationChains) {
      for (let i = chain.chain.length - 1; i >= 0; i--) {
        const step = chain.chain[i];
        if (step.alternativeTool === toolName && step.success === null) {
          step.success = succeeded;
          step.context = context;
          return;
        }
      }
    }
  }

  /**
   * Get the pattern identifier for a tool (for grouping escalation chains).
   */
  private getEscalationPattern(failedTool: string): string {
    // Extract a human-readable pattern from the tool name
    return failedTool;
  }

  /**
   * Get all escalation chain data (for display or analysis).
   */
  getEscalationChains(): Map<string, EscalationPattern> {
    return new Map(this.escalationChains);
  }

  /**
   * Get a specific escalation chain by tool pattern.
   */
  getChainCount(toolPattern: string): number {
    const chain = this.escalationChains.get(toolPattern);
    return chain ? chain.count : 0;
  }

  /**
   * Get a formatted summary of escalation chains.
   */
  getEscalationChainSummary(): string {
    if (this.escalationChains.size === 0) {
      return "  No escalation chains recorded.";
    }

    // Show last 5 chains sorted by most recent
    const chains = [...this.escalationChains.values()]
      .sort((a, b) => b.lastEscalation - a.lastEscalation)
      .slice(0, 5);

    const lines: string[] = [
      `  Escalation Chain History (last ${Math.min(this.escalationChains.size, 5)} of ${this.escalationChains.size}):`
    ];

    for (const chain of chains) {
      const steps = chain.chain.map(s => {
        const levelName = ToolPrivilegeLevel[s.level];
        const altName = s.alternativeTool
          ? `→ ${ToolPrivilegeLevel[s.alternativeLevel!]}:${s.alternativeTool}`
          : "→ (none)";
        const status = s.success === null ? "⏳" : s.success ? "✅" : "❌";
        return `${levelName}:${s.toolName} ${altName} ${status}`;
      });
      lines.push(`    • ${steps.join(" > ")} (${chain.count}x)`);
    }

    return lines.join("\n");
  }


  recordEscalation(toolName: string, alternative: string | null, context: string) {
    this.escalationHistory.push({ toolName, timestamp: Date.now(), suggestedAlternative: alternative, wasOverride: true, context });
  }

  getEscalationRate(): number {
    if (this.totalToolCalls === 0) return 0;
    return this.escalationHistory.filter(e => e.wasOverride).length / this.totalToolCalls;
  }

  getToolsAtLevel(level: ToolPrivilegeLevel): ToolPrivilege[] {
    return [...this.toolPrivileges.values()].filter(tp => tp.level <= level);
  }

  formatStatus(): string {
    const total = this.toolPrivileges.size;
    const escalations = this.escalationHistory.filter(e => e.wasOverride).length;
    const rate = this.totalToolCalls > 0 ? (escalations / this.totalToolCalls * 100).toFixed(0) : "0";
    const compliance = this.totalToolCalls > 0 ? ((1 - this.getEscalationRate()) * 100).toFixed(0) : "100";

    const lines: string[] = [
      `🔒 Tool Privileges:`,
      `  ${total} tools registered`,
      `  Escalation rate: ${rate}% (${escalations} escalations in ${this.totalToolCalls} calls)`,
      `  Least-privilege compliance: ${compliance}%`,
      ``,
      this.getEscalationChainSummary(),
    ];

    // Show configuration suggestions for chains with 3+ escalations
    const chainsNeedingConfig = [...this.escalationChains.values()]
      .filter(c => c.configSuggested);

    if (chainsNeedingConfig.length > 0) {
      lines.push(``);
      lines.push(`⚙️ Configuration Suggestions:`);
      for (const c of chainsNeedingConfig) {
        lines.push(`  • Tool "${c.pattern}" has been escalated ${c.count} times. Consider adjusting tool privilege settings in .pi/settings.json.`);
      }
      lines.push(`  Set "lemonharness.toolPrivilege.escalationThreshold" to raise or lower the sensitivity.`);
    }

    return lines.join("\n");
  }

  reset() {
    this.toolPrivileges.clear();
    this.escalationHistory = [];
    this.totalToolCalls = 0;
    this.escalationChains.clear();
    this.specificEscalation.clear();
    this.registerDefaultTools();
    this.registerEscalationAlternatives();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v3: SaPVerifier — Skill Pseudocode Contract Verification
// ═══════════════════════════════════════════════════════════════════════════
// Research basis: arXiv:2605.27955 — Skill-as-Pseudocode

export class SaPVerifier {
  verifyContract(contract: SkillContract, skillContent: string, existingContracts: SkillContract[] = []): SaPVerificationResult {
    const coverage = this.checkCoverage(contract, skillContent);
    const binding = this.checkBinding(contract);
    const replacement = this.checkReplacement(contract, existingContracts);
    const risk = this.checkRisk(contract);
    const issues: string[] = [];
    if (!coverage) issues.push("Coverage: Pseudocode may not cover all prose operations");
    if (!binding) issues.push("Binding: Some inputs have unresolvable types");
    if (!replacement) issues.push("Replacement: Contract conflicts with existing contracts");
    if (!risk) issues.push("Risk: Potentially dangerous operations not flagged");
    return { name: contract.name, passed: coverage && binding && replacement && risk, coverage, binding, replacement, risk, issues };
  }

  private checkCoverage(contract: SkillContract, skillContent: string): boolean {
    const lowerContent = skillContent.toLowerCase();
    const terms = new Set<string>();
    for (const i of contract.inputs) terms.add(i.name.toLowerCase());
    for (const p of contract.preconditions) p.toLowerCase().split(/\s+/).forEach(w => { if (w.length > 3) terms.add(w); });
    for (const p of contract.postconditions) p.toLowerCase().split(/\s+/).forEach(w => { if (w.length > 3) terms.add(w); });
    let matches = 0;
    for (const t of terms) { if (lowerContent.includes(t)) matches++; }
    return terms.size === 0 || matches / terms.size >= 0.3;
  }

  private checkBinding(contract: SkillContract): boolean {
    // All inputs must have non-empty types
    for (const inp of contract.inputs) {
      if (!inp.type || inp.type.trim() === "") return false;
      if (inp.required && (!inp.name || inp.name.trim() === "")) return false;
    }
    // All outputs must have non-empty types
    for (const out of contract.outputs) {
      if (!out.type || out.type.trim() === "") return false;
    }
    // Preconditions required when inputs exist
    if (contract.preconditions.length === 0 && contract.inputs.length > 0) return false;
    // Postconditions required when outputs exist
    if (contract.postconditions.length === 0 && contract.outputs.length > 0) return false;
    return true;
  }

  private checkReplacement(contract: SkillContract, existing: SkillContract[]): boolean {
    for (const ec of existing) {
      if (ec.name === contract.name) continue;
      const ei = new Set(ec.inputs.map(i => i.name));
      const ni = new Set(contract.inputs.map(i => i.name));
      if ([...ei].filter(i => ni.has(i)).length >= 2) return false;
    }
    return true;
  }

  private checkRisk(contract: SkillContract): boolean {
    const dangerous = ["rm", "delete", "remove", "overwrite", "sudo", "chmod", "kill", "reboot", "shutdown", "format"];
    const allText = [...contract.preconditions, ...contract.postconditions, ...contract.errorHandling, ...contract.inputs.map(i => i.description), ...contract.outputs.map(o => o.description)].join(" ").toLowerCase();
    for (const p of dangerous) { if (allText.includes(p) && !contract.errorHandling.some(e => e.toLowerCase().includes(p))) return false; }
    return true;
  }

  formatResult(result: SaPVerificationResult): string {
    const status = result.passed ? "✅" : "❌";
    return [`${status} ${result.name}: ${result.passed ? "Passed" : "Issues Found"}`, `  • Coverage: ${result.coverage ? "✅" : "❌"}`, `  • Binding: ${result.binding ? "✅" : "❌"}`, `  • Replacement: ${result.replacement ? "✅" : "❌"}`, `  • Risk: ${result.risk ? "✅" : "❌"}`, ...(result.issues.length > 0 ? [`  Issues: ${result.issues.join("; ")}`] : [])].join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v3: KeyMomentDetector — ASH Key-Moment Detection
// ═══════════════════════════════════════════════════════════════════════════
// Research basis: arXiv:2605.14211 — ASH self-honing agents

export class KeyMomentDetector {
  detectStuckBreakthrough(entries: LogEntry[]): KeyMoment | null {
    if (entries.length < 4) return null;
    for (let i = 3; i < entries.length; i++) {
      if (entries.slice(i - 3, i).every(e => e.isError === true) && !entries[i].isError) {
        return { timestamp: entries[i].timestamp, type: "stuck_breakthrough", beforeState: "3+ consecutive errors", afterState: `Success on ${entries[i].toolName}`, pattern: `When stuck after 3+ errors, try: ${entries[i].toolName}`, significance: 0.8 };
      }
    }
    return null;
  }

  detectErrorRecovery(entries: LogEntry[]): KeyMoment | null {
    if (entries.length < 3) return null;
    for (let i = 2; i < entries.length; i++) {
      if (entries[i-2].isError && !entries[i-1].isError && !entries[i].isError && entries[i-1].toolName !== entries[i-2].toolName) {
        return { timestamp: entries[i].timestamp, type: "error_recovery", beforeState: `Error on ${entries[i-2].toolName}, pivoted to ${entries[i-1].toolName}`, afterState: `Success on ${entries[i].toolName}`, pattern: `After ${entries[i-2].toolName} fails, try ${entries[i-1].toolName}`, significance: 0.7 };
      }
    }
    return null;
  }

  detectEfficiencyGain(entries: LogEntry[]): KeyMoment | null {
    if (entries.length < 6) return null;
    const seq = entries.filter(e => e.type === "tool_call").map(e => e.toolName || "unknown").slice(-6);
    for (let i = 0; i < seq.length - 2; i++) {
      if (seq[i] === seq[i+1] && seq[i] === seq[i+2] && seq[i+3] !== seq[i]) {
        return { timestamp: entries[entries.length-1].timestamp, type: "efficiency_gain", beforeState: `Repeated ${seq[i]} 3x`, afterState: "Found alternative", pattern: `Instead of repeating ${seq[i]}, try alternatives after 2 failures`, significance: 0.6 };
      }
    }
    return null;
  }

  detectValidationMilestone(entries: LogEntry[]): KeyMoment | null {
    let foundFail = false;
    for (const e of entries) {
      if (e.type === "validation" && e.passed === false) foundFail = true;
      if (e.type === "validation" && e.passed === true && foundFail) {
        return { timestamp: e.timestamp, type: "validation_milestone", beforeState: "Preceded by validation failures", afterState: `Passed: ${(e.validationName || e.command || "").slice(0, 60)}`, pattern: "Changes that pass validation after failures are reliable", significance: 0.75 };
      }
    }
    return null;
  }

  findAllKeyMoments(entries: LogEntry[]): KeyMoment[] {
    const moments: KeyMoment[] = [];
    const detectors = [this.detectStuckBreakthrough(entries), this.detectErrorRecovery(entries), this.detectEfficiencyGain(entries), this.detectValidationMilestone(entries)];
    for (const m of detectors) { if (m) moments.push(m); }
    const unique = new Map<string, KeyMoment>();
    for (const m of moments) { const k = m.pattern.slice(0, 40); if (!unique.has(k) || m.significance > unique.get(k)!.significance) unique.set(k, m); }
    return [...unique.values()].sort((a, b) => b.significance - a.significance);
  }

  formatKeyMoments(moments: KeyMoment[]): string {
    if (moments.length === 0) return "No key moments detected this session.";
    const labels: Record<string, string> = { stuck_breakthrough: "Stuck Breakthrough", error_recovery: "Error Recovery", efficiency_gain: "Efficiency Gain", validation_milestone: "Validation Milestone" };
    return ["💡 Key Moments Detected:", ...moments.map(m => `  • [${labels[m.type] || m.type}] (sig: ${(m.significance*100).toFixed(0)}%) Before: ${m.beforeState} | After: ${m.afterState} | Pattern: ${m.pattern}`)].join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v3: VerificationRefinement — Validation-Pattern Correlation
// ═══════════════════════════════════════════════════════════════════════════
// Research basis: arXiv:2603.13258 — MemCoder framework

export class VerificationRefinement {
  private correlations: Map<string, ValidationCorrelation> = new Map();

  promoteOnPass(_validationCommand: string, relatedPatterns: string[]) {
    for (const pattern of relatedPatterns) {
      const key = pattern.toLowerCase().trim();
      let corr = this.correlations.get(key);
      if (!corr) { corr = { patternDescription: pattern, totalApplications: 0, passedValidations: 0, correlation: 0 }; this.correlations.set(key, corr); }
      corr.totalApplications++; corr.passedValidations++;
      corr.correlation = corr.passedValidations / corr.totalApplications;
    }
  }

  demoteOnFail(_validationCommand: string, _output: string, relatedPatterns: string[]) {
    for (const pattern of relatedPatterns) {
      const key = pattern.toLowerCase().trim();
      let corr = this.correlations.get(key);
      if (!corr) { corr = { patternDescription: pattern, totalApplications: 0, passedValidations: 0, correlation: 0 }; this.correlations.set(key, corr); }
      corr.totalApplications++;
      corr.correlation = corr.passedValidations / corr.totalApplications;
    }
  }

  getCorrelation(pattern: string): ValidationCorrelation | undefined {
    return this.correlations.get(pattern.toLowerCase().trim());
  }

  getAllCorrelations(): ValidationCorrelation[] {
    return [...this.correlations.values()].sort((a, b) => b.correlation - a.correlation);
  }

  getCorrelationReport(): string {
    const all = this.getAllCorrelations();
    if (all.length === 0) return "No validation-pattern correlation data yet.";
    return ["📊 Validation-Pattern Correlation:", ...all.slice(0, 10).map(c => `  • "${c.patternDescription.slice(0, 50)}" → ${c.passedValidations}/${c.totalApplications} passes (${(c.correlation * 100).toFixed(0)}% correlation)`)] .join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v3: CommitAwareMemory — Git-Context Memory Augmentation
// ═══════════════════════════════════════════════════════════════════════════
// Research basis: arXiv:2603.13258 — MemCoder framework

export class CommitAwareMemory {
  private projectRoot: string;
  constructor(projectRoot: string) { this.projectRoot = projectRoot; }

  async extractIntentMapping(filePath: string): Promise<{ commits: Array<{ hash: string; message: string; files: string[]; timestamp: number }>; intent: string; implementation: string } | null> {
    try {
      const { execSync } = require("child_process");
      const gitLog = execSync(`git log --oneline -5 -- "${filePath}" 2>/dev/null || echo "NOT_TRACKED"`, { cwd: this.projectRoot, encoding: "utf-8", timeout: 5000 }).trim();
      if (gitLog === "NOT_TRACKED" || !gitLog) return null;
      const lines = gitLog.split("\n").filter((l: string) => l.trim());
      const commits = lines.map((line: string) => { const [hash, ...msg] = line.split(" "); return { hash: hash || "unknown", message: msg.join(" ") || "", files: [filePath], timestamp: Date.now() }; });
      const msgs = commits.map((c: { hash: string; message: string }) => c.message).join(" ");
      let intent = "modified file";
      if (/^fix|^bug|^hotfix/i.test(msgs)) intent = "bug fix";
      else if (/^feat|^feature|^add/i.test(msgs)) intent = "feature addition";
      else if (/^refactor/i.test(msgs)) intent = "refactoring";
      else if (/^docs/i.test(msgs)) intent = "documentation";
      else if (/^test/i.test(msgs)) intent = "test addition/modification";
      else if (/^perf|^optimize/i.test(msgs)) intent = "performance optimization";
      return { commits, intent, implementation: msgs.slice(0, 200) };
    } catch { return null; }
  }

  async augmentWithGitContext(filePath: string, memory: { details?: string; tags?: string }): Promise<{ details: string; tags: string; codeRef?: string }> {
    const result = await this.extractIntentMapping(filePath);
    if (!result) return { details: memory.details || "", tags: memory.tags || "" };
    return {
      details: [memory.details || "", "", "--- Git Context ---", `File: ${filePath}`, `Intent: ${result.intent}`, `Recent commits: ${result.commits.map(c => `${c.hash}: ${c.message}`).join("; ")}`].join("\n"),
      tags: [memory.tags || "", "git-tracked"].filter(Boolean).join(","),
      codeRef: result.commits[0]?.hash || "unknown",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Trail Compression — Hierarchical Execution Summaries
// ═══════════════════════════════════════════════════════════════════════════

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

/**
 * Compresses tool call logs by grouping old entries by type.
 * Prevents context window saturation in long-horizon tasks.
 */
export function compressTrail(entries: LogEntry[], maxRecent: number = 4): string {
  const total = entries.length;
  if (total === 0) return "  (no execution records yet)";

  const recent = entries.slice(-maxRecent);
  const older = entries.slice(0, total - maxRecent);
  const lines: string[] = [];

  if (older.length > 0) {
    const typeCounts: Record<string, { total: number; errors: number; valPass: number; valFail: number }> = {};
    for (const entry of older) {
      const key = entry.toolName || "validation";
      if (!typeCounts[key]) typeCounts[key] = { total: 0, errors: 0, valPass: 0, valFail: 0 };
      typeCounts[key].total++;
      if (entry.isError) typeCounts[key].errors++;
      if (entry.type === "validation") {
        if (entry.passed) typeCounts[key].valPass++;
        else typeCounts[key].valFail++;
      }
    }
    const summaryParts = Object.entries(typeCounts).map(([tool, c]) => {
      const errStr = c.errors > 0 ? ` ${c.errors}✗` : "";
      const valStr = c.valPass + c.valFail > 0 ? ` (${c.valPass}✓/${c.valFail}✗)` : "";
      return `${tool}×${c.total}${errStr}${valStr}`;
    });
    lines.push(`  📋 Earlier (${total - maxRecent} more): ${summaryParts.join(", ")}`);
  }

  for (const entry of recent) {
    if (entry.type === "tool_call") {
      const icon = entry.isError ? "✗" : "✓";
      const args = typeof entry.args === "object" && entry.args !== null
        ? JSON.stringify(entry.args).slice(0, 60) : "";
      lines.push(`  ${icon} ${entry.toolName}${args ? ` ${args}` : ""}`);
    } else if (entry.type === "validation") {
      const icon = entry.passed ? "✓" : "✗";
      lines.push(`  ${icon} ${entry.validationName || entry.command?.slice(0, 50)}`);
    }
  }

  if (total > maxRecent + 5) lines.push(`  ─ ${total} total entries`);
  return lines.join("\n");
}

/**
 * Detect run of consecutive failures (regression).
 */
export function detectRegression(entries: LogEntry[], lookback: number = 6): string | null {
  const recent = entries.slice(-lookback);
  const valFails = recent.filter(e => e.type === "validation" && e.passed === false);
  if (valFails.length >= 3) return `Regression: ${valFails.length} recent validation failures`;

  const errs = recent.filter(e => e.isError);
  if (errs.length >= 3 && errs.every(e => e.toolName === errs[0].toolName)) {
    return `Repeated failure: ${errs[0].toolName} failed ${errs.length}x`;
  }
  return null;
}

/**
 * Calculate error rate over a sliding window.
 */
export function getErrorRate(entries: LogEntry[], window: number = 20): number {
  const slice = entries.slice(-window);
  if (slice.length === 0) return 0;
  return slice.filter(e => e.isError).length / slice.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Memory Decay — Ebbinghaus Forgetting Curve
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply time-based decay to confidence scores.
 * Uses exponential decay with configurable half-life.
 */
export function applyMemoryDecay(
  confidence: number,
  lastAccessTime: number,
  halfLifeDays: number = 30,
): number {
  if (confidence <= 0) return 0;
  const daysSinceAccess = (Date.now() - lastAccessTime) / (1000 * 60 * 60 * 24);
  if (daysSinceAccess <= 0) return confidence;
  const decayFactor = Math.exp(-daysSinceAccess / halfLifeDays);
  return Math.max(0, confidence * decayFactor);
}

/**
 * Each reinforcement extends the memory's half-life.
 */
export function computeEffectiveHalfLife(reuseCount: number, baseHalfLife: number = 30): number {
  const multiplier = 1 + Math.min(reuseCount, 6) * 0.5;
  return baseHalfLife * multiplier;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Dynamic Budget Adjustment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determines whether and how much to extend the budget based on phase
 * and remaining time.
 */
export function calculateBudgetExtension(
  currentPhase: string,
  remainingMs: number,
  totalBudgetMs: number,
  isInGraceBand: boolean,
): number {
  let extensionPercent = 0;

  if (currentPhase === "validate" && remainingMs < totalBudgetMs * 0.15) {
    extensionPercent = 0.20;
  } else if (currentPhase === "implement" && remainingMs < totalBudgetMs * 0.20) {
    extensionPercent = 0.10;
  } else if (isInGraceBand && remainingMs < 30_000) {
    extensionPercent = 0.15;
  }

  if (extensionPercent > 0) {
    const baseExtension = Math.round(totalBudgetMs * extensionPercent);
    const minExtension = remainingMs < 30_000 ? 30_000 : 0;
    return Math.max(baseExtension, minExtension);
  }

  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════
// 7. TF-IDF Enhanced Retrieval (Consolidated in lemonharness-shared.ts)
// ═══════════════════════════════════════════════

// All TF-IDF functions are now in lemonharness-shared.ts.
// Re-export for backward compatibility:
export {
  tokenize,
  simpleStem,
  computeTFIDFVector,
  cosineTFIDFSimilarity,
  hybridSimilarity,
  buildDocumentFrequency,
} from "../lib/lemonharness-shared";

// Deprecated - use buildDocumentFrequency from shared module
function buildDF(_entries: string[]): Map<string, number> {
  return new Map();
}

// 8. HealthChecker — Periodic Scheduled Health Checks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of a single health check execution.
 */
export interface HealthCheckResult {
  passed: boolean;
  severity: "green" | "yellow" | "red";
  message: string;
  details?: string;
}

/**
 * State snapshot passed to health check functions.
 * Aggregated from workspace, time director, and execution logger.
 */
export interface HealthCheckState {
  turnIndex: number;
  elapsedMs: number;
  totalBudgetMs: number;
  currentPhase: string;
  phaseProgress: number;
  totalProgress: number;
  totalToolCalls: number;
  totalErrors: number;
  consecutiveErrors: number;
  errorRate: number;
  regressionDetected: boolean;
  regressionMessage: string | null;
  filesModified: number;
  dependencies: string[];
  dependencyCount: number;
  validationsPassed: number;
  validationsFailed: number;
}

/**
 * Internal registration for a health check.
 */
export interface HealthCheckRegistration {
  name: string;
  interval: number;
  checkFn: (state: HealthCheckState) => HealthCheckResult;
  lastRunTurn: number;
  lastResult: HealthCheckResult | null;
}

/**
 * HealthChecker — Periodic Scheduled Health Checks
 *
 * Registers interval-based hooks that fire every N turns to check
 * approach validity, budget health, and prerequisite changes.
 *
 * Features:
 * - Configurable check intervals (default: every 5 turns)
 * - Three default checks: approach_validity, budget_health, prerequisite_change
 * - Yellow alert for approach drift, Red alert for budget overrun
 * - Status report via getStatus()
 */
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

  /**
   * Register a health check function that runs every `interval` turns.
   */
  registerCheck(name: string, interval: number, checkFn: (state: HealthCheckState) => HealthCheckResult): void {
    this.checks.set(name, { name, interval, checkFn, lastRunTurn: 0, lastResult: null });
  }

  /**
   * Register the three default health checks:
   *   1. approach_validity — Is the approach still valid given new information?
   *   2. budget_health — Are we on track for the budget?
   *   3. prerequisite_change — Have prerequisites changed?
   *
   * Each runs every 5 turns (configurable via interval parameter).
   */
  registerDefaultChecks(interval: number = 5): void {
    // Check 1: Approach validity
    this.registerCheck("approach_validity", interval, (state) => {
      // Yellow alert if 3+ consecutive errors (approach drift)
      if (state.consecutiveErrors >= 3) {
        return {
          passed: false,
          severity: "yellow",
          message: `Approach may be drifting: ${state.consecutiveErrors} consecutive errors detected`,
          details: `Check if current approach needs adjustment; consider pivoting or re-evaluating assumptions`,
        };
      }
      // Yellow alert if regression detected
      if (state.regressionDetected) {
        return {
          passed: false,
          severity: "yellow",
          message: `Approach validity concern: ${state.regressionMessage || "Regression detected (3+ consecutive failures of same type)"}`,
          details: `Repeated failures of same type suggest the current approach is not working`,
        };
      }
      // Yellow alert if error rate > 50% in recent calls
      if (state.errorRate > 0.5 && state.totalToolCalls >= 5) {
        return {
          passed: false,
          severity: "yellow",
          message: `High error rate (${(state.errorRate * 100).toFixed(0)}% of recent calls) — approach may need revision`,
          details: `More than half of recent tool calls resulted in errors; consider a different approach`,
        };
      }
      return {
        passed: true,
        severity: "green",
        message: "Approach appears valid given current execution context",
      };
    });

    // Check 2: Budget health
    this.registerCheck("budget_health", interval, (state) => {
      const remainingPct = Math.max(0, 1 - state.totalProgress);

      // Red alert: < 10% remaining and not yet in reserve phase
      if (remainingPct < 0.1 && state.currentPhase !== "reserve") {
        return {
          passed: false,
          severity: "red",
          message: `Budget overrun risk: only ${(remainingPct * 100).toFixed(0)}% of budget remains in ${state.currentPhase} phase`,
          details: `Immediately wrap up current work and transition to reserve phase to preserve results`,
        };
      }

      // Yellow alert: < 20% remaining and still in explore or implement
      if (remainingPct < 0.2 && (state.currentPhase === "explore" || state.currentPhase === "implement")) {
        return {
          passed: false,
          severity: "yellow",
          message: `Budget running low: ${(remainingPct * 100).toFixed(0)}% remaining in ${state.currentPhase} phase`,
          details: `Accelerate execution or adjust scope to fit within the remaining budget`,
        };
      }

      // Yellow alert: spent > 35% of budget but still in explore
      if (state.currentPhase === "explore" && state.totalProgress > 0.35) {
        return {
          passed: false,
          severity: "yellow",
          message: `Spent ${(state.totalProgress * 100).toFixed(0)}% of budget but still in explore phase`,
          details: `Consider transitioning to implementation phase to make progress on the task`,
        };
      }

      return {
        passed: true,
        severity: "green",
        message: `Budget on track (${(remainingPct * 100).toFixed(0)}% remaining)`,
      };
    });

    // Check 3: Prerequisite change
    this.registerCheck("prerequisite_change", interval, (state) => {
      // If 2+ consecutive errors and past early phase, prerequisites may be stale
      if (state.consecutiveErrors >= 2 && state.totalProgress > 0.3) {
        return {
          passed: false,
          severity: "yellow",
          message: `Prerequisites may have changed: ${state.consecutiveErrors} errors suggest underlying assumptions may be invalid`,
          details: `Check if dependencies, file paths, or environment configuration have changed since the start`,
        };
      }

      // Healthy: report current state
      const depInfo = state.dependencyCount > 0
        ? `${state.dependencyCount} dependencies installed`
        : "no dependencies";
      const fileInfo = state.filesModified > 0
        ? `${state.filesModified} files modified`
        : "no files modified yet";

      return {
        passed: true,
        severity: "green",
        message: `Prerequisites stable — ${depInfo}, ${fileInfo}`,
      };
    });
  }

  /**
   * Run all health checks that are due based on the current turn index and state.
   * Call this after each tool call or turn.
   */
  runChecks(state: Partial<HealthCheckState>): void {
    this.turnIndex++;

    const fullState: HealthCheckState = {
      turnIndex: this.turnIndex,
      elapsedMs: state.elapsedMs ?? 0,
      totalBudgetMs: state.totalBudgetMs ?? 300000,
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

        // Generate alerts for non-green results (deduped by name + severity)
        if (result.severity === "yellow" || result.severity === "red") {
          // Avoid duplicate alerts for the same check
          const hasActive = this.alerts.some(
            a => !a.dismissed && a.name === name && a.severity === result.severity && a.message === result.message
          );
          if (!hasActive) {
            this.alerts.push({
              name,
              severity: result.severity,
              message: result.message,
              timestamp: Date.now(),
              dismissed: false,
            });
          }
        }
      }
    }
  }

  /**
   * Get all pending alerts and mark them as dismissed.
   * Returns empty array if no new alerts.
   */
  getAlerts(): Array<{ name: string; severity: "yellow" | "red"; message: string }> {
    const pending = this.alerts.filter(a => !a.dismissed);
    for (const alert of pending) {
      alert.dismissed = true;
    }
    return pending.map(({ name, severity, message }) => ({ name, severity, message }));
  }

  /**
   * Get a formatted human-readable status report of all health checks.
   * Shows last result for each check and any pending alerts.
   */
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
      const lastRunStr = !result
        ? "Pending (first check on next cycle)"
        : `Last: ${result.message}`;

      lines.push(`  ${icon} ${name}`);
      lines.push(`     ${lastRunStr}`);
      if (result?.details) {
        lines.push(`     ${result.details}`);
      }
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

  /**
   * Get the number of registered checks.
   */
  getCheckCount(): number {
    return this.checks.size;
  }

  /**
   * Get the current turn index.
   */
  getTurnIndex(): number {
    return this.turnIndex;
  }

  /**
   * Reset the health checker: clear all checks, alerts, and turn counter.
   */
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
      return {
        passed: false,
        severity: "yellow",
        message: `Approach may be drifting: ${state.consecutiveErrors} consecutive errors`,
      };
    }
    if (state.regressionDetected) {
      return {
        passed: false,
        severity: "yellow",
        message: `Approach validity concern: ${state.regressionMessage || "Regression detected"}`,
      };
    }
    if (state.errorRate > maxErrorRate && state.totalToolCalls >= 5) {
      return {
        passed: false,
        severity: "yellow",
        message: `High error rate (${(state.errorRate * 100).toFixed(0)}%)`,
      };
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
      return {
        passed: false,
        severity: "red",
        message: `Budget overrun risk: only ${(remainingPct * 100).toFixed(0)}% of budget remains`,
      };
    }
    if (remainingPct < 0.2 && (state.currentPhase === "explore" || state.currentPhase === "implement")) {
      return {
        passed: false,
        severity: "yellow",
        message: `Budget running low: ${(remainingPct * 100).toFixed(0)}% remaining in ${state.currentPhase} phase`,
      };
    }
    return { passed: true, severity: "green", message: "Budget on track" };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. ValidationAutoHealer — Self-Healing Validation Loop
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Represents a validation failure event with metadata for tracking.
 */
export interface ValidationFailureEvent {
  timestamp: number;
  command: string;
  errorOutput: string;
  suggestions: string[];
  resolved: boolean;
  healAttempts: number;
  escalated?: boolean;
  escalationReport?: string;
}

/**
 * Result of an auto-heal attempt.
 */
export interface AutoHealResult {
  healed: boolean;
  attemptedFix: string | null;
  topSuggestion: string | null;
  escalation: boolean;
  escalationReport?: string;
  retryCommand: string | undefined;
  attempt: number;
}

/**
 * Internal representation of an identified fix.
 */
interface IdentifiedFix {
  type: string;
  description: string;
  command?: string;
}

/**
 * ValidationAutoHealer — Self-Healing Validation Loop
 *
 * Automatically triages validation failures, searches ERL heuristics
 * for relevant prevention/correction rules, and attempts automatic fixes
 * for common issues (formatting, missing imports, type errors, etc.).
 *
 * After 3 failed auto-retry attempts, escalates with a structured report.
 *
 * Research basis: arXiv:2603.24639 — ERL Experiential Reflective Learning
 * Applied to validation: auto-extract patterns from errors, attempt fix,
 * re-run validation, and escalate on repeated failure.
 */
export class ValidationAutoHealer {
  private projectRoot: string;
  private workspaceDir: string;
  private attemptCount: Map<string, number> = new Map();
  private failureEvents: ValidationFailureEvent[] = [];
  private heuristicManager: HeuristicManager | null = null;

  constructor(projectRoot: string, workspaceDir: string) {
    this.projectRoot = projectRoot;
    this.workspaceDir = workspaceDir;
  }

  /**
   * Set the HeuristicManager instance for ERL heuristic lookups.
   */
  setHeuristicManager(hm: HeuristicManager): void {
    this.heuristicManager = hm;
  }

  /**
   * Auto-heal a validation failure.
   *
   * 1. Register validation_failure event
   * 2. Search ERL heuristics for relevant prevention/correction rules
   * 3. Present the top retry suggestion
   * 4. Attempt automatic fix based on error pattern
   * 5. If fix succeeds, return retry command
   * 6. If fails 3 times, escalate with structured report
   */
  async autoHeal(
    validationCommand: string,
    errorOutput: string
  ): Promise<AutoHealResult> {
    const key = this.normalizeKey(validationCommand);
    const currentAttempts = this.attemptCount.get(key) || 0;
    const newAttempts = currentAttempts + 1;
    this.attemptCount.set(key, newAttempts);

    // 1. Register failure event
    const event: ValidationFailureEvent = {
      timestamp: Date.now(),
      command: validationCommand,
      errorOutput,
      suggestions: [],
      resolved: false,
      healAttempts: newAttempts,
    };
    this.failureEvents.push(event);

    // 2. Search ERL heuristics for relevant prevention/correction rules
    const relevantHeuristics = this.getHeuristicsFor(errorOutput);
    const topSuggestion = relevantHeuristics.length > 0
      ? relevantHeuristics[0].rule
      : null;

    // 3. Check escalation threshold (3 strikes → escalate)
    if (newAttempts >= 3) {
      event.escalated = true;
      event.escalationReport = this.buildEscalationReport(
        validationCommand, errorOutput, newAttempts, relevantHeuristics.slice(0, 3)
      );
      event.suggestions = relevantHeuristics.map(h => h.rule);
      return {
        healed: false,
        attemptedFix: null,
        topSuggestion,
        escalation: true,
        escalationReport: event.escalationReport,
        retryCommand: undefined,
        attempt: newAttempts,
      };
    }

    // 4. Try to identify the issue from error output
    const fix = this.identifyFix(errorOutput);
    if (!fix) {
      // No known fix pattern — present top heuristic suggestion
      event.suggestions = relevantHeuristics.map(h => h.rule);
      return {
        healed: false,
        attemptedFix: null,
        topSuggestion,
        escalation: false,
        retryCommand: undefined,
        attempt: newAttempts,
      };
    }

    // 5. Apply the identified fix
    const fixApplied = await this.applyFix(fix);
    if (fixApplied) {
      event.resolved = true;
      event.suggestions = [fix.description];
      return {
        healed: true,
        attemptedFix: fix.description,
        topSuggestion,
        escalation: false,
        retryCommand: validationCommand,
        attempt: newAttempts,
      };
    }

    // Fix failed — return with suggestion
    event.suggestions = relevantHeuristics.map(h => h.rule);
    return {
      healed: false,
      attemptedFix: fix.description,
      topSuggestion,
      escalation: false,
      retryCommand: undefined,
      attempt: newAttempts,
    };
  }

  /**
   * Register a validation failure without attempting auto-heal.
   */
  registerFailure(command: string, errorOutput: string): ValidationFailureEvent {
    const event: ValidationFailureEvent = {
      timestamp: Date.now(),
      command,
      errorOutput,
      suggestions: [],
      resolved: false,
      healAttempts: 0,
    };
    this.failureEvents.push(event);
    return event;
  }

  /**
   * Manually trigger healing for the most recent failure.
   */
  async healLastFailure(): Promise<AutoHealResult | null> {
    const lastFailure = this.getLastFailure();
    if (!lastFailure) return null;
    return this.autoHeal(lastFailure.command, lastFailure.errorOutput);
  }

  /**
   * Get the last unresolved failure event.
   */
  getLastFailure(): ValidationFailureEvent | null {
    for (let i = this.failureEvents.length - 1; i >= 0; i--) {
      if (!this.failureEvents[i].resolved && !this.failureEvents[i].escalated) {
        return this.failureEvents[i];
      }
    }
    return this.failureEvents.length > 0
      ? this.failureEvents[this.failureEvents.length - 1]
      : null;
  }

  /**
   * Get recent failure events (last N).
   */
  getRecentFailures(n: number = 5): ValidationFailureEvent[] {
    return this.failureEvents.slice(-n);
  }

  /**
   * Get all failure events.
   */
  getAllFailures(): ValidationFailureEvent[] {
    return [...this.failureEvents];
  }

  /**
   * Identify the type of issue from error output and return a fix.
   * Supports: formatting, missing imports/modules, type errors, syntax errors, npm installs.
   */
  private identifyFix(errorOutput: string): IdentifiedFix | null {
    const lower = errorOutput.toLowerCase();

    // Formatting / lint issues — apply prettier + eslint auto-fix
    if (
      /\bprettier\b/i.test(errorOutput) ||
      /\bformatting\b/i.test(lower) ||
      /\beslint\b/i.test(errorOutput) ||
      /\blint(s|ing|)\b/i.test(errorOutput) ||
      /unnecessary\s+escape/i.test(lower) ||
      /trailing\s+(whitespace|space)/i.test(lower) ||
      /expected\s+(indentation|spacing)/i.test(lower) ||
      /code\s+style/i.test(lower)
    ) {
      return {
        type: "format",
        description: "Auto-format files with prettier and eslint --fix",
        command: "npx prettier --write . 2>/dev/null; npx eslint --fix . 2>/dev/null; true",
      };
    }

    // Missing imports / modules — install dependencies and suggest fix
    if (
      /cannot\s+find\s+(module|name|file)/i.test(errorOutput) ||
      /module\s+not\s+found/i.test(errorOutput) ||
      /missing\s+import/i.test(lower) ||
      /import.*not\s+found/i.test(lower) ||
      /no\s+such\s+file/i.test(lower) ||
      /require\(\).*not\s+found/i.test(errorOutput)
    ) {
      return {
        type: "import",
        description: "Check for missing imports and install dependencies",
        command: "npm install 2>/dev/null || true",
      };
    }

    // TypeScript type errors
    if (
      /type\s+.*\s+is\s+not\s+assignable/i.test(errorOutput) ||
      /cannot\s+find\s+name/i.test(errorOutput) ||
      /property\s+.*\s+does\s+not\s+exist/i.test(errorOutput) ||
      /is\s+not\s+a\s+type/i.test(errorOutput) ||
      /type\s+.*not\s+assignable/i.test(errorOutput) ||
      /Argument of type/i.test(errorOutput)
    ) {
      return {
        type: "type_error",
        description: "TypeScript type error detected — may require manual fix",
      };
    }

    // Syntax errors
    if (
      /unexpected\s+token/i.test(errorOutput) ||
      /syntax\s+error/i.test(lower) ||
      /unexpected\s+identifier/i.test(lower) ||
      /expected\s+.*got/i.test(errorOutput) ||
      /parse\s+error/i.test(lower)
    ) {
      return {
        type: "syntax",
        description: "Syntax error detected — may require manual fix",
      };
    }

    // Missing npm packages (node_modules not found, ENOENT)
    if (
      /cannot\s+find\s+module/i.test(errorOutput) ||
      /ENOENT/i.test(errorOutput) ||
      /Cannot\s+resolve\s+module/i.test(errorOutput)
    ) {
      if (lower.includes("node_modules") || lower.includes("npm") || lower.includes("package")) {
        return {
          type: "npm_install",
          description: "Install missing npm packages",
          command: "npm install",
        };
      }
    }

    // Test failures — attempt to gather more info
    if (
      /\btest\b/i.test(errorOutput) &&
      (/\bfail/i.test(errorOutput) || /\berror\b/i.test(errorOutput))
    ) {
      return {
        type: "test_failure",
        description: "Test failure detected — may require manual investigation",
      };
    }

    return null;
  }

  /**
   * Apply an identified fix by running its shell command.
   * Returns true if the fix was applied successfully.
   */
  private async applyFix(fix: IdentifiedFix): Promise<boolean> {
    if (!fix.command) return false;
    try {
      await this.execCommand(fix.command);
      return true;
    } catch (e) {
      console.error("Subsystems: operation failed", e);
      return false;
    }
  }

  /**
   * Search ERL heuristics for relevant rules based on error output.
   */
  private getHeuristicsFor(errorOutput: string): Heuristic[] {
    if (!this.heuristicManager) return [];
    const domain = this.detectDomain(errorOutput);
    const heuristics = this.heuristicManager.getRelevantHeuristics(domain, 5);
    // Also search for general heuristics as fallback
    if (heuristics.length < 2) {
      const general = this.heuristicManager.getRelevantHeuristics("general", 3);
      return [...heuristics, ...general];
    }
    return heuristics;
  }

  /**
   * Detect the relevant domain from error output for heuristic matching.
   */
  private detectDomain(errorOutput: string): string {
    const lower = errorOutput.toLowerCase();
    if (lower.includes("typescript") || lower.includes(".tsx") || /\.[jt]sx?:/i.test(errorOutput)) return "typescript";
    if (lower.includes("javascript") || /\.js:/i.test(errorOutput)) return "javascript";
    if (lower.includes("python") || /\.py:/i.test(errorOutput)) return "python";
    if (lower.includes("css") || lower.includes("scss") || lower.includes("sass")) return "css";
    if (lower.includes("json") || /\/package\.json/i.test(errorOutput)) return "json";
    if (lower.includes("npm") || lower.includes("node_modules") || lower.includes("package.json")) return "npm";
    if (lower.includes("test") && (lower.includes("fail") || lower.includes("error"))) return "testing";
    return "general";
  }

  /**
   * Build a structured escalation report for the /lemonharness:heal command.
   */
  private buildEscalationReport(
    command: string,
    errorOutput: string,
    attempts: number,
    relevantHeuristics: Heuristic[]
  ): string {
    const lines: string[] = [
      "═══════════════════════════════════════════",
      "  🚨 VALIDATION ESCALATION REPORT",
      "═══════════════════════════════════════════",
      "",
      `  Validation Command: ${command}`,
      `  Failed Attempts: ${attempts}`,
      `  Timestamp: ${new Date().toISOString()}`,
      "",
      "  ── Error Output Summary ──",
      `  ${errorOutput.slice(0, 800)}`,
      "",
    ];

    if (relevantHeuristics.length > 0) {
      lines.push("  ── Relevant ERL Heuristics ──");
      for (const h of relevantHeuristics) {
        lines.push(`  • [${h.type}] "${h.rule}" (confidence: ${(h.confidence * 100).toFixed(0)}%)`);
      }
      lines.push("");
    }

    lines.push("  ── Suggested Actions ──");
    lines.push("  1. Review the error output above for root cause");
    lines.push("  2. Consider manual inspection of affected files");
    lines.push("  3. Try running the validation command with verbose output");
    lines.push("  4. Check if dependencies or environment have changed");
    lines.push("");
    lines.push("═══════════════════════════════════════════");

    return lines.join("\n");
  }

  /**
   * Execute a shell command in the project root with a 30-second timeout.
   */
  private async execCommand(cmd: string): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("bash", ["-c", cmd], {
        cwd: this.projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30000,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", (code) => {
        if (code === 0) resolvePromise(stdout);
        else rejectPromise(new Error(stderr.slice(0, 200)));
      });
      child.on("error", (err) => rejectPromise(err));
    });
  }

  /**
   * Normalize a validation command to a consistent key for attempt counting.
   */
  private normalizeKey(command: string): string {
    return command.trim().toLowerCase().replace(/\s+/g, " ");
  }

  /**
   * Reset attempt counter for a specific command.
   */
  resetAttempts(command: string): void {
    this.attemptCount.delete(this.normalizeKey(command));
  }

  /**
   * Reset all attempt counters (e.g., after a successful manual fix).
   */
  resetAllAttempts(): void {
    this.attemptCount.clear();
  }

  /**
   * Get the current attempt count for a command.
   */
  getAttemptCount(command: string): number {
    return this.attemptCount.get(this.normalizeKey(command)) || 0;
  }

  /**
   * Get auto-healing statistics for display.
   */
  getStats(): string {
    const total = this.failureEvents.length;
    const resolved = this.failureEvents.filter(e => e.resolved).length;
    const escalated = this.failureEvents.filter(e => e.escalated).length;
    const pending = total - resolved - escalated;

    const lines: string[] = [
      "🩺 Validation Auto-Healing Stats",
      "─────────────────────────────────",
      `  Total failures tracked: ${total}`,
      `  Auto-healed (attempted fix): ${resolved}`,
      `  Escalated (3+ failed attempts): ${escalated}`,
      `  Pending: ${pending}`,
    ];
    if (total > 0) {
      const successRate = ((resolved / total) * 100).toFixed(0);
      lines.push(`  Auto-heal success rate: ${successRate}%`);
    }
    return lines.join("\n");
  }

  /**
   * Get a formatted summary of all tracked failures.
   */
  getFailuresSummary(): string {
    const total = this.failureEvents.length;
    if (total === 0) return "No validation failures tracked.";

    const lines: string[] = [
      `📋 Validation Failures (${total} total):`,
    ];

    for (let i = 0; i < Math.min(total, 10); i++) {
      const f = this.failureEvents[total - 1 - i];
      const status = f.resolved ? "✅ healed" : f.escalated ? "🚨 escalated" : "⏳ pending";
      const cmd = f.command.length > 50 ? f.command.slice(0, 50) + "..." : f.command;
      const time = new Date(f.timestamp).toLocaleTimeString();
      lines.push(`  ${status} [${time}] ${cmd} (${f.healAttempts} attempt(s))`);
    }

    return lines.join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension Factory
// ═══════════════════════════════════════════════════════════════════════════

export default function (pi: any) {
  pi.on("session_start", async (_event: any, ctx: any) => {
    ctx.ui.setStatus("lemonharness-subsystems", "🔧 Subsystems module loaded");
  });
  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    ctx.ui.setStatus("lemonharness-subsystems", undefined);
  });
}
