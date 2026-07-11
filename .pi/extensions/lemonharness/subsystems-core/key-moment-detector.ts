// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * KeyMomentDetector — ASH Key-Moment Detection
 *
 * Research basis: arXiv:2605.14211 — ASH self-honing agents
 */

import type { KeyMoment, LogEntry } from "./types";

export class KeyMomentDetector {
  detectStuckBreakthrough(entries: LogEntry[]): KeyMoment | null {
    if (entries.length < 4) return null;
    for (let i = 3; i < entries.length; i++) {
      if (entries.slice(i - 3, i).every(e => e.isError === true) && !entries[i].isError) {
        return {
          timestamp: entries[i].timestamp, type: "stuck_breakthrough",
          beforeState: "3+ consecutive errors",
          afterState: `Success on ${entries[i].toolName}`,
          pattern: `When stuck after 3+ errors, try: ${entries[i].toolName}`,
          significance: 0.8,
        };
      }
    }
    return null;
  }

  detectErrorRecovery(entries: LogEntry[]): KeyMoment | null {
    if (entries.length < 3) return null;
    for (let i = 2; i < entries.length; i++) {
      if (entries[i-2].isError && !entries[i-1].isError && !entries[i].isError && entries[i-1].toolName !== entries[i-2].toolName) {
        return {
          timestamp: entries[i].timestamp, type: "error_recovery",
          beforeState: `Error on ${entries[i-2].toolName}, pivoted to ${entries[i-1].toolName}`,
          afterState: `Success on ${entries[i].toolName}`,
          pattern: `After ${entries[i-2].toolName} fails, try ${entries[i-1].toolName}`,
          significance: 0.7,
        };
      }
    }
    return null;
  }

  detectEfficiencyGain(entries: LogEntry[]): KeyMoment | null {
    if (entries.length < 6) return null;
    const seq = entries.filter(e => e.type === "tool_call").map(e => e.toolName || "unknown").slice(-6);
    for (let i = 0; i < seq.length - 2; i++) {
      if (seq[i] === seq[i+1] && seq[i] === seq[i+2] && seq[i+3] !== seq[i]) {
        return {
          timestamp: entries[entries.length-1].timestamp, type: "efficiency_gain",
          beforeState: `Repeated ${seq[i]} 3x`,
          afterState: "Found alternative",
          pattern: `Instead of repeating ${seq[i]}, try alternatives after 2 failures`,
          significance: 0.6,
        };
      }
    }
    return null;
  }

  detectValidationMilestone(entries: LogEntry[]): KeyMoment | null {
    let foundFail = false;
    for (const e of entries) {
      if (e.type === "validation" && e.passed === false) foundFail = true;
      if (e.type === "validation" && e.passed === true && foundFail) {
        return {
          timestamp: e.timestamp, type: "validation_milestone",
          beforeState: "Preceded by validation failures",
          afterState: `Passed: ${(e.validationName || e.command || "").slice(0, 60)}`,
          pattern: "Changes that pass validation after failures are reliable",
          significance: 0.75,
        };
      }
    }
    return null;
  }

  findAllKeyMoments(entries: LogEntry[]): KeyMoment[] {
    const moments: KeyMoment[] = [];
    const detectors = [
      this.detectStuckBreakthrough(entries),
      this.detectErrorRecovery(entries),
      this.detectEfficiencyGain(entries),
      this.detectValidationMilestone(entries),
    ];
    for (const m of detectors) { if (m) moments.push(m); }
    const unique = new Map<string, KeyMoment>();
    for (const m of moments) {
      const k = m.pattern.slice(0, 40);
      if (!unique.has(k) || m.significance > unique.get(k)!.significance) unique.set(k, m);
    }
    return [...unique.values()].sort((a, b) => b.significance - a.significance);
  }

  formatKeyMoments(moments: KeyMoment[]): string {
    if (moments.length === 0) return "No key moments detected this session.";
    const labels: Record<string, string> = {
      stuck_breakthrough: "Stuck Breakthrough", error_recovery: "Error Recovery",
      efficiency_gain: "Efficiency Gain", validation_milestone: "Validation Milestone",
    };
    return [
      "💡 Key Moments Detected:",
      ...moments.map(m =>
        `  • [${labels[m.type] || m.type}] (sig: ${(m.significance*100).toFixed(0)}%) Before: ${m.beforeState} | After: ${m.afterState} | Pattern: ${m.pattern}`
      ),
    ].join("\n");
  }
}
