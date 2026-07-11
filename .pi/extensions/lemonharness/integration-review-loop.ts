import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { ReviewLoopManager, determineTermination, detectOscillation, buildImplementerTask, buildReviewerTask, parseReviewJson, computeSeverityStats } from "./review-loop";

/**
 * Spawn a delegate via delegate-runner.mjs and return the structured result.
 * Extracted to reduce handler complexity and allow reuse across cycles.
 */
async function runDelegate(
  cwd: string,
  task: string,
  budgetMs: number,
  context: string,
  constraint?: string,
): Promise<{ success: boolean; summary: string; output: string; files: string[] }> {
  return new Promise<any>((resolvePromise, rejectPromise) => {
    const child = spawn("node", [
      join(cwd, ".lemonharness", "delegate-runner.mjs"),
    ], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_PATH: join(cwd, "node_modules") },
      timeout: budgetMs + 5000,
    });

    let stdout = "", stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const input = JSON.stringify({
      task,
      cwd,
      budgetMs,
      context: context || "",
      constraint: constraint || "",
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
        // Fallback: include full stdout as output for parsing
        const fallbackSummary = stdout.slice(-2000) || "Delegate completed (no structured output)";
        resolvePromise({
          success: code === 0,
          summary: fallbackSummary,
          output: stdout,
          files: [],
          toolCalls: 0,
        });
      }
    });

    child.on("error", (err) => {
      rejectPromise(new Error(`Delegate spawn failed: ${err.message}`));
    });
  });
}

export function setupIntegrationReviewLoop(
  pi: ExtensionAPI,
  _ctx: { cwd: string },
  reviewLoopManager: any,
  heuristicManager: any,
) {
  pi.registerCommand("review-loop", {
    description: "Run a relentless review loop: implementer + reviewer alternate until diminishing returns. Usage: /review-loop [spec-path] [max-cycles]",
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

      // Initialize review loop manager (note: reviewLoopManager is reassigned from the parameter)
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
          const implResult = await runDelegate(
            ctx.cwd,
            implementerTask,
            120_000,
            isFirstCycle ? "First implementation cycle. Build from spec." : `Review cycle ${cycle}. Fix issues from review.`,
          );

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

        let reviewerOk = false;
        let reviewerRawOutput = "";

        try {
          const revResult = await runDelegate(
            ctx.cwd,
            reviewerTask,
            60_000,
            `Review cycle ${cycle}. Advisory authority only — do not modify files.`,
            "Do NOT modify files, run install commands, or change state. Read and analyze only.",
          );

          reviewerOk = revResult.success === true;

          // Priority: 1) delegate output (reviewer JSON in response text) → 2) review.json file → 3) summary
          // The reviewer is instructed to include JSON in the response text before the === DELEGATE RESULT === marker
          const delegateOutput = revResult.output || "";

          // Also try to read review.json from disk as secondary fallback
          const reviewJsonPath = join(ctx.cwd, ".lemonharness", "review-loop", `cycle-${cycle}`, "review.json");
          let reviewFileContent: string | null = null;
          try {
            if (existsSync(reviewJsonPath)) {
              reviewFileContent = readFileSync(reviewJsonPath, "utf-8");
              JSON.parse(reviewFileContent);
            }
          } catch {
            reviewFileContent = null;
          }

          reviewerRawOutput = delegateOutput || reviewFileContent || revResult.summary || "";

          ctx.ui.notify(
            `  ✅ Reviewer ${reviewerOk ? "completed" : "finished with issues"}`,
            reviewerOk ? "info" : "warning",
          );
        } catch (err: any) {
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
        const highSev = entry.review.findings.filter((f: any) => f.severity >= 7).length;

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
          const currentFindings = entry.review.findings.filter((f: any) => f.severity >= 4);
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
      const sevTrend = trail.map((t: any) => `${t.cycle}: ${t.maxSeverity}`).join(" → ");

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
}

  });
}
