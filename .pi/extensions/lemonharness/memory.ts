/**
 * LemonHarness Memory Extension — Entry Point
 * Event handlers, lifecycle, and re-exports.
 * Tools are in memory-tools.ts, commands in memory-commands.ts.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

// ── Re-export all classes and types from memory-core ──
export * from "./memory-core";

import {
  MemoryEventType,
  MemoryEvent,
  TextMemoryEntry,
  CodeMemoryEntry,
  MemoryIndex,
  PreActionCheck,
  memoryStore,
  ExperienceDistiller,
  memoryState,
} from "./memory-core";

import { registerMemoryTools } from "./memory-tools";
import { registerMemoryCommands } from "./memory-commands";

export function setupMemory(pi: ExtensionAPI) {
  // ── Session Events ────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    memoryState.projectRoot = ctx.cwd;
    const memoryDir = join(memoryState.projectRoot, ".lemonharness", "memory");
    await memoryStore.initialize(memoryDir);

    memoryState.experienceDistiller = new ExperienceDistiller(memoryStore);

    ctx.ui.setStatus("harnessmem", "🧠 HarnessMem active");

    // Run initial distillation after a brief delay
    setTimeout(async () => {
      try {
        const result = await memoryState.experienceDistiller!.distill();
        if (result.promotedToText > 0 || result.promotedToCode > 0) {
          ctx.ui.notify(
            `🧠 Memory distilled: ${result.promotedToText} text, ${result.promotedToCode} code, ${result.patternsFound} patterns`,
            "info",
          );
        }
      } catch {
        // Distillation is non-critical
      }
    }, 5000);

    // Periodic distillation every 5 minutes
    memoryState.distillInterval = setInterval(async () => {
      try {
        await memoryState.experienceDistiller!.distill();
      } catch {
        // Non-critical
      }
    }, 5 * 60 * 1000);

    // Register tools after initialization
    registerMemoryTools(pi);
    registerMemoryCommands(pi);

    memoryState.initialized = true;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (memoryState.distillInterval) {
      clearInterval(memoryState.distillInterval);
      memoryState.distillInterval = null;
    }
    ctx.ui.setStatus("harnessmem", undefined);
    memoryState.initialized = false;
  });

  // ── Record Execution Events from Tool Results ──────────────────

  pi.on("tool_result", async (event, ctx) => {
    if (!memoryState.initialized) return;

    // Record errors as failure events
    if (event.isError) {
      const summary = `${event.toolName} failed`;
      const details = JSON.stringify(event.content).slice(0, 500);

      await memoryStore.recordEvent("failure", summary, details, {
        context: `Tool: ${event.toolName}`,
        tags: [event.toolName, "error"],
        outcome: "failure",
      });
    }
  });

  // ── Pre-Action Governance ──────────────────────────────────────

  pi.on("tool_call" as any, async (event: any, ctx: any) => {
    if (!memoryState.initialized) return;

    // Intercept edit tool — check if target was previously a failure
    if (isToolCallEventType("edit", event)) {
      const editPath = event.input.path as string;
      const check = await memoryStore.checkPreAction("edit", editPath);
      if (check.warning) {
        ctx.ui.notify(
          `🧠 ${check.warning}${check.suggestion ? `\n\nPrevious details: ${check.suggestion}` : ""}`,
          "warning",
        );

        return {
          context: {
            memoryWarning: check.warning,
            memorySuggestion: check.suggestion,
          },
        } as any;
      }
    }

    // Intercept bash tool — check if command was a previous failure
    if (isToolCallEventType("bash", event)) {
      const command = (event.input.command as string) || "";
      const shortCmd = command.slice(0, 60);
      const check = await memoryStore.checkPreAction("bash", shortCmd);
      if (check.warning) {
        ctx.ui.notify(
          `🧠 ${check.warning}${check.suggestion ? `\n\nPrevious failure details: ${check.suggestion}` : ""}`,
          "warning",
        );
      }
    }
  });

  // ── v3: Turn End — Auto-scan for Key Moments ────────────────────

  let turnCounter = 0;

  pi.on("turn_end", async (_event, ctx) => {
    if (!memoryState.initialized) return;
    turnCounter++;

    // Scan for key moments every 10 turns
    if (turnCounter % 10 === 0) {
      try {
        const mod = await import("./subsystems");
        const detector = new mod.KeyMomentDetector();
        const memEvents = memoryStore.getEvents({ limit: 30 });
        const logEntries = memEvents.map(e => ({
          type: (e.outcome === "success" ? "validation" : "tool_call") as "tool_call" | "validation",
          timestamp: e.timestamp,
          toolName: (e.context || "memory").split(":")[0]?.trim() || "memory",
          args: e.details.slice(0, 100),
          isError: e.outcome === "failure",
          passed: e.outcome === "success",
          command: e.summary,
          validationName: e.summary,
        }));
        const moments = detector.findAllKeyMoments(logEntries);
        if (moments.length > 0) {
          const topMoment = moments[0];
          ctx.ui.notify(
            `💡 Key moment detected: ${topMoment.type} — ${topMoment.pattern.slice(0, 80)}`,
            "info",
          );
        }
      } catch { /* non-critical */ }
    }
  });

  // ── Agent Start — Inject Memory Status ─────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!memoryState.initialized) return;

    const stats = memoryStore.getStats();
    const highConfidenceCode = memoryStore.getCodeEntries().filter(
      (e) => e.confidenceScore >= 0.7,
    );

    const memoryPromptParts: string[] = [];
    memoryPromptParts.push("", "## Memory & Learning System (HarnessMem)");

    memoryPromptParts.push(
      "",
      "You have access to a persistent memory system that learns from every session.",
      "Key tools: `workspace_memory_record` (save experience), `workspace_memory_search` (retrieve),",
      "`workspace_memory_feedback` (improve confidence), `workspace_memory_distill` (extract patterns).",
    );

    if (stats.eventCount > 0) {
      memoryPromptParts.push(
        "",
        `📊 Session memory: ${stats.eventCount} events recorded, ${stats.textCount} text memories, ${stats.codeCount} code tools.`,
      );
    }

    if (highConfidenceCode.length > 0) {
      memoryPromptParts.push(
        "",
        "🔧 Available crystallized tools from past experience:",
      );
      for (const entry of highConfidenceCode) {
        memoryPromptParts.push(
          `  - \`${entry.name}\`: ${entry.summary} (confidence: ${Math.round(entry.confidenceScore * 100)}%)`,
        );
      }
      memoryPromptParts.push(
        "",
        "Use `workspace_memory_search` to find relevant experience, or run the script directly.",
      );
    }

    // Inject pre-action governance instructions
    memoryPromptParts.push(
      "",
      "### Pre-Action Governance",
      "",
      "Before attempting operations that might have failed before, the system will check memory.",
      "If you see a 🧠 warning about a previous failure, consider an alternative approach.",
      "Record failures with `workspace_memory_record type=\"failure\"` so the system learns.",
    );

    return {
      systemPrompt: event.systemPrompt + "\n\n" + memoryPromptParts.join("\n"),
    };
  });
}
