/**
 * LemonHarness Memory Tools — Tool Registrations
 * Extracted from memory.ts to keep files under 400 lines.
 */

import { Type } from "typebox";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  MemoryEventType,
  memoryStore,
  memoryState,
} from "./memory-core";

/**
 * Format a memory search result as display text.
 */
function formatSearchResult(result: any): string {
  const lines: string[] = ["🧠 Memory Search Results", ""];
  if (result.textMatches.length > 0) {
    lines.push("📝 Text Memory:");
    for (const { entry, score } of result.textMatches) {
      const pct = Math.round(entry.confidenceScore * 100);
      const reuse = entry.reuseCount > 0
        ? ` (used ${entry.reuseCount}x, ${entry.successCount}✓ ${entry.failureCount}✗)`
        : "";
      lines.push(`  [${entry.type}] ${entry.summary}`);
      lines.push(`    Confidence: ${pct}% | Score: ${score.toFixed(2)}${reuse}`);
      lines.push(`    Tags: ${entry.tags.join(", ") || "(none)"}`);
      lines.push(`    Details: ${entry.details.length > 150 ? entry.details.slice(0, 150) + "..." : entry.details}`);
      lines.push("");
    }
  }
  if (result.codeMatches.length > 0) {
    lines.push("🔧 Code Memory (callable):");
    for (const { entry, score } of result.codeMatches) {
      const pct = Math.round(entry.confidenceScore * 100);
      const reuse = entry.reuseCount > 0
        ? ` (used ${entry.reuseCount}x, ${entry.successCount}✓ ${entry.failureCount}✗)`
        : "";
      lines.push(`  ${entry.name}: ${entry.summary}`);
      lines.push(`    Confidence: ${pct}% | Score: ${score.toFixed(2)}${reuse}`);
      lines.push(`    Script: ${join(".lemonharness/memory/code/", entry.name + ".sh")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/**
 * Format memory statistics as display text.
 */
function formatStats(stats: any): string {
  const eventDist = stats.eventTypeDistribution as Record<string, number>;
  const tagDist = stats.tagDistribution as Record<string, number>;

  const lines = [
    "🧠 HarnessMem — Memory Statistics",
    "─────────────────────────────────",
    "",
    `📊 Events: ${stats.eventCount} total`,
  ];
  for (const [type, count] of Object.entries(eventDist).sort()) {
    const maxVal = Math.max(...(Object.values(eventDist) as number[]));
    const bar = "█".repeat(Math.round((count as number) / maxVal * 20));
    lines.push(`   ${type.padEnd(10)} ${(count as number).toString().padStart(3)} ${bar}`);
  }
  lines.push(
    "",
    `📝 Text Memory: ${stats.textCount} entries`,
    `🔧 Code Memory: ${stats.codeCount} entries`,
    `🔄 Total Reuses: ${stats.totalReuses}`,
    `📈 Avg Confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`,
    "",
  );
  const topTags = (Object.entries(tagDist) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topTags.length > 0) {
    lines.push("🏷 Top Tags:");
    for (const [tag, count] of topTags) {
      const bar = "▓".repeat(Math.round(count / topTags[0][1] * 20));
      lines.push(`   ${tag.padEnd(15)} ${count.toString().padStart(3)} ${bar}`);
    }
  }
  lines.push("", `📁 Storage: ${memoryStore.getBaseDir()}`, `🆔 Session: ${memoryStore.getSessionId()}`);
  return lines.join("\n");
}

/**
 * Format code memory list as display text.
 */
function formatCodeEntries(entries: any[]): string {
  if (entries.length === 0) {
    return "🔧 No code memory entries yet. They are created when text memories are reused 3+ times.";
  }
  const lines = ["🔧 Crystallized Code Memory", "───────────────────────────", ""];
  for (const entry of entries) {
    const pct = Math.round(entry.confidenceScore * 100);
    lines.push(`  ${entry.name}`);
    lines.push(`    ${entry.summary}`);
    lines.push(`    Confidence: ${pct}% | Used: ${entry.reuseCount}x`);
    lines.push(`    Source events: ${entry.sourceCount}`);
    lines.push(`    Script: ${join(".lemonharness/memory/code/", entry.name + ".sh")}`);
    if (entry.requires.length > 0) lines.push(`    Requires: ${entry.requires.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Register all memory-related tools.
 */
export function registerMemoryTools(pi: ExtensionAPI) {
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
        return { content: [{ type: "text" as const, text: "Memory system is not initialized yet." }], isError: true, details: {} };
      }
      if (!params.type || !params.summary || !params.details) {
        return { content: [{ type: "text" as const, text: "Error: 'type', 'summary', and 'details' are all required." }], isError: true, details: {} };
      }
      const tags = params.tags ? params.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      let enrichedDetails = params.details;
      let enrichedTags = params.tags;
      if (params.context && /\.\w+$/.test(params.context) && !params.context.includes(" ") && memoryState.projectRoot) {
        try {
          const mod = await import("./subsystems");
          const commitMem = new mod.CommitAwareMemory(memoryState.projectRoot);
          const augmented = await commitMem.augmentWithGitContext(params.context, { details: params.details, tags: params.tags || "" });
          enrichedDetails = augmented.details;
          enrichedTags = augmented.tags;
        } catch { /* proceed without git context */ }
      }
      const event = await memoryStore.recordEvent(
        params.type as MemoryEventType, params.summary, enrichedDetails,
        { context: params.context, tags: enrichedTags ? enrichedTags.split(",").map((t) => t.trim()).filter(Boolean) : tags, outcome: params.outcome as any },
      );
      await memoryStore.getOrCreateTextMemory(event);
      return { content: [{ type: "text" as const, text: `🧠 Recorded ${params.type}: "${params.summary}" (id: ${event.id})` }], details: { eventId: event.id, type: params.type, tags } };
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
        return { content: [{ type: "text" as const, text: "Memory system is not initialized yet." }], isError: true, details: {} };
      }
      if (!params.query) {
        return { content: [{ type: "text" as const, text: "Error: 'query' (string) is required." }], isError: true, details: {} };
      }
      const tags = params.tags ? params.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      const result = memoryStore.retrieve({ query: params.query, tags, maxResults: params.max_results ?? 5, minConfidence: params.min_confidence ?? 0.5 });
      if (result.abstain) {
        return { content: [{ type: "text" as const, text: `🧠 Memory search: abstained — ${result.abstainReason || "No relevant entries found with sufficient confidence."}` }], details: { abstain: true, reason: result.abstainReason } };
      }
      return { content: [{ type: "text" as const, text: formatSearchResult(result) }], details: { textMatches: result.textMatches.length, codeMatches: result.codeMatches.length } };
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
        return { content: [{ type: "text" as const, text: "Memory system is not initialized yet." }], isError: true, details: {} };
      }
      return { content: [{ type: "text" as const, text: formatStats(memoryStore.getStats()) }], details: memoryStore.getStats() };
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
        return { content: [{ type: "text" as const, text: "Memory system is not initialized yet." }], isError: true, details: {} };
      }
      const entries = memoryStore.getCodeEntries();
      return { content: [{ type: "text" as const, text: formatCodeEntries(entries) }], details: { count: entries.length } };
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
        return { content: [{ type: "text" as const, text: "Memory system is not initialized yet." }], isError: true, details: {} };
      }
      const result = await memoryState.experienceDistiller.distill();
      let keyMomentsOutput = "";
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
          keyMomentsOutput = "\n\n💡 Key Moments Detected:";
          for (const m of moments) {
            keyMomentsOutput += `\n  • [${m.type}] (sig: ${(m.significance * 100).toFixed(0)}%) ${m.pattern}`;
            await memoryStore.recordEvent("insight", `Key moment: ${m.pattern.slice(0, 60)}`, m.pattern, {
              context: `key-moment:${m.type}`, tags: ["ash", "key-moment", m.type], outcome: "success",
            });
          }
        }
      } catch { /* skip key-moment detection */ }
      return {
        content: [{ type: "text" as const, text: [
          "🧠 Distillation complete:",
          `  • ${result.promotedToText} events promoted to text memory`,
          `  • ${result.promotedToCode} text entries crystallized to code memory`,
          `  • ${result.promotedToCode} patterns identified`,
          keyMomentsOutput,
        ].join("\n") }],
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
        return { content: [{ type: "text" as const, text: "Memory system is not initialized yet." }], isError: true, details: {} };
      }
      if (!params.summary) {
        return { content: [{ type: "text" as const, text: "Error: 'summary' (string) is required." }], isError: true, details: {} };
      }
      const updated = await memoryStore.updateFeedbackBySummary(params.summary, params.useful);
      return {
        content: [{ type: "text" as const, text: `🧠 Feedback recorded: "${params.summary}" was ${params.useful ? "useful ✓" : "not useful ✗"} (${updated} entries updated)` }],
        details: { updated, useful: params.useful },
      };
    },
  });
}
