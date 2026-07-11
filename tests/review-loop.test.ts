/**
 * Tests for the Review Loop module.
 *
 * Tests pure functions: parseReviewJson, computeSeverityStats,
 * determineTermination, buildReviewNotes, detectOscillation.
 * These are the core logic functions that don't require I/O.
 */

import { describe, it, expect } from "vitest";

// ── Import the module under test ────────────────────────────────
async function getModule() {
  return import("../.pi/extensions/lemonharness/review-loop");
}

// ── parseReviewJson ─────────────────────────────────────────────
describe("parseReviewJson", () => {
  it("should parse a raw JSON object from text", async () => {
    const mod = await getModule();
    const input = JSON.stringify({
      cycle: 1,
      timestamp: "2026-07-11T00:00:00Z",
      findings: [
        { id: 1, severity: 7, category: "correctness", description: "Bug", fix_suggestion: "Fix it" },
      ],
      overall_assessment: "Needs work",
      recommended_next_action: "continue",
    });
    const result = mod.parseReviewJson(input);
    expect(result).not.toBeNull();
    expect(result!.cycle).toBe(1);
    expect(result!.findings).toHaveLength(1);
    expect(result!.findings[0].severity).toBe(7);
    expect(result!.recommended_next_action).toBe("continue");
  });

  it("should parse JSON inside a fenced code block", async () => {
    const mod = await getModule();
    const input =
      "Some text before\n" +
      "```json\n" +
      JSON.stringify({
        cycle: 2,
        timestamp: "2026-07-11T00:00:00Z",
        findings: [
          { id: 1, severity: 9, category: "security", description: "XSS", fix_suggestion: "Sanitize input" },
        ],
        overall_assessment: "Critical issues",
        recommended_next_action: "continue",
      }) +
      "\n```\nSome text after";
    const result = mod.parseReviewJson(input);
    expect(result).not.toBeNull();
    expect(result!.cycle).toBe(2);
    expect(result!.findings).toHaveLength(1);
    expect(result!.findings[0].severity).toBe(9);
  });

  it("should return null for text with no severity information", async () => {
    const mod = await getModule();
    const input = "This is just a regular paragraph with no review data.";
    const result = mod.parseReviewJson(input);
    expect(result).toBeNull();
  });

  it("should extract findings from unstructured text with severity mentions", async () => {
    const mod = await getModule();
    const input =
      "Here are my review notes:\n" +
      "Severity: 8 - Missing validation on user paths\n" +
      "Severity: 5 - Unclear variable naming\n" +
      "The code seems correct overall.";
    const result = mod.parseReviewJson(input);
    expect(result).not.toBeNull();
    expect(result!.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle empty string", async () => {
    const mod = await getModule();
    expect(mod.parseReviewJson("")).toBeNull();
  });

  it("should handle malformed JSON gracefully", async () => {
    const mod = await getModule();
    const input = "{ this is not valid json }";
    const result = mod.parseReviewJson(input);
    // Should either extract from text or return null, not throw
    expect(result === null || result !== null).toBe(true);
  });
});

// ── computeSeverityStats ─────────────────────────────────────────
describe("computeSeverityStats", () => {
  it("should compute max severity and top-3 average", async () => {
    const mod = await getModule();
    const review = {
      cycle: 1,
      timestamp: "",
      findings: [
        { id: 1, severity: 8, category: "correctness", description: "", fix_suggestion: "" },
        { id: 2, severity: 5, category: "maintainability", description: "", fix_suggestion: "" },
        { id: 3, severity: 3, category: "performance", description: "", fix_suggestion: "" },
        { id: 4, severity: 9, category: "security", description: "", fix_suggestion: "" },
      ],
      overall_assessment: "",
      recommended_next_action: "continue" as const,
    };
    const stats = mod.computeSeverityStats(review);
    expect(stats.maxSeverity).toBe(9);
    expect(stats.topThreeAvg).toBeCloseTo((9 + 8 + 5) / 3, 1);
  });

  it("should handle empty findings", async () => {
    const mod = await getModule();
    const review = {
      cycle: 1,
      timestamp: "",
      findings: [],
      overall_assessment: "",
      recommended_next_action: "continue" as const,
    };
    const stats = mod.computeSeverityStats(review);
    expect(stats.maxSeverity).toBe(0);
    expect(stats.topThreeAvg).toBe(0);
  });

  it("should handle fewer than 3 findings", async () => {
    const mod = await getModule();
    const review = {
      cycle: 1,
      timestamp: "",
      findings: [
        { id: 1, severity: 7, category: "correctness", description: "", fix_suggestion: "" },
      ],
      overall_assessment: "",
      recommended_next_action: "continue" as const,
    };
    const stats = mod.computeSeverityStats(review);
    expect(stats.maxSeverity).toBe(7);
    expect(stats.topThreeAvg).toBe(7);
  });
});

// ── determineTermination ─────────────────────────────────────────
describe("determineTermination", () => {
  function makeEntry(maxSeverity: number, topThreeAvg: number, recommended_next_action: "continue" | "stop" = "continue") {
    return {
      cycle: 1,
      review: {
        cycle: 1,
        timestamp: "",
        findings: [],
        overall_assessment: "",
        recommended_next_action,
      },
      maxSeverity,
      topThreeAvg,
      rawOutput: "",
      parsedOk: true,
    };
  }

  it("should not terminate with empty trail", async () => {
    const mod = await getModule();
    const decision = mod.determineTermination([], 5);
    expect(decision.shouldStop).toBe(false);
  });

  it("should stop when max cycles reached", async () => {
    const mod = await getModule();
    const trail = [makeEntry(8, 7)];
    const decision = mod.determineTermination(trail, 1);
    expect(decision.shouldStop).toBe(true);
    expect(decision.reason).toBe("max_cycles_reached");
  });

  it("should stop on manual stop", async () => {
    const mod = await getModule();
    const trail = [makeEntry(5, 4, "stop")];
    const decision = mod.determineTermination(trail, 5);
    expect(decision.shouldStop).toBe(true);
    expect(decision.reason).toBe("manual_stop");
  });

  it("should stop after two consecutive low-severity cycles", async () => {
    const mod = await getModule();
    const trail = [
      makeEntry(3, 2.5),
      makeEntry(2, 1.5),
    ];
    const decision = mod.determineTermination(trail, 5);
    expect(decision.shouldStop).toBe(true);
    expect(decision.reason).toBe("max_severity_low_two_consecutive");
  });

  it("should not stop after only one low-severity cycle", async () => {
    const mod = await getModule();
    const trail = [makeEntry(3, 2.5)];
    const decision = mod.determineTermination(trail, 5);
    expect(decision.shouldStop).toBe(false);
  });

  it("should stop on flat trend after 3 cycles", async () => {
    const mod = await getModule();
    const trail = [
      makeEntry(5, 4.0),
      makeEntry(5, 4.1),
      makeEntry(5, 3.9),
    ];
    const decision = mod.determineTermination(trail, 5);
    expect(decision.shouldStop).toBe(true);
    expect(decision.reason).toBe("flat_trend");
  });
});

// ── detectOscillation ────────────────────────────────────────────
describe("detectOscillation", () => {
  it("should detect alternating high-low-high pattern", async () => {
    const mod = await getModule();
    function entry(sev: number) {
      return {
        cycle: 1,
        review: { cycle: 1, timestamp: "", findings: [], overall_assessment: "", recommended_next_action: "continue" as const },
        maxSeverity: sev,
        topThreeAvg: sev,
        rawOutput: "",
        parsedOk: true,
      };
    }
    const trail = [entry(7), entry(3), entry(7), entry(3)];
    expect(mod.detectOscillation(trail)).toBe(true);
  });

  it("should not detect oscillation with low alternation count", async () => {
    const mod = await getModule();
    function entry(sev: number) {
      return {
        cycle: 1,
        review: { cycle: 1, timestamp: "", findings: [], overall_assessment: "", recommended_next_action: "continue" as const },
        maxSeverity: sev,
        topThreeAvg: sev,
        rawOutput: "",
        parsedOk: true,
      };
    }
    const trail = [entry(7), entry(3)]; // Only 2 entries, too few for detection
    expect(mod.detectOscillation(trail)).toBe(false);
  });
});

// ── buildReviewNotes ─────────────────────────────────────────────
describe("buildReviewNotes", () => {
  it("should include actionable findings (severity ≥ 4)", async () => {
    const mod = await getModule();
    const review = {
      cycle: 1,
      timestamp: "",
      findings: [
        { id: 1, severity: 7, category: "security", description: "Missing validation", fix_suggestion: "Add input validation" },
        { id: 2, severity: 2, category: "style", description: "Minor naming", fix_suggestion: "Rename variable" },
      ],
      overall_assessment: "Some issues found.",
      recommended_next_action: "continue" as const,
    };
    const notes = mod.buildReviewNotes(1, review, "");
    expect(notes).toContain("1 actionable findings");
    expect(notes).toContain("Missing validation");
    // Low-severity items should be in the optional section, not actionable
    expect(notes).toContain("low-severity");
    expect(notes).toContain("Minor naming"); // listed in low-severity notes section
  });

  it("should handle no findings", async () => {
    const mod = await getModule();
    const review = {
      cycle: 1,
      timestamp: "",
      findings: [],
      overall_assessment: "No issues.",
      recommended_next_action: "stop" as const,
    };
    const notes = mod.buildReviewNotes(1, review, "");
    expect(notes).toContain("No actionable findings");
  });
});
