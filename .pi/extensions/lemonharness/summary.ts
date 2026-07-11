/**
 * LemonHarness Summary Extension — Entry Point
 * Core types/class in summary-core.ts, data builder in summary-builder.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

export * from "./summary-core";
export { buildSummaryFromLiveDataExternal } from "./summary-builder";

import { SessionSummary } from "./summary-core";

export function setupSummary(pi: ExtensionAPI) {
  const sessionSummaries: SessionSummary[] = [];
  let currentSummary: SessionSummary | null = null;

  pi.on("session_start", async (_event, ctx) => {
    const workspaceDir = join(ctx.cwd, ".lemonharness");
    currentSummary = new SessionSummary(workspaceDir);
    sessionSummaries.push(currentSummary);
    ctx.ui.setStatus("lemonharness-summary", "📝 Live documentation active");
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("lemonharness-summary", undefined);
  });

  // /lemonharness:summary — Generate on-demand summary
  pi.registerCommand("lemonharness:summary", {
    description: "Generate a structured session summary markdown document",
    handler: async (_args, ctx) => {
      try {
        const wsMod = await import("./workspace");
        const summary = currentSummary || new SessionSummary(join(ctx.cwd, ".lemonharness"));
        const { buildSummaryFromSingletons } = await import("./summary-builder");

        const markdown = await buildSummaryFromSingletons(
          summary, wsMod.workspaceManager, wsMod.timeDirector, wsMod.executionLogger,
          ctx, wsMod.sessionPromptDescription || "",
        );
        const path = await summary.saveSummary(markdown);
        ctx.ui.notify(
          `📝 Session summary generated\n\n${markdown.slice(0, 3000)}${markdown.length > 3000 ? "\n\n...(truncated)" : ""}\n\n---\nSaved to: \`${path}\``,
          "info",
        );
      } catch (err: any) {
        ctx.ui.notify(`⚠️ Failed to generate summary: ${err.message}`, "error");
      }
    },
  });

  // /lemonharness:history — Show past summaries
  pi.registerCommand("lemonharness:history", {
    description: "List past session summaries available for review",
    handler: async (_args, ctx) => {
      try {
        const summary = new SessionSummary(join(ctx.cwd, ".lemonharness"));
        const history = await summary.getHistory();
        if (history.length === 0) {
          ctx.ui.notify("📚 No past session summaries found. Generate one with `/lemonharness:summary`.", "info");
          return;
        }
        const lines = ["📚 Session Summary History", "──────────────────────────", "", `Found **${history.length}** past session summary/summaries:`, ""];
        for (let i = 0; i < Math.min(history.length, 20); i++) {
          const h = history[i];
          lines.push(`${i + 1}. **${h.preview}** — ${h.timestamp !== "unknown" ? new Date(h.timestamp).toLocaleString() : "unknown date"}`);
        }
        if (history.length > 20) lines.push(`\n... and ${history.length - 20} more.`);
        lines.push("", "💡 Each summary is archived in `.lemonharness/summaries/`.");
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err: any) {
        ctx.ui.notify(`⚠️ Failed to load history: ${err.message}`, "error");
      }
    },
  });
}
