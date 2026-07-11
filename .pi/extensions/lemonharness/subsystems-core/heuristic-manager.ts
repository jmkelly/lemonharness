// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * HeuristicManager — ERL Heuristic Extraction & Injection
 *
 * Research basis: arXiv:2603.24639 — Experiential Reflective Learning
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Heuristic } from "./types";

export class HeuristicManager {
  private heuristics: Heuristic[] = [];
  private storagePath: string;

  constructor(workspaceDir: string) {
    this.storagePath = `${workspaceDir}/heuristics.json`;
  }

  async init() { await this.load(); }

  extractHeuristic(eventType: string, summary: string, details: string, domain: string): Heuristic | null {
    const text = (summary + " " + details).toLowerCase();
    if (text.length < 20) return null;
    let rule: string | null = null;
    let type: "prevention" | "correction" | "optimization" = "prevention";
    if (/always|never|always use|always check|always set|never use|never forget/i.test(text)) {
      const match = text.match(/(always|never)\s+(.+?)(?:\.|$)/i);
      if (match) { rule = match[0].trim(); rule = rule.charAt(0).toUpperCase() + rule.slice(1); if (!rule.endsWith(".")) rule += "."; }
      type = "prevention";
    }
    if (!rule && /(?:fix|resolve|solved|fixed by)/i.test(text)) {
      const match = text.match(/(?:fix|resolve|solved|fixed)\s+(?:by|with|using)\s+(.+?)(?:\.|$)/i);
      if (match) { rule = `When encountering this, ${match[1].trim()}.`; rule = rule.charAt(0).toUpperCase() + rule.slice(1); }
      else { rule = `Check ${summary.split(/\s+/).slice(0, 5).join(" ")} before proceeding.`; }
      type = "correction";
    }
    if (!rule && /(?:faster|quicker|efficient|optimize|improve|better|simpler)/i.test(text)) {
      const match = text.match(/(?:use|prefer|choose|try)\s+(.+?)(?:\.|$)/i);
      if (match) { rule = `Prefer ${match[1].trim()} for better efficiency.`; }
      else { rule = `Optimize ${summary.split(/\s+/).slice(0, 4).join(" ")} for performance.`; }
      type = "optimization";
    }
    if (!rule) {
      const firstSentence = summary.split(/[.!]/).find((s: string) => s.trim().length > 10);
      if (firstSentence) { rule = firstSentence.trim() + "."; type = "correction"; }
      else return null;
    }
    const existing = this.heuristics.find(h =>
      h.rule.toLowerCase().includes(rule!.toLowerCase().slice(0, 20)) ||
      rule!.toLowerCase().includes(h.rule.toLowerCase().slice(0, 20))
    );
    if (existing) { existing.successCount++; existing.lastUsedAt = Date.now(); existing.confidence = Math.min(1, existing.confidence + 0.05); return existing; }
    const heuristic: Heuristic = {
      id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, rule, domain, type,
      sourceEvent: `${eventType}: ${summary.slice(0, 80)}`, confidence: 0.5, successCount: 1, failureCount: 0,
      createdAt: Date.now(), lastUsedAt: Date.now(),
    };
    this.heuristics.push(heuristic); this.save(); return heuristic;
  }

  getRelevantHeuristics(domain: string, maxResults: number = 5): Heuristic[] {
    return [...this.heuristics].filter(h => h.domain === domain || h.domain === "general" || h.confidence >= 0.4)
      .sort((a, b) => b.confidence - a.confidence).slice(0, maxResults);
  }

  formatForPrompt(heuristics: Heuristic[]): string {
    if (heuristics.length === 0) return "";
    return ["🧪 Relevant Heuristics (from past experience):",
      ...heuristics.map(h => `  • "${h.rule}" (${h.type}, confidence: ${h.confidence.toFixed(2)})`)
    ].join("\n");
  }

  recordOutcome(heuristicId: string, succeeded: boolean) {
    const h = this.heuristics.find(h => h.id === heuristicId);
    if (!h) return;
    if (succeeded) { h.successCount++; h.confidence = Math.min(1, h.confidence + 0.1); }
    else { h.failureCount++; h.confidence = Math.max(0, h.confidence - 0.15); }
    h.lastUsedAt = Date.now(); this.save();
  }

  getAllHeuristics(): Heuristic[] { return [...this.heuristics]; }

  getStats(): string {
    const total = this.heuristics.length;
    const byType = { prevention: 0, correction: 0, optimization: 0 };
    for (const h of this.heuristics) byType[h.type]++;
    const avgConf = this.heuristics.reduce((s, h) => s + h.confidence, 0) / (total || 1);
    return [
      `Heuristics: ${total} total`,
      `  Prevention: ${byType.prevention}, Correction: ${byType.correction}, Optimization: ${byType.optimization}`,
      `  Avg confidence: ${(avgConf * 100).toFixed(0)}%`
    ].join("\n");
  }

  private async save() {
    try {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(this.storagePath), { recursive: true });
      await writeFile(this.storagePath, JSON.stringify(this.heuristics, null, 2), "utf-8");
    } catch { /* non-critical */ }
  }

  private async load() {
    try {
      const { readFile } = await import("node:fs/promises");
      this.heuristics = JSON.parse(await readFile(this.storagePath, "utf-8"));
    } catch { this.heuristics = []; }
  }
}
