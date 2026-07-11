import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

export function setupIntegrationCommands(
  pi: ExtensionAPI,
  ctx: { cwd: string },
  qualityGateManager: any,
  dependencyGraph: any,
  metricsRecorder: any,
  privilegeManager: any,
  heuristicManager: any,
  keyMomentDetector: any,
  verificationRefinement: any,
  validationAutoHealer: any,
) {
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
        ctx.ui.notify(`✅ Quality gate PASSED\n\n${result.output.slice(0, 1000)}`, "info");
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

  // /lemonharness:privilege — Show tool privilege stats + escalation chain history
  pi.registerCommand("lemonharness:privilege", {
    description: "Show tool privilege hierarchy, escalation chain history, and config suggestions",
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
        const mod = await import("./subsystems");
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

  // /lemonharness:heal — Manually trigger healing or show stats
  pi.registerCommand("lemonharness:heal", {
    description: "Show auto-healing stats or manually trigger healing for last failure. Usage: /lemonharness:heal [last|stats|reset]",
    handler: async (args, ctx) => {
      if (!validationAutoHealer) {
        ctx.ui.notify("🍋 Validation auto-healer not initialized", "warning");
        return;
      }

      const subcommand = args.trim().toLowerCase();

      if (subcommand === "stats") {
        // Show auto-healing statistics
        ctx.ui.notify(validationAutoHealer.getStats(), "info");
        return;
      }

      if (subcommand === "reset") {
        // Reset attempt counters
        validationAutoHealer.resetAllAttempts();
        ctx.ui.notify("🔄 Reset all auto-heal attempt counters. Next validation failure will start fresh.", "info");
        return;
      }

      if (subcommand === "list") {
        // Show all tracked failures
        ctx.ui.notify(validationAutoHealer.getFailuresSummary(), "info");
        return;
      }

      if (subcommand === "" || subcommand === "last") {
        // Show stats + attempt to heal last failure
        ctx.ui.notify(validationAutoHealer.getStats(), "info");

        const lastFailure = validationAutoHealer.getLastFailure();
        if (!lastFailure) {
          ctx.ui.notify("No unresolved validation failures to heal.", "info");
          return;
        }

        ctx.ui.notify(
          `Attempting to heal last failure: ${lastFailure.command.slice(0, 80)}...`,
          "info",
        );

        const result = await validationAutoHealer.healLastFailure();
        if (!result) {
          ctx.ui.notify("No failure to heal.", "info");
          return;
        }

        if (result.escalation) {
          ctx.ui.notify(
            `🚨 Escalation after ${result.attempt} attempts:\n\n${result.escalationReport}`,
            "error",
          );
        } else if (result.healed) {
          const retryMsg = result.retryCommand
            ? ` Re-run: \`${result.retryCommand}\``
            : "";
          ctx.ui.notify(
            `✅ Auto-healed! Fix applied: ${result.attemptedFix}.${retryMsg}`,
            "info",
          );
        } else if (result.attemptedFix) {
          const suggestion = result.topSuggestion
            ? `\nSuggestion: "${result.topSuggestion}"`
            : "";
          ctx.ui.notify(
            `⚠ Fix attempt failed: ${result.attemptedFix}.${suggestion}`,
            "warning",
          );
        } else {
          const suggestion = result.topSuggestion
            ? `From past experience: "${result.topSuggestion}"`
            : "No auto-fix available for this error pattern.";
          ctx.ui.notify(`🔍 ${suggestion}`, "info");
        }
        return;
      }

      // Unknown subcommand
      ctx.ui.notify(
        "Usage: /lemonharness:heal [last|stats|list|reset]\n\n" +
        "  last   — Attempt to heal the most recent validation failure (default)\n" +
        "  stats  — Show auto-healing statistics\n" +
        "  list   — List all tracked validation failures\n" +
        "  reset  — Reset auto-heal attempt counters",
        "info",
      );
    },
  });

  // Note: /review-loop is registered in integration.ts via setupIntegrationReviewLoop
}
