/**
 * Review Loop — Orchestration Module
 *
 * Implementer ↔ Reviewer loop with severity-scored termination.
 * Both agents get fresh context each cycle. The reviewer is advisory-only.
 * Terminates when max severity ≤ 3 for 2 consecutive cycles or trend is flat.
 *
 * Research basis:
 *   - ERL (arXiv:2603.24639): heuristic extraction from repeated patterns
 *   - ASH (arXiv:2605.14211): key moment detection for breakthrough cycles
 *   - LemonHarness (arXiv:2606.24311): execution boundary framework
 */

import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

// ── Types ────────────────────────────────────────────────────────────────

export interface ReviewFinding {
  id: number;
  severity: number;
  category: string;
  description: string;
  fix_suggestion: string;
  location?: string;
}

export interface ReviewOutput {
  cycle: number;
  timestamp: string;
  findings: ReviewFinding[];
  overall_assessment: string;
  recommended_next_action: "continue" | "stop";
  summary_stats?: {
    total_findings: number;
    by_severity: Record<string, number>;
    max_severity: number;
    avg_severity: number;
  };
}

export interface ReviewTrailEntry {
  cycle: number;
  review: ReviewOutput;
  maxSeverity: number;
  topThreeAvg: number;
  rawOutput: string;
  parsedOk: boolean;
}

export type TerminationReason =
  | "max_severity_low_two_consecutive"
  | "flat_trend"
  | "max_cycles_reached"
  | "manual_stop"
  | "implementer_failed"
  | "reviewer_failed";

export interface LoopResult {
  trail: ReviewTrailEntry[];
  terminationReason: TerminationReason;
  cyclesCompleted: number;
  severityTrend: number[];
  topThreeTrend: number[];
  finalHandoffPath: string;
  heuristicsExtracted: number;
}

// ── Severity Parsing ─────────────────────────────────────────────────────

export function parseReviewJson(raw: string): ReviewOutput | null {
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]) as ReviewOutput; } catch { /* fall through */ }
  }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as ReviewOutput; } catch { /* fall through */ }
  }
  return extractSeverityFromText(raw);
}

function extractSeverityFromText(raw: string): ReviewOutput | null {
  const findings: ReviewFinding[] = [];
  let id = 0;
  const lines = raw.split("\n");
  for (const line of lines) {
    let sevMatch = line.match(/severity[:\s]*(\d+)/i);
    if (!sevMatch) sevMatch = line.match(/\b(\d{1,2})\/10\b/);
    if (!sevMatch) continue;
    const severity = parseInt(sevMatch[1], 10);
    if (severity < 1 || severity > 10) continue;
    let category = "maintainability";
    if (/secur|inject|XSS|CSRF|auth|password/i.test(line)) category = "security";
    else if (/correct|wrong|incorrect|bug|error/i.test(line)) category = "correctness";
    else if (/spec|requirement|violat/i.test(line)) category = "spec-violation";
    else if (/perform|slow|O\(/i.test(line)) category = "performance";
    else if (/test|coverage/i.test(line)) category = "testing";
    id++;
    findings.push({ id, severity, category, description: line.trim().slice(0, 200), fix_suggestion: "See full review text for suggestion" });
  }
  if (findings.length === 0) return null;
  const maxSev = Math.max(...findings.map(f => f.severity));
  return {
    cycle: 0, timestamp: new Date().toISOString(), findings,
    overall_assessment: `Extracted ${findings.length} findings from unstructured review text.`,
    recommended_next_action: maxSev <= 3 ? "stop" : "continue",
  };
}

export function computeSeverityStats(review: ReviewOutput): { maxSeverity: number; topThreeAvg: number } {
  const severities = review.findings.map(f => f.severity).sort((a, b) => b - a);
  const maxSeverity = severities.length > 0 ? severities[0] : 0;
  const topThree = severities.slice(0, 3);
  const topThreeAvg = topThree.length > 0 ? topThree.reduce((s, n) => s + n, 0) / topThree.length : 0;
  return { maxSeverity, topThreeAvg };
}

// ── Termination Logic ────────────────────────────────────────────────────

export function determineTermination(
  trail: ReviewTrailEntry[],
  maxCycles: number,
): { shouldStop: boolean; reason: TerminationReason } {
  if (trail.length === 0) return { shouldStop: false, reason: "max_cycles_reached" };
  const last = trail[trail.length - 1];
  if (last.review.recommended_next_action === "stop") return { shouldStop: true, reason: "manual_stop" };
  if (trail.length >= maxCycles) return { shouldStop: true, reason: "max_cycles_reached" };
  if (trail.length >= 2) {
    const prev = trail[trail.length - 2];
    if (last.maxSeverity <= 3 && prev.maxSeverity <= 3) return { shouldStop: true, reason: "max_severity_low_two_consecutive" };
  }
  if (trail.length >= 3) {
    const avgs = trail.slice(-3).map(r => r.topThreeAvg);
    if (Math.abs(linearRegressionSlope(avgs)) < 0.5) return { shouldStop: true, reason: "flat_trend" };
  }
  return { shouldStop: false, reason: "max_cycles_reached" };
}

function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += values[i]; sxy += i * values[i]; sx2 += i * i; }
  const denom = n * sx2 - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

export function detectOscillation(trail: ReviewTrailEntry[]): boolean {
  if (trail.length < 4) return false;
  const sevs = trail.map(t => t.maxSeverity);
  let alternations = 0;
  for (let i = 2; i < sevs.length; i++) {
    if ((sevs[i - 2] > sevs[i - 1] + 2 && sevs[i] > sevs[i - 1] + 2) ||
        (sevs[i - 1] > sevs[i - 2] + 2 && sevs[i - 1] > sevs[i] + 2)) alternations++;
  }
  return alternations >= 2;
}

// ── Review Notes Builder ────────────────────────────────────────────────

export function buildReviewNotes(cycle: number, review: ReviewOutput, prevNotes: string): string {
  const actionable = review.findings.filter(f => f.severity >= 4);
  const lowSev = review.findings.filter(f => f.severity <= 3);
  const lines: string[] = [
    `# Review Cycle ${cycle} — Notes for Implementer`, "",
    `> **Overall Assessment:** ${review.overall_assessment}`, "",
    `**${actionable.length} actionable findings** (severity ≥ 4):`, "",
  ];
  if (actionable.length === 0) {
    lines.push("✅ No actionable findings. All remaining issues are severity ≤ 3 (diminishing returns).");
  } else {
    for (const f of actionable) {
      lines.push(`### ${f.id}. [${f.severity}/10] [${f.category}] ${f.description.slice(0, 100)}`, "");
      lines.push(`**Fix suggestion:** ${f.fix_suggestion}`);
      if (f.location) lines.push(`**Location:** \`${f.location}\``);
      lines.push("");
    }
  }
  if (lowSev.length > 0) {
    lines.push("---", "", `**${lowSev.length} low-severity notes** (severity ≤ 3, optional):`, "");
    for (const f of lowSev) lines.push(`- [${f.severity}/10] ${f.description.slice(0, 100)}`);
  }
  if (prevNotes) lines.push("", "---", "", "## Prior Review Notes", "", prevNotes.slice(0, 3000));
  return lines.join("\n");
}

// ── Final Handoff Builder ────────────────────────────────────────────────

export function buildFinalHandoff(result: LoopResult, specPath: string, maxCycles: number): string {
  const lines: string[] = [
    "# Review Loop — Final Handoff", "",
    `**Date:** ${new Date().toISOString()}`,
    `**Spec:** \`${specPath}\``,
    `**Cycles completed:** ${result.cyclesCompleted} / ${maxCycles} max`,
    `**Termination reason:** ${formatTermReason(result.terminationReason)}`, "",
    "---", "", "## Severity Trend", "",
    "| Cycle | Max Severity | Top-3 Avg | Findings | Status |",
    "|-------|-------------|-----------|----------|--------|",
  ];
  for (const entry of result.trail) {
    const status = entry.maxSeverity <= 3 ? "✅" : entry.maxSeverity <= 6 ? "⚠️" : "🔴";
    lines.push(`| ${entry.cycle} | ${entry.maxSeverity} | ${entry.topThreeAvg.toFixed(1)} | ${entry.review.findings.length} | ${status} |`);
  }
  lines.push("", "---", "", "## Cycle Summaries", "");
  for (const entry of result.trail) {
    lines.push(`### Cycle ${entry.cycle}`, "", entry.review.overall_assessment, "");
    const bySev = entry.review.summary_stats?.by_severity;
    if (bySev) {
      const parts: string[] = [];
      if (bySev.critical) parts.push(`${bySev.critical} critical`);
      if (bySev.high) parts.push(`${bySev.high} high`);
      if (bySev.medium) parts.push(`${bySev.medium} medium`);
      if (bySev.low) parts.push(`${bySev.low} low`);
      lines.push(`**Distribution:** ${parts.join(", ")}`);
    }
    lines.push("");
  }
  lines.push("---", "", "## Termination Analysis", "");
  switch (result.terminationReason) {
    case "max_severity_low_two_consecutive":
      lines.push("✅ **Diminishing returns reached.** Two consecutive cycles had no findings above severity 3.");
      break;
    case "flat_trend":
      lines.push("⚠️ **Severity trend is flat.** Review is not finding fewer/less-severe issues over time.");
      break;
    case "max_cycles_reached":
      lines.push("⏰ **Maximum cycles reached.** Safety valve triggered before diminishing returns confirmed.");
      break;
    case "manual_stop":
      lines.push("🛑 **Reviewer recommended stop.** Remaining issues not worth another cycle.");
      break;
    default:
      lines.push(`⏹ **Loop terminated:** ${result.terminationReason}`);
  }
  lines.push("", "---", "", "## Heuristics Extracted", "",
    `${result.heuristicsExtracted} ERL heuristics extracted. Run \`/lemonharness:heuristics\` to view.`, "",
    "---", "", "## Next Steps", "",
    "1. Review final implementation against spec", "2. Address any remaining severity-4+ findings",
    "3. Run validation: \`/lemonharness:validate\`", "4. Snapshot: \`/lemonharness:snapshot \"Review loop final\"\`", "");
  return lines.join("\n");
}

function formatTermReason(reason: TerminationReason): string {
  const m: Record<TerminationReason, string> = {
    max_severity_low_two_consecutive: "Diminishing returns — max severity ≤ 3 for 2 consecutive cycles",
    flat_trend: "Flat trend — severity not improving over 3 cycles",
    max_cycles_reached: "Maximum cycles reached (safety valve)",
    manual_stop: "Reviewer recommended stop",
    implementer_failed: "Implementer delegate failed",
    reviewer_failed: "Reviewer delegate failed",
  };
  return m[reason] || reason;
}

// ── Delegate Task Builders ───────────────────────────────────────────────

export function buildImplementerTask(
  specPath: string, specContent: string, cycle: number,
  reviewNotes: string, isFirstCycle: boolean,
): string {
  const outputDir = `.lemonharness/review-loop/cycle-${cycle}`;
  return [
    `You are an IMPLEMENTER in a review loop (Cycle ${cycle}).`,
    ``, `## YOUR TASK`, `Implement changes according to the specification.`,
    isFirstCycle ? `This is the first cycle — implement the spec from scratch.`
      : `This is cycle ${cycle}. Read the review notes and fix EVERY issue with severity ≥ 4.`,
    ``, `## SPECIFICATION`, `The spec is in \`${specPath}\`. Content:`, ``,
    '```', specContent.slice(0, 8000), '```', ``,
    reviewNotes ? `## REVIEW NOTES (from previous cycle)\n\n${reviewNotes.slice(0, 6000)}`
      : `## REVIEW NOTES\n\nNo prior review — this is the first implementation cycle.`,
    ``, `## CONSTRAINTS`,
    `- Do NOT modify the specification. Only implement against it.`,
    `- Fix ALL findings with severity ≥ 4.`,
    `- Findings with severity ≤ 3 are optional.`,
    `- Write tests for new or changed code.`,
    `- Run workspace_validate to verify changes.`,
    `- Report a clear summary when done.`,
    ``, `## OUTPUT DIRECTORY`, `Save artifacts to \`${outputDir}/\`.`,
  ].join("\n");
}

export function buildReviewerTask(
  specPath: string, specContent: string, cycle: number,
): string {
  const outputDir = `.lemonharness/review-loop/cycle-${cycle}`;
  return [
    `You are a REVIEWER in a review loop (Cycle ${cycle}).`,
    `You have ADVISORY AUTHORITY ONLY — do NOT modify files or run state-changing commands.`,
    ``, `## YOUR TASK`, `Review the current implementation against the specification.`,
    ``, `## SPECIFICATION`, `\`${specPath}\`:`, ``,
    '```', specContent.slice(0, 8000), '```', ``,
    `## REVIEW INSTRUCTIONS`,
    `1. Read the specification carefully.`,
    `2. Read the current implementation files (read only — NO modifications).`,
    `3. For each issue, assign severity 1–10:`,
    `   9–10: Critical | 7–8: High | 4–6: Medium | 1–3: Low`,
    `4. EVERY finding must include a concrete, actionable fix suggestion.`,
    `5. Output in this EXACT JSON format:`, ``,
    '```json', '{',
    `  "cycle": ${cycle},`,
    `  "timestamp": "${new Date().toISOString()}",`,
    '  "findings": [',
    '    { "id": 1, "severity": 7, "category": "security",',
    '      "description": "What the issue is",',
    '      "fix_suggestion": "How to fix it",',
    '      "location": "src/file.ts:42" }',
    '  ],',
    '  "overall_assessment": "Brief summary of quality",',
    '  "recommended_next_action": "continue",',
    '  "summary_stats": { "total_findings": 0,',
    '    "by_severity": {"critical":0,"high":0,"medium":0,"low":0},',
    '    "max_severity": 0, "avg_severity": 0 }',
    '}', '```', ``,
    `## CATEGORIES: correctness, security, spec-violation, maintainability, performance, testing`,
    ``, `## OUTPUT`, `Write review JSON to \`${outputDir}/review.json\`.`,
  ].join("\n");
}

// ── ReviewLoopManager ────────────────────────────────────────────────────

export class ReviewLoopManager {
  private projectRoot: string;
  private outputBaseDir: string;
  private trail: ReviewTrailEntry[] = [];
  private heuristicsCount = 0;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.outputBaseDir = join(projectRoot, ".lemonharness", "review-loop");
  }

  async init(): Promise<void> {
    await mkdir(this.outputBaseDir, { recursive: true });
  }

  getTrail(): ReviewTrailEntry[] { return this.trail; }
  addHeuristic(): void { this.heuristicsCount++; }

  buildResult(reason: TerminationReason, maxCycles: number, specPath: string): LoopResult {
    const result: LoopResult = {
      trail: this.trail, terminationReason: reason,
      cyclesCompleted: this.trail.length,
      severityTrend: this.trail.map(t => t.maxSeverity),
      topThreeTrend: this.trail.map(t => t.topThreeAvg),
      finalHandoffPath: join(this.outputBaseDir, "REVIEW-LOOP-FINAL.md"),
      heuristicsExtracted: this.heuristicsCount,
    };
    const handoff = buildFinalHandoff(result, specPath, maxCycles);
    writeFile(result.finalHandoffPath, handoff, "utf-8").catch(() => {});
    writeFile(join(this.outputBaseDir, "trend.json"),
      JSON.stringify({ severityTrend: result.severityTrend, topThreeTrend: result.topThreeTrend,
        terminationReason: reason, cyclesCompleted: result.cyclesCompleted }, null, 2), "utf-8").catch(() => {});
    return result;
  }

  processReview(cycle: number, rawOutput: string): { entry: ReviewTrailEntry; parsedOk: boolean } {
    const review = parseReviewJson(rawOutput);
    const parsedOk = review !== null;
    const defaultReview: ReviewOutput = {
      cycle, timestamp: new Date().toISOString(), findings: [],
      overall_assessment: "Could not parse review output — treating as no findings.",
      recommended_next_action: "continue",
      summary_stats: { total_findings: 0, by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, max_severity: 0, avg_severity: 0 },
    };
    const effectiveReview = review || defaultReview;
    if (review) review.cycle = cycle;
    const stats = computeSeverityStats(effectiveReview);
    const entry: ReviewTrailEntry = { cycle, review: effectiveReview, maxSeverity: stats.maxSeverity, topThreeAvg: stats.topThreeAvg, rawOutput, parsedOk };
    this.trail.push(entry);
    const cycleDir = join(this.outputBaseDir, `cycle-${cycle}`);
    mkdir(cycleDir, { recursive: true }).catch(() => {});
    writeFile(join(cycleDir, "review.json"), JSON.stringify(effectiveReview, null, 2), "utf-8").catch(() => {});
    writeFile(join(cycleDir, "review-raw.md"), rawOutput, "utf-8").catch(() => {});
    const prevNotes = cycle > 1 ? this.getReviewNotesForCycle(cycle) : "";
    const notes = buildReviewNotes(cycle, effectiveReview, prevNotes);
    writeFile(join(cycleDir, "review-notes.md"), notes, "utf-8").catch(() => {});
    return { entry, parsedOk };
  }

  getReviewNotesForCycle(cycle: number): string {
    if (cycle <= 1) return "";
    try {
      const p = join(this.outputBaseDir, `cycle-${cycle - 1}`, "review-notes.md");
      return existsSync(p) ? readFileSync(p, "utf-8") : "";
    } catch { return ""; }
  }

  isOscillating(): boolean { return detectOscillation(this.trail); }
}
