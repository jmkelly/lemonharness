// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * FormatGuard — Constraints & Format Detection
 *
 * Detects format constraints in user prompts to adjust agent behavior.
 */

export class FormatGuard {
  private constraintPatterns = [
    { pattern: /EXACTLY\s+\d+\s+words/i, type: "word_count" as const },
    { pattern: /Output ONLY the/i, type: "strict_output" as const },
    { pattern: /Output ONLY your final/i, type: "strict_output" as const },
    { pattern: /Report ONLY the final/i, type: "strict_output" as const },
    { pattern: /Answer as a single letter/i, type: "single_letter" as const },
    { pattern: /Answer: just the number/i, type: "single_value" as const },
    { pattern: /Answer: just the email/i, type: "single_value" as const },
    { pattern: /Do NOT use the word/i, type: "negative_constraint" as const },
    { pattern: /Do NOT list more than/i, type: "negative_constraint" as const },
    { pattern: /Output ONLY the JSON/i, type: "json_only" as const },
    { pattern: /Output only the code/i, type: "code_only" as const },
  ];

  detected: Set<string> = new Set();

  scan(prompt: string): void {
    this.detected.clear();
    for (const { pattern, type } of this.constraintPatterns) {
      if (pattern.test(prompt)) this.detected.add(type);
    }
  }

  get isConstrained(): boolean {
    return this.detected.size > 0 && !this.detected.has("single_letter");
  }

  get suppressExtras(): boolean {
    return this.detected.has("word_count") || this.detected.has("strict_output") ||
           this.detected.has("json_only") || this.detected.has("code_only");
  }

  formatNote(): string {
    if (this.detected.size === 0) return "";
    return `⚠️ Format constraint detected: ${[...this.detected].join(", ")}. Keep response brief and precise.`;
  }
}

export const formatGuard = new FormatGuard();
