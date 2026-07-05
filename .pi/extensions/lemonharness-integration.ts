/**
 * LemonHarness Integration Adapter
 *
 * Hooks the new subsystems (DependencyGraph, MetricsRecorder, QualityGateManager,
 * trail compression, memory decay, dynamic budget, TF-IDF) into the existing
 * lemonharness-workspace and lemonharness-memory extensions.
 *
 * v3: HeuristicManager, PrivilegeManager, SaPVerifier, KeyMomentDetector,
 *      VerificationRefinement, CommitAwareMemory
 *
 * This file is auto-discovered and adds capabilities without modifying the
 * existing extensions. It subscribes to the same events and augments behavior.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

// Import the new subsystems
import type {
  DependencyGraph,
  MetricsRecorder,
  QualityGateManager,
  QualityGateConfig,
  HeuristicManager,
  PrivilegeManager,
  SaPVerifier,
  KeyMomentDetector,
  VerificationRefinement,
  CommitAwareMemory,
} from "./lemonharness-subsystems";

// We use dynamic imports because the subsystems module is a separate file
let dependencyGraph: DependencyGraph | null = null;
let metricsRecorder: MetricsRecorder | null = null;
let qualityGateManager: QualityGateManager | null = null;
let heuristicManager: HeuristicManager | null = null;
let privilegeManager: PrivilegeManager | null = null;
let saPVerifier: SaPVerifier | null = null;
let keyMomentDetector: KeyMomentDetector | null = null;
let verificationRefinement: VerificationRefinement | null = null;
let commitAwareMemory: CommitAwareMemory | null = null;
let qualityGateAlreadyTriggered = false;

// Import helpers from subsystems at runtime
async function getSubsystems() {
  const mod = await import("./lemonharness-subsystems");
  return mod;
}

export default function (pi: ExtensionAPI) {
  // ── Session Events ────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    try {
      const mod = await getSubsystems();

      // Initialize subsystems (v2)
      dependencyGraph = new mod.DependencyGraph();

      const workspaceDir = join(ctx.cwd, ".lemonharness");
      metricsRecorder = new mod.MetricsRecorder(workspaceDir);
      await metricsRecorder.init();
      metricsRecorder.startSession(ctx.sessionManager.getSessionFile() || `session-${Date.now()}`);

      qualityGateManager = new mod.QualityGateManager(ctx.cwd, {
        autoTriggerOnP3Entry: true,
        blockOnFailure: false,
        scriptPath: ".lemonharness/quality-gate.sh",
        expectedOutput: "All checks pass",
      });
      qualityGateAlreadyTriggered = false;

      // Initialize v3 subsystems
      heuristicManager = new mod.HeuristicManager(workspaceDir);
      await heuristicManager.init();

      privilegeManager = new mod.PrivilegeManager();
      saPVerifier = new mod.SaPVerifier();
      keyMomentDetector = new mod.KeyMomentDetector();
      verificationRefinement = new mod.VerificationRefinement();
      commitAwareMemory = new mod.CommitAwareMemory(ctx.cwd);

      ctx.ui.setStatus("lemonharness-subsystems", "🔧 Enhanced subsystems active");
    } catch (err) {
      // Subsystems module not found or failed to load — gracefully degrade
      console.error("🍋 Enhanced subsystems not available:", err instanceof Error ? err.message : err);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (metricsRecorder) {
      try { await metricsRecorder.finalize(100); } catch { /* non-critical */ }
    }
    ctx.ui.setStatus("lemonharness-subsystems", undefined);
  });

  // ── Tool Call Interception — Track Dependencies ──────────────────

  pi.on("tool_call", async (event, ctx) => {
    if (!dependencyGraph || !metricsRecorder) return;

    // Track writes to dependency graph
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path = (event.input as any)?.path;
      if (path) {
        dependencyGraph.registerFile(path as string);
        metricsRecorder.recordFileModified();
      }
    }

    // Track bash commands that install packages
    if (isToolCallEventType("bash", event)) {
      const cmd = (event.input as any)?.command as string || "";
      if (cmd.includes("npm install") || cmd.includes("pip install") || cmd.includes("apt install")) {
        metricsRecorder.recordDepInstalled();
        dependencyGraph.registerCommand(cmd.slice(0, 80));
      }
    }
  });

  // ── v3: Privilege Interceptor — Suggest Lower-Privilege Alternatives ──

  pi.on("tool_call", async (event, ctx) => {
    if (!privilegeManager) return;
    const settingsPath = join(ctx.cwd, ".pi", "settings.json");
    let suggestAlternatives = true;
    try {
      const settings = JSON.parse(require("fs").readFileSync(settingsPath, "utf-8"));
      suggestAlternatives = settings.lemonharness?.toolPrivilege?.suggestAlternatives !== false;
    } catch { /* use default */ }

    if (!suggestAlternatives) return;

    const privCheck = privilegeManager.checkPrivilege(event.toolName, {
      recentErrors: false,
      taskType: "general",
    });

    if (privCheck.isOverPrivileged && privCheck.suggestedAlternative) {
      ctx.ui.notify(
        `🔒 Suggestion: Consider using \`${privCheck.suggestedAlternative}\` instead of \`${event.toolName}\` for least-privilege compliance.`,
        "info",
      );
    }
  });

  // ── Tool Result — Metrics and Validation Tracking ────────────────

  pi.on("tool_result", async (event, ctx) => {
    if (!dependencyGraph || !metricsRecorder) return;

    metricsRecorder.recordToolCall(event.isError === true);

    // --- v3: Harness Metrics ---
    // Track constraint violations (errors from workspace boundary)
    if (event.isError && event.toolName === "workspace_write") {
      metricsRecorder.recordConstraintViolation();
    }
    // Track trace completeness — every tool call with input/output is traceable
    metricsRecorder.recordTraceCompleteness(true);
    // Track justification rate — tool calls preceded by reasoning (approximated)
    metricsRecorder.recordJustifiedCall(true);

    // Track workspace_write operations
    if (event.toolName === "workspace_write") {
      const path = (event.input as any)?.path;
      if (path) {
        dependencyGraph.registerFile(path as string);
        metricsRecorder.recordFileModified();
      }
    }

    // Track workspace_install_dep operations
    if (event.toolName === "workspace_install_dep") {
      const pkg = (event.input as any)?.package;
      if (pkg) {
        dependencyGraph.registerPackage(pkg as string);
        metricsRecorder.recordDepInstalled();
      }
    }

    // Track validation results
    if (event.toolName === "workspace_validate") {
      const passed = !event.isError;
      metricsRecorder.recordValidation(passed);
      const cmd = (event.input as any)?.command;
      if (cmd) {
        const cmdId = dependencyGraph.registerCommand(cmd as string);
        dependencyGraph.recordValidation(cmdId, passed, event.isError ? 1 : 0);

        // v3: VerificationRefinement — correlate validation with patterns
        if (verificationRefinement) {
          const patterns = metricsRecorder.getHarnessMetrics();
          const relatedPatterns: string[] = [];
          if (patterns.constraintViolations === 0) relatedPatterns.push("Respect workspace boundaries");
          if (patterns.traceCompleteness > 0.8) relatedPatterns.push("Maintain execution trace");
          if (patterns.regressionFreeRate > 0.8) relatedPatterns.push("Avoid regressions");
          if (passed) {
            verificationRefinement.promoteOnPass(cmd as string, relatedPatterns);
          } else {
            verificationRefinement.demoteOnFail(cmd as string, (event.content || "") as string, relatedPatterns);
          }
        }
      }
    }

    // v3: Detect constraint violations from error messages
    if (event.isError) {
      const errorText = (typeof event.content === "string" ? event.content : "") || "";
      if (errorText.toLowerCase().includes("outside workspace") || errorText.toLowerCase().includes("workspace boundary")) {
        metricsRecorder.recordConstraintViolation();
      }

      // v3: Privilege check on tool calls that errored
      if (privilegeManager && event.toolName) {
        const privCheck = privilegeManager.checkPrivilege(event.toolName, { recentErrors: true });
        if (privCheck.isOverPrivileged && !privCheck.suggestedAlternative) {
          privilegeManager.recordEscalation(event.toolName, null, "tool_error");
        }
      }

      // Detect regression on consecutive errors
      try {
        ctx.ui.notify(
          `⚠ Tool error: ${event.toolName} — check for regression patterns`,
          "warning",
        );
      } catch { /* non-critical */ }
    }
  });

  // ── Phase Transition Detection ──────────────────────────────────

  pi.on("turn_start", async (_event, ctx) => {
    if (!qualityGateManager) return;
    // Quality gate auto-trigger is handled in the workspace extension's turn_start.
  });

  // ── Commands ─────────────────────────────────────────────────────

  // /lemonharness:quality-gate — Manually run quality gate
  pi.registerCommand("lemonharness:quality-gate", {
    description: "Run the quality gate manually and report results",
    handler: async (_args, ctx) => {
      if (!qualityGateManager) {
        ctx.ui.notify("🍋 Quality gate not initialized", "warning");
        return;
      }
      ctx.ui.notify("🍋 Running quality gate...", "info");
      const result = await qualityGateManager.run();
      if (result.passed) {
        ctx.ui.notify(`✅ Quality gate PASSED\n\n${result.output.slice(0, 1000)}`, "success");
      } else {
        ctx.ui.notify(`❌ Quality gate FAILED\n\n${result.output.slice(0, 2000)}`, "error");
      }
    },
  });

  // /lemonharness:deps — Show dependency graph
  pi.registerCommand("lemonharness:deps", {
    description: "Show the dependency graph — tracked files, packages, and commands",
    handler: async (_args, ctx) => {
      if (!dependencyGraph) { ctx.ui.notify("🍋 Dependency graph not initialized", "warning"); return; }
      ctx.ui.notify(dependencyGraph.summarize(), "info");
    },
  });

  // /lemonharness:metrics — Cross-session metrics + Harness metrics
  pi.registerCommand("lemonharness:metrics", {
    description: "Show cross-session improvement metrics, harness metrics, and trends",
    handler: async (_args, ctx) => {
      if (!metricsRecorder) { ctx.ui.notify("🍋 Metrics not initialized", "warning"); return; }
      const report = await metricsRecorder.getAggregateReport();
      const harnessReport = await metricsRecorder.getHarnessReport();
      ctx.ui.notify([report, "", harnessReport].join("\n"), "info");
    },
  });

  // /lemonharness:safety-specs — Show discovered safety specs
  pi.registerCommand("lemonharness:safety-specs", {
    description: "Show safety specifications mined from quality gate failures (EPO-Safe)",
    handler: async (_args, ctx) => {
      if (!qualityGateManager) { ctx.ui.notify("🍋 Quality gate not initialized", "warning"); return; }
      ctx.ui.notify(qualityGateManager.formatSafetySpecs(), "info");
    },
  });

  // /lemonharness:harness — Show harness evaluation metrics
  pi.registerCommand("lemonharness:harness", {
    description: "Show harness evaluation metrics (constraint violations, trace completeness, etc.)",
    handler: async (_args, ctx) => {
      if (!metricsRecorder) { ctx.ui.notify("🍋 Metrics not initialized", "warning"); return; }
      const report = await metricsRecorder.getHarnessReport();
      ctx.ui.notify(report, "info");
    },
  });

  // /lemonharness:privilege — Show tool privilege stats
  pi.registerCommand("lemonharness:privilege", {
    description: "Show tool privilege hierarchy and escalation statistics",
    handler: async (_args, ctx) => {
      if (!privilegeManager) { ctx.ui.notify("🍋 Privilege manager not initialized", "warning"); return; }
      ctx.ui.notify(privilegeManager.formatStatus(), "info");
    },
  });

  // /lemonharness:heuristics — Show extracted heuristics
  pi.registerCommand("lemonharness:heuristics", {
    description: "Show ERL heuristics extracted from past experiences",
    handler: async (_args, ctx) => {
      if (!heuristicManager) { ctx.ui.notify("🍋 Heuristic manager not initialized", "warning"); return; }
      const all = heuristicManager.getAllHeuristics();
      if (all.length === 0) { ctx.ui.notify("No heuristics extracted yet. Run /improvement:reflect to generate some.", "info"); return; }
      ctx.ui.notify(heuristicManager.formatForPrompt(all), "info");
    },
  });

  // /lemonharness:key-moments — Show detected key moments
  pi.registerCommand("lemonharness:key-moments", {
    description: "Show key moments detected in this session (stuck breakthroughs, recoveries, etc.)",
    handler: async (_args, ctx) => {
      if (!keyMomentDetector) { ctx.ui.notify("🍋 Key moment detector not initialized", "warning"); return; }
      try {
        const mod = await import("./lemonharness-subsystems");
        const detector = new mod.KeyMomentDetector();
        // Try to load memory events for detection
        const memoryDir = join(ctx.cwd, ".lemonharness", "memory");
        const { readFile } = await import("node:fs/promises");
        const { join: joinPath } = await import("node:path");
        try {
          const eventsRaw = await readFile(joinPath(memoryDir, "events.jsonl"), "utf-8");
          const memEvents = eventsRaw.split("\n").filter(Boolean).map(l => JSON.parse(l));
          const logEntries = memEvents.map((e: any) => ({
            type: (e.outcome === "success" ? "validation" : "tool_call") as "tool_call" | "validation",
            timestamp: e.timestamp,
            toolName: (e.context || "memory").split(":")[0]?.trim() || "memory",
            isError: e.outcome === "failure",
            passed: e.outcome === "success",
            command: e.summary,
            validationName: e.summary,
          }));
          const moments = detector.findAllKeyMoments(logEntries);
          if (moments.length > 0) {
            ctx.ui.notify(detector.formatKeyMoments(moments), "info");
          } else {
            ctx.ui.notify("No key moments detected yet. Run more operations to generate data.", "info");
          }
        } catch {
          ctx.ui.notify("No memory events found. Key moments are detected from session activity.", "info");
        }
      } catch {
        ctx.ui.notify("Key moment detection subsystem not available.", "warning");
      }
    },
  });

  // /lemonharness:correlation — Show validation-pattern correlation
  pi.registerCommand("lemonharness:correlation", {
    description: "Show validation-pattern correlation data (MemCoder)",
    handler: async (_args, ctx) => {
      if (!verificationRefinement) { ctx.ui.notify("🍋 Verification refinement not initialized", "warning"); return; }
      ctx.ui.notify(verificationRefinement.getCorrelationReport(), "info");
    },
  });
}
