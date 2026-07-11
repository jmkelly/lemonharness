// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * ExecutionLogger — Trail & Validation Feedback
 *
 * Logs tool calls and validation results, detects regressions,
 * and provides compressed execution summaries.
 */

import type { LogEntry } from "./types";

export class ExecutionLogger {
  private trail: LogEntry[] = [];
  private consecutiveErrors: number = 0;
  private lastErrorType: string = "";
  private errorSequence: string[] = [];
  private errorEpisodes: number = 0;
  private lastEpisodeTool: string = "";
  private retryWindowMs: number = 10_000;

  logToolCall(toolName: string, args: unknown, result: { content: unknown; isError?: boolean }, isError?: boolean) {
    this.trail.push({
      type: "tool_call", timestamp: Date.now(), toolName, args,
      result: result.content, isError: isError ?? result.isError,
    });

    if (isError || result.isError) {
      this.consecutiveErrors++;
      const now = Date.now();
      // Count as a new error episode only if different tool or outside retry window
      if (toolName !== this.lastEpisodeTool || this.errorEpisodes === 0) {
        this.errorEpisodes++;
        this.lastEpisodeTool = toolName;
      } else {
        // Same tool, within retry window — check if enough time passed
        const lastErrorEntry = [...this.trail].reverse().find(e => e.isError);
        if (lastErrorEntry && (now - lastErrorEntry.timestamp) > this.retryWindowMs) {
          this.errorEpisodes++;
        }
      }
      this.lastErrorType = toolName;
      this.errorSequence.push(toolName);
    } else {
      this.consecutiveErrors = 0;
    }

    if (this.trail.length > 200) { this.trail = this.trail.slice(-100); }
  }

  recordConfidence(toolName: string, args: unknown, score: number, rationale: string) {
    const clampedScore = Math.max(1, Math.min(5, Math.round(score)));
    this.trail.push({
      type: "confidence", timestamp: Date.now(), toolName, args,
      confidence: {
        score: clampedScore,
        rationale: rationale.slice(0, 500),
        flagForReview: clampedScore < 3,
      },
    });
    if (this.trail.length > 200) { this.trail = this.trail.slice(-100); }
  }

  logValidation(validationName: string, command: string, passed: boolean, output: string) {
    this.trail.push({
      type: "validation", timestamp: Date.now(),
      validationName, command, passed, output: output.slice(0, 500),
    });
    if (!passed) {
      this.consecutiveErrors++;
      this.errorSequence.push(`validation:${validationName}`);
    } else {
      this.consecutiveErrors = 0;
    }
  }

  getExecutionTrail(): LogEntry[] { return [...this.trail]; }

  getConsecutiveErrors(): number { return this.consecutiveErrors; }

  /**
   * Returns the number of distinct error episodes (retries of same tool
   * within the retry window count as one episode). Use for aggregate
   * error rate calculations to avoid inflation from transient retries.
   */
  getErrorEpisodes(): number { return this.errorEpisodes; }

  detectRegression(): string | null {
    if (this.errorSequence.length < 3) return null;
    const last3 = this.errorSequence.slice(-3);
    if (last3.every(e => e === last3[0])) {
      return `3 consecutive "${last3[0]}" failures detected`;
    }
    return null;
  }

  summarize(maxEntries: number = 10): string {
    const entries = this.trail.slice(-maxEntries);
    if (entries.length === 0) return "";
    const lines: string[] = [];
    for (const entry of entries) {
      if (entry.type === "validation") {
        const icon = entry.passed ? "✅" : "❌";
        lines.push(`  ${icon} ${entry.validationName}: ${entry.command?.slice(0, 60)}`);
      } else {
        const icon = entry.isError ? "✗" : "→";
        const argsStr = entry.args ? JSON.stringify(entry.args).slice(0, 60) : "";
        lines.push(`  ${icon} ${entry.toolName}: ${argsStr}`);
      }
    }
    return lines.join("\n");
  }

  summarizeCompressed(maxEntries: number = 10): string {
    if (this.trail.length <= maxEntries) return this.summarize(maxEntries);

    const recent = this.trail.slice(-maxEntries);
    const older = this.trail.slice(0, -maxEntries);

    const toolCalls = older.filter(e => e.type === "tool_call").length;
    const validations = older.filter(e => e.type === "validation").length;
    const errors = older.filter(e => e.isError).length;
    const passes = older.filter(e => e.type === "validation" && e.passed).length;

    const lines: string[] = [
      `📋 Earlier: ${toolCalls} tool calls, ${validations} validations (${errors} errors, ${passes} passed)`,
      "",
      `📋 Recent (${recent.length} entries):`,
    ];

    for (const entry of recent) {
      if (entry.type === "validation") {
        lines.push(`  ${entry.passed ? "✅" : "❌"} ${entry.validationName}: ${entry.command?.slice(0, 60)}`);
      } else {
        lines.push(`  ${entry.isError ? "✗" : "→"} ${entry.toolName}: ${JSON.stringify(entry.args).slice(0, 60)}`);
      }
    }

    return lines.join("\n");
  }
}
