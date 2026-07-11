// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * ExperienceDistiller — Pattern Detection & Promotion
 *
 * Scans events for patterns and promotes to text/code memory.
 */

import type { MemoryEvent, TextMemoryEntry, CodeMemoryEntry } from "./types";
import { MemoryStore } from "./memory-store";

export class ExperienceDistiller {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  async distill(): Promise<{
    promotedToText: number;
    promotedToCode: number;
    patternsFound: number;
  }> {
    const result = { promotedToText: 0, promotedToCode: 0, patternsFound: 0 };
    const solutionEvents = this.store.getEvents({ type: "solution" });
    const failureEvents = this.store.getEvents({ type: "failure" });
    const feedbackEvents = this.store.getEvents({ type: "feedback" });
    const solutionClusters = this.clusterByTags(solutionEvents);
    const failureClusters = this.clusterByTags(failureEvents);

    for (const [, group] of Object.entries(solutionClusters)) {
      if (group.length >= 2) {
        const representative = group[0];
        const existingEntry = await this.store.getOrCreateTextMemory(representative);
        existingEntry.sourceCount = Math.max(existingEntry.sourceCount, group.length);
        await this.store.updateTextMemory(existingEntry.id, { sourceCount: existingEntry.sourceCount });
        result.promotedToText++;
        result.patternsFound++;
      }
    }

    for (const [, group] of Object.entries(failureClusters)) {
      if (group.length >= 2) {
        const representative = group[0];
        const entry = await this.store.getOrCreateTextMemory({
          ...representative,
          type: "pattern",
          details: `⚠ AVOID: ${representative.summary}\n\n${representative.details}\n\nLesson: ${representative.context || "N/A"}`,
          tags: [...new Set([...representative.tags, "avoid", "lesson"])],
        });
        result.promotedToText++;
        result.patternsFound++;
      }
    }

    for (const event of feedbackEvents) {
      if (event.outcome === "success") {
        await this.store.getOrCreateTextMemory({
          ...event, type: "pattern", tags: [...event.tags, "validated"],
        });
        result.promotedToText++;
      }
    }

    const textEntries = this.store.getTextEntries();
    for (const entry of textEntries) {
      if (entry.sourceCount >= 3 && entry.confidenceScore >= 0.7 && entry.type !== "pattern") {
        const codeName = this.sanitizeName(entry.summary);
        if (!this.store.getCodeEntry(codeName)) {
          const script = this.generateScriptFromText(entry);
          await this.store.promoteToCodeMemory(entry.id, codeName, script);
          result.promotedToCode++;
        }
      }
    }

    return result;
  }

  private clusterByTags(events: MemoryEvent[]): Record<string, MemoryEvent[]> {
    const clusters: Record<string, MemoryEvent[]> = {};
    for (const event of events) {
      const key = [...event.tags].sort().join(",");
      if (!key) continue;
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(event);
    }
    return clusters;
  }

  private generateScriptFromText(entry: TextMemoryEntry): string {
    const lines: string[] = [
      "#!/usr/bin/env bash", "#", `# ${entry.summary}`,
      `# Generated from text memory: ${entry.id}`,
      `# Confidence: ${(entry.confidenceScore * 100).toFixed(0)}%`, "#",
      "set -euo pipefail", "",
    ];
    const detailLines = entry.details.split("\n");
    let inCommandBlock = false;
    for (const line of detailLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) { inCommandBlock = !inCommandBlock; continue; }
      if (inCommandBlock || /^(npm|pip|bash|python|node|npx|cd |mkdir|cp |mv |rm )/.test(trimmed)) {
        lines.push(trimmed);
      }
    }
    if (lines.length <= 6) {
      lines.push(`echo "Memory: ${entry.summary}"`);
      lines.push(`echo "See text memory ${entry.id} for details"`);
    }
    lines.push("");
    return lines.join("\n");
  }

  private sanitizeName(summary: string): string {
    return summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "unnamed";
  }
}
