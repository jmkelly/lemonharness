/**
 * LemonHarness Execution Path Visualization
 *
 * Generates visual execution graphs (HTML and TUI) showing the agent's
 * decision path, phase transitions, and validation results.
 *
 * Research basis:
 * - Execution trail visualization for agent introspection and debugging
 * - Phase-aware timeline rendering with budget utilization tracking
 *
 * Integrates with lemonharness-workspace.ts for trail data and phase state.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  executionLogger,
  timeDirector,
  workspaceManager,
} from "./workspace";
import type { LogEntry, TimePhase, TimePhaseName } from "./workspace";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface BudgetData {
  totalBudgetMs: number;
  elapsedMs: number;
  remainingMs: number;
}

interface PhaseInfo {
  name: TimePhaseName;
  label: string;
  startRatio: number;
  endRatio: number;
  color: string;
  bgColor: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase Configuration
// ─────────────────────────────────────────────────────────────────────────

const PHASES: PhaseInfo[] = [
  { name: "explore",    label: "Explore",    startRatio: 0.0,  endRatio: 0.3,  color: "#1a73e8", bgColor: "#e8f0fe" },
  { name: "implement",  label: "Implement",  startRatio: 0.3,  endRatio: 0.6,  color: "#e67e22", bgColor: "#fef3e8" },
  { name: "validate",   label: "Validate",   startRatio: 0.6,  endRatio: 0.9,  color: "#27ae60", bgColor: "#e8f5e9" },
  { name: "reserve",    label: "Reserve",    startRatio: 0.9,  endRatio: 1.0,  color: "#8e44ad", bgColor: "#f3e8fd" },
];

const PHASE_MAP: Record<string, PhaseInfo> = Object.fromEntries(
  PHASES.map(p => [p.name, p]),
);

// ─────────────────────────────────────────────────────────────────────────
// Embedded CSS Styles (extracted to reduce HTML generation verbosity)
// ─────────────────────────────────────────────────────────────────────────

const HTML_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f5f7fa; color: #1a1a2e; line-height: 1.6; padding: 20px;
  }
  .container { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 20px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: #fff; border-radius: 10px; padding: 14px 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); border-left: 4px solid #ccc; }
  .summary-card .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: #888; }
  .summary-card .value { font-size: 1.3rem; font-weight: 600; margin-top: 2px; }
  .summary-card .sub { font-size: 0.8rem; color: #888; }
  .card-phase { border-left-color: #1a73e8; }
  .card-budget { border-left-color: #e67e22; }
  .card-calls { border-left-color: #27ae60; }
  .card-errors { border-left-color: #e74c3c; }
  .card-validations { border-left-color: #8e44ad; }
  .budget-section { background: #fff; border-radius: 10px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .budget-header { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 8px; }
  .budget-bar { height: 24px; background: #e9ecef; border-radius: 12px; overflow: hidden; position: relative; }
  .budget-fill { height: 100%; border-radius: 12px; background: linear-gradient(90deg, #1a73e8 0%, #e67e22 30%, #27ae60 60%, #8e44ad 90%); transition: width 0.5s ease; }
  .budget-bar .label-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; color: #333; }
  .budget-markers { position: relative; height: 10px; margin-top: 4px; }
  .budget-marker { position: absolute; top: 0; width: 2px; height: 10px; background: #333; transform: translateX(-1px); }
  .budget-marker-label { position: absolute; top: 12px; font-size: 0.65rem; color: #888; transform: translateX(-50%); }
  .timeline-section { background: #fff; border-radius: 10px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .timeline-section h2 { font-size: 1rem; margin-bottom: 12px; }
  .timeline-svg { width: 100%; height: auto; }
  .tl-tooltip { position: absolute; background: #1a1a2e; color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 0.75rem; pointer-events: none; white-space: nowrap; z-index: 10; opacity: 0; transition: opacity 0.15s; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #555; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .legend-diamond { width: 10px; height: 10px; display: inline-block; transform: rotate(45deg); border-radius: 2px; }
  .events-section { background: #fff; border-radius: 10px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .events-section h2 { font-size: 1rem; margin-bottom: 12px; }
  .event-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .event-table th { text-align: left; padding: 6px 10px; border-bottom: 2px solid #eee; color: #888; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
  .event-table td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  .event-table tr:hover { background: #f8f9fa; }
  .event-phase { display: inline-block; font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; color: #fff; font-weight: 600; }
  .badge-success, .badge-pass { display: inline-block; background: #27ae60; color: #fff; font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; }
  .badge-error, .badge-fail { display: inline-block; background: #e74c3c; color: #fff; font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; }
  .event-time { color: #999; font-size: 0.75rem; font-family: 'SF Mono', 'Fira Code', monospace; white-space: nowrap; }
  .footer { text-align: center; color: #aaa; font-size: 0.75rem; padding: 20px; }
  .footer a { color: #1a73e8; text-decoration: none; }
`;

// ─────────────────────────────────────────────────────────────────────────
// VisualizationGenerator Class
// ─────────────────────────────────────────────────────────────────────────

export class VisualizationGenerator {
  /**
   * Generate a self-contained HTML report with inline SVG timeline.
   */
  generateHTML(
    trail: LogEntry[],
    currentPhase: TimePhase,
    budgetData: BudgetData,
    startTime: number,
  ): string {
    const { totalBudgetMs, elapsedMs, remainingMs } = budgetData;
    const progress = totalBudgetMs > 0 ? Math.min(elapsedMs / totalBudgetMs, 1) : 0;
    const progressPercent = Math.round(progress * 100);
    const remainingFormatted = this._formatDuration(remainingMs);
    const elapsedFormatted = this._formatDuration(elapsedMs);
    const totalFormatted = this._formatDuration(totalBudgetMs);

    // Build the SVG timeline
    const svgTimeline = this._buildSvgTimeline(trail, startTime, totalBudgetMs, progress);

    // Build the detailed event list
    const eventList = this._buildEventList(trail, startTime, PHASE_MAP);

    // Compute stats
    const totalCalls = trail.length;
    const errors = trail.filter(t => t.isError).length;
    const validations = trail.filter(t => t.type === "validation").length;
    const passedValidations = trail.filter(t => t.passed).length;
    const toolCalls = trail.filter(t => t.type === "tool_call").length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🍋 LemonHarness Execution Report</title>
<style>
${HTML_STYLES}
</style>
</head>
<body>
<div class="container">
  <h1>🍋 LemonHarness Execution Report</h1>
  <div class="subtitle">Generated at ${new Date().toISOString().replace("T", " ").slice(0, 19)}</div>

  <!-- Summary Cards -->
  <div class="summary">
    <div class="summary-card card-phase">
      <div class="label">Current Phase</div>
      <div class="value">${currentPhase.phase.toUpperCase()}</div>
      <div class="sub">${Math.round(currentPhase.phaseProgress * 100)}% through phase</div>
    </div>
    <div class="summary-card card-budget">
      <div class="label">Budget Used</div>
      <div class="value">${progressPercent}%</div>
      <div class="sub">${elapsedFormatted} / ${totalFormatted}</div>
    </div>
    <div class="summary-card card-calls">
      <div class="label">Tool Calls</div>
      <div class="value">${toolCalls}</div>
      <div class="sub">Across all phases</div>
    </div>
    <div class="summary-card card-errors">
      <div class="label">Errors</div>
      <div class="value" style="color: ${errors > 0 ? '#e74c3c' : '#27ae60'}">${errors}</div>
      <div class="sub">${totalCalls > 0 ? Math.round(errors / totalCalls * 100) : 0}% error rate</div>
    </div>
    <div class="summary-card card-validations">
      <div class="label">Validations</div>
      <div class="value">${validations}</div>
      <div class="sub">${passedValidations} passed, ${validations - passedValidations} failed</div>
    </div>
  </div>

  <!-- Budget Bar -->
  <div class="budget-section">
    <div class="budget-header">
      <span><strong>Budget Utilization</strong></span>
      <span>${elapsedFormatted} elapsed · ${remainingFormatted} remaining</span>
    </div>
    <div class="budget-bar">
      <div class="budget-fill" style="width: ${progressPercent}%"></div>
      <div class="label-overlay">${progressPercent}% used</div>
    </div>
    <div class="budget-markers">
      ${[0.3, 0.6, 0.9].map(r => `
        <div class="budget-marker" style="left: ${r * 100}%"></div>
      `).join("")}
    </div>
  </div>

  <!-- Timeline SVG -->
  <div class="timeline-section">
    <h2>🕐 Execution Timeline</h2>
    ${svgTimeline}
    <div class="legend">
      <div class="legend-item"><span class="legend-dot" style="background:#27ae60"></span> Tool call (success)</div>
      <div class="legend-item"><span class="legend-dot" style="background:#e74c3c"></span> Tool call (error)</div>
      <div class="legend-item"><span class="legend-diamond" style="background:#27ae60"></span> Validation (pass)</div>
      <div class="legend-item"><span class="legend-diamond" style="background:#e74c3c"></span> Validation (fail)</div>
      <div class="legend-item"><span style="display:inline-block;width:14px;height:4px;background:#ddd;border-radius:2px"></span> Phase boundary</div>
    </div>
  </div>

  <!-- Event List -->
  <div class="events-section">
    <h2>📋 Event Trail (${trail.length} entries)</h2>
    ${eventList}
  </div>

  <div class="footer">
    Generated by LemonHarness Visualization · <a href="#" onclick="window.print()">Print / Save PDF</a>
  </div>
</div>
</body>
</html>`;
  }

  /**
   * Generate a text-based ASCII visualization for the terminal.
   */
  generateTUI(
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

    const elapsedFormatted = this._formatDuration(elapsedMs);
    const totalFormatted = this._formatDuration(totalBudgetMs);

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

    // ── Phase band header ─────────────────────────────────────────
    // Build the phase labels row
    const phaseLabels = PHASES.map(p => {
      const percent = Math.round(p.startRatio * 100);
      return `${p.label} (${percent}%)`;
    });

    // ── Timeline ──────────────────────────────────────────────────
    const timelineWidth = 60;
    const lines: string[] = [];

    lines.push("┌─ LemonHarness Execution Trail ──────────────────────────────┐");
    lines.push(`│ Budget:  ${bar}  ${progressPercent}% used                  │`);
    lines.push(`│ Time:    ${elapsedFormatted} elapsed / ${totalFormatted} total           │`);
    lines.push("│                                                              │");

    // Phase timeline header
    lines.push("│ Phases:");
    // Show colored phase indicators
    const phaseRow = PHASES.map(p => {
      const len = Math.round((p.endRatio - p.startRatio) * timelineWidth);
      const label = p.label;
      const padded = label.padEnd(len > label.length ? len : label.length, "─");
      return padded;
    }).join("│");
    lines.push(`│ ${phaseRow} │`);

    // Phase boundaries row
    const boundChars: string[] = [];
    let currentPos = 0;
    for (const p of PHASES) {
      const width = Math.round((p.endRatio - p.startRatio) * timelineWidth);
      currentPos += width;
    }
    // Draw time axis with markers
    const axisChars: string[] = [];
    for (let i = 0; i < timelineWidth; i++) {
      const ratio = i / timelineWidth;
      const phase = PHASES.find(p => ratio >= p.startRatio && ratio < p.endRatio) || PHASES[PHASES.length - 1];
      axisChars.push("·");
    }
    // Add phase boundary markers
    for (const p of PHASES) {
      const idx = Math.round(p.startRatio * timelineWidth);
      if (idx > 0 && idx < timelineWidth) {
        axisChars[idx] = "│";
      }
    }
    // Add phase labels below the axis
    lines.push(`│ ${axisChars.join("")} │`);

    // ── Events on timeline ────────────────────────────────────────
    if (trail.length > 0) {
      const maxTime = Math.max(...trail.map(t => t.timestamp));
      const minTime = startTime > 0 ? Math.min(startTime, ...trail.map(t => t.timestamp)) : Math.min(...trail.map(t => t.timestamp));
      const timeRange = maxTime - minTime || 1;

      // Place markers on the timeline
      const markerRows: string[][] = [[], [], []];
      const markerRowIndex = (entry: LogEntry): number => {
        if (entry.type === "validation") return 0;
        return 1 + (entry.isError ? 1 : 0); // row 1 for success tool calls, row 2 for errors
      };

      // We'll place markers in a single row, stacking if there are overlaps
      const usedPositions = new Set<number>();

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

        // Find a row to place it
        const row = markerRowIndex(entry);
        const actualRow = row < 3 ? row : 0;

        const rowData = markerRows[actualRow];
        // Pad to position
        while (rowData.length < pos) rowData.push(" ");
        if (rowData.length === pos) {
          rowData.push(marker);
        } else {
          // Overlap - try next row
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
    const timeMarkers = ["0:00", this._formatDuration(totalBudgetMs * 0.25),
      this._formatDuration(totalBudgetMs * 0.5), this._formatDuration(totalBudgetMs * 0.75),
      this._formatDuration(totalBudgetMs)];
    const timeRow = timeMarkers.map((t, i) => {
      const pos = Math.round((i / (timeMarkers.length - 1)) * timelineWidth);
      const prevLen = i > 0 ? timeMarkers.slice(0, i).reduce((acc, x) => acc + x.length + 1, 0) : 0;
      return " ".repeat(Math.max(0, pos - prevLen)) + t;
    });
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
        const ts = this._formatDuration(Math.max(0, relTime));
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

  // ─────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────

  private _formatDuration(ms: number): string {
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `0:${totalSec.toString().padStart(2, "0")}`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }

  private _getPhaseForRatio(ratio: number): PhaseInfo {
    return PHASES.find(p => ratio >= p.startRatio && ratio < p.endRatio) || PHASES[PHASES.length - 1];
  }

  /**
   * Build the inline SVG timeline.
   */
  private _buildSvgTimeline(
    trail: LogEntry[],
    startTime: number,
    totalBudgetMs: number,
    progress: number,
  ): string {
    const svgWidth = 920;
    const svgHeight = 240;
    const margin = { top: 20, right: 20, bottom: 40, left: 10 };
    const chartWidth = svgWidth - margin.left - margin.right;
    const chartTop = margin.top;
    const bandHeight = 80;
    const timelineY = chartTop + bandHeight / 2;

    // Compute time range
    let minTime: number;
    let maxTime: number;
    let timeRange: number;

    if (trail.length === 0) {
      minTime = startTime || Date.now() - totalBudgetMs;
      maxTime = (startTime || Date.now()) + totalBudgetMs;
      timeRange = maxTime - minTime;
    } else {
      const trailMin = Math.min(...trail.map(t => t.timestamp));
      const trailMax = Math.max(...trail.map(t => t.timestamp));
      // Expand range to include predicted start/end
      minTime = startTime > 0 ? Math.min(startTime, trailMin) : trailMin;
      const predictedEnd = startTime > 0 ? startTime + totalBudgetMs : trailMax + (trailMax - trailMin) * 0.1;
      maxTime = Math.max(trailMax, predictedEnd);
      timeRange = Math.max(maxTime - minTime, 1000); // at least 1s
    }

    const toX = (t: number): number => {
      const ratio = (t - minTime) / timeRange;
      return margin.left + Math.max(0, Math.min(1, ratio)) * chartWidth;
    };

    // Phase bands
    let bandsSvg = "";
    for (const phase of PHASES) {
      const x1 = margin.left + phase.startRatio * chartWidth;
      const x2 = margin.left + phase.endRatio * chartWidth;
      const w = x2 - x1;
      bandsSvg += `
    <rect x="${x1}" y="${chartTop}" width="${w}" height="${bandHeight}" fill="${phase.bgColor}" rx="4" />
    <text x="${x1 + w / 2}" y="${chartTop + bandHeight - 6}" text-anchor="middle" font-size="11" fill="${phase.color}" font-weight="600">${phase.label}</text>`;
    }

    // Phase boundary lines
    let boundarySvg = "";
    for (const phase of PHASES) {
      if (phase.startRatio === 0) continue;
      const x = margin.left + phase.startRatio * chartWidth;
      boundarySvg += `
    <line x1="${x}" y1="${chartTop}" x2="${x}" y2="${chartTop + bandHeight}" stroke="#ccc" stroke-width="1.5" stroke-dasharray="4,3" />`;
    }

    // Current time indicator
    const currentX = margin.left + progress * chartWidth;
    const currentIndicator = progress > 0 && progress < 1 ? `
    <line x1="${currentX}" y1="${chartTop - 6}" x2="${currentX}" y2="${chartTop + bandHeight + 6}" stroke="#e74c3c" stroke-width="2" />
    <polygon points="${currentX - 4},${chartTop - 6} ${currentX + 4},${chartTop - 6} ${currentX},${chartTop - 10}" fill="#e74c3c" />
    <text x="${currentX}" y="${chartTop - 14}" text-anchor="middle" font-size="10" fill="#e74c3c" font-weight="600">NOW</text>` : "";

    // Timeline line
    const timelineLine = `
    <line x1="${margin.left}" y1="${timelineY}" x2="${margin.left + chartWidth}" y2="${timelineY}" stroke="#999" stroke-width="1.5" />`;

    // Time labels (5 ticks)
    let timeLabelsSvg = "";
    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const x = margin.left + ratio * chartWidth;
      const t = minTime + ratio * timeRange;
      const elapsed = t - minTime;
      const label = this._formatDuration(Math.max(0, elapsed));
      timeLabelsSvg += `
    <text x="${x}" y="${svgHeight - 15}" text-anchor="middle" font-size="10" fill="#888">${label}</text>
    <line x1="${x}" y1="${timelineY + 4}" x2="${x}" y2="${timelineY + 8}" stroke="#bbb" stroke-width="1" />`;
    }

    // ── Place markers ──────────────────────────────────────────────
    let markersSvg = "";

    // Track positions to avoid overlap
    const placedPositions: number[] = [];

    // Sort by timestamp
    const sortedTrail = [...trail].sort((a, b) => a.timestamp - b.timestamp);

    for (const entry of sortedTrail) {
      const x = toX(entry.timestamp);
      // Some tolerance for overlap
      const overlapping = placedPositions.some(p => Math.abs(p - x) < 12);
      const yOffset = overlapping ? 12 : 0;
      placedPositions.push(x);

      const isValidation = entry.type === "validation";
      const isError = entry.isError;
      const isPass = entry.passed;

      if (isValidation) {
        const color = isPass ? "#27ae60" : "#e74c3c";
        const size = 8;
        // Diamond shape
        markersSvg += `
    <g class="marker" data-tooltip="${escapeHtml(entry.validationName || entry.command || "validation")}">
      <rect x="${x - size / 2}" y="${timelineY - size / 2 + yOffset}" width="${size}" height="${size}" rx="2" fill="${color}" stroke="#fff" stroke-width="1.5" transform="rotate(45,${x},${timelineY + yOffset})">
        <title>${escapeHtml(entry.validationName || "")}: ${isPass ? "PASS" : "FAIL"}${entry.command ? " - " + escapeHtml(entry.command.slice(0, 60)) : ""}</title>
      </rect>
      <text x="${x}" y="${timelineY + size + 10 + yOffset}" text-anchor="middle" font-size="8" fill="${color}" font-weight="600">${isPass ? "✓" : "✗"}</text>
    </g>`;
      } else {
        const color = isError ? "#e74c3c" : "#27ae60";
        const r = 5;
        markersSvg += `
    <g class="marker">
      <circle cx="${x}" cy="${timelineY + yOffset}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1.5">
        <title>${escapeHtml(entry.toolName || "")}: ${isError ? "ERROR" : "OK"}${entry.args ? " " + escapeHtml(JSON.stringify(entry.args).slice(0, 80)) : ""}</title>
      </circle>
    </g>`;
      }
    }

    // ── Build legend items on SVG (compact) ──
    const legendX = margin.left;
    const legendY = chartTop + bandHeight + 22;
    const legendSvg = `
    <text x="${legendX}" y="${legendY}" font-size="10" fill="#666">● tool call</text>
    <circle cx="${legendX + 52}" cy="${legendY - 4}" r="4" fill="#27ae60" />
    <circle cx="${legendX + 68}" cy="${legendY - 4}" r="4" fill="#e74c3c" />
    <text x="${legendX + 85}" y="${legendY}" font-size="10" fill="#666">◆ validation</text>
    <rect x="${legendX + 145}" y="${legendY - 7}" width="6" height="6" rx="1" fill="#27ae60" transform="rotate(45,${legendX + 148},${legendY - 4})" />
    <rect x="${legendX + 158}" y="${legendY - 7}" width="6" height="6" rx="1" fill="#e74c3c" transform="rotate(45,${legendX + 161},${legendY - 4})" />
    <line x1="${legendX + 185}" y1="${legendY - 4}" x2="${legendX + 198}" y2="${legendY - 4}" stroke="#ccc" stroke-width="1.5" stroke-dasharray="3,2" />
    <text x="${legendX + 205}" y="${legendY}" font-size="10" fill="#666">phase boundary · now</text>
    <polygon points="${legendX + 265},${legendY - 6} ${legendX + 271},${legendY - 6} ${legendX + 268},${legendY - 10}" fill="#e74c3c" />
    `;

    return `<svg class="timeline-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.15" />
      </filter>
    </defs>
    ${bandsSvg}
    ${boundarySvg}
    ${currentIndicator}
    ${timelineLine}
    ${timeLabelsSvg}
    ${markersSvg}
    ${legendSvg}
    </svg>`;
  }

  /**
   * Build the detailed event list HTML.
   */
  private _buildEventList(
    trail: LogEntry[],
    startTime: number,
    phaseMap: Record<string, PhaseInfo>,
  ): string {
    if (trail.length === 0) {
      return "<p style='color:#888;font-style:italic;padding:12px;'>No events recorded yet. Start working to populate the execution trail.</p>";
    }

    // Determine session start
    const sessionStart = startTime > 0 ? startTime : Math.min(...trail.map(t => t.timestamp));

    // Determine phase for a given timestamp
    const getPhase = (ts: number): TimePhaseName => {
      const elapsed = ts - sessionStart;
      // We need totalBudgetMs - use the max timestamp as a rough measure or use the actual budget
      // For phase mapping, we'll use the progress ratio approach
      // Since we don't know the exact budget per entry, we'll compute
      // based on time elapsed relative to total time span or budget
      // Use a heuristic: map entries to phases based on their position in the trail
      const totalTime = Math.max(sessionStart, ...trail.map(t => t.timestamp)) - sessionStart || 1;
      const ratio = elapsed / totalTime;
      if (ratio <= 0.3) return "explore";
      if (ratio <= 0.6) return "implement";
      if (ratio <= 0.9) return "validate";
      return "reserve";
    };

    const rows: string[] = [];
    let seq = 0;

    // Show all entries, most recent first
    const displayTrail = [...trail].reverse();

    for (const entry of displayTrail) {
      seq++;
      const phase = getPhase(entry.timestamp);
      const phaseInfo = phaseMap[phase] || PHASES[0];
      const elapsed = entry.timestamp - sessionStart;
      const timeLabel = this._formatDuration(Math.max(0, elapsed));

      let badge: string;
      let description: string;

      if (entry.type === "validation") {
        const status = entry.passed ? "PASS" : "FAIL";
        const badgeClass = entry.passed ? "badge-pass" : "badge-fail";
        badge = `<span class="${badgeClass}">${status}</span>`;
        description = `<strong>${escapeHtml(entry.validationName || "validation")}</strong>`;
        if (entry.command) {
          description += `<br><span style="color:#888;font-size:0.75rem;font-family:monospace">${escapeHtml(entry.command.slice(0, 100))}</span>`;
        }
      } else {
        badge = entry.isError
          ? `<span class="badge-error">ERROR</span>`
          : `<span class="badge-success">OK</span>`;
        description = `<strong>${escapeHtml(entry.toolName || "tool_call")}</strong>`;
        if (entry.args) {
          const argsStr = JSON.stringify(entry.args).slice(0, 100);
          description += `<br><span style="color:#888;font-size:0.75rem;font-family:monospace">${escapeHtml(argsStr)}</span>`;
        }
      }

      const phaseColor = phaseInfo.color;
      rows.push(`<tr>
        <td><span class="event-time">${timeLabel}</span></td>
        <td><span class="event-phase" style="background:${phaseColor}">${phase.toUpperCase().slice(0, 4)}</span></td>
        <td>${badge}</td>
        <td>${description}</td>
      </tr>`);
    }

    return `<table class="event-table">
      <thead><tr>
        <th style="width:60px">Time</th>
        <th style="width:50px">Phase</th>
        <th style="width:60px">Status</th>
        <th>Event</th>
      </tr></thead>
      <tbody>${rows.join("\n")}</tbody>
    </table>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helper: escape HTML entities
// ─────────────────────────────────────────────────────────────────────────

function escapeHtml(str: unknown): string {
  if (typeof str !== "string") return String(str ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─────────────────────────────────────────────────────────────────────────
// Extension Export
// ─────────────────────────────────────────────────────────────────────────

export function setupVisualization(pi: ExtensionAPI) {
  const vizGen = new VisualizationGenerator();

  // ── /lemonharness:visualize Command ──────────────────────────────

  pi.registerCommand("lemonharness:visualize", {
    description: "Generate an execution visualization: HTML report at .lemonharness/execution-report.html, plus TUI display",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const currentPhase = timeDirector.getCurrentPhase();
      const totalBudgetMs = timeDirector.getBudget();
      const elapsedMs = timeDirector.getElapsed();
      const remainingMs = Math.max(totalBudgetMs - elapsedMs, 0);
      const startTime = Date.now() - elapsedMs;

      const budgetData: BudgetData = { totalBudgetMs, elapsedMs, remainingMs };

      // 1. Generate and display TUI
      const tuiOutput = vizGen.generateTUI(trail, currentPhase, budgetData, startTime);
      ctx.ui.notify(tuiOutput, "info");

      // 2. Generate and save HTML report
      try {
        const workspaceDir = workspaceManager.getWorkspaceDir();
        await mkdir(workspaceDir, { recursive: true });
        const html = vizGen.generateHTML(trail, currentPhase, budgetData, startTime);
        const reportPath = join(workspaceDir, "execution-report.html");
        await writeFile(reportPath, html, "utf-8");
        ctx.ui.notify(`🍋 HTML report saved to: ${reportPath}`, "info");
      } catch (err: any) {
        ctx.ui.notify(`❌ Failed to write HTML report: ${err.message}`, "error");
      }
    },
  });
}
