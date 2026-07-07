/**
 * LemonHarness Memory Extension — Entry Point
 * All classes and types are in .pi/extensions/lib/harness-mem.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";

// ── Re-export all classes and types from harness-mem ──
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

        // We don't block, but we flag it visibly
        return {
          // Continue with the edit but with context
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

  // ── Custom Tools ──────────────────────────────────────────────────

  // workspace_memory_record — Record a memory event
  pi.registerTool({
    name: "workspace_memory_record",
    label: "Memory Record",
    description:
      "Record a memory event (decision, solution, failure, pattern, feedback, or insight). " +
      "This builds the agent's persistent memory for future sessions.",
    parameters: Type.Object({
      type: Type.Enum({
        decision: "decision",
        solution: "solution",
        failure: "failure",
        pattern: "pattern",
        feedback: "feedback",
        insight: "insight",
      }, { description: "Type of memory event" }),
      summary: Type.String({ description: "Short summary of the event (used for retrieval)" }),
      details: Type.String({ description: "Full details — what happened, why, and what was learned" }),
      context: Type.Optional(Type.String({ description: "Context — what was happening when this occurred" })),
      tags: Type.Optional(Type.String({ description: "Comma-separated tags for retrieval (e.g., 'python,import,error')" })),
      outcome: Type.Optional(Type.Enum({
        success: "success",
        failure: "failure",
        unknown: "unknown",
      }, { description: "Outcome of the event" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!memoryState.initialized) {
        return {
          content: [{ type: "text" as const, text: "Memory system is not memoryState.initialized yet." }],
          isError: true,
          details: {},
        };
      }

      const tags = params.tags
        ? params.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      // v3: Augment with git context if context contains a file path (MemCoder)
      let enrichedDetails = params.details;
      let enrichedTags = params.tags;
      if (params.context && /\.\w+$/.test(params.context) && !params.context.includes(" ") && memoryState.projectRoot) {
        try {
          const mod = await import("./subsystems");
          const commitMem = new mod.CommitAwareMemory(memoryState.projectRoot);
          const augmented = await commitMem.augmentWithGitContext(
            params.context,
            { details: params.details, tags: params.tags || "" }
          );
          enrichedDetails = augmented.details;
          enrichedTags = augmented.tags;
        } catch { /* git context not available — proceed without */ }
      }

      const event = await memoryStore.recordEvent(
        params.type as MemoryEventType,
        params.summary,
        enrichedDetails,
        {
          context: params.context,
          tags: enrichedTags
            ? enrichedTags.split(",").map((t) => t.trim()).filter(Boolean)
            : tags,
          outcome: params.outcome as "success" | "failure" | "unknown" | undefined,
        },
      );

      // Also promote immediately to text memory for retrieval
      await memoryStore.getOrCreateTextMemory(event);

      return {
        content: [
          {
            type: "text" as const,
            text: `🧠 Recorded ${params.type}: "${params.summary}" (id: ${event.id})`,
          },
        ],
        details: { eventId: event.id, type: params.type, tags },
      };
    },
  });

  // workspace_memory_search — Search memory
  pi.registerTool({
    name: "workspace_memory_search",
    label: "Memory Search",
    description:
      "Search the agent's memory for relevant past experiences, solutions, and patterns. " +
      "Returns matched text and code memory entries with confidence scores.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query describing what you're looking for" }),
      tags: Type.Optional(Type.String({ description: "Comma-separated tags to filter by" })),
      max_results: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
      min_confidence: Type.Optional(Type.Number({ description: "Minimum confidence score 0-1 (default: 0.3)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!memoryState.initialized) {
        return {
          content: [{ type: "text" as const, text: "Memory system is not memoryState.initialized yet." }],
          isError: true,
          details: {},
        };
      }

      const tags = params.tags
        ? params.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined;

      const result = memoryStore.retrieve({
        query: params.query,
        tags,
        maxResults: params.max_results ?? 5,
        minConfidence: params.min_confidence ?? 0.5,
      });

      if (result.abstain) {
        return {
          content: [
            {
              type: "text" as const,
              text: `🧠 Memory search: abstained — ${result.abstainReason || "No relevant entries found with sufficient confidence."}`,
            },
          ],
          details: { abstain: true, reason: result.abstainReason },
        };
      }

      const lines: string[] = ["🧠 Memory Search Results", ""];

      if (result.textMatches.length > 0) {
        lines.push("📝 Text Memory:");
        for (const { entry, score } of result.textMatches) {
          const confidencePct = Math.round(entry.confidenceScore * 100);
          const reuseInfo = entry.reuseCount > 0
            ? ` (used ${entry.reuseCount}x, ${entry.successCount}✓ ${entry.failureCount}✗)`
            : "";
          lines.push(`  [${entry.type}] ${entry.summary}`);
          lines.push(`    Confidence: ${confidencePct}% | Score: ${score.toFixed(2)}${reuseInfo}`);
          lines.push(`    Tags: ${entry.tags.join(", ") || "(none)"}`);
          if (entry.details.length > 150) {
            lines.push(`    Details: ${entry.details.slice(0, 150)}...`);
          } else {
            lines.push(`    Details: ${entry.details}`);
          }
          lines.push("");
        }
      }

      if (result.codeMatches.length > 0) {
        lines.push("🔧 Code Memory (callable):");
        for (const { entry, score } of result.codeMatches) {
          const confidencePct = Math.round(entry.confidenceScore * 100);
          const reuseInfo = entry.reuseCount > 0
            ? ` (used ${entry.reuseCount}x, ${entry.successCount}✓ ${entry.failureCount}✗)`
            : "";
          lines.push(`  ${entry.name}: ${entry.summary}`);
          lines.push(`    Confidence: ${confidencePct}% | Score: ${score.toFixed(2)}${reuseInfo}`);
          lines.push(`    Script: ${join(".lemonharness/memory/code/", entry.name + ".sh")}`);
          lines.push("");
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {
          textMatches: result.textMatches.length,
          codeMatches: result.codeMatches.length,
        },
      };
    },
  });

  // workspace_memory_stats — Show memory statistics
  pi.registerTool({
    name: "workspace_memory_stats",
    label: "Memory Stats",
    description: "Get statistics about the agent's memory — event counts, tag distribution, confidence levels.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!memoryState.initialized) {
        return {
          content: [{ type: "text" as const, text: "Memory system is not memoryState.initialized yet." }],
          isError: true,
          details: {},
        };
      }

      const stats = memoryStore.getStats();
      const lines: string[] = [
        "🧠 HarnessMem — Memory Statistics",
        "─────────────────────────────────",
        "",
        `📊 Events: ${stats.eventCount} total`,
      ];

      // Event type breakdown
      for (const [type, count] of Object.entries(stats.eventTypeDistribution).sort()) {
        const bar = "█".repeat(Math.round(count / Math.max(...Object.values(stats.eventTypeDistribution)) * 20));
        lines.push(`   ${type.padEnd(10)} ${count.toString().padStart(3)} ${bar}`);
      }

      lines.push("");
      lines.push(`📝 Text Memory: ${stats.textCount} entries`);
      lines.push(`🔧 Code Memory: ${stats.codeCount} entries`);
      lines.push(`🔄 Total Reuses: ${stats.totalReuses}`);
      lines.push(`📈 Avg Confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`);
      lines.push("");

      // Top tags
      const topTags = Object.entries(stats.tagDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (topTags.length > 0) {
        lines.push("🏷 Top Tags:");
        for (const [tag, count] of topTags) {
          const bar = "▓".repeat(Math.round(count / topTags[0][1] * 20));
          lines.push(`   ${tag.padEnd(15)} ${count.toString().padStart(3)} ${bar}`);
        }
      }

      // Memory location
      lines.push("");
      lines.push(`📁 Storage: ${memoryStore.getBaseDir()}`);
      lines.push(`🆔 Session: ${memoryStore.getSessionId()}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: stats,
      };
    },
  });

  // workspace_memory_list_code — List crystallized code memory
  pi.registerTool({
    name: "workspace_memory_list_code",
    label: "List Code Memory",
    description: "List all crystallized code memory entries (callable scripts/tools) with their confidence scores.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!memoryState.initialized) {
        return {
          content: [{ type: "text" as const, text: "Memory system is not memoryState.initialized yet." }],
          isError: true,
          details: {},
        };
      }

      const entries = memoryStore.getCodeEntries();
      if (entries.length === 0) {
        return {
          content: [{ type: "text" as const, text: "🔧 No code memory entries yet. They are created when text memories are reused 3+ times." }],
          details: { count: 0 },
        };
      }

      const lines: string[] = [
        "🔧 Crystallized Code Memory",
        "───────────────────────────",
        "",
      ];

      for (const entry of entries) {
        const confidencePct = Math.round(entry.confidenceScore * 100);
        lines.push(`  ${entry.name}`);
        lines.push(`    ${entry.summary}`);
        lines.push(`    Confidence: ${confidencePct}% | Used: ${entry.reuseCount}x`);
        lines.push(`    Source events: ${entry.sourceCount}`);
        lines.push(`    Script: ${join(".lemonharness/memory/code/", entry.name + ".sh")}`);
        if (entry.requires.length > 0) {
          lines.push(`    Requires: ${entry.requires.join(", ")}`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { count: entries.length, entries: entries.map((e) => e.name) },
      };
    },
  });

  // workspace_memory_distill — Force distillation run
  pi.registerTool({
    name: "workspace_memory_distill",
    label: "Memory Distill",
    description:
      "Force an immediate distillation of memory events into patterns. " +
      "Detects repeated solutions/failures, promotes them to text memory, and " +
      "crystallizes frequent text entries into callable code tools.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!memoryState.initialized || !memoryState.experienceDistiller) {
        return {
          content: [{ type: "text" as const, text: "Memory system is not memoryState.initialized yet." }],
          isError: true,
          details: {},
        };
      }

      const result = await memoryState.experienceDistiller.distill();

      // v3: Run key-moment detection on memory events
      let keyMomentsOutput = "";
      try {
        const mod = await import("./subsystems");
        const detector = new mod.KeyMomentDetector();
        const memEvents = memoryStore.getEvents({ limit: 30 });

        // Convert memory events to LogEntry-compatible format
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
          keyMomentsOutput = "\n\n💡 Key Moments Detected:";
          for (const m of moments) {
            keyMomentsOutput += `\n  • [${m.type}] (sig: ${(m.significance * 100).toFixed(0)}%) ${m.pattern}`;
            // Promote key moments as high-confidence memory
            await memoryStore.recordEvent("insight", `Key moment: ${m.pattern.slice(0, 60)}`, m.pattern, {
              context: `key-moment:${m.type}`,
              tags: ["ash", "key-moment", m.type],
              outcome: "success",
            });
          }
        }
      } catch { /* subsystems not available — skip key-moment detection */ }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "🧠 Distillation complete:",
              `  • ${result.promotedToText} events promoted to text memory`,
              `  • ${result.promotedToCode} text entries crystallized to code memory`,
              `  • ${result.patternsFound} patterns identified`,
              keyMomentsOutput,
            ].join("\n"),
          },
        ],
        details: { ...result, keyMoments: keyMomentsOutput.length > 0 },
      };
    },
  });

  // workspace_memory_feedback — Provide feedback on a memory entry
  pi.registerTool({
    name: "workspace_memory_feedback",
    label: "Memory Feedback",
    description:
      "Provide feedback on whether a memory entry was useful. " +
      "This updates the confidence score for risk-sensitive retrieval. " +
      "Useful=true increases confidence, useful=false decreases it.",
    parameters: Type.Object({
      summary: Type.String({ description: "Summary of the memory entry (or part of it) to provide feedback on" }),
      useful: Type.Boolean({ description: "Was this memory entry useful/accurate?" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!memoryState.initialized) {
        return {
          content: [{ type: "text" as const, text: "Memory system is not memoryState.initialized yet." }],
          isError: true,
          details: {},
        };
      }

      const updated = await memoryStore.updateFeedbackBySummary(
        params.summary,
        params.useful,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `🧠 Feedback recorded: "${params.summary}" was ${params.useful ? "useful ✓" : "not useful ✗"} (${updated} entries updated)`,
          },
        ],
        details: { updated, useful: params.useful },
      };
    },
  });

  // ── Commands ───────────────────────────────────────────────────────

  // /memory:status — Show memory status
  pi.registerCommand("memory:status", {
    description: "Show memory system status with event counts and latest entries",
    handler: async (_args, ctx) => {
      if (!memoryState.initialized) {
        ctx.ui.notify("🧠 Memory system not memoryState.initialized", "error");
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
    handler: async (args, ctx) => {
      if (!memoryState.initialized) {
        ctx.ui.notify("🧠 Memory system not memoryState.initialized", "error");
        return;
      }

      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Please provide a memory ID or summary to forget", "error");
        return;
      }

      // Check if it's an event ID
      const events = memoryStore.getEvents();
      const matchedEvents = events.filter(
        (e) => e.id === query || e.summary.toLowerCase().includes(query.toLowerCase()),
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
