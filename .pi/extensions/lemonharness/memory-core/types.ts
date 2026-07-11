// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * Types for HarnessMem — Memory & Learning Extension
 *
 * Implements a dual-representation memory system inspired by:
 * - Metis (arXiv:2606.24151): dual text + code memory
 * - ProjectMem (arXiv:2606.12329): event-sourced log
 * - MemCoder (arXiv:2603.13258): experience distillation
 * - Distilling Feedback (arXiv:2601.05960)
 * - Learning When to Remember (arXiv:2604.27283)
 */

export type MemoryEventType =
  | "decision"
  | "solution"
  | "failure"
  | "pattern"
  | "feedback"
  | "insight";

export interface MemoryEvent {
  id: string;
  type: MemoryEventType;
  timestamp: number;
  sessionId: string;
  summary: string;
  details: string;
  context?: string;
  tags: string[];
  outcome?: "success" | "failure" | "unknown";
  codeRef?: string;
  reuseCount: number;
  successCount: number;
  failureCount: number;
  confidenceScore: number;
}

export interface TextMemoryEntry {
  id: string;
  type: MemoryEventType;
  summary: string;
  details: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sourceCount: number;
  reuseCount: number;
  successCount: number;
  failureCount: number;
  confidenceScore: number;
}

export interface CodeMemoryEntry {
  name: string;
  summary: string;
  scriptContent: string;
  createdAt: number;
  updatedAt: number;
  sourceCount: number;
  reuseCount: number;
  successCount: number;
  failureCount: number;
  confidenceScore: number;
  requires: string[];
}

export interface MemoryIndex {
  version: number;
  lastUpdated: number;
  events: number;
  textEntries: number;
  codeEntries: number;
  tags: Record<string, number>;
}

export interface PreActionCheck {
  shouldBlock: boolean;
  warning?: string;
  suggestion?: string;
  relevantMemory?: TextMemoryEntry | CodeMemoryEntry;
}

export interface RetrievalContext {
  query: string;
  tags?: string[];
  maxResults?: number;
  minConfidence?: number;
  taskType?: string;
}

export interface RetrievalResult {
  textMatches: Array<{ entry: TextMemoryEntry; score: number }>;
  codeMatches: Array<{ entry: CodeMemoryEntry; score: number }>;
  abstain: boolean;
  abstainReason?: string;
}
