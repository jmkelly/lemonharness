// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * ContextBudgetTracker — Token estimation and context limit monitoring
 *
 * Monitors token usage relative to model context limits.
 * Uses heuristic: 1 token ≈ 4 chars for text, 1 token ≈ 1 char for code.
 */

import type { LogEntry, ContextStatusResult } from "./types";

export class ContextBudgetTracker {
  private modelContextLimit: number;
  private memoryRetrieved: Array<{ content: string; timestamp: number }> = [];
  private skillsLoaded: Array<{ name: string; content: string }> = [];
  private warnedThresholds: Set<number> = new Set();

  constructor(modelContextLimit: number = 128000) {
    this.modelContextLimit = modelContextLimit;
  }

  setLimit(limit: number): void { this.modelContextLimit = limit; }
  getLimit(): number { return this.modelContextLimit; }
  resetWarnings(): void { this.warnedThresholds.clear(); }

  estimateTokens(text: string, isCode: boolean = false): number {
    if (!text) return 0;
    const chars = text.length;
    if (isCode) return Math.ceil(chars);
    return Math.ceil(chars / 4);
  }

  private detectIsCode(content: unknown): boolean {
    if (typeof content !== "string") return false;
    const codePatterns = [
      /function\s+\w+\s*\(/, /=>\s*{/, /import\s+.*from/, /export\s+(default\s+)?/,
      /const\s+\w+\s*=/, /let\s+\w+\s*=/, /var\s+\w+\s*=/, /class\s+\w+/,
      /if\s*\(/, /for\s*\(/, /while\s*\(/, /switch\s*\(/, /try\s*{/,
      /\.\w+\(/, /;\s*$/, /```/, /\bdef\s+\w+\s*\(/, /\bclass\s+\w+/,
      /^\s*#\s*include/, /^\s*using\s+namespace/, /^\s*import\s+/, /\bconsole\./,
      /\bmodule\.exports/, /\brequire\(/, /^\s*<\?php/, /^\s*#!/,
    ];
    let matches = 0;
    for (const pattern of codePatterns) {
      if (pattern.test(content)) matches++;
      if (matches >= 2) return true;
    }
    return false;
  }

  estimateTokensForEntry(entry: LogEntry): number {
    let total = 0;
    if (entry.args) {
      const argsStr = typeof entry.args === "string" ? entry.args : JSON.stringify(entry.args);
      total += this.estimateTokens(argsStr, this.detectIsCode(argsStr));
    }
    if (entry.result) {
      const resultStr = typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result);
      total += this.estimateTokens(resultStr, this.detectIsCode(resultStr));
    }
    if (entry.output) {
      total += this.estimateTokens(entry.output, this.detectIsCode(entry.output));
    }
    return total;
  }

  trackMemoryRetrieval(content: string): void {
    this.memoryRetrieved.push({ content, timestamp: Date.now() });
    if (this.memoryRetrieved.length > 50) { this.memoryRetrieved = this.memoryRetrieved.slice(-50); }
  }

  trackSkillLoaded(name: string, content: string): void {
    const existing = this.skillsLoaded.findIndex(s => s.name === name);
    if (existing >= 0) { this.skillsLoaded[existing] = { name, content }; }
    else { this.skillsLoaded.push({ name, content }); }
  }

  untrackSkill(name: string): void {
    this.skillsLoaded = this.skillsLoaded.filter(s => s.name !== name);
  }

  getMemoryRetrievals(): Array<{ content: string; timestamp: number }> { return [...this.memoryRetrieved]; }
  getSkillsLoaded(): Array<{ name: string; content: string }> { return [...this.skillsLoaded]; }

  getContextStatus(trail: LogEntry[]): ContextStatusResult {
    const trailTokens = trail.reduce((sum, entry) => sum + this.estimateTokensForEntry(entry), 0);
    const memoryTokens = this.memoryRetrieved.reduce((sum, entry) => sum + this.estimateTokens(entry.content), 0);
    const skillsTokens = this.skillsLoaded.reduce((sum, skill) => sum + this.estimateTokens(skill.content || "", this.detectIsCode(skill.content || "")), 0);
    const totalTokens = trailTokens + memoryTokens + skillsTokens;
    const percentUsed = Math.min(100, Math.round((totalTokens / this.modelContextLimit) * 100));
    const maxRecent = 10;
    const recentCount = Math.min(trail.length, maxRecent);
    const compressedCount = Math.max(0, trail.length - maxRecent);
    const recentTrail = trail.slice(-maxRecent);
    const olderTrail = trail.slice(0, -maxRecent);
    const recentTok = recentTrail.reduce((sum, entry) => sum + this.estimateTokensForEntry(entry), 0);
    const compressedTok = olderTrail.reduce((sum, entry) => sum + this.estimateTokensForEntry(entry), 0);

    return {
      totalTokens, percentUsed, modelLimit: this.modelContextLimit,
      trail: { totalCount: trail.length, recentCount, compressedCount, recentTokens: recentTok, compressedTokens: compressedTok, totalTokens: trailTokens },
      memory: { count: this.memoryRetrieved.length, tokens: memoryTokens },
      skills: { count: this.skillsLoaded.length, tokens: skillsTokens },
      recommendation: this.getRecommendation(percentUsed, trail.length, this.memoryRetrieved.length, this.skillsLoaded.length),
    };
  }

  getRecommendation(percentUsed: number, trailCount?: number, memoryCount?: number, skillsCount?: number): string {
    const parts: string[] = [];
    if (percentUsed >= 90) { parts.push("⚠️ CRITICAL: Context nearly full. Immediate action recommended:"); }
    else if (percentUsed >= 70) { parts.push("⚠️ High context usage. Consider compressing:"); }
    else if (percentUsed >= 50) { parts.push("📋 Moderate context usage. Monitor these areas:"); }
    else { return "✅ Context usage is healthy — no action needed."; }

    if (trailCount && trailCount > 50) { parts.push("  • Execution trail: " + trailCount + " entries — consider resetting with /lemonharness:reset"); }
    else if (trailCount && trailCount > 20) { parts.push("  • Execution trail: " + trailCount + " entries — will be compressed automatically"); }
    if (memoryCount && memoryCount > 20) { parts.push("  • Memory retrieved: " + memoryCount + " entries — use more specific memory queries"); }
    if (skillsCount && skillsCount > 3) { parts.push("  • Skills loaded: " + skillsCount + " — only load essential skills"); }
    else if (skillsCount && skillsCount > 0 && percentUsed >= 70) {
      if (trailCount && trailCount > 10) { parts.push("  • Compress execution trail with summarizeCompressed or /lemonharness:reset"); }
    }
    if (parts.length === 1) {
      parts.push("  • Consider resetting trail with /lemonharness:reset");
      parts.push("  • Narrow memory search scope");
      parts.push("  • Load only essential skills (/skill:<name>)");
    }
    return parts.join("\n");
  }

  formatStatus(status: ContextStatusResult): string {
    const lines = [
      "🧠 Context Budget Status",
      "────────────────────────", "",
      `Estimated context: ~${this.formatTokens(status.totalTokens)} tokens (${status.percentUsed}% of ${this.formatTokens(status.modelLimit)} limit)`, "",
      `📋 Trail entries: ${status.trail.totalCount} total`,
      `   Recent: ${status.trail.recentCount} entries (~${this.formatTokens(status.trail.recentTokens)} tokens)`,
      `   Compressed: ${status.trail.compressedCount} entries (~${this.formatTokens(status.trail.compressedTokens)} tokens)`,
      `   Total: ~${this.formatTokens(status.trail.totalTokens)} tokens`, "",
      `💾 Memory retrieved: ${status.memory.count} entries (~${this.formatTokens(status.memory.tokens)} tokens)`,
      `🔧 Skills loaded: ${status.skills.count} skills (~${this.formatTokens(status.skills.tokens)} tokens)`, "",
      `📊 Recommendation:`, status.recommendation,
    ];
    return lines.join("\n");
  }

  checkThresholds(percentUsed: number): Array<{ threshold: number; message: string }> {
    const thresholds = [50, 70, 90];
    const hits: Array<{ threshold: number; message: string }> = [];
    for (const threshold of thresholds) {
      if (percentUsed >= threshold && !this.warnedThresholds.has(threshold)) {
        this.warnedThresholds.add(threshold);
        const emoji = threshold >= 90 ? "🔴" : threshold >= 70 ? "⚠️" : "📋";
        hits.push({ threshold, message: `${emoji} Context usage at ${percentUsed}% (exceeded ${threshold}% threshold). Use /lemonharness:context for details.` });
      }
    }
    return hits;
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${tokens}`;
  }
}
