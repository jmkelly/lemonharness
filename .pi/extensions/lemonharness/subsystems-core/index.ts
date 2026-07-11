// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * LemonHarness Enhanced Subsystems — Barrel
 *
 * Re-exports all subsystem classes, types, and helper functions.
 * All imports from "./subsystems-core" resolve to this index.
 */

// ── Types ───────────────────────────────────────────────────────
export type {
  DependencyNode,
  SessionMetrics,
  HarnessMetrics,
  HarnessMetricsSnapshot,
  PhaseCheckpoint,
  SafetySpec,
  Heuristic,
  ToolPrivilege,
  EscalationStep,
  EscalationPattern,
  KeyMoment,
  ValidationCorrelation,
  SkillContract,
  SaPVerificationResult,
  LogEntry,
  QualityGateConfig,
  HealthCheckResult,
  HealthCheckState,
  HealthCheckRegistration,
  ValidationFailureEvent,
  AutoHealResult,
} from "./types";

export {
  ToolPrivilegeLevel,
} from "./types";

// ── Classes ─────────────────────────────────────────────────────
export { DependencyGraph } from "./dependency-graph";
export { MetricsRecorder } from "./metrics-recorder";
export { QualityGateManager } from "./quality-gate";
export { HeuristicManager } from "./heuristic-manager";
export { PrivilegeManager } from "./privilege-manager";
export { SaPVerifier } from "./sap-verifier";
export { KeyMomentDetector } from "./key-moment-detector";
export { VerificationRefinement } from "./verification-refinement";
export { CommitAwareMemory } from "./commit-aware-memory";

// ── Helpers ─────────────────────────────────────────────────────
export {
  compressTrail,
  detectRegression,
  getErrorRate,
  applyMemoryDecay,
  computeEffectiveHalfLife,
  calculateBudgetExtension,
} from "./helpers";

// ── Health Checker ──────────────────────────────────────────────
export { HealthChecker, createApproachValidityCheck, createBudgetHealthCheck } from "./health-checker";

// ── Validation Auto-Healer ──────────────────────────────────────
export { ValidationAutoHealer } from "./validation-auto-healer";

// ── Re-exports from shared (TF-IDF) ─────────────────────────────
export {
  tokenize,
  simpleStem,
  computeTFIDFVector,
  cosineTFIDFSimilarity,
  hybridSimilarity,
  buildDocumentFrequency,
} from "../shared";
