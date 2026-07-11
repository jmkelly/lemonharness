// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * MemoryStore — Persistent Event Log & Dual Memory
 *
 * Implements a dual-representation memory system inspired by:
 * - Metis (arXiv:2606.24151): dual text + code memory
 * - ProjectMem (arXiv:2606.12329): event-sourced log
 * - Learning When to Remember (arXiv:2604.27283): risk-sensitive retrieval
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { MemoryEvent, MemoryEventType, TextMemoryEntry, CodeMemoryEntry, MemoryIndex, PreActionCheck, RetrievalContext, RetrievalResult } from "./types";
import { hybridSimilarity, calculateConfidence } from "./scoring";

export class MemoryStore {
  private baseDir: string = "";
  private events: MemoryEvent[] = [];
  private textMemory: Map<string, TextMemoryEntry> = new Map();
  private codeMemory: Map<string, CodeMemoryEntry> = new Map();
  private sessionId: string = "";
  private initialised: boolean = false;

  async initialize(baseDir: string, sessionId?: string) {
    this.baseDir = baseDir;
    this.sessionId = sessionId || `session-${Date.now()}`;
    await mkdir(join(baseDir, "text"), { recursive: true });
    await mkdir(join(baseDir, "code"), { recursive: true });
    await this.loadEvents();
    await this.loadTextMemory();
    await this.loadCodeMemory();
    this.initialised = true;
  }

  getBaseDir(): string { return this.baseDir; }
  getSessionId(): string { return this.sessionId; }

  async recordEvent(type: MemoryEventType, summary: string, details: string, options?: {
    context?: string; tags?: string[]; outcome?: "success" | "failure" | "unknown"; codeRef?: string;
  }): Promise<MemoryEvent> {
    const id = this.generateId(type);
    const event: MemoryEvent = { id, type, timestamp: Date.now(), sessionId: this.sessionId, summary, details, context: options?.context, tags: options?.tags || [], outcome: options?.outcome || "unknown", codeRef: options?.codeRef, reuseCount: 0, successCount: 0, failureCount: 0, confidenceScore: 0 };
    await appendFile(join(this.baseDir, "events.jsonl"), JSON.stringify(event) + "\n", "utf-8");
    this.events.push(event);
    await this.updateIndex();
    return event;
  }

  async batchAppendEvents(events: MemoryEvent[]) {
    if (events.length === 0) return;
    await appendFile(join(this.baseDir, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    this.events.push(...events);
  }

  getEvents(filter?: { type?: MemoryEventType; limit?: number }): MemoryEvent[] {
    let result = [...this.events];
    if (filter?.type) result = result.filter(e => e.type === filter.type);
    result.sort((a, b) => b.timestamp - a.timestamp);
    if (filter?.limit && filter.limit > 0) result = result.slice(0, filter.limit);
    return result;
  }

  async updateEventFeedback(eventId: string, success: boolean): Promise<void> {
    const event = this.events.find(e => e.id === eventId);
    if (!event) return;
    if (success) { event.successCount++; event.reuseCount++; }
    else { event.failureCount++; event.reuseCount++; }
    event.confidenceScore = calculateConfidence(event.successCount, event.failureCount, event.reuseCount, event.timestamp);
    await this.persistEvents();
  }

  async updateFeedbackBySummary(summary: string, success: boolean): Promise<number> {
    const matching = this.events.filter(e => e.summary.toLowerCase().includes(summary.toLowerCase()) || summary.toLowerCase().includes(e.summary.toLowerCase()));
    for (const event of matching) {
      if (success) { event.successCount++; event.reuseCount++; }
      else { event.failureCount++; event.reuseCount++; }
      event.confidenceScore = calculateConfidence(event.successCount, event.failureCount, event.reuseCount, event.timestamp);
    }
    if (matching.length > 0) await this.persistEvents();
    return matching.length;
  }

  async getOrCreateTextMemory(event: MemoryEvent): Promise<TextMemoryEntry> {
    const existing = this.findSimilarText(event.summary, 0.7);
    if (existing) { existing.sourceCount++; existing.updatedAt = Date.now(); await this.saveTextMemoryEntry(existing); return existing; }
    const entry: TextMemoryEntry = { id: this.generateId("text"), type: event.type, summary: event.summary, details: event.details, tags: event.tags, createdAt: Date.now(), updatedAt: Date.now(), sourceCount: 1, reuseCount: 0, successCount: 0, failureCount: 0, confidenceScore: 0 };
    this.textMemory.set(entry.id, entry);
    await this.saveTextMemoryEntry(entry);
    await this.updateIndex();
    return entry;
  }

  async updateTextMemory(id: string, updates: Partial<TextMemoryEntry>): Promise<TextMemoryEntry | null> {
    const entry = this.textMemory.get(id);
    if (!entry) return null;
    Object.assign(entry, updates); entry.updatedAt = Date.now();
    await this.saveTextMemoryEntry(entry);
    return entry;
  }

  async recordTextReuse(id: string, success: boolean): Promise<void> {
    const entry = this.textMemory.get(id);
    if (!entry) return;
    entry.reuseCount++;
    if (success) entry.successCount++; else entry.failureCount++;
    entry.confidenceScore = calculateConfidence(entry.successCount, entry.failureCount, entry.reuseCount);
    await this.saveTextMemoryEntry(entry);
  }

  getTextEntries(): TextMemoryEntry[] {
    return Array.from(this.textMemory.values()).sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  async promoteToCodeMemory(textId: string, name: string, scriptContent: string, requires?: string[]): Promise<CodeMemoryEntry | null> {
    const textEntry = this.textMemory.get(textId);
    if (!textEntry) return null;
    const existing = this.codeMemory.get(name);
    if (existing) { existing.scriptContent = scriptContent; existing.sourceCount++; existing.updatedAt = Date.now(); existing.requires = requires || []; await this.saveCodeMemoryEntry(existing); return existing; }
    const entry: CodeMemoryEntry = { name, summary: textEntry.summary, scriptContent, createdAt: Date.now(), updatedAt: Date.now(), sourceCount: 1, reuseCount: 0, successCount: 0, failureCount: 0, confidenceScore: 0.5, requires: requires || [] };
    this.codeMemory.set(name, entry);
    await this.saveCodeMemoryEntry(entry);
    await this.updateIndex();
    return entry;
  }

  async recordCodeReuse(name: string, success: boolean): Promise<void> {
    const entry = this.codeMemory.get(name);
    if (!entry) return;
    entry.reuseCount++; if (success) entry.successCount++; else entry.failureCount++;
    entry.confidenceScore = calculateConfidence(entry.successCount, entry.failureCount, entry.reuseCount);
    await this.saveCodeMemoryEntry(entry);
  }

  getCodeEntries(): CodeMemoryEntry[] { return Array.from(this.codeMemory.values()).sort((a, b) => b.confidenceScore - a.confidenceScore); }
  getCodeEntry(name: string): CodeMemoryEntry | undefined { return this.codeMemory.get(name); }

  retrieve(ctx: RetrievalContext): RetrievalResult {
    const minConfidence = ctx.minConfidence ?? 0.5;
    const maxResults = ctx.maxResults ?? 5;
    const scoredText: Array<{ entry: TextMemoryEntry; score: number }> = [];
    for (const entry of this.textMemory.values()) { const score = this.computeRelevance(entry, ctx); if (score > minConfidence) scoredText.push({ entry, score }); }
    const scoredCode: Array<{ entry: CodeMemoryEntry; score: number }> = [];
    for (const entry of this.codeMemory.values()) { const score = this.computeCodeRelevance(entry, ctx); if (score > minConfidence) scoredCode.push({ entry, score }); }
    scoredText.sort((a, b) => b.score - a.score);
    scoredCode.sort((a, b) => b.score - a.score);
    const textMatches = scoredText.slice(0, maxResults);
    const codeMatches = scoredCode.slice(0, Math.max(1, Math.floor(maxResults / 2)));
    const abstain = textMatches.length === 0 && codeMatches.length === 0;
    return { textMatches, codeMatches, abstain, abstainReason: abstain ? "No memory entries meet the minimum confidence threshold." : undefined };
  }

  async checkPreAction(actionType: string, actionTarget: string): Promise<PreActionCheck> {
    const result: PreActionCheck = { shouldBlock: false };
    const failures = this.events.filter(e => e.type === "failure" && (e.summary.toLowerCase().includes(actionTarget.toLowerCase()) || e.details.toLowerCase().includes(actionTarget.toLowerCase())));
    if (failures.length > 0) {
      const latest = failures[0];
      result.warning = `⚠ This action (${actionTarget}) previously failed: "${latest.summary}"`;
      result.suggestion = latest.details.slice(0, 200);
      result.relevantMemory = await this.findTextMemoryForEvent(latest);
    }
    return result;
  }

  getStats() {
    const tagDist: Record<string, number> = {}; const typeDist: Record<string, number> = {};
    for (const event of this.events) { typeDist[event.type] = (typeDist[event.type] || 0) + 1; for (const tag of event.tags) tagDist[tag] = (tagDist[tag] || 0) + 1; }
    let totalReuses = 0, totalConfidence = 0, confidenceCount = 0;
    for (const entry of this.textMemory.values()) { totalReuses += entry.reuseCount; if (entry.confidenceScore > 0) { totalConfidence += entry.confidenceScore; confidenceCount++; } }
    for (const entry of this.codeMemory.values()) { totalReuses += entry.reuseCount; if (entry.confidenceScore > 0) { totalConfidence += entry.confidenceScore; confidenceCount++; } }
    return { eventCount: this.events.length, textCount: this.textMemory.size, codeCount: this.codeMemory.size, tagDistribution: tagDist, eventTypeDistribution: typeDist, totalReuses, avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0 };
  }

  private async loadEvents() {
    try { this.events = (await readFile(join(this.baseDir, "events.jsonl"), "utf-8")).split("\n").filter(Boolean).map(line => JSON.parse(line)); }
    catch { this.events = []; }
  }

  private async persistEvents() {
    await writeFile(join(this.baseDir, "events.jsonl"), this.events.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  }

  private async loadTextMemory() {
    try {
      const files = await readdir(join(this.baseDir, "text"));
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const entry = this.parseTextMemoryFile(await readFile(join(this.baseDir, "text", file), "utf-8"), file.replace(".md", ""));
        if (entry) this.textMemory.set(entry.id, entry);
      }
    } catch { /* may be empty */ }
  }

  private async loadCodeMemory() {
    try {
      const codeDir = join(this.baseDir, "code");
      for (const file of await readdir(codeDir)) {
        if (!file.endsWith(".sh")) continue;
        try {
          const metadata = JSON.parse(await readFile(join(codeDir, file.replace(".sh", ".json")), "utf-8"));
          metadata.scriptContent = await readFile(join(codeDir, file), "utf-8");
          this.codeMemory.set(metadata.name, metadata as CodeMemoryEntry);
        } catch { /* skip */ }
      }
    } catch { /* may be empty */ }
  }

  private async saveTextMemoryEntry(entry: TextMemoryEntry) {
    await writeFile(join(this.baseDir, "text", `${entry.id}.md`), this.formatTextMemoryFile(entry), "utf-8");
  }

  private async saveCodeMemoryEntry(entry: CodeMemoryEntry) {
    const codeDir = join(this.baseDir, "code");
    await writeFile(join(codeDir, `${entry.name}.sh`), entry.scriptContent, "utf-8");
    const { scriptContent, ...meta } = entry;
    await writeFile(join(codeDir, `${entry.name}.json`), JSON.stringify(meta, null, 2), "utf-8");
  }

  private async updateIndex() {
    const tagDist: Record<string, number> = {};
    for (const event of this.events) { for (const tag of event.tags) tagDist[tag] = (tagDist[tag] || 0) + 1; }
    try { await writeFile(join(this.baseDir, "index.json"), JSON.stringify({ version: 1, lastUpdated: Date.now(), events: this.events.length, textEntries: this.textMemory.size, codeEntries: this.codeMemory.size, tags: tagDist }, null, 2), "utf-8"); } catch { /* non-critical */ }
  }

  private findSimilarText(summary: string, threshold: number): TextMemoryEntry | undefined {
    const words = new Set(summary.toLowerCase().split(/\s+/));
    for (const entry of this.textMemory.values()) {
      const entryWords = new Set(entry.summary.toLowerCase().split(/\s+/));
      const intersection = new Set([...words].filter(w => entryWords.has(w)));
      const union = new Set([...words, ...entryWords]);
      if (intersection.size / union.size >= threshold) return entry;
    }
    return undefined;
  }

  private computeRelevance(entry: TextMemoryEntry, ctx: RetrievalContext): number {
    let score = 0;
    score += hybridSimilarity(ctx.query, entry.summary + " " + entry.details.slice(0, 200)) * 0.4;
    if (ctx.tags && ctx.tags.length > 0) {
      score += (entry.tags.filter(t => ctx.tags!.includes(t)).length / Math.max(ctx.tags.length, 1)) * 0.2;
    }
    score += entry.confidenceScore * 0.3;
    score += (Math.min(entry.reuseCount, 10) / 10) * 0.1;
    return Math.min(1, score);
  }

  private computeCodeRelevance(entry: CodeMemoryEntry, ctx: RetrievalContext): number {
    let score = 0;
    score += hybridSimilarity(ctx.query, entry.summary + " " + entry.scriptContent.slice(0, 300)) * 0.35;
    score += entry.confidenceScore * 0.35;
    score += (Math.min(entry.reuseCount, 10) / 10) * 0.2;
    const ageDays = (Date.now() - entry.createdAt) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - ageDays / 30) * 0.1;
    return Math.min(1, score);
  }

  private async findTextMemoryForEvent(event: MemoryEvent): Promise<TextMemoryEntry | undefined> {
    for (const entry of this.textMemory.values()) {
      if (entry.summary === event.summary || entry.tags.some(t => event.tags.includes(t))) return entry;
    }
    return undefined;
  }

  private formatTextMemoryFile(entry: TextMemoryEntry): string {
    return ["---", `id: ${entry.id}`, `type: ${entry.type}`, `created_at: ${new Date(entry.createdAt).toISOString()}`, `updated_at: ${new Date(entry.updatedAt).toISOString()}`, `source_count: ${entry.sourceCount}`, `reuse_count: ${entry.reuseCount}`, `success_count: ${entry.successCount}`, `failure_count: ${entry.failureCount}`, `confidence: ${entry.confidenceScore.toFixed(3)}`, entry.tags.length > 0 ? `tags: [${entry.tags.join(", ")}]` : "", "---", "", `# ${entry.summary}`, "", entry.details].filter(Boolean).join("\n");
  }

  private parseTextMemoryFile(content: string, fallbackId: string): TextMemoryEntry | null {
    try {
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) return null;
      const fm = frontmatterMatch[1], body = content.slice(frontmatterMatch[0].length).trim();
      const gf = (n: string) => fm.split("\n").find(l => l.startsWith(`${n}: `))?.slice(n.length + 2).trim();
      const gi = (n: string) => { const v = gf(n); return v ? parseInt(v, 10) : 0; };
      const gfl = (n: string) => { const v = gf(n); return v ? parseFloat(v) : 0; };
      const pt = () => { const r = gf("tags"); return r ? r.replace(/^\[|\]$/g, "").split(",").map(t => t.trim()).filter(Boolean) : []; };
      const entry: TextMemoryEntry = { id: gf("id") || fallbackId, type: (gf("type") as MemoryEventType) || "insight", summary: body.split("\n")[0]?.replace(/^#\s*/, "") || "Untitled", details: body, tags: pt(), createdAt: new Date(gf("created_at") || Date.now()).getTime(), updatedAt: new Date(gf("updated_at") || Date.now()).getTime(), sourceCount: gi("source_count") || 1, reuseCount: gi("reuse_count"), successCount: gi("success_count"), failureCount: gi("failure_count"), confidenceScore: gfl("confidence") };
      const hm = body.match(/^#\s+(.+)$/m);
      if (hm) entry.summary = hm[1].trim();
      return entry;
    } catch { return null; }
  }

  private generateId(type: string): string {
    const prefix = type.slice(0, 3);
    const hash = createHash("md5").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 8);
    return `${prefix}-${hash}`;
  }
}
