/**
 * LemonHarness Workspace Event Handlers
 *
 * Extracted from workspace.ts for file size compliance.
 * Contains all pi.on() event handler registrations.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  workspaceManager,
  timeDirector,
  executionLogger,
  contextBudgetTracker,
  snapshotManager,
  ruleKnowledge,
  ReviewLoopManager,
  ensureReviewLoopImports,
} from "./workspace";

import {
  formatGuard,
  pathExists,
  formatDuration,
  detectBashStateChange,
  estimateBudgetFromPrompt,
  SnapshotFileChange,
  getProjectRoot,
  setProjectRoot,
  readLemonHarnessSettings,
  bootstrapWorkspace,
  TimePhaseName,
} from "./workspace-core";

import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * Mutable workspace state shared between workspace.ts and workspace-handlers.ts.
 * Passed as a single object so mutations are visible across modules.
 */
export interface WorkspaceHandlerState {
  healthChecker: any;
  sessionPromptDescription: string;
  previousPhase: TimePhaseName | null;
  trailInjectionCounter: number;
  reviewLoopAutoTriggered: boolean;
  lastKnownCommitHash: string | null;
  autoReflectTurnCounter: number;
  lastDistillEventCount: number;
  autoCommitDone: boolean;
  qualityGateAlreadyTriggered: boolean;
  warnedContextThresholds: Set<number>;
}

export function createWorkspaceHandlerState(): WorkspaceHandlerState {
  return {
    healthChecker: null,
    sessionPromptDescription: "",
    previousPhase: null,
    trailInjectionCounter: 0,
    reviewLoopAutoTriggered: false,
    lastKnownCommitHash: null,
    autoReflectTurnCounter: 0,
    lastDistillEventCount: 0,
    autoCommitDone: false,
    qualityGateAlreadyTriggered: false,
    warnedContextThresholds: new Set<number>(),
  };
}

export function setupWorkspaceHandlers(
  pi: ExtensionAPI,
  state: WorkspaceHandlerState,
): { qualityGateAlreadyTriggered: boolean } {
  let qualityGateAlreadyTriggered = false;

  pi.on("session_start", async (_event, ctx) => {
    setProjectRoot(ctx.cwd);

    try { await bootstrapWorkspace(ctx.cwd, __dirname); } catch { /* bootstrap non-critical */ }

    try { state.lastKnownCommitHash = execSync("git rev-parse HEAD", { cwd: ctx.cwd, stdio: "pipe" }).toString().trim(); } catch { state.lastKnownCommitHash = null; }
    state.autoReflectTurnCounter = 0;
    state.lastDistillEventCount = 0;
    state.autoCommitDone = false;

    const settings = readLemonHarnessSettings();
    workspaceManager.initialize(ctx.cwd, settings.workspace);
    try { await mkdir(workspaceManager.getWorkspaceDir(), { recursive: true }); } catch { console.error("Workspace: operation failed"); }
    const wsDir = workspaceManager.getWorkspaceDir();
    (snapshotManager as any)["snapshotsDir"] = join(wsDir, "snapshots");
    await snapshotManager.init();
    timeDirector.start();
    const budget = settings.timeAwareness?.defaultBudgetMs ?? 600_000;
    timeDirector.setBudget(budget);
    if (settings.contextBudget?.enabled !== false) {
      const limit = settings.contextBudget?.modelContextLimit ?? 128000;
      contextBudgetTracker.setLimit(limit);
      contextBudgetTracker.resetWarnings();
    }
    const skillsDir = join(ctx.cwd, ".pi", "skills");
    await ruleKnowledge.discover(skillsDir);
    try {
      const mod = await import("./subsystems");
      state.healthChecker = new mod.HealthChecker();
      state.healthChecker.registerDefaultChecks(5);
    } catch (e) { console.error("Workspace: operation failed", e); }

    ctx.ui.setStatus("lemonharness", "🍋 LemonHarness active");
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("lemonharness", undefined);
  });

  // ── Before Agent Start ─────────────────────────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    const settings = readLemonHarnessSettings();
    const systemPromptParts: string[] = [];

    state.sessionPromptDescription = event.prompt.slice(0, 1000);

    formatGuard.scan(event.prompt);
    const isConstrained = formatGuard.isConstrained;
    const suppressExtras = formatGuard.suppressExtras;

    const wsDir = workspaceManager.getWorkspaceDir();
    systemPromptParts.push(
      `You are running inside a controlled workspace at \`${wsDir}\`.`,
      `All file writes, dependency installations, and artifact creation must`,
      `occur inside this workspace or within the project root. Before each`,
      `state-changing action, check whether the target path is within the`,
      `workspace. The workspace state is available via the \`workspace_state\` tool.`,
    );

    if (settings.timeAwareness?.enabled !== false) {
      const budget = estimateBudgetFromPrompt(event.prompt);
      timeDirector.setBudget(budget);
      timeDirector.start();
      if (!isConstrained) systemPromptParts.push("", timeDirector.formatStatus());
    }

    if (settings.ruleKnowledge?.enabled !== false) {
      const autoDetect = settings.ruleKnowledge?.autoDetectDomain !== false;
      if (autoDetect) {
        const domains = ruleKnowledge.detectDomain(event.prompt);
        for (const domain of domains) {
          const content = await ruleKnowledge.getSkillContent(domain);
          if (content) systemPromptParts.push("", `## Relevant Rules: ${domain}`, "", content);
        }
      }
      if (!isConstrained) {
        const skills = ruleKnowledge.getSkills();
        if (skills.length > 0) {
          systemPromptParts.push("", "## Available Skills");
          systemPromptParts.push("Use `/skill:<name>` to load a skill manually. Available skills:");
          for (const skill of skills) {
            systemPromptParts.push(`- \`${skill.name}\`: ${skill.description.slice(0, 120)}`);
          }
        }
      }
    }

    if (!suppressExtras) {
      try {
        const mod = await import("./subsystems");
        const settingsFull = readLemonHarnessSettings();
        if (settingsFull.heuristics?.enabled !== false) {
          const workspaceDir2 = workspaceManager.getWorkspaceDir();
          const hm = new mod.HeuristicManager(workspaceDir2);
          await hm.init();
          const domain = ruleKnowledge.detectDomain(event.prompt)[0] || "general";
          const heuristics = hm.getRelevantHeuristics(domain, settingsFull.heuristics?.maxHeuristicsPerPrompt || 5);
          if (heuristics.length > 0) {
            systemPromptParts.push("", hm.formatForPrompt(heuristics));
          }
        }
      } catch { /* subsystems not available */ }
    }

    try {
      const mod = await import("./subsystems");
      const settingsFull = readLemonHarnessSettings();
      if (settingsFull.skills?.pseudocodeEnabled !== false && !isConstrained) {
        const skills = ruleKnowledge.getSkills();
        if (skills.length > 0) {
          systemPromptParts.push("", `📋 ${skills.length} skills loaded.`);
        }
      }
    } catch { /* SaP not available */ }

    const totalEntries = executionLogger.getExecutionTrail().length;
    if (!suppressExtras && totalEntries > 5) {
      const logInterval = totalEntries < 20 ? 5 : settings.executionLogging?.injectTrailInterval ?? 3;
      state.trailInjectionCounter++;
      if (state.trailInjectionCounter % logInterval === 1) {
        const maxEntries = settings.executionLogging?.maxTrailEntries ?? 10;
        const trail = totalEntries > maxEntries * 2
          ? executionLogger.summarizeCompressed(maxEntries)
          : executionLogger.summarize(maxEntries);
        if (trail) systemPromptParts.push("", "📋 Recent Execution Trail:", trail);
      }
    }

    return {
      systemPrompt: event.systemPrompt + "\n\n" + systemPromptParts.join("\n"),
    };
  });


  pi.on("turn_start", async (_event, ctx) => {    const settings = readLemonHarnessSettings();    if (settings.timeAwareness?.enabled === false) return;    const phase = timeDirector.getCurrentPhase();    if (timeDirector.isInGraceBand() && phase.remainingMs < 30_000) {      const extension = Math.round(phase.remainingMs * 0.2);      timeDirector.extendBudget(extension);    }    const currentPhase = timeDirector.getCurrentPhase();    if (state.previousPhase && currentPhase.phase !== state.previousPhase) {      ctx.ui.notify(        `🍋 Phase transition: ${state.previousPhase} → ${currentPhase.phase} (${Math.round(currentPhase.totalProgress * 100)}% budget used)`,        "info",      );      const wsState = workspaceManager.getWorkspaceState();      const cp = timeDirector.recordPhaseCheckpoint(        currentPhase.phase,        JSON.stringify({ files: wsState.files.length, deps: wsState.dependencies.length }),        "",      );      ctx.ui.setStatus("lemonharness-checkpoint", `📍 ${cp.phase} (DA: ${(cp.decisionAdvantage * 100).toFixed(0)}%)`);      const recentErrors = executionLogger.getExecutionTrail().filter((t: any) => t.isError).slice(-6);      if (recentErrors.length > 1) {        try {          const mod = await import("./subsystems");          const wsDir = workspaceManager.getWorkspaceDir();          const hm = new mod.HeuristicManager(wsDir);          await hm.init();          let count = 0;          for (const t of recentErrors) {            if (t.toolName) {              hm.extractHeuristic("failure", `${t.toolName} failed`, JSON.stringify(t.args || ""), "general");              count++;            }          }          if (count > 0) ctx.ui.notify(`🧪 ${count} heuristics extracted from phase errors`, "info");        } catch { /* subsystems not available */ }      }      if (currentPhase.phase === "reserve" && state.previousPhase !== "reserve") {        try {          const status = execSync("git status --porcelain", { cwd: ctx.cwd, stdio: "pipe" }).toString().trim();          if (status && !state.autoCommitDone) {            const diffStats = execSync("git diff --stat", { cwd: ctx.cwd, stdio: "pipe" }).toString().trim();            const firstLine = (state.sessionPromptDescription || "").split(/\n/)[0].slice(0, 72);            const summary = firstLine ? `chore(reserve): ${firstLine}` : "chore(reserve): auto-commit remaining changes";            execSync("git add -A", { cwd: ctx.cwd, stdio: "pipe" });            execSync(`git commit -m "${summary}" -m "${diffStats}"`, { cwd: ctx.cwd, stdio: "pipe" });            const hash = execSync("git rev-parse --short HEAD", { cwd: ctx.cwd, stdio: "pipe" }).toString().trim();            ctx.ui.notify(`📸 Auto-committed remaining changes as ${hash}`, "info");            state.autoCommitDone = true;          }        } catch { /* git not available */ }        try {          const summaryMod = await import("./summary");          const summary = new summaryMod.SessionSummary(join(workspaceManager.getWorkspaceDir()));          const markdown = await summaryMod.buildSummaryFromLiveDataExternal(            summary, workspaceManager, timeDirector, executionLogger, ctx, state.sessionPromptDescription,          );          const path = await summary.saveSummary(markdown);          ctx.ui.notify(`📝 Session summary auto-generated and saved to \`${path}\``, "info");        } catch (err: any) {          ctx.ui.notify(`⚠️ Auto-generate summary note: ${err.message}`, "info");        }        const confTrail = executionLogger.getExecutionTrail().filter(e => e.type === "confidence" && e.confidence);        if (confTrail.length > 0) {          const confLines: string[] = [            "📊 Confidence Summary (P4 Reserve)",            "─────────────────────────────────────",            "",          ];          const flagged = confTrail.filter(e => e.confidence!.flagForReview);          const scores = confTrail.map(e => e.confidence!.score);          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;          confLines.push(`Total recorded: ${confTrail.length}`);          confLines.push(`Average confidence: ${avg.toFixed(1)}/5`);          confLines.push(`Range: ${Math.min(...scores)}–${Math.max(...scores)}`);          confLines.push(`Flagged for review: ${flagged.length}`);          if (flagged.length > 0) {            confLines.push("", "🔔 OUTPUTS NEEDING HUMAN REVIEW:");            confLines.push("");            for (const entry of flagged) {              const c = entry.confidence!;              const label: Record<number, string> = { 1: "Very Low", 2: "Low" };              confLines.push(`   ⚠ [${label[c.score] || c.score}] ${entry.toolName || "unknown"}`);              confLines.push(`      Rationale: ${c.rationale}`);            }            confLines.push("", "Review these outputs before finalizing.");          } else {            confLines.push("", "✅ No outputs flagged for review — confidence is acceptable.");          }          ctx.ui.notify(confLines.join("\n"), flagged.length > 0 ? "warning" : "info");        } else {          ctx.ui.notify("ℹ No confidence scores recorded this session.", "info");        }      }      if (currentPhase.phase === "implement" && state.previousPhase === "explore") {        const projectRoot = workspaceManager.getProjectRoot();        const hasTestDir = existsSync(join(projectRoot, "tests"));        const hasTestRunner = existsSync(join(projectRoot, "node_modules", ".bin", "vitest")) ||          existsSync(join(projectRoot, "node_modules", ".bin", "jest"));        const hasTestFiles = hasTestDir && (() => {          try {            const files = readdirSync(join(projectRoot, "tests"));            return files.some(f => f.includes(".test.") || f.includes(".spec."));          } catch (e) { console.error("Workspace: operation failed", e); return false; }        })();        if (!hasTestRunner) {          ctx.ui.notify("🧪 TDD GUARDRAIL: No test runner found. Install vitest before implementing.", "warning");        }        if (!hasTestFiles) {          ctx.ui.notify("🧪 TDD GUARDRAIL: No test files found in tests/.", "warning");        }        if (hasTestRunner && hasTestFiles) {          ctx.ui.notify("🧪 TDD check passed: test infrastructure and test files present", "info");        }      }      if (currentPhase.phase === "validate" && !state.qualityGateAlreadyTriggered) {        state.qualityGateAlreadyTriggered = true;        const scriptPath = join(workspaceManager.getProjectRoot(), ".lemonharness", "quality-gate.sh");        pathExists(scriptPath).then(exists => {          if (!exists) return;          const qgChild = spawn("bash", ["-c", `bash "${scriptPath}"`], {            cwd: workspaceManager.getProjectRoot(), stdio: ["pipe", "pipe", "pipe"],          });          let qgStdout = "", qgStderr = "";          qgChild.stdout?.on("data", (d: Buffer) => { qgStdout += d.toString(); });          qgChild.stderr?.on("data", (d: Buffer) => { qgStderr += d.toString(); });          qgChild.on("close", (code) => {            const output = qgStdout + qgStderr;            const passed = code === 0 || output.includes("All checks pass");            if (passed) {              ctx.ui.notify("✅ Auto quality gate PASSED — code quality within thresholds", "info");              if (!state.autoCommitDone) {                try {                  const status = execSync("git status --porcelain", { cwd: ctx.cwd, stdio: "pipe" }).toString().trim();                  if (status) {                    const diffStats = execSync("git diff --stat", { cwd: ctx.cwd, stdio: "pipe" }).toString().trim();                    const firstLine = (state.sessionPromptDescription || "").split(/\n/)[0].slice(0, 80);                    const summary = firstLine || "auto-commit after passing validation";                    execSync("git add -A", { cwd: ctx.cwd, stdio: "pipe" });                    execSync(`git commit -m "feat: ${summary}" -m "${diffStats}"`, { cwd: ctx.cwd, stdio: "pipe" });                    const hash = execSync("git rev-parse --short HEAD", { cwd: ctx.cwd, stdio: "pipe" }).toString().trim();                    ctx.ui.notify(`📸 Auto-committed as ${hash} — quality gate passed`, "info");                    state.autoCommitDone = true;                  }                } catch (e) { console.error("Workspace: operation failed", e); }              }            } else {              ctx.ui.notify(`⚠️ Auto quality gate FAILED — review issues before continuing\n${output.slice(0, 500)}`, "warning");            }          });        });        const reviewLoopSettings = readLemonHarnessSettings().reviewLoop || {};        if (!state.reviewLoopAutoTriggered && reviewLoopSettings.enabled !== false && reviewLoopSettings.autoTriggerOnP3Entry !== false) {          state.reviewLoopAutoTriggered = true;          (async () => {            try {              await ensureReviewLoopImports();              if (!ReviewLoopManager) return;              const rlm = new ReviewLoopManager(getProjectRoot());              await rlm.init();              const specContent = state.sessionPromptDescription || "Implement the required changes.";              const specDir = join(getProjectRoot(), ".lemonharness", "review-loop");              const specPath = join(specDir, "auto-spec.md");              await mkdir(specDir, { recursive: true });              await writeFile(specPath, `# Auto-Generated Spec — Review Loop\n\n${specContent}`, "utf-8");              ctx.ui.setStatus("lemonharness-review-loop", `🔄 Review loop ready — /review-loop ${join(".lemonharness", "review-loop", "auto-spec.md")}`);              ctx.ui.notify(`🔄 Review loop auto-ready — run with: /review-loop .lemonharness/review-loop/auto-spec.md`, "info");            } catch (err: any) {              ctx.ui.notify(`⚠️ Review loop auto-trigger note: ${err.message}`, "info");            }          })();        }      }    }    state.previousPhase = currentPhase.phase;    const elapsed = formatDuration(currentPhase.elapsedMs);    const remaining = formatDuration(currentPhase.remainingMs);    ctx.ui.setStatus(      "lemonharness-time",      `🍋 ${currentPhase.phase.toUpperCase()} ${Math.round(currentPhase.totalProgress * 100)}% | ${elapsed} / ${remaining}`,    );  });  
pi.on("turn_end", async (_event, ctx) => {    const stateWs = workspaceManager.getWorkspaceState();    ctx.ui.setStatus(      "lemonharness-workspace",      `📁 ${stateWs.files.length} files, ${stateWs.dependencies.length} deps`,    );    if (state.healthChecker) {      const phase = timeDirector.getCurrentPhase();      const trail = executionLogger.getExecutionTrail();      const totalToolCalls = trail.filter(t => t.type === "tool_call").length;      const totalErrors = trail.filter(t => t.isError).length;      const validationsPassed = trail.filter(t => t.passed === true).length;      const validationsFailed = trail.filter(t => t.passed === false).length;      const recentTrail = trail.slice(-10);      const recentErrors = recentTrail.filter(t => t.isError).length;      const errorRate = recentTrail.length > 0 ? recentErrors / recentTrail.length : 0;      const regressionMsg = executionLogger.detectRegression();      state.healthChecker.runChecks({        elapsedMs: timeDirector.getElapsed(),        totalBudgetMs: timeDirector.getBudget(),        currentPhase: phase.phase,        phaseProgress: phase.phaseProgress,        totalProgress: phase.totalProgress,        totalToolCalls, totalErrors,        consecutiveErrors: executionLogger.getConsecutiveErrors(),        errorRate,        regressionDetected: regressionMsg !== null,        regressionMessage: regressionMsg,        filesModified: stateWs.files.length,        dependencies: stateWs.dependencies,        dependencyCount: stateWs.dependencies.length,        validationsPassed, validationsFailed,      });      const alerts = state.healthChecker.getAlerts();      for (const alert of alerts) {        if (alert.severity === "red") {          ctx.ui.notify(`🔴 [Health Check] ${alert.name}: ${alert.message}`, "error");        } else if (alert.severity === "yellow") {          ctx.ui.notify(`⚠️  [Health Check] ${alert.name}: ${alert.message}`, "warning");        }      }      if (regressionMsg !== null) {        ctx.ui.notify(`🩺 Regression detected: ${regressionMsg} — attempting auto-heal...`, "warning");        (async () => {          try {            const mod = await import("./subsystems");            const wsDir = workspaceManager.getWorkspaceDir();            const projectRoot = workspaceManager.getProjectRoot();            const healer = new mod.ValidationAutoHealer(projectRoot, wsDir);            const result = await healer.healLastFailure();            if (result?.healed) {              ctx.ui.notify(`🩺 Auto-heal succeeded${result.retryCommand ? ` — re-run: ${result.retryCommand}` : ""}`, "info");            } else if (result?.escalation) {              ctx.ui.notify(`🚨 Auto-heal escalated after ${result.attempt} attempts — review required`, "error");            }          } catch { /* heal not available */ }        })();      }      state.autoReflectTurnCounter++;      const consecErrors = executionLogger.getConsecutiveErrors();      if ((state.autoReflectTurnCounter % 5 === 0 || consecErrors >= 3) && consecErrors > 1) {        const trail = executionLogger.getExecutionTrail();        const recentErrors = trail.filter(t => t.isError).slice(-8);        if (recentErrors.length > 1) {          (async () => {            try {              const mod = await import("./subsystems");              const wsDir = workspaceManager.getWorkspaceDir();              const hm = new mod.HeuristicManager(wsDir);              await hm.init();              let count = 0;              for (const t of recentErrors) {                if (t.toolName) {                  hm.extractHeuristic("failure", `${t.toolName} failed`, JSON.stringify(t.args || ""), "general");                  count++;                }              }              if (count > 1) ctx.ui.notify(`🧪 Auto-reflect: ${count} heuristics extracted`, "info");            } catch { /* subsystems not available */ }          })();        }      }      try {        const eventsFile = join(workspaceManager.getWorkspaceDir(), "memory", "events.jsonl");        const countStr = execSync(`wc -l < "${eventsFile}" 2>/dev/null || echo 0`, { stdio: "pipe" }).toString().trim();        const count = parseInt(countStr, 10) || 0;        if (count >= 30 && count - state.lastDistillEventCount >= 30) {          state.lastDistillEventCount = count;          ctx.ui.notify(`🧠 ${count} memory events accumulated — run workspace_memory_distill to extract patterns`, "info");        }      } catch { /* memory file not accessible */ }    }    try {      const currentHash = execSync("git rev-parse HEAD", { cwd: ctx.cwd, stdio: "pipe" }).toString().trim();      if (state.lastKnownCommitHash !== null && currentHash !== state.lastKnownCommitHash) {        state.lastKnownCommitHash = currentHash;        const trail = executionLogger.getExecutionTrail();        const recentTurns = trail.slice(-10);        const errors = trail.filter(t => t.isError).length;        const lines = [          "📝 Post-Commit Reflection (auto-triggered)",          "──────────────────────────────────────────",          "", `Commit detected: ${currentHash.slice(0, 7)}`,          "", "Take a moment to reflect:",          "", "1️⃣  What did I just accomplish?",          "2️⃣  What worked well? → Record as solution/pattern",          "3️⃣  What didn't work? → Record as failure with root cause",          "4️⃣  What should I do differently next time? → Record as insight",          "", `📊 Session: ${trail.length} tool calls, ${errors} errors`,          "", "Use `workspace_memory_record` to save lessons.",          'Use `workspace_memory_search query="self-improvement"` to find past lessons.',        ];        try {          const mod = await import("./subsystems");          const workspaceDir2 = workspaceManager.getWorkspaceDir();          const hm = new mod.HeuristicManager(workspaceDir2);          await hm.init();          const extracted: string[] = [];          for (const t of recentTurns) {            if (t.isError && t.toolName) {              const h = hm.extractHeuristic("failure", `${t.toolName} failed`, JSON.stringify(t.args || ""), "general");              if (h) extracted.push(`• "${h.rule}" (${h.type}, confidence: ${h.confidence.toFixed(2)})`);            }          }          if (extracted.length > 0) {            lines.push("", "🧪 Extracted Heuristics (ERL):");            lines.push(...extracted);            lines.push("", `${extracted.length} heuristic(s) saved. Use /lemonharness:heuristics to view all.`);          }        } catch { /* subsystems not available */ }        ctx.ui.notify(lines.join("\n"), "info");      }    } catch { /* not a git repo */ }    const settings = readLemonHarnessSettings();    if (settings.contextBudget?.enabled !== false) {      const usage = ctx.getContextUsage();      if (usage && usage.percent !== null) {        const thresholds = [50, 70, 90];        for (const threshold of thresholds) {          if (usage.percent >= threshold && !state.warnedContextThresholds.has(threshold)) {            state.warnedContextThresholds.add(threshold);            ctx.ui.notify(threshold >= 90 ? ('🔴 Context usage at ' + usage.percent + '% (exceeded ' + threshold + '% threshold). Model: ' + (usage.tokens?.toLocaleString() || '?') + ' / ' + usage.contextWindow.toLocaleString() + ' tokens. Use /lemonharness:context for details.') : threshold >= 70 ? ('⚠️ Context usage at ' + usage.percent + '% (exceeded ' + threshold + '% threshold). Use /lemonharness:context for details.') : ('📋 Context usage at ' + usage.percent + '% (exceeded ' + threshold + '% threshold). Use /lemonharness:context for details.'), threshold >= 90 ? 'error' : threshold >= 70 ? 'warning' : 'info');          }        }      }    }  });




  pi.on("tool_call", async (event, ctx) => {
    const settings = readLemonHarnessSettings();

    if (isToolCallEventType("write", event)) {
      if (!settings.structuredTools?.interceptBuiltins) return;
      const writePath = event.input.path as string;
      const absPath = resolve(ctx.cwd, writePath);
      if (workspaceManager.wouldBlockWrite(absPath)) {
        ctx.ui.notify(`🍋 Blocked write outside workspace: ${writePath}`, "warning");
        return { block: true, reason: `Write target "${writePath}" is outside the workspace boundary. Use the workspace_root or allowed paths.` };
      }
    }

    if (isToolCallEventType("edit", event)) {
      if (!settings.structuredTools?.interceptBuiltins) return;
      const editPath = event.input.path as string;
      const absPath = resolve(ctx.cwd, editPath);
      if (workspaceManager.wouldBlockWrite(absPath)) {
        ctx.ui.notify(`🍋 Blocked edit outside workspace: ${editPath}`, "warning");
        return { block: true, reason: `Edit target "${editPath}" is outside the workspace boundary.` };
      }
    }

    if (isToolCallEventType("bash", event)) {
      const command = event.input.command as string;
      const stateChange = detectBashStateChange(command);
      if (stateChange) {
        workspaceManager.trackProcess(command, 0);

        if (/rm\s+-rf|git\s+reset|git\s+clean|git\s+checkout/.test(command)) {
          (async () => {
            try {
              const wsState = workspaceManager.getWorkspaceState();
              const snapshotId = `auto-${Date.now()}`;
              const changedFiles: SnapshotFileChange[] = [];
              const root = workspaceManager.getProjectRoot();
              for (const file of wsState.files) {
                const absPath = resolve(root, file.path);
                try {
                  const { readFile } = await import("node:fs/promises");
                  const content = await readFile(absPath, "utf-8");
                  changedFiles.push({ path: file.path, oldContent: content, newContent: null, action: "modify" });
                } catch { /* file gone */ }
              }
              if (changedFiles.length > 0) {
                const meta = await snapshotManager.createSnapshot(snapshotId, `Pre-destructive: ${command.slice(0, 60)}`, changedFiles);
                ctx.ui.notify(`📸 Pre-destructive snapshot: ${snapshotId} (${meta.files?.length ?? 0} files)`, "info");
              }
            } catch { /* snapshot not available */ }
          })();
        }
      }
    }
  });

  // ── Tool Result — Logging ─────────────────────────────────────────

  pi.on("tool_result", async (event, ctx) => {
    executionLogger.logToolCall(
      event.toolName,
      event.input,
      { content: event.content, isError: event.isError },
      event.isError,
    );

    if (event.toolName === "workspace_memory_search") {
      const contentStr = typeof event.content === "string" ? event.content : JSON.stringify(event.content || "");
      contextBudgetTracker.trackMemoryRetrieval(contentStr);
    }

    if (event.toolName === "workspace_memory_record") {
      const contentStr = typeof event.content === "string" ? event.content : JSON.stringify(event.content || "");
      contextBudgetTracker.trackMemoryRetrieval(contentStr);
    }

    if (event.isError) {
      const regression = executionLogger.detectRegression();
      if (regression) {
        ctx.ui.notify(`🧠 Regression detected: ${regression}`, "warning");
        const snapshots = await snapshotManager.listSnapshots();
        if (snapshots.length > 0) {
          const latest = snapshots[0];
          ctx.ui.notify(
            `💡 Auto-suggestion: Consider rollback with /lemonharness:rollback ${latest.id} to restore state before failures`,
            "info",
          );
        }
      }
    }
  });

  // ── P4 Reserve Phase Enforcement ──────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    const settings = readLemonHarnessSettings();
    if (settings.timeAwareness?.enabled === false) return;
    const phase = timeDirector.getCurrentPhase();
    if (phase.phase !== "reserve") return;
    const stateChangingTools = ["write", "edit", "bash"];
    if (stateChangingTools.includes(event.toolName)) {
      return { block: true, reason: "You are in the RESERVE phase (last 10% of time budget). Stop initiating new state-changing actions. Preserve whatever acceptable result is on disk. Only perform minimal validation or output formatting." };
    }
  });

  return { qualityGateAlreadyTriggered };
}

