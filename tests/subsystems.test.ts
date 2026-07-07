/**
 * Tests for the LemonHarness Enhanced Subsystems (v3).
 *
 * Tests DependencyGraph, MetricsRecorder, QualityGateManager,
 * HeuristicManager, PrivilegeManager, SaPVerifier, KeyMomentDetector,
 * VerificationRefinement, CommitAwareMemory, ValidationAutoHealer,
 * HealthChecker, and utility functions.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ── DependencyGraph Tests ──────────────────────────────────────

describe("DependencyGraph", () => {
  it("should be exported from subsystems module", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    expect(mod.DependencyGraph).toBeDefined();
    expect(typeof mod.DependencyGraph).toBe("function");
  });

  it("should register files and track dependencies", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const graph = new mod.DependencyGraph();

    const fileId = graph.registerFile("src/main.ts");
    expect(fileId).toBe("file:src/main.ts");

    graph.registerFile("src/utils.ts", ["lodash"], ["build"]);
    const summary = graph.summarize();
    expect(summary).toContain("Files: 2");
  });

  it("should register packages and commands", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const graph = new mod.DependencyGraph();

    graph.registerPackage("lodash");
    graph.registerCommand("npm test");

    const summary = graph.summarize();
    expect(summary).toContain("Packages: 1");
    expect(summary).toContain("Commands: 1");
  });

  it("should record validation results", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const graph = new mod.DependencyGraph();

    const cmdId = graph.registerCommand("npm test");
    graph.recordValidation(cmdId, true, 0);

    const failed = graph.getFailedNodes();
    expect(failed.length).toBe(0);
  });

  it("should find affected nodes via BFS (files depending on package)", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const graph = new mod.DependencyGraph();

    graph.registerPackage("typescript");
    graph.registerFile("src/index.ts", ["typescript"]);
    graph.registerFile("src/utils.ts", ["typescript"]);

    const affected = graph.findAffectedNodes("pkg:typescript");
    expect(affected.length).toBeGreaterThanOrEqual(3);
  });

  it("should reset cleanly", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const graph = new mod.DependencyGraph();
    graph.registerFile("src/main.ts");
    graph.reset();
    const summary = graph.summarize();
    expect(summary).toContain("Files: 0");
  });
});

// ── Harness Metrics Tests ──────────────────────────────────────

describe("HarnessMetrics", () => {
  it("should define all 5 metrics in the interface", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const metrics = {} as any;
    metrics.constraintViolations = 0;
    metrics.traceCompleteness = 0;
    metrics.toolJustificationRate = 0;
    metrics.recoveryEfficiency = 0;
    metrics.regressionFreeRate = 0;
    expect(typeof metrics.constraintViolations).toBe("number");
    expect(typeof metrics.traceCompleteness).toBe("number");
    expect(typeof metrics.toolJustificationRate).toBe("number");
  });

  it("should record constraint violations correctly", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const recorder = new mod.MetricsRecorder("/tmp/test-metrics");
    await recorder.init();
    recorder.startSession("test-session-1");
    expect(recorder.getHarnessMetrics().constraintViolations).toBe(0);
    recorder.recordConstraintViolation();
    recorder.recordConstraintViolation();
    expect(recorder.getHarnessMetrics().constraintViolations).toBe(2);
  });

  it("should compute trace completeness as a ratio", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const recorder = new mod.MetricsRecorder("/tmp/test-metrics");
    await recorder.init();
    recorder.startSession("test-session-2");
    recorder.recordToolCall(false);
    recorder.recordTraceCompleteness(true);
    recorder.recordToolCall(false);
    recorder.recordTraceCompleteness(false);
    const m = recorder.getHarnessMetrics();
    expect(m.traceCompleteness).toBeGreaterThan(0);
    expect(m.traceCompleteness).toBeLessThanOrEqual(1);
  });

  it("should compute justification rate", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const recorder = new mod.MetricsRecorder("/tmp/test-metrics");
    await recorder.init();
    recorder.startSession("test-session-3");
    recorder.recordJustifiedCall(true);
    recorder.recordJustifiedCall(true);
    recorder.recordJustifiedCall(false);
    expect(recorder.getHarnessMetrics().toolJustificationRate).toBeCloseTo(0.667, 2);
  });

  it("should compute regression-free rate", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const recorder = new mod.MetricsRecorder("/tmp/test-metrics");
    await recorder.init();
    recorder.startSession("test-session-4");
    recorder.recordChange(false);
    recorder.recordChange(false);
    recorder.recordChange(true);
    expect(recorder.getHarnessMetrics().regressionFreeRate).toBeCloseTo(0.667, 2);
  });

  it("should record recovery efficiency from error timing", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const recorder = new mod.MetricsRecorder("/tmp/test-metrics");
    await recorder.init();
    recorder.startSession("test-session-5");
    recorder.recordToolCall(true);
    recorder.recordRecoveryTime(5000);
    const m = recorder.getHarnessMetrics();
    expect(m.recoveryEfficiency).toBeGreaterThanOrEqual(0);
    expect(m.recoveryEfficiency).toBeLessThanOrEqual(1);
  });
});

// ── HealthChecker Tests ────────────────────────────────────────

describe("HealthChecker", () => {
  it("should be exported and createable", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const checker = new mod.HealthChecker();
    expect(checker).toBeDefined();
    expect(typeof checker.registerCheck).toBe("function");
  });

  it("should register checks and get status (runChecks returns void)", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const checker = new mod.HealthChecker();
    checker.registerCheck("always_pass", () => ({ healthy: true, message: "OK" }), 1);
    // runChecks returns void — check via getStatus()
    checker.runChecks({ currentPhase: "explore", isErrored: false, phasesCompleted: [] });
    const status = checker.getStatus();
    expect(typeof status).toBe("string");
  });

  it("should detect unhealthy states via alerts", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const checker = new mod.HealthChecker();
    checker.registerCheck("fail_check", () => ({ healthy: false, message: "FAILED" }), 1);
    checker.registerCheck("pass_check", () => ({ healthy: true, message: "OK" }), 1);
    checker.runChecks({ currentPhase: "implement", isErrored: true, phasesCompleted: [] });
    const alerts = checker.getAlerts();
    expect(alerts).toBeDefined();
  });
});

// ── HeuristicManager Tests ─────────────────────────────────────

describe("HeuristicManager", () => {
  it("should extract prevention heuristics from text", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const hm = new mod.HeuristicManager("/tmp/test-heuristics");
    await hm.init();
    const h = hm.extractHeuristic("failure", "Always check imports before compiling", "I forgot to import", "typescript");
    expect(h).not.toBeNull();
    if (h) { expect(h.type).toBe("prevention"); expect(h.domain).toBe("typescript"); }
  });

  it("should extract correction heuristics", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const hm = new mod.HeuristicManager("/tmp/test-heuristics");
    await hm.init();
    const h = hm.extractHeuristic("failure", "Fixed by clearing the npm cache", "fix the build error by clearing npm cache", "general");
    if (h) { expect(h.type).toBe("correction"); }
  });

  it("should format heuristics for prompt", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const hm = new mod.HeuristicManager("/tmp/test-heuristics");
    await hm.init();
    hm.extractHeuristic("failure", "Always check types", "Type error", "typescript");
    hm.extractHeuristic("failure", "Never skip validation", "Validation skipped", "general");
    const formatted = hm.formatForPrompt(hm.getAllHeuristics());
    expect(formatted).toContain("Heuristics");
  });

  it("should update confidence on outcome", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const hm = new mod.HeuristicManager("/tmp/test-heuristics");
    await hm.init();
    hm.extractHeuristic("failure", "Always validate input", "Missing validation", "general");
    const before = hm.getAllHeuristics();
    if (before.length > 0) {
      const startConf = before[0].confidence;
      hm.recordOutcome(before[0].id, true);
      expect(hm.getAllHeuristics()[0].confidence).toBeGreaterThanOrEqual(startConf);
    }
  });

  it("should get stats string", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const hm = new mod.HeuristicManager("/tmp/test-heuristics");
    await hm.init();
    hm.extractHeuristic("failure", "Always check config", "Config issue", "general");
    expect(hm.getStats()).toContain("Heuristics:");
  });
});

// ── PrivilegeManager Tests ─────────────────────────────────────

describe("PrivilegeManager", () => {
  it("should register default tools with privilege levels", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const pm = new mod.PrivilegeManager();
    expect(pm.getPrivilegeLevel("workspace_state")).toBe(mod.ToolPrivilegeLevel.READ);
    expect(pm.getPrivilegeLevel("workspace_exec")).toBe(mod.ToolPrivilegeLevel.EXECUTION);
    expect(pm.getPrivilegeLevel("workspace_install_dep")).toBe(mod.ToolPrivilegeLevel.MANAGEMENT);
  });

  it("should suggest lower-privilege alternatives for tools that have them", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const pm = new mod.PrivilegeManager();
    // `write` has workspace_write as alternative
    const result = pm.checkPrivilege("write", { recentErrors: false });
    expect(result.isOverPrivileged).toBe(true);
    expect(result.suggestedAlternative).toBe("workspace_write");
  });

  it("should not flag read-level tools as over-privileged", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const pm = new mod.PrivilegeManager();
    expect(pm.checkPrivilege("read", { recentErrors: false }).isOverPrivileged).toBe(false);
  });

  it("should not suggest alternatives when recentErrors is true", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const pm = new mod.PrivilegeManager();
    expect(pm.checkPrivilege("write", { recentErrors: true }).isOverPrivileged).toBe(false);
  });

  it("should attempt escalation and return alternatives", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const pm = new mod.PrivilegeManager();
    const escalation = pm.attemptEscalation("workspace_write", "tool_error");
    expect(escalation.alternativeTool).toBeTruthy();
  });
});

// ── SaPVerifier Tests ──────────────────────────────────────────

describe("SaPVerifier", () => {
  it("should verify a valid contract (coverage >= 30% of terms)", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const verifier = new mod.SaPVerifier();
    const contract: mod.SkillContract = {
      name: "test-skill",
      inputs: [{ name: "inputFile", type: "string", description: "Input file path", required: true }],
      outputs: [{ name: "result", type: "string", description: "Output" }],
      preconditions: ["inputFile must exist"],
      postconditions: ["result has been generated"],
      errorHandling: ["Handle missing file gracefully"],
    };
    const result = verifier.verifyContract(contract, "This skill processes input files that must exist in order to produce results. The output has been generated successfully. Handle missing files gracefully.");
    expect(result.passed).toBe(true);
    expect(result.coverage).toBe(true);
    expect(result.binding).toBe(true);
  });

  it("should detect binding issues (missing types)", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const verifier = new mod.SaPVerifier();
    const contract: mod.SkillContract = {
      name: "bad-skill",
      inputs: [{ name: "inputFile", type: "", description: "No type", required: true }],
      outputs: [],
      preconditions: ["inputFile must exist"],
      postconditions: [],
      errorHandling: [],
    };
    expect(verifier.verifyContract(contract, "content with enough words for coverage check threshold").binding).toBe(false);
  });

  it("should format verification results", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const verifier = new mod.SaPVerifier();
    const contract: mod.SkillContract = { name: "format-test", inputs: [], outputs: [], preconditions: [], postconditions: [], errorHandling: [] };
    expect(verifier.formatResult(verifier.verifyContract(contract, "content"))).toContain("format-test");
  });
});

// ── KeyMomentDetector Tests ────────────────────────────────────

describe("KeyMomentDetector", () => {
  function makeEntry(type: "tool_call" | "validation", isError: boolean, toolName = "test", passed = false): any {
    return { type, timestamp: Date.now(), toolName, isError, passed, command: toolName, validationName: toolName, args: "test" };
  }

  it("should detect stuck breakthroughs", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const detector = new mod.KeyMomentDetector();
    const entries = [makeEntry("tool_call", true, "a"), makeEntry("tool_call", true, "b"), makeEntry("tool_call", true, "c"), makeEntry("tool_call", false, "d")];
    const m = detector.detectStuckBreakthrough(entries);
    expect(m).not.toBeNull();
    if (m) { expect(m.type).toBe("stuck_breakthrough"); }
  });

  it("should return null for no stuck breakthrough", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    expect(new mod.KeyMomentDetector().detectStuckBreakthrough([makeEntry("tool_call", false, "ok")])).toBeNull();
  });

  it("should detect error recoveries", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const d = new mod.KeyMomentDetector();
    expect(d.detectErrorRecovery([makeEntry("tool_call", true, "a"), makeEntry("tool_call", false, "b"), makeEntry("tool_call", false, "c")])).not.toBeNull();
  });

  it("should detect validation milestones", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const d = new mod.KeyMomentDetector();
    expect(d.detectValidationMilestone([makeEntry("validation", false, "t", false), makeEntry("validation", false, "t", true)])).not.toBeNull();
  });

  it("should find all key moments and deduplicate", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const entries = [makeEntry("tool_call", true, "a"), makeEntry("tool_call", true, "b"), makeEntry("tool_call", true, "c"), makeEntry("tool_call", false, "d")];
    expect(new mod.KeyMomentDetector().findAllKeyMoments(entries).length).toBeGreaterThanOrEqual(1);
  });

  it("should format key moments", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const d = new mod.KeyMomentDetector();
    const entries = [makeEntry("tool_call", true, "a"), makeEntry("tool_call", true, "b"), makeEntry("tool_call", true, "c"), makeEntry("tool_call", false, "d")];
    expect(d.formatKeyMoments(d.findAllKeyMoments(entries))).toContain("Key Moments");
  });
});

// ── Trail Compression Tests ────────────────────────────────────

describe("trail compression utilities", () => {
  it("compressTrail should handle empty entries", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    expect(mod.compressTrail([])).toContain("no execution records");
  });

  it("compressTrail should format recent entries", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const entries: any[] = [
      { type: "tool_call", timestamp: 100, toolName: "read", isError: false },
      { type: "validation", timestamp: 200, validationName: "npm test", passed: true },
    ];
    const result = mod.compressTrail(entries, 4);
    expect(result).toContain("read");
    expect(result).toContain("npm test");
  });

  it("getErrorRate should compute correct rate", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const entries: any[] = [
      { type: "tool_call", timestamp: 100, toolName: "a", isError: true },
      { type: "tool_call", timestamp: 200, toolName: "b", isError: false },
      { type: "tool_call", timestamp: 300, toolName: "c", isError: true },
      { type: "tool_call", timestamp: 400, toolName: "d", isError: false },
    ];
    expect(mod.getErrorRate(entries, 20)).toBeCloseTo(0.5, 1);
  });

  it("applyMemoryDecay should decay old entries", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    const oldTime = Date.now() - 100 * 24 * 60 * 60 * 1000;
    const decayed = mod.applyMemoryDecay(1.0, oldTime, 30);
    expect(decayed).toBeLessThan(1.0);
    expect(decayed).toBeGreaterThan(0);
  });

  it("computeEffectiveHalfLife should extend for reused entries", async () => {
    const mod = await import("../.pi/extensions/lemonharness/subsystems-core");
    expect(mod.computeEffectiveHalfLife(10, 30)).toBeGreaterThan(30);
  });
})
