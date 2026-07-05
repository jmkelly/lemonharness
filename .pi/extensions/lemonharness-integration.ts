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
import { Type } from "typebox";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

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
  ValidationAutoHealer,
  AutoHealResult,
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
let validationAutoHealer: ValidationAutoHealer | null = null;

// ── Delegate Tracking ─────────────────────────────────────────────

interface DelegateRecord {
  id: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "timed_out";
  startedAt: number;
  completedAt?: number;
  budgetMs: number;
  scope?: string;
  summary?: string;
  files?: string[];
  toolCalls?: number;
  error?: string;
}

const delegates: Map<string, DelegateRecord> = new Map();
let delegateCounter = 0;

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

      // Initialize ValidationAutoHealer with connection to HeuristicManager for ERL lookups
      validationAutoHealer = new mod.ValidationAutoHealer(ctx.cwd, workspaceDir);
      if (heuristicManager) {
        validationAutoHealer.setHeuristicManager(heuristicManager);
      }

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

        // ── Self-Healing Validation Loop ────────────────────────────
        // Auto-triage validation failures: attempt fixes, re-run, escalate
        if (!passed && validationAutoHealer) {
          const errorOutput = (typeof event.content === "string" ? event.content : "") || "";

          // Attempt auto-heal asynchronously (don't block the event loop)
          const healResult = await validationAutoHealer.autoHeal(cmd as string, errorOutput);

          if (healResult.escalation) {
            // After 3 failed attempts, present structured escalation report
            ctx.ui.notify(
              `🚨 Validation escalation after ${healResult.attempt} attempts:\n\n${healResult.escalationReport}`,
              "error",
            );
          } else if (healResult.healed && healResult.retryCommand) {
            // Fix applied successfully — suggest re-running validation
            ctx.ui.notify(
              `✅ Auto-healed validation: ${healResult.attemptedFix}\nRe-run validation to confirm.`,
              "success",
            );
          } else if (healResult.attemptedFix) {
            // Fix attempted but failed — inform user
            const suggestion = healResult.topSuggestion
              ? `\n\nSuggestion from past experience: "${healResult.topSuggestion}"`
              : "";
            ctx.ui.notify(
              `⚠ Auto-heal attempt failed: ${healResult.attemptedFix}${suggestion}`,
              "warning",
            );
          } else {
            // No auto-fix available — present heuristic suggestion if available
            if (healResult.topSuggestion) {
              ctx.ui.notify(
                `🔍 Validation failed. From past experience: "${healResult.topSuggestion}"`,
                "info",
              );
            }
          }
        }
      }
    }

    // ── v3: Escalation Ladder — Track escalation result ────────────
    // Record whether this tool call (if it was a suggested alternative) succeeded or failed
    if (privilegeManager && event.toolName) {
      privilegeManager.recordEscalationResult(event.toolName, !event.isError, "tool_result");
    }

    // ── v3: Escalation Ladder — Auto-retry on failure ─────────────
    if (event.isError && privilegeManager && event.toolName) {
      // Read escalationAutoRetry setting
      let autoRetry = true;
      try {
        const { readFileSync } = require("fs");
        const settings = JSON.parse(readFileSync(join(ctx.cwd, ".pi", "settings.json"), "utf-8"));
        autoRetry = settings.lemonharness?.escalationAutoRetry !== false;
      } catch { /* use default */ }

      if (autoRetry) {
        const escalationResult = privilegeManager.attemptEscalation(event.toolName, "tool_error");

        if (escalationResult.alternativeTool) {
          ctx.ui.notify(
            `🔒 Escalation ladder: \`${event.toolName}\` failed → try \`${escalationResult.alternativeTool}\``,
            "info",
          );
        }

        if (escalationResult.shouldSuggestConfig) {
          ctx.ui.notify(
            `⚙️ Tool "${event.toolName}" has been escalated ${privilegeManager.getChainCount(event.toolName)} times. Consider adjusting privilege settings in .pi/settings.json.`,
            "warning",
          );
        }
      }

      // v3: Detect constraint violations from error messages
      const errorText = (typeof event.content === "string" ? event.content : "") || "";
      if (errorText.toLowerCase().includes("outside workspace") || errorText.toLowerCase().includes("workspace boundary")) {
        metricsRecorder.recordConstraintViolation();
      }

      // v3: Legacy privilege check on tool calls that errored
      if (privilegeManager) {
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
    } else if (!event.isError && privilegeManager && event.toolName) {
      // Non-error: still check for constraint violations in content
      const content = (typeof event.content === "string" ? event.content : "") || "";
      if (content.toLowerCase().includes("outside workspace") || content.toLowerCase().includes("workspace boundary")) {
        if (metricsRecorder) metricsRecorder.recordConstraintViolation();
      }
    }
  });

  // ── Phase Transition Detection ──────────────────────────────────

  pi.on("turn_start", async (_event, ctx) => {
    if (!qualityGateManager) return;
    // Quality gate auto-trigger is handled in the workspace extension's turn_start.
  });

  // ── Delegation: workspace_delegate tool ──────────────────────────

  const PI_GLOBAL_PATH = "/home/james/.nvm/versions/node/v22.18.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
  const DELEGATE_RUNNER = ".lemonharness/delegate-runner.mjs";

  /**
   * workspace_delegate — Spawn a sub-agent to work on a bounded sub-task.
   *
   * Research basis: arXiv:2605.23023 — Human-LLM collaborative planning
   * Extended for multi-agent task decomposition with bounded authority.
   */
  pi.registerTool({
    name: "workspace_delegate",
    label: "Delegate Task",
    description: "Delegate a bounded sub-task to a sub-agent with its own budget and scope. " +
      "The sub-agent runs independently, reads files, makes changes, and reports back. " +
      "Use for parallelizable work, independent sub-tasks, or exploring alternative approaches.",
    promptSnippet: "Delegate a bounded sub-task to an independent sub-agent",
    promptGuidelines: [
      "Use workspace_delegate for work that can be done independently by a sub-agent with limited budget.",
      "Be specific in the task description — include file paths, expected outcomes, and constraints.",
      "The sub-agent has read, bash, write, and edit tools. It cannot install dependencies or access the network.",
      "Check results with /lemonharness:delegates after spawning sub-agents.",
      "Use context parameter to pass relevant information the sub-agent needs.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "What the sub-agent should accomplish — be specific and include file paths" }),
      budget_seconds: Type.Optional(Type.Number({ description: "Max execution time in seconds (default: 120, max: 600)" })),
      context: Type.Optional(Type.String({ description: "Additional context, reference info, or prior work for the sub-agent" })),
      scope: Type.Optional(Type.String({ description: "Subdirectory to constrain the sub-agent's work to (e.g., '.pi/extensions/')" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const id = `delegate-${++delegateCounter}-${Date.now().toString(36)}`;
      const task = params.task;
      const budgetMs = Math.min((params.budget_seconds || 120) * 1000, 600_000);
      const context = params.context || "";
      const scope = params.scope || "";

      // Create delegate workspace
      const delegateDir = join(ctx.cwd, ".lemonharness", "delegates", id);
      await mkdir(delegateDir, { recursive: true });

      // Register delegate
      const record: DelegateRecord = {
        id, task, status: "running",
        startedAt: Date.now(),
        budgetMs, scope,
      };
      delegates.set(id, record);

      // Build input for delegate runner
      const input = JSON.stringify({
        task,
        cwd: ctx.cwd,
        budgetMs,
        context,
        constraint: scope ? `All work must be within the '${scope}' directory.` : "",
        outputDir: join(".lemonharness", "delegates", id),
      });

      // Spawn delegate runner as child process
      const runnerPath = join(ctx.cwd, DELEGATE_RUNNER);
      if (!existsSync(runnerPath)) {
        delegates.set(id, { ...record, status: "failed", error: "Delegate runner not found" });
        return {
          content: [{ type: "text" as const, text: `Error: Delegate runner not found at ${DELEGATE_RUNNER}` }],
          isError: true, details: {},
        };
      }

      // Run in background — spawn without awaiting
      const child = spawn("node", [runnerPath], {
        cwd: ctx.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NODE_PATH: join(ctx.cwd, "node_modules") },
      });

      let stdout = "";
      let stderr = "";
      let resultEmitted = false;

      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      child.stdin?.write(input);
      child.stdin?.end();

      // Wait for completion
      const exitPromise = new Promise<void>((resolvePromise) => {
        child.on("close", (code) => {
          // Parse result from stdout (last JSON line)
          const lines = stdout.trim().split("\n").filter(Boolean);
          const lastLine = lines[lines.length - 1];
          let result: any = null;
          if (lastLine) {
            try { result = JSON.parse(lastLine); } catch { /* not JSON */ }
          }

          if (result?.type === "result") {
            const status = result.success ? "completed" : "failed";
            record.status = status;
            record.completedAt = Date.now();
            record.summary = result.summary?.slice(0, 500);
            record.files = result.files || [];
            record.toolCalls = result.toolCalls || 0;
            resultEmitted = true;
          } else {
            record.status = code === 0 ? "completed" : "failed";
            record.completedAt = Date.now();
            record.summary = stdout.slice(0, 500);
            if (code !== 0) record.error = stderr.slice(0, 300);
          }

          resolvePromise();
        });

        // Timeout safety
        setTimeout(() => {
          if (!resultEmitted) {
            child.kill("SIGTERM");
            record.status = "timed_out";
            record.completedAt = Date.now();
            record.summary = stdout.slice(0, 500);
            resolvePromise();
          }
        }, budgetMs + 10_000); // 10s grace for cleanup
      });

      await exitPromise;

      // Return results
      const summary = record.summary || "Delegate completed";
      const filesList = record.files?.length
        ? `\n\nFiles modified: ${record.files.join(", ")}`
        : "";
      const toolInfo = record.toolCalls ? `\nTool calls: ${record.toolCalls}` : "";
      const errorInfo = record.error ? `\nError: ${record.error}` : "";

      const text = record.status === "completed"
        ? `✅ Delegate [${id}] completed\n\n${summary.slice(0, 3000)}${filesList}${toolInfo}`
        : `❌ Delegate [${id}] ${record.status}: ${record.error || "Unknown error"}\n\nPartial output: ${summary.slice(0, 1000)}`;

      return {
        content: [{ type: "text" as const, text }],
        details: { delegateId: id, status: record.status, summary: summary.slice(0, 500) },
        isError: record.status !== "completed",
      };
    },
  });

  // ── Commands ─────────────────────────────────────────────────────

  // /lemonharness:delegates — Show delegate status
  pi.registerCommand("lemonharness:delegates", {
    description: "Show status of all spawned delegates (sub-agents)",
    handler: async (_args, ctx) => {
      const all = [...delegates.values()];
      if (all.length === 0) {
        ctx.ui.notify("No delegates have been spawned this session.", "info");
        return;
      }
      const lines = [
        "🤖 Delegate Summary",
        "───────────────────",
        ...all.map(d => {
          const statusIcon =
            d.status === "completed" ? "✅" :
            d.status === "failed" ? "❌" :
            d.status === "timed_out" ? "⏰" :
            "🔄";
          const time = d.completedAt
            ? `${((d.completedAt - d.startedAt) / 1000).toFixed(0)}s`
            : "running...";
          return `  ${statusIcon} ${d.id}: ${d.task.slice(0, 60)} [${time}, ${d.status}]`;
        }),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // /lemonharness:delegate <id> — Show detailed delegate result
  pi.registerCommand("lemonharness:delegate", {
    description: "Show detailed result of a specific delegate. Usage: /lemonharness:delegate <id>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) { ctx.ui.notify("Usage: /lemonharness:delegate <id>", "error"); return; }
      const d = delegates.get(id);
      if (!d) { ctx.ui.notify(`Delegate "${id}" not found.`, "error"); return; }
      const lines = [
        `🤖 Delegate: ${d.id}`,
        `  Task: ${d.task}`,
        `  Status: ${d.status}`,
        `  Budget: ${(d.budgetMs / 1000).toFixed(0)}s`,
        `  Duration: ${d.completedAt ? ((d.completedAt - d.startedAt) / 1000).toFixed(0) + "s" : "running..."}`,
        `  Scope: ${d.scope || "(none)"}`,
      ];
      if (d.summary) lines.push(`  Summary: ${d.summary.slice(0, 1000)}`);
      if (d.files?.length) lines.push(`  Files: ${d.files.join(", ")}`);
      if (d.error) lines.push(`  Error: ${d.error}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });  // ── Commands ─────────────────────────────────────────────────────

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
            "success",
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
}
