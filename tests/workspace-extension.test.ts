/**
 * Tests for the LemonHarness Workspace Extension.
 *
 * Tests the TimeDirector phase management, ExecutionLogger,
 * and phase checkpoint recording.
 */

import { describe, it, expect } from "vitest";

// ── TimeDirector tests ──────────────────────────────────────────
describe("TimeDirector", () => {
  it("should export TimeDirector class from workspace extension", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    expect(mod.TimeDirector).toBeDefined();
    expect(typeof mod.TimeDirector).toBe("function");
  });

  it("should create a TimeDirector with default config", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const director = new mod.TimeDirector();
    expect(director.getBudget()).toBe(300_000); // default 5 min
  });

  it("should accept custom budget in config", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const director = new mod.TimeDirector({ totalBudgetMs: 600_000 });
    expect(director.getBudget()).toBe(600_000);
  });

  it("should extend budget correctly", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const director = new mod.TimeDirector({ totalBudgetMs: 100_000 });
    director.extendBudget(20_000);
    expect(director.getBudget()).toBe(120_000);
  });

  it("should set budget correctly", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const director = new mod.TimeDirector({ totalBudgetMs: 100_000 });
    director.setBudget(200_000);
    expect(director.getBudget()).toBe(200_000);
  });

  it("should format status without errors", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const director = new mod.TimeDirector({ totalBudgetMs: 300_000 });
    director.start();
    const status = director.formatStatus();
    expect(status).toContain("EXPLORE");
    expect(status).toContain("Explore (0–30% budget)");
  });
});

// ── Phase Checkpoints (v3) ──────────────────────────────────────
describe("Phase Checkpoints", () => {
  it("should record a checkpoint with decision advantage decay", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const director = new mod.TimeDirector({ totalBudgetMs: 100_000 });

    const cp = director.recordPhaseCheckpoint("explore", '{"files":3}', "test trail");
    expect(cp.phase).toBe("explore");
    // First checkpoint: e^(-0.3 * 1) ≈ 0.741
    expect(cp.decisionAdvantage).toBeCloseTo(Math.exp(-0.3), 2);
    expect(cp.timestamp).toBeGreaterThan(0);

    // Second checkpoint should have lower decision advantage
    const cp2 = director.recordPhaseCheckpoint("implement", '{"files":5}', "");
    // Second: e^(-0.3 * 2) ≈ 0.549
    expect(cp2.decisionAdvantage).toBeCloseTo(Math.exp(-0.6), 2);
  });

  it("should retrieve recorded checkpoints", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const director = new mod.TimeDirector({ totalBudgetMs: 100_000 });

    director.recordPhaseCheckpoint("explore", "{}", "");
    director.recordPhaseCheckpoint("implement", "{}", "");

    const checkpoints = director.getPhaseCheckpoints();
    expect(checkpoints.length).toBe(2);
    expect(checkpoints[0].phase).toBe("explore");
    expect(checkpoints[1].phase).toBe("implement");
  });

  it("should return decision advantage decay factor", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const director = new mod.TimeDirector({ totalBudgetMs: 100_000 });

    // No checkpoints yet
    expect(director.getDecisionAdvantageDecay()).toBe(1);

    // After 2 checkpoints: e^(-0.3 * 2) = e^(-0.6)
    director.recordPhaseCheckpoint("explore", "{}", "");
    director.recordPhaseCheckpoint("implement", "{}", "");
    expect(director.getDecisionAdvantageDecay()).toBeCloseTo(Math.exp(-0.6), 2);
  });
});

// ── ExecutionLogger ─────────────────────────────────────────────
describe("ExecutionLogger", () => {
  it("should export ExecutionLogger class", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    expect(mod.ExecutionLogger).toBeDefined();
    expect(typeof mod.ExecutionLogger).toBe("function");
  });

  it("should log a tool call and retrieve the trail", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const logger = new mod.ExecutionLogger();

    logger.logToolCall("test_tool", { arg: "hello" }, { content: "ok", isError: false });
    const trail = logger.getExecutionTrail();
    expect(trail.length).toBe(1);
    expect(trail[0].toolName).toBe("test_tool");
    expect(trail[0].isError).toBe(false);
  });

  it("should track consecutive errors", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const logger = new mod.ExecutionLogger();

    logger.logToolCall("tool1", {}, { content: "ok" });
    expect(logger.getConsecutiveErrors()).toBe(0);

    logger.logToolCall("failing_tool", {}, { content: "error", isError: true }, true);
    expect(logger.getConsecutiveErrors()).toBe(1);

    // Second consecutive error
    logger.logToolCall("failing_tool2", {}, { content: "error2", isError: true }, true);
    expect(logger.getConsecutiveErrors()).toBe(2);

    // Success resets consecutive count
    logger.logToolCall("working_tool", {}, { content: "ok" });
    expect(logger.getConsecutiveErrors()).toBe(0);
  });

  it("should detect regression after 3+ consecutive failures of same tool", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const logger = new mod.ExecutionLogger();

    // Three build failures in a row
    logger.logToolCall("build", {}, { content: "fail", isError: true }, true);
    expect(logger.detectRegression()).toBeNull(); // only 1 error

    logger.logToolCall("build", {}, { content: "fail", isError: true }, true);
    expect(logger.detectRegression()).toBeNull(); // only 2 errors

    logger.logToolCall("build", {}, { content: "fail", isError: true }, true);
    const msg = logger.detectRegression();
    expect(msg).not.toBeNull();
    expect(msg).toContain("build");
  });

  it("should record confidence scores", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const logger = new mod.ExecutionLogger();

    logger.recordConfidence("test_tool", { arg: 1 }, 4, "high confidence");
    const trail = logger.getExecutionTrail();
    const confEntry = trail.find(e => e.type === "confidence");
    expect(confEntry).toBeDefined();
    expect(confEntry!.confidence!.score).toBe(4);
    expect(confEntry!.confidence!.rationale).toBe("high confidence");
  });

  it("should clamp confidence scores to 1-5 range", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const logger = new mod.ExecutionLogger();

    // Score 0 should become 1
    logger.recordConfidence("tool", {}, 0, "too low");
    // Score 10 should become 5
    logger.recordConfidence("tool", {}, 10, "too high");

    const trail = logger.getExecutionTrail().filter(e => e.type === "confidence");
    expect(trail[0].confidence!.score).toBe(1);
    expect(trail[1].confidence!.score).toBe(5);
  });

  it("should flag scores < 3 for review", async () => {
    const mod = await import("../.pi/extensions/lemonharness/workspace.ts");
    const logger = new mod.ExecutionLogger();

    logger.recordConfidence("tool", {}, 2, "low confidence");
    logger.recordConfidence("tool", {}, 5, "high confidence");

    const trail = logger.getExecutionTrail().filter(e => e.type === "confidence");
    expect(trail[0].confidence!.flagForReview).toBe(true);
    expect(trail[1].confidence!.flagForReview).toBe(false);
  });
});

// ── v3: Heuristic Injection lives in lemonharness-subsystems.ts ──
describe("HeuristicManager (v3)", () => {
  it("should export HeuristicManager from subsystems", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems.ts");
    expect(mod.HeuristicManager).toBeDefined();
    expect(typeof mod.HeuristicManager).toBe("function");
  });
});
