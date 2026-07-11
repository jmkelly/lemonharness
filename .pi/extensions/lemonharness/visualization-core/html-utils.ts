/**
 * HTML rendering utilities for LemonHarness execution visualization.
 * Extracted from VisualizationGenerator private methods.
 */

import type { LogEntry, TimePhase } from "../workspace";
import type { PhaseInfo } from "./types";
import { PHASES } from "./types";

/**
 * Format milliseconds as a duration string (e.g., "1:23").
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `0:${totalSec.toString().padStart(2, "0")}`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Get the phase info for a given progress ratio.
 */
function getPhaseForRatio(ratio: number): PhaseInfo {
  return PHASES.find(p => ratio >= p.startRatio && ratio < p.endRatio) || PHASES[PHASES.length - 1];
}

/**
 * Build the inline SVG timeline.
 */
export function buildSvgTimeline(
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
    minTime = startTime > 0 ? Math.min(startTime, trailMin) : trailMin;
    const predictedEnd = startTime > 0 ? startTime + totalBudgetMs : trailMax + (trailMax - trailMin) * 0.1;
    maxTime = Math.max(trailMax, predictedEnd);
    timeRange = Math.max(maxTime - minTime, 1000);
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
    const label = formatDuration(Math.max(0, elapsed));
    timeLabelsSvg += `
    <text x="${x}" y="${svgHeight - 15}" text-anchor="middle" font-size="10" fill="#888">${label}</text>
    <line x1="${x}" y1="${timelineY + 4}" x2="${x}" y2="${timelineY + 8}" stroke="#bbb" stroke-width="1" />`;
  }

  // Place markers
  let markersSvg = "";
  const placedPositions: number[] = [];
  const sortedTrail = [...trail].sort((a, b) => a.timestamp - b.timestamp);

  for (const entry of sortedTrail) {
    const x = toX(entry.timestamp);
    const overlapping = placedPositions.some(p => Math.abs(p - x) < 12);
    const yOffset = overlapping ? 12 : 0;
    placedPositions.push(x);

    const isValidation = entry.type === "validation";
    const isError = entry.isError;
    const isPass = entry.passed;

    if (isValidation) {
      const color = isPass ? "#27ae60" : "#e74c3c";
      const size = 8;
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

  // Legend
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
export function buildEventList(
  trail: LogEntry[],
  startTime: number,
  phaseMap: Record<string, PhaseInfo>,
): string {
  if (trail.length === 0) {
    return "<p style='color:#888;font-style:italic;padding:12px;'>No events recorded yet. Start working to populate the execution trail.</p>";
  }

  const sessionStart = startTime > 0 ? startTime : Math.min(...trail.map(t => t.timestamp));

  const getPhase = (ts: number): string => {
    const elapsed = ts - sessionStart;
    const totalTime = Math.max(sessionStart, ...trail.map(t => t.timestamp)) - sessionStart || 1;
    const ratio = elapsed / totalTime;
    if (ratio <= 0.3) return "explore";
    if (ratio <= 0.6) return "implement";
    if (ratio <= 0.9) return "validate";
    return "reserve";
  };

  const rows: string[] = [];
  let seq = 0;
  const displayTrail = [...trail].reverse();

  for (const entry of displayTrail) {
    seq++;
    const phase = getPhase(entry.timestamp);
    const phaseInfo = phaseMap[phase] || PHASES[0];
    const elapsed = entry.timestamp - sessionStart;
    const timeLabel = formatDuration(Math.max(0, elapsed));

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

/**
 * Escape HTML entities in a string.
 */
function escapeHtml(str: unknown): string {
  if (typeof str !== "string") return String(str ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
