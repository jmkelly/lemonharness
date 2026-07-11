// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * Helper functions for LemonHarness Workspace Extension
 */

import { stat as fsStat } from "node:fs/promises";

export async function pathExists(p: string): Promise<boolean> {
  try { await fsStat(p); return true; } catch { return false; }
}

export function detectBashStateChange(command: string): string | null {
  const patterns: RegExp[] = [
    />>?\s+\S+/, /touch\s+\S+/, /mv\s+\S+\s+\S+/, /cp\s+\S+\s+\S+/,
    /mkdir\s+-p\s+\S+/, /npm\s+install/, /pip\s+install/, /apt\s+install/,
    /yarn\s+add/, /pnpm\s+add/, /cargo\s+install/, /go\s+install/, /rm\s+-rf?\s+/,
  ];
  for (const pattern of patterns) { if (pattern.test(command)) return command.slice(0, 80); }
  return null;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}

export function estimateBudgetFromPrompt(prompt: string): number {
  const length = prompt.length;
  if (length < 100) return 2 * 60 * 1000;
  if (length < 500) return 5 * 60 * 1000;
  if (length < 2000) return 10 * 60 * 1000;
  return 20 * 60 * 1000;
}

/**
 * Generate a simple unified diff between two strings.
 * Produces a single-hunk unified diff suitable for snapshot recording.
 */
export function computeUnifiedDiff(oldStr: string, newStr: string, relPath: string): string {
  if (oldStr === newStr) return "";
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const minLen = Math.min(oldLines.length, newLines.length);
  let firstDiff = 0;
  while (firstDiff < minLen && oldLines[firstDiff] === newLines[firstDiff]) { firstDiff++; }
  let lastOld = oldLines.length - 1;
  let lastNew = newLines.length - 1;
  while (lastOld > firstDiff && lastNew > firstDiff && oldLines[lastOld] === newLines[lastNew]) { lastOld--; lastNew--; }
  const hunkOldStart = firstDiff + 1;
  const hunkOldCount = lastOld - firstDiff + 1;
  const hunkNewStart = firstDiff + 1;
  const hunkNewCount = lastNew - firstDiff + 1;
  const lines: string[] = [
    `--- a/${relPath}`, `+++ b/${relPath}`,
    `@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`,
  ];
  for (let i = firstDiff; i <= lastOld; i++) lines.push(`-${oldLines[i]}`);
  for (let i = firstDiff; i <= lastNew; i++) lines.push(`+${newLines[i]}`);
  return lines.join("\n");
}

/** Sanitize a string for use as a filename component */
export function sanitizePathForFile(p: string): string {
  return p.replace(/[^a-zA-Z0-9_\-\.\/]/g, "_");
}
