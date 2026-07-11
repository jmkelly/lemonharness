/**
 * TUI (terminal) rendering for LemonHarness execution visualization.
 * Extracted from VisualizationGenerator.generateTUI method.
 */

import type { LogEntry, TimePhase, TimePhaseName } from "../workspace";
import type { BudgetData } from "./types";
import { PHASES } from "./types";
import { formatDuration } from "./html-utils";

/**
 * Generate a text-based ASCII visualization for the terminal.
 */
export function generateTUIView(
  trail: LogEntry[],
  currentPhase: TimePhase,
  budgetData: BudgetData,
  startTime: number,
): string {
  const { totalBudgetMs, elapsedMs } = budgetData;
  const progress = totalBudgetMs > 0 ? Math.min(elapsedMs / totalBudgetMs, 1) : 0;
  const progressPercent = Math.round(progress * 100);

  const totalCalls = trail.length;
  const errors = trail.filter(t => t.isError).length;
  const validations = trail.filter(t => t.type === "validation").length;
  const passedValidations = trail.filter(t => t.passed).length;
  const toolCallsCount = trail.filter(t => t.type === "tool_call").length;

  const elapsedFormatted = formatDuration(elapsedMs);
  const totalFormatted = formatDuration(totalBudgetMs);

  // Phase map for quick lookup
  const phaseMap: Record<TimePhaseName, { label: string; start: number; end: number }> = {
    explore:   { label: "EXPLORE",   start: 0.0, end: 0.3 },
    implement: { label: "IMPLEMENT", start: 0.3, end: 0.6 },
    validate:  { label: "VALIDATE",  start: 0.6, end: 0.9 },
    reserve:   { label: "RESERVE",   start: 0.9, end: 1.0 },
  };

  // ── Progress bar ──────────────────────────────────────────────
  const barWidth = 40;
  const filled = Math.round(progress * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  // ── Timeline ──────────────────────────────────────────────────
  const timelineWidth = 60;
  const lines: string[] = [];

  lines.push("┌─ LemonHarness Execution Trail ──────────────────────────────┐");
  lines.push(`│ Budget:  ${bar}  ${progressPercent}% used                  │`);
  lines.push(`│ Time:    ${elapsedFormatted} elapsed / ${totalFormatted} total           │`);
  lines.push("│                                                              │");

  // Phase timeline header
  const phaseRow = PHASES.map(p => {
    const len = Math.round((p.endRatio - p.startRatio) * timelineWidth);
    const label = p.label;
    return label.padEnd(len > label.length ? len : label.length, "─");
  }).join("│");
  lines.push(`│ ${phaseRow} │`);

  // Draw time axis with markers
  const axisChars: string[] = [];
  for (let i = 0; i < timelineWidth; i++) {
    axisChars.push("·");
  }
  for (const p of PHASES) {
    const idx = Math.round(p.startRatio * timelineWidth);
    if (idx > 0 && idx < timelineWidth) {
      axisChars[idx] = "│";
    }
  }
  lines.push(`│ ${axisChars.join("")} │`);

  // ── Events on timeline ────────────────────────────────────────
  if (trail.length > 0) {
    const maxTime = Math.max(...trail.map(t => t.timestamp));
    const minTime = startTime > 0 ? Math.min(startTime, ...trail.map(t => t.timestamp)) : Math.min(...trail.map(t => t.timestamp));
    const timeRange = maxTime - minTime || 1;

    const markerRows: string[][] = [[], [], []];
    const markerRowIndex = (entry: LogEntry): number => {
      if (entry.type === "validation") return 0;
      return 1 + (entry.isError ? 1 : 0);
    };

    for (const entry of trail) {
      const ratio = (entry.timestamp - minTime) / timeRange;
      const pos = Math.round(ratio * (timelineWidth - 1));
      if (pos < 0 || pos >= timelineWidth) continue;

      let marker: string;
      if (entry.type === "validation") {
        marker = entry.passed ? "V" : "!";
      } else {
        marker = entry.isError ? "x" : "o";
      }

      const row = markerRowIndex(entry);
      const actualRow = row < 3 ? row : 0;
      const rowData = markerRows[actualRow];

      while (rowData.length < pos) rowData.push(" ");
      if (rowData.length === pos) {
        rowData.push(marker);
      } else {
        for (let r = 0; r < 3; r++) {
          const rd = markerRows[r];
          if (rd.length <= pos || rd[pos] === " ") {
            while (rd.length < pos) rd.push(" ");
            rd[pos] = marker;
            break;
          }
        }
      }
    }

    for (const row of markerRows) {
      while (row.length < timelineWidth) row.push(" ");
      const rowStr = row.join("");
      if (rowStr.trim()) {
        lines.push(`│ ${rowStr} │`);
      }
    }
  }

  // Phase labels below timeline
  const labelRow = PHASES.map(p => {
    const len = Math.round((p.endRatio - p.startRatio) * timelineWidth);
    const label = `${p.label} (${Math.round(p.startRatio * 100)}-${Math.round(p.endRatio * 100)}%)`;
    return label.padEnd(len > label.length ? len : label.length).slice(0, len);
  }).join("");
  lines.push(`│ ${labelRow} │`);

  // Time axis
  const timeMarkers = ["0:00", formatDuration(totalBudgetMs * 0.25),
    formatDuration(totalBudgetMs * 0.5), formatDuration(totalBudgetMs * 0.75),
    formatDuration(totalBudgetMs)];
  const timeRowStr = timeMarkers.reduce((acc, t, i) => {
    const pos = Math.round((i / (timeMarkers.length - 1)) * timelineWidth);
    const padding = Math.max(1, pos - acc.length);
    return acc + " ".repeat(padding - t.length) + t;
  }, "");
  if (timeRowStr.trim()) {
    lines.push(`│ ${timeRowStr}${" ".repeat(Math.max(0, timelineWidth - timeRowStr.length))} │`);
  }

  // ── Stats summary ─────────────────────────────────────────────
  lines.push("│                                                              │");
  lines.push(`│ Stats:  ${toolCallsCount} tool calls, ${errors} errors, ${validations} validations (${passedValidations} passed) │`);
  lines.push(`│ Phase:  ${currentPhase.phase.toUpperCase()} │ ${Math.round(currentPhase.totalProgress * 100)}% of budget used │`);

  // ── Legend ────────────────────────────────────────────────────
  lines.push("│                                                              │");
  lines.push("│ Legend: o = tool (success)   x = tool (error)               │");
  lines.push("│         V = validation pass  ! = validation fail             │");
  lines.push("│         │ = phase boundary   · = time axis                  │");

  // ── Recent events ─────────────────────────────────────────────
  if (trail.length > 0) {
    lines.push("│                                                              │");
    lines.push("│ Recent Events:                                                │");
    const displayEntries = trail.slice(-10);
    for (let i = 0; i < displayEntries.length; i++) {
      const entry = displayEntries[i];
      const relTime = entry.timestamp - (startTime || entry.timestamp);
      const ts = formatDuration(Math.max(0, relTime));
      let icon: string;
      let desc: string;
      if (entry.type === "validation") {
        icon = entry.passed ? "✓" : "✗";
        desc = `validation: ${entry.validationName || entry.command?.slice(0, 40) || "unknown"}`;
      } else {
        icon = entry.isError ? "✗" : "→";
        desc = `${entry.toolName || "unknown"}`;
        if (entry.args) {
          const argsStr = JSON.stringify(entry.args).slice(0, 60);
          desc += ` ${argsStr}`;
        }
      }
      const line = `  ${ts} ${icon} ${desc}`;
      lines.push(`│ ${line.padEnd(61).slice(0, 61)} │`);
    }
  }

  lines.push("└──────────────────────────────────────────────────────────────┘");

  return lines.join("\n");
}
