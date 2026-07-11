// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * Types and interfaces for LemonHarness Enhanced Subsystems
 *
 * Research basis:
 * - Dependency provenance: ProjectMem (arXiv:2606.12329)
 * - Harness Metrics: arXiv:2605.18747
 * - Phase Checkpoints: arXiv:2602.06413
 * - Safety Specs: arXiv:2604.23210
 * - ERL Heuristics: arXiv:2603.24639
 * - Tool Privilege: arXiv:2606.20023
 * - SaP Contracts: arXiv:2605.27955
 * - Key Moments: arXiv:2605.14211
 * - MemCoder: arXiv:2603.13258
 */

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

// ═══════════════════════════════════════════════════════════════════════════
// 2. Cross-Session Metrics
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

// ── v3: Harness Evaluation Metrics ──────────────────────────────────
// Research basis: arXiv:2605.18747 — Section 4 (Harness Evaluation)

export interface HarnessMetrics {
  constraintViolations: number;
  traceCompleteness: number;
  toolJustificationRate: number;
  recoveryEfficiency: number;
  regressionFreeRate: number;
}

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
  workspaceState: string;
  trailSummary: string;
  decisionAdvantage: number;
}

// ── v3: Safety Specifications ───────────────────────────────────────
// Research basis: arXiv:2604.23210 — EPO-Safe Framework

export interface SafetySpec {
  rule: string;
  triggeredBy: string;
  confidence: number;
  timesTriggered: number;
  lastObserved: number;
}

// ── v3: Heuristics (ERL) ────────────────────────────────────────────
// Research basis: arXiv:2603.24639 — Experiential Reflective Learning

export interface Heuristic {
  id: string;
  rule: string;
  domain: string;
  type: "prevention" | "correction" | "optimization";
  sourceEvent: string;
  confidence: number;
  successCount: number;
  failureCount: number;
  createdAt: number;
  lastUsedAt: number;
}

// ── v3: Tool Privilege ─────────────────────────────────────────────
// Research basis: arXiv:2606.20023 — Over-Privileged Tool Selection

export enum ToolPrivilegeLevel {
  READ       = 1,
  SCOPED_WRITE = 2,
  EXECUTION  = 3,
  MANAGEMENT = 4,
}

export interface ToolPrivilege {
  toolName: string;
  level: ToolPrivilegeLevel;
  description: string;
  sufficientAlternatives: string[];
}

// ── v3: Tool Privilege Escalation Ladder ──────────────────────────

export interface EscalationStep {
  level: ToolPrivilegeLevel;
  toolName: string;
  timestamp: number;
  alternativeTool: string | null;
  alternativeLevel: ToolPrivilegeLevel | null;
  success: boolean | null;
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
  beforeState: string;
  afterState: string;
  pattern: string;
  significance: number;
}

// ── v3: Verification-Pattern Correlation (MemCoder) ─────────────────
// Research basis: arXiv:2603.13258 — MemCoder framework

export interface ValidationCorrelation {
  patternDescription: string;
  totalApplications: number;
  passedValidations: number;
  correlation: number;
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

// ═══════════════════════════════════════════════════════════════════════════
// 4. Trail Compression — Log Entry
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

// ═══════════════════════════════════════════════════════════════════════════
// Quality Gate — Config
// ═══════════════════════════════════════════════════════════════════════════

export interface QualityGateConfig {
  autoTriggerOnP3Entry: boolean;
  blockOnFailure: boolean;
  scriptPath: string;
  expectedOutput: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. HealthChecker — Types
// ═══════════════════════════════════════════════════════════════════════════

export interface HealthCheckResult {
  passed: boolean;
  severity: "green" | "yellow" | "red";
  message: string;
  details?: string;
}

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

export interface HealthCheckRegistration {
  name: string;
  interval: number;
  checkFn: (state: HealthCheckState) => HealthCheckResult;
  lastRunTurn: number;
  lastResult: HealthCheckResult | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. ValidationAutoHealer — Types
// ═══════════════════════════════════════════════════════════════════════════

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

export interface AutoHealResult {
  healed: boolean;
  attemptedFix: string | null;
  topSuggestion: string | null;
  escalation: boolean;
  escalationReport?: string;
  retryCommand: string | undefined;
  attempt: number;
}
