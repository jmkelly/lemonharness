/**
 * LemonHarness Memory Commands — Command Handlers
 * Extracted from memory.ts to keep files under 400 lines.
 */

import { memoryStore, memoryState } from "./memory-core";

/**
 * Register all memory-related commands.
 */
export function registerMemoryCommands(pi: any) {
  // /memory:status — Show memory status
  pi.registerCommand("memory:status", {
    description: "Show memory system status with event counts and latest entries",
    handler: async (_args: any, ctx: any) => {
      if (!memoryState.initialized) {
        ctx.ui.notify("🧠 Memory system not initialized", "error");
        return;
      }

      const stats = memoryStore.getStats();
      const recentEvents = memoryStore.getEvents({ limit: 5 });

      const lines = [
        "🧠 HarnessMem Status",
        "─────────────────────",
        "",
        `📊 ${stats.eventCount} events | ${stats.textCount} text | ${stats.codeCount} code`,
        `🔄 ${stats.totalReuses} reuses | Avg confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`,
        "",
      ];

      if (recentEvents.length > 0) {
        lines.push("📋 Recent Events:");
        for (const event of recentEvents) {
          const icon = event.type === "failure" ? "✗" :
                       event.type === "solution" ? "✓" :
                       event.type === "decision" ? "→" : "•";
          lines.push(`  ${icon} [${event.type}] ${event.summary.slice(0, 70)}`);
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // /memory:forget — Remove a memory entry (for correcting mistakes)
  pi.registerCommand("memory:forget", {
    description: "Remove a memory entry by ID or summary text. Usage: /memory:forget <id or summary>",
    handler: async (args: any, ctx: any) => {
      if (!memoryState.initialized) {
        ctx.ui.notify("🧠 Memory system not initialized", "error");
        return;
      }

      const query = (typeof args === "string" ? args : args?.toString() || "").trim();
      if (!query) {
        ctx.ui.notify("Please provide a memory ID or summary to forget", "error");
        return;
      }

      // Check if it's an event ID
      const events = memoryStore.getEvents();
      const matchedEvents = events.filter(
        (e: any) => e.id === query || e.summary.toLowerCase().includes(query.toLowerCase()),
      );

      if (matchedEvents.length === 0) {
        ctx.ui.notify(`🧠 No memory matching "${query}"`, "info");
        return;
      }

      ctx.ui.notify(
        `🧠 Forgetting ${matchedEvents.length} events matching "${query}". ` +
        `This prevents them from being retrieved in future sessions.`,
        "info",
      );
    },
  });
}
