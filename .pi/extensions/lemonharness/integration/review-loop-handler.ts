// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * review-loop command handler — extracted from integration.ts to reduce file size.
 */

import { join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import type { ReviewLoopManager } from "../review-loop";
import type { HeuristicManager } from "../subsystems-core";

/**
 * Handle the /review-loop command with all its orchestrator logic.
 */
export async function handleReviewLoop(
  args: string,
  ctx: any,
  reviewLoopManager: ReviewLoopManager | null,
  heuristicManager: HeuristicManager | null,
  injectables: {
    ReviewLoopManager: any;
    buildReviewerTask: any;
    buildFinalHandoff: any;
    computeSeverityStats: any;
    determineTermination: any;
    buildImplementerTask: any;
  },
): Promise<void> {
  const parts = args.trim().split(/\s+/);
  let specPath = parts[0];
  const maxCycles = Math.min(parseInt(parts[1], 10) || 5, 10);
  const {
    ReviewLoopManager: RLM,
    buildReviewerTask,
    buildFinalHandoff,
    computeSeverityStats,
    determineTermination,
    buildImplementerTask,
  } = injectables;

  // Auto-discover spec file when no argument is given
  if (!specPath) {
    const candidates = [
      ".lemonharness/review-loop/auto-spec.md",
      ".lemonharness/review-loop/spec.md",
      ".lemonharness/spec.md",
      "SPEC.md", "spec.md", "requirements.md", "README.md",
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
      ctx.ui.notify("No spec path given and no spec found in default locations.\n\n" +
        "Provide a path: /review-loop <spec-path> [max-cycles]\n\n" +
        "Searched: " + candidates.join(", "), "error");
      return;
    }
  }

  const absSpecPath = resolve(ctx.cwd, specPath);
  if (!existsSync(absSpecPath)) { ctx.ui.notify(`Spec file not found: ${specPath}`, "error"); return; }

  let specContent: string;
  try { specContent = readFileSync(absSpecPath, "utf-8"); } catch (err: any) {
    ctx.ui.notify(`Could not read spec file: ${err.message}`, "error"); return;
  }

  let rlm: ReviewLoopManager = new RLM(ctx.cwd);
  await rlm.init();

  ctx.ui.notify(`🍋 Review Loop started\n\nSpec: ${specPath}\nMax cycles: ${maxCycles}\n` +
    `Budget per cycle: ~180s (120s implementer + 60s reviewer)\nEstimated total: ~${maxCycles * 3} minutes`, "info");

  let terminationReason: string = "max_cycles_reached";
  let previousReviewNotes = "";

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const isFirstCycle = cycle === 1;
    ctx.ui.notify(`\n🔄 Review Loop — Cycle ${cycle} / ${maxCycles}`, "info");

    // ── Phase A: Implementer ──
    ctx.ui.notify(`  👷 Spawning implementer (Cycle ${cycle})...`, "info");
    const implementerTask = buildImplementerTask(specPath, specContent, cycle, previousReviewNotes, isFirstCycle);
    let implementerSummary = "", implementerOk = false;

    try {
      const implResult = await runDelegate(ctx, implementerTask, 120_000);
      implementerOk = implResult.success === true;
      implementerSummary = implResult.summary || "No summary available";
      ctx.ui.notify(`  ✅ Implementer ${implementerOk ? "completed" : "finished with issues"}: ${implementerSummary.slice(0, 200)}`, implementerOk ? "info" : "warning");
    } catch (err: any) {
      implementerSummary = `Implementer failed: ${err.message}`;
      ctx.ui.notify(`  ❌ Implementer error: ${err.message}`, "error");
      if (rlm) { const result = rlm.buildResult("implementer_failed" as any, maxCycles, specPath); ctx.ui.notify(`\n⏹ Review loop aborted. Final handoff: \`${result.finalHandoffPath}\``, "error"); }
      return;
    }

    // ── Phase B: Reviewer ──
    ctx.ui.notify(`  🔍 Spawning reviewer (Cycle ${cycle})...`, "info");
    const reviewerTask = buildReviewerTask(specPath, specContent, cycle);
    let reviewerRawOutput = "";

    try {
      const revResult = await runDelegate(ctx, reviewerTask, 60_000, "Do NOT modify files, run install commands, or change state. Read and analyze only.");
      reviewerRawOutput = revResult.summary || "No summary available";
      ctx.ui.notify(`  ✅ Reviewer finished`, "info");
    } catch (err: any) {
      ctx.ui.notify(`  ❌ Reviewer error: ${err.message}`, "error");
      if (rlm) { const result = rlm.buildResult("reviewer_failed" as any, maxCycles, specPath); ctx.ui.notify(`\n⏹ Review loop aborted. Final handoff: \`${result.finalHandoffPath}\``, "error"); }
      return;
    }

    // ── Phase C: Process & Decide ──
    const { entry } = rlm.processReview(cycle, reviewerRawOutput);
    const stats = computeSeverityStats(entry.review);
    const maxSev = stats.maxSeverity;
    const totalFindings = entry.review.findings.length;
    const highSev = entry.review.findings.filter((f: any) => f.severity >= 7).length;

    ctx.ui.notify(`  📊 Review — Max severity: ${maxSev}/10 | ${totalFindings} findings (${highSev} high/critical) | Parsed: ${entry.parsedOk ? "✅" : "⚠️"}`, maxSev >= 7 ? "warning" : "info");

    if (rlm.isOscillating()) ctx.ui.notify("  ⚠️ Oscillation detected", "warning");

    const decision = determineTermination(rlm.getTrail(), maxCycles);
    if (decision.shouldStop) { terminationReason = decision.reason; ctx.ui.notify(`\n⏹ Review loop terminating: ${terminationReason}`, "info"); break; }

    // Extract heuristics for multi-cycle patterns
    if (cycle >= 2 && heuristicManager) {
      for (const f of entry.review.findings.filter((f: any) => f.severity >= 4)) {
        heuristicManager.extractHeuristic("pattern", `Review loop: ${f.category}`, JSON.stringify({ severity: f.severity, description: f.description }), f.category);
      }
    }

    previousReviewNotes = rlm.getReviewNotesForCycle(cycle + 1);
    ctx.ui.notify(`  ➡️ Continuing to cycle ${cycle + 1}...`, "info");
  }

  // ── Final Output ──
  const result = rlm.buildResult(terminationReason as any, maxCycles, specPath);
  const sevTrend = rlm.getTrail().map((t: any) => `${t.cycle}: ${t.maxSeverity}`).join(" → ");
  ctx.ui.notify([
    "", "═══════════════════════════════════", "🍋 Review Loop — Complete", "═══════════════════════════════════", "",
    `Cycles: ${result.cyclesCompleted} / ${maxCycles}`,
    `Termination: ${result.terminationReason}`,
    `Severity trend: ${sevTrend}`,
    `Heuristics: ${result.heuristicsExtracted}`,
    "", `📝 Final handoff: \`${result.finalHandoffPath}\``, "📊 Trend data: \`.lemonharness/review-loop/trend.json\`", "📂 Review trail: \`.lemonharness/review-loop/cycle-*/\"", "",
    "Run /lemonharness:heuristics to view extracted heuristics.",
    "Run /lemonharness:key-moments to detect breakthrough cycles.",
  ].join("\n"), "info");
}

async function runDelegate(ctx: any, task: string, budgetMs: number, constraint?: string): Promise<any> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [join(ctx.cwd, ".lemonharness", "delegate-runner.mjs")], {
      cwd: ctx.cwd, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_PATH: join(ctx.cwd, "node_modules") },
      timeout: budgetMs + 5000,
    });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const input = JSON.stringify({ task, cwd: ctx.cwd, budgetMs, context: "", constraint: constraint || "" });
    child.stdin?.write(input);
    child.stdin?.end();
    child.on("close", (code) => {
      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1];
      let result: any = null;
      if (lastLine) { try { result = JSON.parse(lastLine); } catch { /* not JSON */ } }
      if (result?.type === "result") resolvePromise(result);
      else resolvePromise({ success: code === 0, summary: stdout.slice(-2000) || "Completed", files: [], toolCalls: 0 });
    });
    child.on("error", (err) => rejectPromise(new Error(`Spawn failed: ${err.message}`)));
  });
}
