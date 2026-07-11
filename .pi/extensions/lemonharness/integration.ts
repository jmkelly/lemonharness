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
import { existsSync, readFileSync } from "node:fs";

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
} from "./subsystems";
import { ReviewLoopManager, ReviewTrailEntry, determineTermination, detectOscillation, buildImplementerTask, buildReviewerTask, parseReviewJson, computeSeverityStats } from "./review-loop";

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
let reviewLoopManager: ReviewLoopManager | null = null;

// ── Metrics Tracking State ───────────────────────────────────────
// Track last error timestamp for recovery efficiency calculation
let lastErrorTimestamp: number | null = null;
// Track which validation commands have passed before for regression detection
const passedValidations: Set<string> = new Set();

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
  const mod = await import("./subsystems");
  return mod;
}

export function setupIntegration(pi: ExtensionAPI) {
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
      try { await metricsRecorder.finalize(100); } catch { console.error("Integration: operation failed"); }
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
    } catch { console.error("Integration: using default after error"); }

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
    // Track trace completeness — only truly complete if tool returned with output
    // Error calls may have incomplete provenance (no output captured)
    metricsRecorder.recordTraceCompleteness(!event.isError);

    // Track justification rate — workspace tools are justified, raw tools less so
    const justified = event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash";
    metricsRecorder.recordJustifiedCall(justified);

    // Track recovery efficiency — time from error to successful operation
    if (event.isError) {
      lastErrorTimestamp = Date.now();
    } else if (!event.isError && lastErrorTimestamp !== null) {
      const recoveryTimeMs = Date.now() - lastErrorTimestamp;
      metricsRecorder.recordRecoveryTime(recoveryTimeMs);
      lastErrorTimestamp = null; // Reset after recording
    }


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

      // Track regression detection: if a command previously passed but now fails
      if (cmd) {
        if (passed) {
          passedValidations.add(cmd);
        } else if (passedValidations.has(cmd)) {
          // This command previously passed but now failed — it's a regression
          metricsRecorder.recordChange(true);
        } else {
          // Non-regression failure (first time failing or never passed)
          metricsRecorder.recordChange(false);
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
      } catch { console.error("Integration: using default after error"); }

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
      } catch { console.error("Integration: operation failed"); }
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

  // ── /review-loop — Implementer ↔ Reviewer Loop ─────────────────────────
  // Research basis: ERL (arXiv:2603.24639), ASH (arXiv:2605.14211),
  //   LemonHarness (arXiv:2606.24311)

  pi.registerCommand("review-loop", {
    description: "Run a relentless review loop: implementer + reviewer alternate until diminishing returns. Usage: /review-loop [spec-path] [max-cycles]",
    // argumentHint removed — RegisteredCommand type doesn't support it
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      let specPath = parts[0];
      const maxCycles = Math.min(parseInt(parts[1], 10) || 5, 10);

      // Auto-discover spec file when no argument is given
      if (!specPath) {
        const candidates = [
          ".lemonharness/review-loop/auto-spec.md",
          ".lemonharness/review-loop/spec.md",
          ".lemonharness/spec.md",
          "SPEC.md",
          "spec.md",
          "requirements.md",
          "README.md",
        ];
        for (const candidate of candidates) {
          const abs = resolve(ctx.cwd, candidate);
          if (existsSync(abs)) {
            specPath = candidate;
            ctx.ui.notify(`📄 No spec path given — auto-discovered: ${candidate}`, "info");
            break;
          }
        }
        if (!specPath) {
          ctx.ui.notify(
            "No spec path given and no spec found in default locations.\n\n" +
            "Provide a path: /review-loop <spec-path> [max-cycles]\n\n" +
            "Searched: " + candidates.join(", "),
            "error",
          );
          return;
        }
      }

      const absSpecPath = resolve(ctx.cwd, specPath);
      if (!existsSync(absSpecPath)) {
        ctx.ui.notify(`Spec file not found: ${specPath}`, "error");
        return;
      }

      let specContent: string;
      try {
        specContent = readFileSync(absSpecPath, "utf-8");
      } catch (err: any) {
        ctx.ui.notify(`Could not read spec file: ${err.message}`, "error");
        return;
      }

      // Initialize review loop manager
      reviewLoopManager = new ReviewLoopManager(ctx.cwd);
      await reviewLoopManager.init();

      ctx.ui.notify(
        `🍋 Review Loop started\n\n` +
        `Spec: ${specPath}\n` +
        `Max cycles: ${maxCycles}\n` +
        `Budget per cycle: ~180s (120s implementer + 60s reviewer)\n` +
        `Estimated total: ~${maxCycles * 3} minutes`,
        "info",
      );

      // ── Main Loop ────────────────────────────────────────────────
      let terminationReason: string = "max_cycles_reached";
      let previousReviewNotes = "";

      for (let cycle = 1; cycle <= maxCycles; cycle++) {
        const isFirstCycle = cycle === 1;

        ctx.ui.notify(`\n🔄 Review Loop — Cycle ${cycle} / ${maxCycles}`, "info");

        // ── Phase A: Implementer ──────────────────────────────────
        ctx.ui.notify(`  👷 Spawning implementer (Cycle ${cycle})...`, "info");

        const implementerTask = buildImplementerTask(
          specPath, specContent, cycle, previousReviewNotes, isFirstCycle,
        );

        let implementerSummary = "";
        let implementerOk = false;

        try {
          const implResult = await new Promise<any>((resolvePromise, rejectPromise) => {
            const child = spawn("node", [
              join(ctx.cwd, ".lemonharness", "delegate-runner.mjs"),
            ], {
              cwd: ctx.cwd,
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env, NODE_PATH: join(ctx.cwd, "node_modules") },
              timeout: 120_000,
            });

            let stdout = "", stderr = "";
            child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
            child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

            const input = JSON.stringify({
              task: implementerTask,
              cwd: ctx.cwd,
              budgetMs: 120_000,
              context: isFirstCycle ? "First implementation cycle. Build from spec." : `Review cycle ${cycle}. Fix issues from review.`,
            });

            child.stdin?.write(input);
            child.stdin?.end();

            child.on("close", (code) => {
              const lines = stdout.trim().split("\n").filter(Boolean);
              const lastLine = lines[lines.length - 1];
              let result: any = null;
              if (lastLine) {
                try { result = JSON.parse(lastLine); } catch { /* not JSON */ }
              }
              if (result?.type === "result") {
                resolvePromise(result);
              } else {
                resolvePromise({
                  success: code === 0,
                  summary: stdout.slice(-2000) || "Implementer completed (no structured output)",
                  files: [],
                  toolCalls: 0,
                });
              }
            });

            child.on("error", (err) => {
              rejectPromise(new Error(`Implementer spawn failed: ${err.message}`));
            });
          });

          implementerOk = implResult.success === true;
          implementerSummary = implResult.summary || "No summary available";

          ctx.ui.notify(
            `  ✅ Implementer ${implementerOk ? "completed" : "finished with issues"}: ${implementerSummary.slice(0, 200)}`,
            implementerOk ? "info" : "warning",
          );
        } catch (err: any) {
          implementerSummary = `Implementer failed: ${err.message}`;
          implementerOk = false;
          ctx.ui.notify(`  ❌ Implementer error: ${err.message}`, "error");

          if (reviewLoopManager) {
            const result = reviewLoopManager.buildResult("implementer_failed", maxCycles, specPath);
            ctx.ui.notify(`\n⏹ Review loop aborted (implementer failed). Final handoff: \`${result.finalHandoffPath}\``, "error");
          }
          return;
        }

        // ── Phase B: Reviewer ─────────────────────────────────────
        ctx.ui.notify(`  🔍 Spawning reviewer (Cycle ${cycle})...`, "info");

        const reviewerTask = buildReviewerTask(specPath, specContent, cycle);

        let reviewerSummary = "";
        let reviewerOk = false;
        let reviewerRawOutput = "";

        try {
          const revResult = await new Promise<any>((resolvePromise, rejectPromise) => {
            const child = spawn("node", [
              join(ctx.cwd, ".lemonharness", "delegate-runner.mjs"),
            ], {
              cwd: ctx.cwd,
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env, NODE_PATH: join(ctx.cwd, "node_modules") },
              timeout: 60_000,
            });

            let stdout = "", stderr = "";
            child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
            child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

            const input = JSON.stringify({
              task: reviewerTask,
              cwd: ctx.cwd,
              budgetMs: 60_000,
              context: `Review cycle ${cycle}. Advisory authority only — do not modify files.`,
              constraint: "Do NOT modify files, run install commands, or change state. Read and analyze only.",
            });

            child.stdin?.write(input);
            child.stdin?.end();

            child.on("close", (code) => {
              const lines = stdout.trim().split("\n").filter(Boolean);
              const lastLine = lines[lines.length - 1];
              let result: any = null;
              if (lastLine) {
                try { result = JSON.parse(lastLine); } catch { /* not JSON */ }
              }
              if (result?.type === "result") {
                resolvePromise(result);
              } else {
                resolvePromise({
                  success: code === 0,
                  summary: stdout.slice(-2000) || "Reviewer completed (no structured output)",
                  files: [],
                  toolCalls: 0,
                });
              }
            });

            child.on("error", (err) => {
              rejectPromise(new Error(`Reviewer spawn failed: ${err.message}`));
            });
          });

          reviewerOk = revResult.success === true;
          reviewerSummary = revResult.summary || "No summary available";
          reviewerRawOutput = reviewerSummary;

          ctx.ui.notify(
            `  ✅ Reviewer ${reviewerOk ? "completed" : "finished with issues"}`,
            reviewerOk ? "info" : "warning",
          );
        } catch (err: any) {
          reviewerSummary = `Reviewer failed: ${err.message}`;
          reviewerOk = false;
          ctx.ui.notify(`  ❌ Reviewer error: ${err.message}`, "error");

          if (reviewLoopManager) {
            const result = reviewLoopManager.buildResult("reviewer_failed", maxCycles, specPath);
            ctx.ui.notify(`\n⏹ Review loop aborted (reviewer failed). Final handoff: \`${result.finalHandoffPath}\``, "error");
          }
          return;
        }

        // ── Phase C: Process & Decide ─────────────────────────────

        if (!reviewLoopManager) {
          ctx.ui.notify("Review loop manager lost — aborting.", "error");
          return;
        }

        const { entry } = reviewLoopManager.processReview(cycle, reviewerRawOutput);

        const stats = computeSeverityStats(entry.review);
        const maxSev = stats.maxSeverity;
        const topThree = stats.topThreeAvg;
        const totalFindings = entry.review.findings.length;
        const highSev = entry.review.findings.filter(f => f.severity >= 7).length;

        ctx.ui.notify(
          `  📊 Review results — Max severity: ${maxSev}/10 | Top-3 avg: ${topThree.toFixed(1)} | ` +
          `${totalFindings} findings (${highSev} high/critical) | Parsed: ${entry.parsedOk ? "✅" : "⚠️ (fallback)"}`,
          maxSev >= 7 ? "warning" : "info",
        );

        // Check oscillation
        if (reviewLoopManager.isOscillating()) {
          ctx.ui.notify(
            `  ⚠️ Oscillation detected — severity alternating high-low-high. May indicate implementer introducing regressions.`,
            "warning",
          );
        }

        // Check termination
        const decision = determineTermination(reviewLoopManager.getTrail(), maxCycles);

        if (decision.shouldStop) {
          terminationReason = decision.reason;
          ctx.ui.notify(`\n⏹ Review loop terminating: ${terminationReason}`, "info");
          break;
        }

        // Extract heuristics for multi-cycle patterns
        if (cycle >= 2) {
          const prevCycles = reviewLoopManager.getTrail().slice(0, -1);
          const currentFindings = entry.review.findings.filter(f => f.severity >= 4);
          const prevCategories = new Set<string>();
          for (const prev of prevCycles) {
            for (const f of prev.review.findings) {
              if (f.severity >= 4) prevCategories.add(f.category);
            }
          }
          let heuristicCount = 0;
          for (const f of currentFindings) {
            if (prevCategories.has(f.category)) {
              reviewLoopManager.addHeuristic();
              heuristicCount++;
            }
          }
          if (heuristicCount > 0) {
            if (heuristicManager) {
              for (const f of currentFindings) {
                if (prevCategories.has(f.category)) {
                  heuristicManager.extractHeuristic(
                    "pattern",
                    `Review loop: ${f.category} issue persists across cycles`,
                    JSON.stringify({ severity: f.severity, description: f.description }),
                    f.category,
                  );
                }
              }
            }
            ctx.ui.notify(`  🧪 ${heuristicCount} ERL heuristics extracted from recurring patterns`, "info");
          }
        }

        // Prepare review notes for next cycle
        previousReviewNotes = reviewLoopManager.getReviewNotesForCycle(cycle + 1);

        ctx.ui.notify(`  ➡️ Continuing to cycle ${cycle + 1}...`, "info");
      }

      // ── Final Output ──────────────────────────────────────────────

      if (!reviewLoopManager) {
        ctx.ui.notify("Review loop manager lost — cannot produce final output.", "error");
        return;
      }

      const result = reviewLoopManager.buildResult(
        terminationReason as any, maxCycles, specPath,
      );

      const trail = reviewLoopManager.getTrail();
      const sevTrend = trail.map(t => `${t.cycle}: ${t.maxSeverity}`).join(" → ");

      const summaryLines = [
        "",
        "═══════════════════════════════════",
        "🍋 Review Loop — Complete",
        "═══════════════════════════════════",
        "",
        `Cycles: ${result.cyclesCompleted} / ${maxCycles}`,
        `Termination: ${result.terminationReason}`,
        `Severity trend: ${sevTrend}`,
        `Heuristics: ${result.heuristicsExtracted}`,
        "",
        `📝 Final handoff: \`${result.finalHandoffPath}\``,
        `📊 Trend data: \`.lemonharness/review-loop/trend.json\``,
        `📂 Review trail: \`.lemonharness/review-loop/cycle-*/\``,
        "",
        "Run `/lemonharness:heuristics` to view extracted heuristics.",
        "Run `/lemonharness:key-moments` to detect breakthrough cycles.",
      ];

      ctx.ui.notify(summaryLines.join("\n"), "info");
    },
  });
}
