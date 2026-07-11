// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * ValidationAutoHealer — Self-Healing Validation Loop
 *
 * Automatically triages validation failures, searches ERL heuristics
 * for relevant prevention/correction rules, and attempts automatic fixes
 * for common issues (formatting, missing imports, type errors, etc.).
 *
 * Research basis: arXiv:2603.24639 — ERL Experiential Reflective Learning
 */

import { spawn } from "node:child_process";
import type { ValidationFailureEvent, AutoHealResult, Heuristic } from "./types";

interface IdentifiedFix {
  type: string;
  description: string;
  command?: string;
}

export class ValidationAutoHealer {
  private projectRoot: string;
  private workspaceDir: string;
  private attemptCount: Map<string, number> = new Map();
  private failureEvents: ValidationFailureEvent[] = [];
  private heuristicManager: any | null = null;

  constructor(projectRoot: string, workspaceDir: string) {
    this.projectRoot = projectRoot;
    this.workspaceDir = workspaceDir;
  }

  setHeuristicManager(hm: any): void {
    this.heuristicManager = hm;
  }

  async autoHeal(validationCommand: string, errorOutput: string): Promise<AutoHealResult> {
    const key = this.normalizeKey(validationCommand);
    const currentAttempts = this.attemptCount.get(key) || 0;
    const newAttempts = currentAttempts + 1;
    this.attemptCount.set(key, newAttempts);

    const event: ValidationFailureEvent = {
      timestamp: Date.now(), command: validationCommand, errorOutput,
      suggestions: [], resolved: false, healAttempts: newAttempts,
    };
    this.failureEvents.push(event);

    const relevantHeuristics = this.getHeuristicsFor(errorOutput);
    const topSuggestion = relevantHeuristics.length > 0 ? relevantHeuristics[0].rule : null;

    if (newAttempts >= 3) {
      event.escalated = true;
      event.escalationReport = this.buildEscalationReport(
        validationCommand, errorOutput, newAttempts, relevantHeuristics.slice(0, 3)
      );
      event.suggestions = relevantHeuristics.map(h => h.rule);
      return {
        healed: false, attemptedFix: null, topSuggestion,
        escalation: true, escalationReport: event.escalationReport,
        retryCommand: undefined, attempt: newAttempts,
      };
    }

    const fix = this.identifyFix(errorOutput);
    if (!fix) {
      event.suggestions = relevantHeuristics.map(h => h.rule);
      return { healed: false, attemptedFix: null, topSuggestion, escalation: false, retryCommand: undefined, attempt: newAttempts };
    }

    const fixApplied = await this.applyFix(fix);
    if (fixApplied) {
      event.resolved = true;
      event.suggestions = [fix.description];
      return { healed: true, attemptedFix: fix.description, topSuggestion, escalation: false, retryCommand: validationCommand, attempt: newAttempts };
    }

    event.suggestions = relevantHeuristics.map(h => h.rule);
    return { healed: false, attemptedFix: fix.description, topSuggestion, escalation: false, retryCommand: undefined, attempt: newAttempts };
  }

  registerFailure(command: string, errorOutput: string): ValidationFailureEvent {
    const event: ValidationFailureEvent = {
      timestamp: Date.now(), command, errorOutput,
      suggestions: [], resolved: false, healAttempts: 0,
    };
    this.failureEvents.push(event);
    return event;
  }

  async healLastFailure(): Promise<AutoHealResult | null> {
    const lastFailure = this.getLastFailure();
    if (!lastFailure) return null;
    return this.autoHeal(lastFailure.command, lastFailure.errorOutput);
  }

  getLastFailure(): ValidationFailureEvent | null {
    for (let i = this.failureEvents.length - 1; i >= 0; i--) {
      if (!this.failureEvents[i].resolved && !this.failureEvents[i].escalated) {
        return this.failureEvents[i];
      }
    }
    return this.failureEvents.length > 0
      ? this.failureEvents[this.failureEvents.length - 1] : null;
  }

  getRecentFailures(n: number = 5): ValidationFailureEvent[] {
    return this.failureEvents.slice(-n);
  }

  getAllFailures(): ValidationFailureEvent[] { return [...this.failureEvents]; }

  private identifyFix(errorOutput: string): IdentifiedFix | null {
    const lower = errorOutput.toLowerCase();
    if (/\bprettier\b/i.test(errorOutput) || /\bformatting\b/i.test(lower) || /\beslint\b/i.test(errorOutput) ||
        /\blint(s|ing|)\b/i.test(errorOutput) || /unnecessary\s+escape/i.test(lower) ||
        /trailing\s+(whitespace|space)/i.test(lower) || /expected\s+(indentation|spacing)/i.test(lower) ||
        /code\s+style/i.test(lower)) {
      return { type: "format", description: "Auto-format files with prettier and eslint --fix", command: "npx prettier --write . 2>/dev/null; npx eslint --fix . 2>/dev/null; true" };
    }
    if (/cannot\s+find\s+(module|name|file)/i.test(errorOutput) || /module\s+not\s+found/i.test(errorOutput) ||
        /missing\s+import/i.test(lower) || /import.*not\s+found/i.test(lower) ||
        /no\s+such\s+file/i.test(lower) || /require\(\).*not\s+found/i.test(errorOutput)) {
      return { type: "import", description: "Check for missing imports and install dependencies", command: "npm install 2>/dev/null || true" };
    }
    if (/type\s+.*\s+is\s+not\s+assignable/i.test(errorOutput) || /cannot\s+find\s+name/i.test(errorOutput) ||
        /property\s+.*\s+does\s+not\s+exist/i.test(errorOutput) || /is\s+not\s+a\s+type/i.test(errorOutput) ||
        /type\s+.*not\s+assignable/i.test(errorOutput) || /Argument of type/i.test(errorOutput)) {
      return { type: "type_error", description: "TypeScript type error detected — may require manual fix" };
    }
    if (/unexpected\s+token/i.test(errorOutput) || /syntax\s+error/i.test(lower) ||
        /unexpected\s+identifier/i.test(lower) || /expected\s+.*got/i.test(errorOutput) ||
        /parse\s+error/i.test(lower)) {
      return { type: "syntax", description: "Syntax error detected — may require manual fix" };
    }
    if (/cannot\s+find\s+module/i.test(errorOutput) || /ENOENT/i.test(errorOutput) || /Cannot\s+resolve\s+module/i.test(errorOutput)) {
      if (lower.includes("node_modules") || lower.includes("npm") || lower.includes("package")) {
        return { type: "npm_install", description: "Install missing npm packages", command: "npm install" };
      }
    }
    if (/\btest\b/i.test(errorOutput) && (/\bfail/i.test(errorOutput) || /\berror\b/i.test(errorOutput))) {
      return { type: "test_failure", description: "Test failure detected — may require manual investigation" };
    }
    return null;
  }

  private async applyFix(fix: IdentifiedFix): Promise<boolean> {
    if (!fix.command) return false;
    try {
      await this.execCommand(fix.command);
      return true;
    } catch { return false; }
  }

  private getHeuristicsFor(errorOutput: string): Heuristic[] {
    if (!this.heuristicManager) return [];
    const domain = this.detectDomain(errorOutput);
    const heuristics = this.heuristicManager.getRelevantHeuristics(domain, 5);
    if (heuristics.length < 2) {
      const general = this.heuristicManager.getRelevantHeuristics("general", 3);
      return [...heuristics, ...general];
    }
    return heuristics;
  }

  private detectDomain(errorOutput: string): string {
    const lower = errorOutput.toLowerCase();
    if (lower.includes("typescript") || lower.includes(".tsx") || /\.[jt]sx?:/i.test(errorOutput)) return "typescript";
    if (lower.includes("javascript") || /\.js:/i.test(errorOutput)) return "javascript";
    if (lower.includes("python") || /\.py:/i.test(errorOutput)) return "python";
    if (lower.includes("css") || lower.includes("scss") || lower.includes("sass")) return "css";
    if (lower.includes("json") || /\/package\.json/i.test(errorOutput)) return "json";
    if (lower.includes("npm") || lower.includes("node_modules") || lower.includes("package.json")) return "npm";
    if (lower.includes("test") && (lower.includes("fail") || lower.includes("error"))) return "testing";
    return "general";
  }

  private buildEscalationReport(command: string, errorOutput: string, attempts: number, relevantHeuristics: Heuristic[]): string {
    const lines: string[] = [
      "═══════════════════════════════════════════",
      "  🚨 VALIDATION ESCALATION REPORT",
      "═══════════════════════════════════════════",
      "", `  Validation Command: ${command}`, `  Failed Attempts: ${attempts}`,
      `  Timestamp: ${new Date().toISOString()}`, "",
      "  ── Error Output Summary ──", `  ${errorOutput.slice(0, 800)}`, "",
    ];
    if (relevantHeuristics.length > 0) {
      lines.push("  ── Relevant ERL Heuristics ──");
      for (const h of relevantHeuristics) {
        lines.push(`  • [${h.type}] "${h.rule}" (confidence: ${(h.confidence * 100).toFixed(0)}%)`);
      }
      lines.push("");
    }
    lines.push("  ── Suggested Actions ──");
    lines.push("  1. Review the error output above for root cause");
    lines.push("  2. Consider manual inspection of affected files");
    lines.push("  3. Try running the validation command with verbose output");
    lines.push("  4. Check if dependencies or environment have changed");
    lines.push("", "═══════════════════════════════════════════");
    return lines.join("\n");
  }

  private async execCommand(cmd: string): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("bash", ["-c", cmd], {
        cwd: this.projectRoot, stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
      });
      let stdout = "", stderr = "";
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", (code) => {
        if (code === 0) resolvePromise(stdout);
        else rejectPromise(new Error(stderr.slice(0, 200)));
      });
      child.on("error", (err) => rejectPromise(err));
    });
  }

  private normalizeKey(command: string): string {
    return command.trim().toLowerCase().replace(/\s+/g, " ");
  }

  resetAttempts(command: string): void {
    this.attemptCount.delete(this.normalizeKey(command));
  }

  resetAllAttempts(): void { this.attemptCount.clear(); }

  getAttemptCount(command: string): number {
    return this.attemptCount.get(this.normalizeKey(command)) || 0;
  }

  getStats(): string {
    const total = this.failureEvents.length;
    const resolved = this.failureEvents.filter(e => e.resolved).length;
    const escalated = this.failureEvents.filter(e => e.escalated).length;
    const pending = total - resolved - escalated;
    const lines: string[] = [
      "🩺 Validation Auto-Healing Stats",
      "─────────────────────────────────",
      `  Total failures tracked: ${total}`,
      `  Auto-healed (attempted fix): ${resolved}`,
      `  Escalated (3+ failed attempts): ${escalated}`,
      `  Pending: ${pending}`,
    ];
    if (total > 0) {
      lines.push(`  Auto-heal success rate: ${((resolved / total) * 100).toFixed(0)}%`);
    }
    return lines.join("\n");
  }

  getFailuresSummary(): string {
    const total = this.failureEvents.length;
    if (total === 0) return "No validation failures tracked.";
    const lines: string[] = [`📋 Validation Failures (${total} total):`];
    for (let i = 0; i < Math.min(total, 10); i++) {
      const f = this.failureEvents[total - 1 - i];
      const status = f.resolved ? "✅ healed" : f.escalated ? "🚨 escalated" : "⏳ pending";
      const cmd = f.command.length > 50 ? f.command.slice(0, 50) + "..." : f.command;
      const time = new Date(f.timestamp).toLocaleTimeString();
      lines.push(`  ${status} [${time}] ${cmd} (${f.healAttempts} attempt(s))`);
    }
    return lines.join("\n");
  }
}
