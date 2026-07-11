// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * LemonHarness Workspace Core — Barrel
 *
 * Re-exports all workspace core classes, types, and helper functions.
 * All imports from "./workspace-core" resolve to this index.
 */

// ── Types ───────────────────────────────────────────────────────
export type {
  WorkspaceFileEntry,
  WorkspaceProcessEntry,
  WorkspaceState,
  TimeDirectorConfig,
  TimePhaseName,
  TimePhase,
  LogEntry,
  SkillInfo,
  PhaseCheckpoint,
  ContextStatusResult,
  SnapshotFileEntry,
  SnapshotMeta,
  SnapshotFileChange,
} from "./types";

// ── Helpers ─────────────────────────────────────────────────────
export {
  pathExists,
  detectBashStateChange,
  formatDuration,
  estimateBudgetFromPrompt,
  computeUnifiedDiff,
  sanitizePathForFile,
} from "./helpers";

// ── Classes and Instances ───────────────────────────────────────
export { FormatGuard, formatGuard } from "./format-guard";
export { WorkspaceManager } from "./workspace-manager";
export { TimeDirector } from "./time-director";
export { ExecutionLogger } from "./execution-logger";
export { ContextBudgetTracker } from "./context-budget";
export { SnapshotManager } from "./snapshot-manager";
export { RuleKnowledgeManager } from "./rule-knowledge";
export type { SkillInfo as SkillInfo_RuleKnowledge } from "./rule-knowledge";

// ── Settings ────────────────────────────────────────────────────
export {
  getProjectRoot,
  setProjectRoot,
  readLemonHarnessSettings,
  bootstrapWorkspace,
} from "./settings";
