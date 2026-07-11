// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * Types and interfaces for LemonHarness Workspace Extension
 */

// ── Workspace Types ────────────────────────────────────────────

export interface WorkspaceFileEntry {
  path: string;
  action: "create" | "modify" | "delete";
  timestamp: number;
}

export interface WorkspaceProcessEntry {
  command: string;
  pid: number;
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
}

export interface WorkspaceState {
  files: WorkspaceFileEntry[];
  processes: WorkspaceProcessEntry[];
  dependencies: string[];
  elapsedMs: number;
  lastReset: number;
}

// ── Time Director Types ────────────────────────────────────────

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

// ── Execution Logger Types ─────────────────────────────────────

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
  confidence?: { score: number; rationale: string; flagForReview: boolean };
}

// ── Skill Types ────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  content: string;
  loadedAt: number;
}

// ── v3: Phase Checkpoints ─────────────────────────────────────

export interface PhaseCheckpoint {
  phase: string;
  timestamp: number;
  elapsedMs: number;
  totalBudgetMs: number;
  workspaceState: string;
  trailSummary: string;
  decisionAdvantage: number;
}

// ── Context Budget Tracker Types ───────────────────────────────

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
  memory: { count: number; tokens: number };
  skills: { count: number; tokens: number };
  recommendation: string;
}

// ── Snapshot Types ─────────────────────────────────────────────

export interface SnapshotFileEntry {
  path: string;
  action?: "create" | "modify" | "delete";
  diffFile?: string;
  oldContentFile?: string;
  size?: number;
  mode?: number;
}

export interface SnapshotMeta {
  id: string;
  description: string;
  timestamp: number;
  totalFiles: number;
  totalSize: number;
  phase?: string;
  files?: SnapshotFileEntry[];
}

export interface SnapshotFileChange {
  path: string;
  type?: "modified" | "created" | "deleted";
  oldContent?: string | null;
  newContent?: string | null;
  action?: string;
}
