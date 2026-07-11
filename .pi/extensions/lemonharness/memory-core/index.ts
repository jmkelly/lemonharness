// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * HarnessMem — Memory & Learning Extension — Barrel
 *
 * Re-exports all memory core classes, types, and singleton instances.
 * All imports from "./memory-core" resolve to this index.
 */

// ── Types ───────────────────────────────────────────────────────
export type {
  MemoryEventType,
  MemoryEvent,
  TextMemoryEntry,
  CodeMemoryEntry,
  MemoryIndex,
  PreActionCheck,
  RetrievalContext,
  RetrievalResult,
} from "./types";

// ── Classes ─────────────────────────────────────────────────────
export { MemoryStore } from "./memory-store";
export { ExperienceDistiller } from "./experience-distiller";

// ── Re-export scoring for shared use ────────────────────────────
export { hybridSimilarity, tokenize, tfidfSimilarity, calculateConfidence } from "./scoring";

// ── Singleton Instances ─────────────────────────────────────────
import { MemoryStore } from "./memory-store";
import { ExperienceDistiller } from "./experience-distiller";

export const memoryStore = new MemoryStore();
export const memoryState = {
  experienceDistiller: null as ExperienceDistiller | null,
  initialized: false,
  distillInterval: null as ReturnType<typeof setInterval> | null,
  projectRoot: "",
};
