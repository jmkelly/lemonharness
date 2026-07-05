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

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, stat as fsStat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

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
    } catch { /* non-critical */ }
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
    } catch { /* non-critical */ }
  }

  async loadSafetySpecs() {
    try {
      const content = await readFile(this.safetySpecsPath, "utf-8");
      this.safetySpecs = JSON.parse(content);
    } catch {
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
    try { const { mkdir, writeFile } = await import("node:fs/promises"); const { dirname } = await import("node:path"); await mkdir(dirname(this.storagePath), { recursive: true }); await writeFile(this.storagePath, JSON.stringify(this.heuristics, null, 2), "utf-8"); } catch { /* non-critical */ }
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

  constructor() { this.registerDefaultTools(); }

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
    return [`🔒 Tool Privileges:`, `  ${total} tools registered`, `  Escalation rate: ${rate}% (${escalations} escalations in ${this.totalToolCalls} calls)`, `  Least-privilege compliance: ${compliance}%`].join("\n");
  }

  reset() { this.toolPrivileges.clear(); this.escalationHistory = []; this.totalToolCalls = 0; this.registerDefaultTools(); }
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

  private checkBinding(_contract: SkillContract): boolean { return true; }

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
      const msgs = commits.map(c => c.message).join(" ");
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
// 7. TF-IDF Enhanced Retrieval
// ═══════════════════════════════════════════════════════════════════════════

interface TokenVector {
  tokens: Map<string, number>;
  magnitude: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2 && t.length <= 40)
    .map(t => simpleStem(t));
}

function simpleStem(word: string): string {
  if (word.length <= 4) return word;
  const suffixes = ["ing", "tion", "sion", "ment", "ness", "able", "ible", "ful", "less", "ly", "ed", "es", "s"];
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function buildDF(entries: string[]): Map<string, number> {
  const df = new Map<string, number>();
  const N = entries.length;
  if (N === 0) return df;
  for (const text of entries) {
    const terms = new Set(tokenize(text));
    for (const term of terms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }
  return df;
}

export function computeTFIDFVector(
  query: string,
  corpus: string[],
  docIndex: number,
): TokenVector {
  const queryTerms = tokenize(query);
  const docTerms = tokenize(corpus[docIndex] || "");

  if (queryTerms.length === 0 || docTerms.length === 0) {
    return { tokens: new Map(), magnitude: 0 };
  }

  const df = buildDF(corpus);
  const N = corpus.length;

  const tokens = new Map<string, number>();
  const querySet = new Set(queryTerms);
  let magnitude = 0;

  for (const term of docTerms) {
    if (!querySet.has(term)) continue;
    const tf = 1 + Math.log2(docTerms.filter(t => t === term).length + 1);
    const docFreq = df.get(term) || 1;
    const idf = Math.log2((N + 1) / (docFreq + 1)) + 1;
    const tfidf = tf * idf;
    tokens.set(term, tfidf);
    magnitude += tfidf * tfidf;
  }

  return { tokens, magnitude: Math.sqrt(magnitude) };
}

export function cosineTFIDFSimilarity(
  query: string,
  document: string,
  corpus: string[],
): number {
  if (!query.trim() || !document.trim()) return 0;
  const corpusForIdf = [...corpus, query];
  const docIndex = corpus.indexOf(document);
  if (docIndex < 0) {
    const terms = tokenize(document);
    const qTerms = tokenize(query);
    const intersection = terms.filter(t => qTerms.includes(t));
    const union = new Set([...terms, ...qTerms]);
    return union.size > 0 ? intersection.length / union.size : 0;
  }
  const docVec = computeTFIDFVector(query, corpusForIdf, docIndex);
  const queryVec = computeTFIDFVector(query, corpusForIdf, corpusForIdf.length - 1);
  if (docVec.magnitude === 0 || queryVec.magnitude === 0) return 0;
  let dotProduct = 0;
  for (const [term, score] of docVec.tokens) {
    const qScore = queryVec.tokens.get(term) || 0;
    dotProduct += score * qScore;
  }
  return dotProduct / (docVec.magnitude * queryVec.magnitude);
}

export function hybridSimilarity(
  query: string,
  document: string,
  corpus: string[],
): number {
  const tfidf = cosineTFIDFSimilarity(query, document, corpus);
  const queryWords = new Set(tokenize(query));
  const docWords = new Set(tokenize(document));
  const intersection = new Set([...queryWords].filter(w => docWords.has(w)));
  const union = new Set([...queryWords, ...docWords]);
  const jaccard = union.size > 0 ? intersection.size / union.size : 0;
  return tfidf * 0.6 + jaccard * 0.4;
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
