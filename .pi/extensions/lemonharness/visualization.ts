/**
 * LemonHarness Execution Path Visualization
 *
 * Entry point — re-exports from visualization-core/ and registers
 * the /lemonharness:visualize command.
 *
 * Generates visual execution graphs (HTML and TUI) showing the agent's
 * decision path, phase transitions, and validation results.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executionLogger, timeDirector, workspaceManager } from "./workspace";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VisualizationGenerator } from "./visualization-core/generator";
import type { BudgetData } from "./visualization-core/types";

export { VisualizationGenerator } from "./visualization-core/generator";

// ─────────────────────────────────────────────────────────────────────────
// Extension Export
// ─────────────────────────────────────────────────────────────────────────

export function setupVisualization(pi: ExtensionAPI) {
  const vizGen = new VisualizationGenerator();

  // ── /lemonharness:visualize Command ──────────────────────────────

  pi.registerCommand("lemonharness:visualize", {
    description: "Generate an execution visualization: HTML report at .lemonharness/execution-report.html, plus TUI display",
    handler: async (_args, ctx) => {
      const trail = executionLogger.getExecutionTrail();
      const currentPhase = timeDirector.getCurrentPhase();
      const totalBudgetMs = timeDirector.getBudget();
      const elapsedMs = timeDirector.getElapsed();
      const remainingMs = Math.max(totalBudgetMs - elapsedMs, 0);
      const startTime = Date.now() - elapsedMs;

      const budgetData: BudgetData = { totalBudgetMs, elapsedMs, remainingMs };

      // 1. Generate and display TUI
      const tuiOutput = vizGen.generateTUI(trail, currentPhase, budgetData, startTime);
      ctx.ui.notify(tuiOutput, "info");

      // 2. Generate and save HTML report
      try {
        const workspaceDir = workspaceManager.getWorkspaceDir();
        await mkdir(workspaceDir, { recursive: true });
        const html = vizGen.generateHTML(trail, currentPhase, budgetData, startTime);
        const reportPath = join(workspaceDir, "execution-report.html");
        await writeFile(reportPath, html, "utf-8");
        ctx.ui.notify(`🍋 HTML report saved to: ${reportPath}`, "info");
      } catch (err: any) {
        ctx.ui.notify(`❌ Failed to write HTML report: ${err.message}`, "error");
      }
    },
  });
}
