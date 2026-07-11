// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * Helper functions for LemonHarness subsystems
 *
 * Trail compression, regression detection, memory decay, and budget extension.
 */

import type { LogEntry } from "./types";

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
