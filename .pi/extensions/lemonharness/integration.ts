/**
 * LemonHarness Integration Adapter
 *
 * Hooks subsystems into workspace and memory extensions.
 * Split into sub-modules for file size compliance.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { existsSync } from "node:fs";

import { setupIntegrationReviewLoop } from "./integration-review-loop";

import type {
  DependencyGraph, MetricsRecorder, QualityGateManager,
  HeuristicManager, PrivilegeManager, SaPVerifier,
  KeyMomentDetector, VerificationRefinement, CommitAwareMemory,
  ValidationAutoHealer,
} from "./subsystems";

// ── Subsystem Instances ───────────────────────────────────────────
let dependencyGraph: DependencyGraph | null = null;
let metricsRecorder: MetricsRecorder | null = null;
let qualityGateManager: QualityGateManager | null = null;
let heuristicManager: HeuristicManager | null = null;
let privilegeManager: PrivilegeManager | null = null;
let saPVerifier: SaPVerifier | null = null;
let keyMomentDetector: KeyMomentDetector | null = null;
let verificationRefinement: VerificationRefinement | null = null;
let commitAwareMemory: CommitAwareMemory | null = null;
let validationAutoHealer: ValidationAutoHealer | null = null;
let qualityGateAlreadyTriggered = false;
let lastErrorTimestamp: number | null = null;
const passedValidations: Set<string> = new Set();

import { DelegateRecord, setupIntegrationDelegation } from "./integration-delegation";
const delegates: Map<string, DelegateRecord> = new Map();
const delegateCounter = { value: 0 };

async function getSubsystems() {
  return import("./subsystems");
}

export function setupIntegration(pi: ExtensionAPI) {
  // ── Event Handlers ────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    try {
      const mod = await getSubsystems();
      dependencyGraph = new mod.DependencyGraph();
      const wsDir = join(ctx.cwd, ".lemonharness");
      metricsRecorder = new mod.MetricsRecorder(wsDir);
      await metricsRecorder.init();
      metricsRecorder.startSession(ctx.sessionManager.getSessionFile() || `session-${Date.now()}`);
      qualityGateManager = new mod.QualityGateManager(ctx.cwd, {
        autoTriggerOnP3Entry: true, blockOnFailure: false,
        scriptPath: ".lemonharness/quality-gate.sh", expectedOutput: "All checks pass",
      });
      qualityGateAlreadyTriggered = false;
      heuristicManager = new mod.HeuristicManager(wsDir);
      await heuristicManager.init();
      validationAutoHealer = new mod.ValidationAutoHealer(ctx.cwd, wsDir);
      if (heuristicManager) validationAutoHealer.setHeuristicManager(heuristicManager);
      privilegeManager = new mod.PrivilegeManager();
      saPVerifier = new mod.SaPVerifier();
      keyMomentDetector = new mod.KeyMomentDetector();
      verificationRefinement = new mod.VerificationRefinement();
      commitAwareMemory = new mod.CommitAwareMemory(ctx.cwd);
      ctx.ui.setStatus("lemonharness-subsystems", "🔧 Enhanced subsystems active");
    } catch (err) {
      console.error("🍋 Enhanced subsystems not available:", err instanceof Error ? err.message : err);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (metricsRecorder) {
      try { await metricsRecorder.finalize(100); } catch { console.error("Integration: operation failed"); }
    }
    ctx.ui.setStatus("lemonharness-subsystems", undefined);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!dependencyGraph || !metricsRecorder) return;
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path = (event.input as any)?.path;
      if (path) { dependencyGraph.registerFile(path as string); metricsRecorder.recordFileModified(); }
    }
    if (isToolCallEventType("bash", event)) {
      const cmd = (event.input as any)?.command as string || "";
      if (cmd.includes("npm install") || cmd.includes("pip install") || cmd.includes("apt install")) {
        metricsRecorder.recordDepInstalled();
        dependencyGraph.registerCommand(cmd.slice(0, 80));
      }
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!privilegeManager) return;
    let suggestAlternatives = true;
    try {
      const settings = JSON.parse(require("fs").readFileSync(join(ctx.cwd, ".pi", "settings.json"), "utf-8"));
      suggestAlternatives = settings.lemonharness?.toolPrivilege?.suggestAlternatives !== false;
    } catch { console.error("Integration: using default after error"); }
    if (!suggestAlternatives) return;
    const privCheck = privilegeManager.checkPrivilege(event.toolName, { recentErrors: false, taskType: "general" });
    if (privCheck.isOverPrivileged && privCheck.suggestedAlternative) {
      ctx.ui.notify(`🔒 Suggestion: Consider using \`${privCheck.suggestedAlternative}\` instead of \`${event.toolName}\`.`, "info");
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!dependencyGraph || !metricsRecorder) return;
    metricsRecorder.recordToolCall(event.isError === true);
    if (event.isError && event.toolName === "workspace_write") metricsRecorder.recordConstraintViolation();
    metricsRecorder.recordTraceCompleteness(!event.isError);
    const justified = event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash";
    metricsRecorder.recordJustifiedCall(justified);
    if (event.isError) { lastErrorTimestamp = Date.now(); }
    else if (!event.isError && lastErrorTimestamp !== null) {
      metricsRecorder.recordRecoveryTime(Date.now() - lastErrorTimestamp);
      lastErrorTimestamp = null;
    }
    if (event.toolName === "workspace_write") {
      const path = (event.input as any)?.path;
      if (path) { dependencyGraph.registerFile(path as string); metricsRecorder.recordFileModified(); }
    }
    if (event.toolName === "workspace_install_dep") {
      const pkg = (event.input as any)?.package;
      if (pkg) { dependencyGraph.registerPackage(pkg as string); metricsRecorder.recordDepInstalled(); }
    }
    if (event.toolName === "workspace_validate") {
      const passed = !event.isError;
      metricsRecorder.recordValidation(passed);
      const cmd = (event.input as any)?.command;
      if (cmd) {
        if (passed) passedValidations.add(cmd);
        else if (passedValidations.has(cmd)) metricsRecorder.recordChange(true);
        else metricsRecorder.recordChange(false);
      }
    }
    // v3: Escalation ladder
    if (privilegeManager && event.toolName) {
      privilegeManager.recordEscalationResult(event.toolName, !event.isError, "tool_result");
      if (event.isError) {
        let autoRetry = true;
        try {
          const { readFileSync } = require("fs");
          const settings = JSON.parse(readFileSync(join(ctx.cwd, ".pi", "settings.json"), "utf-8"));
          autoRetry = settings.lemonharness?.escalationAutoRetry !== false;
        } catch { console.error("Integration: using default after error"); }
        if (autoRetry) {
          const er = privilegeManager.attemptEscalation(event.toolName, "tool_error");
          if (er.alternativeTool) ctx.ui.notify(`🔒 Escalation: \`${event.toolName}\` failed → try \`${er.alternativeTool}\``, "info");
          if (er.shouldSuggestConfig) ctx.ui.notify(`⚙️ Tool "${event.toolName}" escalated ${privilegeManager.getChainCount(event.toolName)} times. Adjust settings.`, "warning");
        }
        const errText = (typeof event.content === "string" ? event.content : "") || "";
        if (errText.toLowerCase().includes("outside workspace") || errText.toLowerCase().includes("workspace boundary")) metricsRecorder.recordConstraintViolation();
        if (privilegeManager) {
          const pc = privilegeManager.checkPrivilege(event.toolName, { recentErrors: true });
          if (pc.isOverPrivileged && !pc.suggestedAlternative) privilegeManager.recordEscalation(event.toolName, null, "tool_error");
        }
        try { ctx.ui.notify(`⚠ Tool error: ${event.toolName} — check for regression patterns`, "warning"); } catch { console.error("Integration: operation failed"); }
      } else if (!event.isError && privilegeManager && event.toolName) {
        const c = (typeof event.content === "string" ? event.content : "") || "";
        if (c.toLowerCase().includes("outside workspace") || c.toLowerCase().includes("workspace boundary")) {
          if (metricsRecorder) metricsRecorder.recordConstraintViolation();
        }
      }
    }
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (!qualityGateManager) return; // Auto-trigger handled in workspace extension
  });

  // ── Delegation Tool & Commands ──────────────────────────────────
  setupIntegrationDelegation(pi, delegates, delegateCounter, "");

  // ── Review Loop Command (Implementer ↔ Reviewer alternating loop) ──
  // Research basis: ERL (arXiv:2603.24639), ASH (arXiv:2605.14211)
  // Note: the _ctx parameter is unused — handler uses pi command-handler ctx
  setupIntegrationReviewLoop(pi, { cwd: "" }, null, heuristicManager);
}
