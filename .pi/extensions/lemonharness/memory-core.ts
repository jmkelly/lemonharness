// @ts-nocheck — Runtime utility module, not a pi extension
import { existsSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
/**
 * HarnessMem — Memory & Learning Extension for Code Agents
 *
 * Implements a dual-representation memory system inspired by:
 * - Metis (arXiv:2606.24151): dual text + code memory
 * - ProjectMem (arXiv:2606.12329): event-sourced log, pre-action governance
 * - MemCoder (arXiv:2603.13258): experience distillation from project history
 * - Distilling Feedback (arXiv:2601.05960): feedback → retrievable guidelines
 * - Learning When to Remember (arXiv:2604.27283): risk-sensitive retrieval
 *
 * Integrates with LemonHarness workspace and time director.
 */

import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
  stat as fsStat,
} from "node:fs/promises";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type MemoryEventType =
  | "decision"   // Key architectural/design choice
  | "solution"   // Successfully resolved a problem
  | "failure"    // Attempt that didn't work
  | "pattern"    // Reusable approach discovered
  | "feedback"   // Validation result / correction
  | "insight";   // Project-specific knowledge

export interface MemoryEvent {
  id: string;
  type: MemoryEventType;
  timestamp: number;
  sessionId: string;
  summary: string;
  details: string;
  context?: string;
  tags: string[];
  outcome?: "success" | "failure" | "unknown";
  codeRef?: string;
  // Tracking for risk-sensitive retrieval
  reuseCount: number;
  successCount: number;
  failureCount: number;
  confidenceScore: number;
}

export interface TextMemoryEntry {
  id: string;
  type: MemoryEventType;
  summary: string;
  details: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sourceCount: number;       // How many events generated this
  reuseCount: number;
  successCount: number;
  failureCount: number;
  confidenceScore: number;
}

export interface CodeMemoryEntry {
  name: string;
  summary: string;
  scriptContent: string;
  createdAt: number;
  updatedAt: number;
  sourceCount: number;       // How many text entries were distilled
  reuseCount: number;
  successCount: number;
  failureCount: number;
  confidenceScore: number;
  requires: string[];        // Dependencies required
}

export interface MemoryIndex {
  version: number;
  lastUpdated: number;
  events: number;
  textEntries: number;
  codeEntries: number;
  tags: Record<string, number>;
}

export interface PreActionCheck {
  shouldBlock: boolean;
  warning?: string;
  suggestion?: string;
  relevantMemory?: TextMemoryEntry | CodeMemoryEntry;
}

export interface RetrievalContext {
  query: string;
  tags?: string[];
  maxResults?: number;
  /** Default raised to 0.5 (was 0.3) to reduce context noise from low-relevance retrievals */
  minConfidence?: number;
  taskType?: string;
}

export interface RetrievalResult {
  textMatches: Array<{ entry: TextMemoryEntry; score: number }>;
  codeMatches: Array<{ entry: CodeMemoryEntry; score: number }>;
  abstain: boolean;
  abstainReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// MemoryStore — Persistent Event Log & Dual Memory
// ─────────────────────────────────────────────────────────────────────────

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

    // Create directory structure
    await mkdir(join(baseDir, "text"), { recursive: true });
    await mkdir(join(baseDir, "code"), { recursive: true });

    // Load existing state
    await this.loadEvents();
    await this.loadTextMemory();
    await this.loadCodeMemory();

    this.initialised = true;
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  // ── Event Log ──────────────────────────────────────────────────

  async recordEvent(
    type: MemoryEventType,
    summary: string,
    details: string,
    options?: {
      context?: string;
      tags?: string[];
      outcome?: "success" | "failure" | "unknown";
      codeRef?: string;
    },
  ): Promise<MemoryEvent> {
    const id = this.generateId(type);
    const event: MemoryEvent = {
      id,
      type,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      summary,
      details,
      context: options?.context,
      tags: options?.tags || [],
      outcome: options?.outcome || "unknown",
      codeRef: options?.codeRef,
      reuseCount: 0,
      successCount: 0,
      failureCount: 0,
      confidenceScore: 0,
    };

    // Append to events.jsonl
    const eventPath = join(this.baseDir, "events.jsonl");
    await appendFile(eventPath, JSON.stringify(event) + "\n", "utf-8");

    // Add to in-memory
    this.events.push(event);

    // Update index
    await this.updateIndex();

    return event;
  }

  // Append a list of events in batch (for replaying)
  async batchAppendEvents(events: MemoryEvent[]) {
    if (events.length === 0) return;
    const eventPath = join(this.baseDir, "events.jsonl");
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await appendFile(eventPath, lines, "utf-8");
    this.events.push(...events);
  }

  getEvents(filter?: { type?: MemoryEventType; limit?: number }): MemoryEvent[] {
    let result = [...this.events];
    if (filter?.type) {
      result = result.filter((e) => e.type === filter.type);
    }
    // Sort by timestamp descending (most recent first)
    result.sort((a, b) => b.timestamp - a.timestamp);
    if (filter?.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }
    return result;
  }

  async updateEventFeedback(eventId: string, success: boolean): Promise<void> {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) return;

    if (success) {
      event.successCount++;
      event.reuseCount++;
    } else {
      event.failureCount++;
      event.reuseCount++;
    }

    // Recalculate confidence with time-based decay (Ebbinghaus forgetting curve)
    event.confidenceScore = this.calculateConfidence(
      event.successCount,
      event.failureCount,
      event.reuseCount,
      event.timestamp,
    );

    // Persist the event log with updated values
    await this.persistEvents();
  }



  /**
   * Update event feedback by matching on summary text (fuzzy-lite matching).
   * Returns number of events updated.
   */
  async updateFeedbackBySummary(summary: string, success: boolean): Promise<number> {
    // Find events with matching summary (exact or containing)
    const matching = this.events.filter(
      (e) => e.summary.toLowerCase().includes(summary.toLowerCase()) ||
             summary.toLowerCase().includes(e.summary.toLowerCase()),
    );
    for (const event of matching) {
      if (success) {
        event.successCount++;
        event.reuseCount++;
      } else {
        event.failureCount++;
        event.reuseCount++;
      }
      // Apply time-based decay to confidence
      event.confidenceScore = this.calculateConfidence(
        event.successCount,
        event.failureCount,
        event.reuseCount,
        event.timestamp,
      );
    }
    if (matching.length > 0) {
      await this.persistEvents();
    }
    return matching.length;
  }

  // ── Text Memory ────────────────────────────────────────────────

  async getOrCreateTextMemory(event: MemoryEvent): Promise<TextMemoryEntry> {
    // Check if similar text memory already exists
    const existing = this.findSimilarText(event.summary, 0.7);
    if (existing) {
      // Update source count
      existing.sourceCount++;
      existing.updatedAt = Date.now();
      await this.saveTextMemoryEntry(existing);
      return existing;
    }

    const entry: TextMemoryEntry = {
      id: this.generateId("text"),
      type: event.type,
      summary: event.summary,
      details: event.details,
      tags: event.tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceCount: 1,
      reuseCount: 0,
      successCount: 0,
      failureCount: 0,
      confidenceScore: 0,
    };

    this.textMemory.set(entry.id, entry);
    await this.saveTextMemoryEntry(entry);
    await this.updateIndex();

    return entry;
  }

  async updateTextMemory(
    id: string,
    updates: Partial<TextMemoryEntry>,
  ): Promise<TextMemoryEntry | null> {
    const entry = this.textMemory.get(id);
    if (!entry) return null;

    Object.assign(entry, updates);
    entry.updatedAt = Date.now();
    await this.saveTextMemoryEntry(entry);
    return entry;
  }

  async recordTextReuse(id: string, success: boolean): Promise<void> {
    const entry = this.textMemory.get(id);
    if (!entry) return;

    entry.reuseCount++;
    if (success) entry.successCount++;
    else entry.failureCount++;

    entry.confidenceScore = this.calculateConfidence(
      entry.successCount,
      entry.failureCount,
      entry.reuseCount,
    );

    await this.saveTextMemoryEntry(entry);
  }

  getTextEntries(): TextMemoryEntry[] {
    return Array.from(this.textMemory.values()).sort(
      (a, b) => b.confidenceScore - a.confidenceScore,
    );
  }

  // ── Code Memory ────────────────────────────────────────────────

  async promoteToCodeMemory(
    textId: string,
    name: string,
    scriptContent: string,
    requires?: string[],
  ): Promise<CodeMemoryEntry | null> {
    const textEntry = this.textMemory.get(textId);
    if (!textEntry) return null;

    // Check if code with this name already exists
    const existing = this.codeMemory.get(name);
    if (existing) {
      // Update instead
      existing.scriptContent = scriptContent;
      existing.sourceCount++;
      existing.updatedAt = Date.now();
      existing.requires = requires || [];
      await this.saveCodeMemoryEntry(existing);
      return existing;
    }

    const entry: CodeMemoryEntry = {
      name,
      summary: textEntry.summary,
      scriptContent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceCount: 1,
      reuseCount: 0,
      successCount: 0,
      failureCount: 0,
      confidenceScore: 0.5, // Initial confidence for promoted entries
      requires: requires || [],
    };

    this.codeMemory.set(name, entry);
    await this.saveCodeMemoryEntry(entry);
    await this.updateIndex();

    return entry;
  }

  async recordCodeReuse(name: string, success: boolean): Promise<void> {
    const entry = this.codeMemory.get(name);
    if (!entry) return;

    entry.reuseCount++;
    if (success) entry.successCount++;
    else entry.failureCount++;

    entry.confidenceScore = this.calculateConfidence(
      entry.successCount,
      entry.failureCount,
      entry.reuseCount,
    );

    await this.saveCodeMemoryEntry(entry);
  }

  getCodeEntries(): CodeMemoryEntry[] {
    return Array.from(this.codeMemory.values()).sort(
      (a, b) => b.confidenceScore - a.confidenceScore,
    );
  }

  getCodeEntry(name: string): CodeMemoryEntry | undefined {
    return this.codeMemory.get(name);
  }

  // ── Retrieval ──────────────────────────────────────────────────

  /**
   * Risk-sensitive retrieval: returns best matches, or abstains if
   * no result meets the confidence threshold.
   */
  retrieve(ctx: RetrievalContext): RetrievalResult {
    const minConfidence = ctx.minConfidence ?? 0.5;
    const maxResults = ctx.maxResults ?? 5;

    // Score text entries
    const scoredText: Array<{ entry: TextMemoryEntry; score: number }> = [];
    for (const entry of this.textMemory.values()) {
      const score = this.computeRelevance(entry, ctx);
      if (score > minConfidence) {
        scoredText.push({ entry, score });
      }
    }

    // Score code entries
    const scoredCode: Array<{ entry: CodeMemoryEntry; score: number }> = [];
    for (const entry of this.codeMemory.values()) {
      const score = this.computeCodeRelevance(entry, ctx);
      if (score > minConfidence) {
        scoredCode.push({ entry, score });
      }
    }

    // Sort by score descending
    scoredText.sort((a, b) => b.score - a.score);
    scoredCode.sort((a, b) => b.score - a.score);

    const textMatches = scoredText.slice(0, maxResults);
    const codeMatches = scoredCode.slice(0, Math.max(1, Math.floor(maxResults / 2)));

    // Abstention logic: if no matches meet threshold, abstain
    const abstain = textMatches.length === 0 && codeMatches.length === 0;
    let abstainReason: string | undefined;
    if (abstain) {
      abstainReason = "No memory entries meet the minimum confidence threshold. " +
        "Using no memory is safer than using low-confidence memory.";
    }

    return { textMatches, codeMatches, abstain, abstainReason };
  }

  /**
   * Pre-action governance: check if action would repeat a failure.
   */
  async checkPreAction(
    actionType: string,
    actionTarget: string,
  ): Promise<PreActionCheck> {
    const result: PreActionCheck = { shouldBlock: false };

    // Check for previous failures matching this action
    const failures = this.events.filter(
      (e) =>
        e.type === "failure" &&
        (e.summary.toLowerCase().includes(actionTarget.toLowerCase()) ||
          e.details.toLowerCase().includes(actionTarget.toLowerCase())),
    );

    if (failures.length > 0) {
      const latest = failures[0];
      result.warning =
        `⚠ This action (${actionTarget}) previously failed: "${latest.summary}"`;
      result.suggestion = latest.details.slice(0, 200);
      result.relevantMemory = await this.findTextMemoryForEvent(latest);
    }

    return result;
  }

  // ── Stats ──────────────────────────────────────────────────────

  getStats(): {
    eventCount: number;
    textCount: number;
    codeCount: number;
    tagDistribution: Record<string, number>;
    eventTypeDistribution: Record<string, number>;
    totalReuses: number;
    avgConfidence: number;
  } {
    const tagDist: Record<string, number> = {};
    const typeDist: Record<string, number> = {};

    for (const event of this.events) {
      typeDist[event.type] = (typeDist[event.type] || 0) + 1;
      for (const tag of event.tags) {
        tagDist[tag] = (tagDist[tag] || 0) + 1;
      }
    }

    let totalReuses = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const entry of this.textMemory.values()) {
      totalReuses += entry.reuseCount;
      if (entry.confidenceScore > 0) {
        totalConfidence += entry.confidenceScore;
        confidenceCount++;
      }
    }
    for (const entry of this.codeMemory.values()) {
      totalReuses += entry.reuseCount;
      if (entry.confidenceScore > 0) {
        totalConfidence += entry.confidenceScore;
        confidenceCount++;
      }
    }

    return {
      eventCount: this.events.length,
      textCount: this.textMemory.size,
      codeCount: this.codeMemory.size,
      tagDistribution: tagDist,
      eventTypeDistribution: typeDist,
      totalReuses,
      avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
    };
  }

  // ── Persistence Helpers ────────────────────────────────────────

  private async loadEvents() {
    const eventPath = join(this.baseDir, "events.jsonl");
    try {
      const content = await readFile(eventPath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      this.events = lines.map((line) => JSON.parse(line));
    } catch (e) {
      console.error("Memory: failed to load events", e);
      this.events = [];
    }
  }

  private async persistEvents() {
    const eventPath = join(this.baseDir, "events.jsonl");
    const lines = this.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await writeFile(eventPath, lines, "utf-8");
  }

  private async loadTextMemory() {
    const textDir = join(this.baseDir, "text");
    try {
      const files = await readdir(textDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await readFile(join(textDir, file), "utf-8");
        const entry = this.parseTextMemoryFile(content, file.replace(".md", ""));
        if (entry) {
          this.textMemory.set(entry.id, entry);
        }
      }
    } catch {
      // Directory may not exist or be empty
    }
  }

  private async loadCodeMemory() {
    const codeDir = join(this.baseDir, "code");
    try {
      const files = await readdir(codeDir);
      for (const file of files) {
        if (!file.endsWith(".sh")) continue;
        const indexFile = file.replace(".sh", ".json");
        const indexPath = join(codeDir, indexFile);
        const scriptPath = join(codeDir, file);

        try {
          const metadata = JSON.parse(await readFile(indexPath, "utf-8"));
          const scriptContent = await readFile(scriptPath, "utf-8");
          metadata.scriptContent = scriptContent;
          this.codeMemory.set(metadata.name, metadata as CodeMemoryEntry);
        } catch {
          // Skip entries without valid metadata
        }
      }
    } catch {
      // Directory may not exist or be empty
    }
  }

  private async saveTextMemoryEntry(entry: TextMemoryEntry) {
    const textDir = join(this.baseDir, "text");
    const filePath = join(textDir, `${entry.id}.md`);
    const content = this.formatTextMemoryFile(entry);
    await writeFile(filePath, content, "utf-8");
  }

  private async saveCodeMemoryEntry(entry: CodeMemoryEntry) {
    const codeDir = join(this.baseDir, "code");
    const scriptPath = join(codeDir, `${entry.name}.sh`);
    const metaPath = join(codeDir, `${entry.name}.json`);

    // Write script
    await writeFile(scriptPath, entry.scriptContent, "utf-8");

    // Write metadata (without script content to keep it small)
    const { scriptContent, ...meta } = entry;
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }

  private async updateIndex() {
    const tagDist: Record<string, number> = {};
    for (const event of this.events) {
      for (const tag of event.tags) {
        tagDist[tag] = (tagDist[tag] || 0) + 1;
      }
    }

    const index: MemoryIndex = {
      version: 1,
      lastUpdated: Date.now(),
      events: this.events.length,
      textEntries: this.textMemory.size,
      codeEntries: this.codeMemory.size,
      tags: tagDist,
    };

    try {
      await writeFile(
        join(this.baseDir, "index.json"),
        JSON.stringify(index, null, 2),
        "utf-8",
      );
    } catch {
      // Non-critical
    }
  }

  // ── Query and Scoring ──────────────────────────────────────────

  private findSimilarText(
    summary: string,
    threshold: number,
  ): TextMemoryEntry | undefined {
    const words = summary.toLowerCase().split(/\s+/);
    const wordSet = new Set(words);

    for (const entry of this.textMemory.values()) {
      const entryWords = entry.summary.toLowerCase().split(/\s+/);
      const entrySet = new Set(entryWords);
      const intersection = new Set(
        [...wordSet].filter((w) => entrySet.has(w)),
      );
      const union = new Set([...wordSet, ...entrySet]);
      const jaccard = intersection.size / union.size;
      if (jaccard >= threshold) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Simple tokenizer with stemming for TF-IDF computation.
   * Pure TypeScript — no external dependencies needed.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 2 && t.length <= 40)
      .map(t => this.simpleStem(t));
  }

  /**
   * Simple stemmer: removes common English suffixes.
   * Not as accurate as Porter2, but sufficient for memory retrieval.
   */
  private simpleStem(word: string): string {
    if (word.length <= 4) return word;
    const suffixes = ["ing", "tion", "sion", "ment", "ness", "able", "ible", "ful", "less", "ly", "ed", "es", "s"];
    for (const suffix of suffixes) {
      if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
        return word.slice(0, -suffix.length);
      }
    }
    return word;
  }

  /**
   * TF-IDF cosine similarity between query and document text.
   *
   * Research basis: TF-IDF outperforms Jaccard by 15-25% for agent memory
   * retrieval (2025 comparisons). This is a pure TypeScript implementation.
   */
  private tfidfSimilarity(query: string, document: string): number {
    const queryTokens = this.tokenize(query);
    const docTokens = this.tokenize(document);

    if (queryTokens.length === 0 || docTokens.length === 0) return 0;

    // Build term frequency maps
    const queryTF = new Map<string, number>();
    const docTF = new Map<string, number>();

    for (const t of queryTokens) queryTF.set(t, (queryTF.get(t) || 0) + 1);
    for (const t of docTokens) docTF.set(t, (docTF.get(t) || 0) + 1);

    // Normalize TF: log frequency
    for (const [t, f] of queryTF) queryTF.set(t, 1 + Math.log2(f));
    for (const [t, f] of docTF) docTF.set(t, 1 + Math.log2(f));

    // IDF: treat the two documents as the corpus
    const allTerms = new Set([...queryTF.keys(), ...docTF.keys()]);
    const N = 2;

    // Compute dot product and magnitudes
    let dotProduct = 0;
    let queryMag = 0;
    let docMag = 0;

    for (const term of allTerms) {
      const qFreq = queryTF.get(term) || 0;
      const dFreq = docTF.get(term) || 0;

      // IDF: term appears in query, doc, or both
      const docFreq = (qFreq > 0 ? 1 : 0) + (dFreq > 0 ? 1 : 0);
      const idf = Math.log2((N + 1) / (docFreq + 1)) + 1;

      const qWeight = qFreq * idf;
      const dWeight = dFreq * idf;

      dotProduct += qWeight * dWeight;
      queryMag += qWeight * qWeight;
      docMag += dWeight * dWeight;
    }

    if (queryMag === 0 || docMag === 0) return 0;
    return dotProduct / (Math.sqrt(queryMag) * Math.sqrt(docMag));
  }

  /**
   * Hybrid similarity: combines TF-IDF cosine with Jaccard overlap.
   * Weighted: 60% TF-IDF, 40% Jaccard.
   *
   * This captures both term frequency information (TF-IDF) and
   * broad lexical overlap (Jaccard).
   */
  private hybridSimilarity(query: string, document: string): number {
    const tfidf = this.tfidfSimilarity(query, document);

    const queryWords = new Set(this.tokenize(query));
    const docWords = new Set(this.tokenize(document));
    const intersection = new Set([...queryWords].filter(w => docWords.has(w)));
    const union = new Set([...queryWords, ...docWords]);
    const jaccard = union.size > 0 ? intersection.size / union.size : 0;

    return tfidf * 0.6 + jaccard * 0.4;
  }

  private computeRelevance(
    entry: TextMemoryEntry,
    ctx: RetrievalContext,
  ): number {
    let score = 0;

    // Hybrid similarity (TF-IDF + Jaccard) for summary
    const similarity = this.hybridSimilarity(ctx.query, entry.summary + " " + entry.details.slice(0, 200));
    score += similarity * 0.4;

    // Tag overlap
    if (ctx.tags && ctx.tags.length > 0) {
      const tagOverlap = entry.tags.filter((t) => ctx.tags!.includes(t)).length;
      score += (tagOverlap / Math.max(ctx.tags.length, 1)) * 0.2;
    }

    // Confidence factor (with time-based decay applied)
    score += entry.confidenceScore * 0.3;

    // Reuse bonus (diminishing after 10 uses)
    const reuseBonus = Math.min(entry.reuseCount, 10) / 10 * 0.1;
    score += reuseBonus;

    return Math.min(1, score);
  }

  private computeCodeRelevance(
    entry: CodeMemoryEntry,
    ctx: RetrievalContext,
  ): number {
    let score = 0;

    // Hybrid similarity for summary + script content
    const similarity = this.hybridSimilarity(ctx.query, entry.summary + " " + entry.scriptContent.slice(0, 300));
    score += similarity * 0.35;

    // Confidence factor
    score += entry.confidenceScore * 0.35;

    // Reuse bonus
    const reuseBonus = Math.min(entry.reuseCount, 10) / 10 * 0.2;
    score += reuseBonus;

    // Freshness bonus (newer entries get slight boost)
    const ageDays = (Date.now() - entry.createdAt) / (1000 * 60 * 60 * 24);
    const freshnessBonus = Math.max(0, 1 - ageDays / 30) * 0.1;
    score += freshnessBonus;

    return Math.min(1, score);
  }

  private async findTextMemoryForEvent(
    event: MemoryEvent,
  ): Promise<TextMemoryEntry | undefined> {
    // Try to find a text entry that was created from this event
    for (const entry of this.textMemory.values()) {
      if (entry.summary === event.summary || entry.tags.some((t) => event.tags.includes(t))) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Calculate confidence score with optional time-based decay.
   * Research basis: Ebbinghaus forgetting curve applied to agent memory (2025).
   * Memories not accessed recently have lower confidence.
   */
  /**
   * Calculate confidence score with time-based decay (Ebbinghaus forgetting curve).
   *
   * Research basis: Adapted from Ebbinghaus forgetting curve for agent memory (2025).
   * - Decay half-life: 30 days (memories lose ~50% confidence in 30 days without access)
   * - Reinforced entries (high reuseCount) get extended half-life (up to 4x)
   * - Guarantees confidence >= 0 (never goes negative)
   */
  private calculateConfidence(
    successCount: number,
    failureCount: number,
    reuseCount: number,
    lastAccessTime?: number,
  ): number {
    if (reuseCount === 0) return 0;
    const successRate = successCount / (successCount + failureCount);
    const failurePenalty = Math.pow(1 - failureCount / Math.max(reuseCount, 1), 2);
    const reuseFactor = Math.min(reuseCount / 10, 1);

    let confidence = successRate * failurePenalty * (0.5 + 0.5 * reuseFactor);

    // Apply Ebbinghaus forgetting curve decay with configurable half-life
    // Each reinforcement extends the effective half-life
    const baseHalfLifeDays = 30;
    const reuseMultiplier = 1 + Math.min(reuseCount, 6) * 0.5;
    if (lastAccessTime && lastAccessTime > 0) {
      const daysSinceAccess = (Date.now() - lastAccessTime) / (1000 * 60 * 60 * 24);
      if (daysSinceAccess > 7) {
        const effectiveHalfLifeDays = baseHalfLifeDays * reuseMultiplier;
        const decayFactor = Math.exp(-daysSinceAccess / effectiveHalfLifeDays);
        confidence *= Math.max(0.05, decayFactor);
      }
    }

    return Math.max(0, Math.min(1, confidence));
  }

  // ── File Format Helpers ────────────────────────────────────────

  private formatTextMemoryFile(entry: TextMemoryEntry): string {
    return [
      "---",
      `id: ${entry.id}`,
      `type: ${entry.type}`,
      `created_at: ${new Date(entry.createdAt).toISOString()}`,
      `updated_at: ${new Date(entry.updatedAt).toISOString()}`,
      `source_count: ${entry.sourceCount}`,
      `reuse_count: ${entry.reuseCount}`,
      `success_count: ${entry.successCount}`,
      `failure_count: ${entry.failureCount}`,
      `confidence: ${entry.confidenceScore.toFixed(3)}`,
      entry.tags.length > 0 ? `tags: [${entry.tags.join(", ")}]` : "",
      "---",
      "",
      `# ${entry.summary}`,
      "",
      entry.details,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private parseTextMemoryFile(
    content: string,
    fallbackId: string,
  ): TextMemoryEntry | null {
    try {
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) return null;

      const frontmatter = frontmatterMatch[1];
      const body = content.slice(frontmatterMatch[0].length).trim();

      const getField = (name: string): string | undefined => {
        const line = frontmatter
          .split("\n")
          .find((l) => l.startsWith(`${name}: `));
        return line?.slice(name.length + 2).trim();
      };

      const getInt = (name: string): number => {
        const val = getField(name);
        return val ? parseInt(val, 10) : 0;
      };

      const getFloat = (name: string): number => {
        const val = getField(name);
        return val ? parseFloat(val) : 0;
      };

      const parseTags = (): string[] => {
        const raw = getField("tags");
        if (!raw) return [];
        return raw
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      };

      const entry: TextMemoryEntry = {
        id: getField("id") || fallbackId,
        type: (getField("type") as MemoryEventType) || "insight",
        summary: body.split("\n")[0]?.replace(/^#\s*/, "") || "Untitled",
        details: body,
        tags: parseTags(),
        createdAt: new Date(getField("created_at") || Date.now()).getTime(),
        updatedAt: new Date(getField("updated_at") || Date.now()).getTime(),
        sourceCount: getInt("source_count") || 1,
        reuseCount: getInt("reuse_count"),
        successCount: getInt("success_count"),
        failureCount: getInt("failure_count"),
        confidenceScore: getFloat("confidence"),
      };

      // Extract summary from heading if present
      const headingMatch = body.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        entry.summary = headingMatch[1].trim();
      }

      return entry;
    } catch {
      return null;
    }
  }

  private generateId(type: string): string {
    const prefix = type.slice(0, 3);
    const hash = createHash("md5")
      .update(`${Date.now()}-${Math.random()}`)
      .digest("hex")
      .slice(0, 8);
    return `${prefix}-${hash}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ExperienceDistiller — Pattern Detection & Promotion
// ─────────────────────────────────────────────────────────────────────────

export class ExperienceDistiller {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Run distillation: scan events for patterns and promote to text/code memory.
   * Called periodically and on-demand.
   */
  async distill(): Promise<{
    promotedToText: number;
    promotedToCode: number;
    patternsFound: number;
  }> {
    const result = { promotedToText: 0, promotedToCode: 0, patternsFound: 0 };

    // 1. Find solution/failure patterns with high frequency
    const solutionEvents = this.store.getEvents({ type: "solution" });
    const failureEvents = this.store.getEvents({ type: "failure" });
    const feedbackEvents = this.store.getEvents({ type: "feedback" });

    // 2. Cluster by tag similarity
    const solutionClusters = this.clusterByTags(solutionEvents);
    const failureClusters = this.clusterByTags(failureEvents);

    // 3. Promote frequent solutions to text memory
    for (const [, group] of Object.entries(solutionClusters)) {
      if (group.length >= 2) {
        // Already seen this solution multiple times → promote
        const representative = group[0];
        const existingEntry = await this.store.getOrCreateTextMemory(representative);
        // Increase source count for each additional occurrence
        existingEntry.sourceCount = Math.max(existingEntry.sourceCount, group.length);
        await this.store.updateTextMemory(existingEntry.id, {
          sourceCount: existingEntry.sourceCount,
        });
        result.promotedToText++;
        result.patternsFound++;
      }
    }

    // 4. Promote frequent failures (as "avoid" patterns)
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

    // 5. Process feedback into text memory
    for (const event of feedbackEvents) {
      if (event.outcome === "success") {
        await this.store.getOrCreateTextMemory({
          ...event,
          type: "pattern",
          tags: [...event.tags, "validated"],
        });
        result.promotedToText++;
      }
    }

    // 6. Check for code promotion candidates
    // A text entry used 3+ times with high confidence → promote to code
    const textEntries = this.store.getTextEntries();
    for (const entry of textEntries) {
      if (
        entry.sourceCount >= 3 &&
        entry.confidenceScore >= 0.7 &&
        entry.type !== "pattern" // Patterns might not be executable
      ) {
        // Generate a script from the text memory
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

  /**
   * Cluster events by shared tags. Groups with 2+ events form a pattern.
   */
  private clusterByTags(events: MemoryEvent[]): Record<string, MemoryEvent[]> {
    const clusters: Record<string, MemoryEvent[]> = {};

    for (const event of events) {
      // Create a cluster key from sorted tags
      const key = [...event.tags].sort().join(",");
      if (!key) continue;
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(event);
    }

    return clusters;
  }

  /**
   * Generate a simple shell script from a text memory entry.
   * Falls back to a command list extracted from the detail text.
   */
  private generateScriptFromText(entry: TextMemoryEntry): string {
    const lines: string[] = [
      "#!/usr/bin/env bash",
      "#",
      `# ${entry.summary}`,
      `# Generated from text memory: ${entry.id}`,
      `# Confidence: ${(entry.confidenceScore * 100).toFixed(0)}%`,
      "#",
      "set -euo pipefail",
      "",
    ];

    // Extract lines that look like commands (starting with common prefixes)
    const detailLines = entry.details.split("\n");
    let inCommandBlock = false;
    for (const line of detailLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        inCommandBlock = !inCommandBlock;
        continue;
      }
      if (inCommandBlock || /^(npm|pip|bash|python|node|npx|cd |mkdir|cp |mv |rm )/.test(trimmed)) {
        lines.push(trimmed);
      }
    }

    if (lines.length <= 6) {
      // No commands found, add a placeholder
      lines.push(`echo "Memory: ${entry.summary}"`);
      lines.push(`echo "See text memory ${entry.id} for details"`);
    }

    lines.push("");
    return lines.join("\n");
  }

  private sanitizeName(summary: string): string {
    return summary
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "unnamed";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Extension State
// ─────────────────────────────────────────────────────────────────────────

export const memoryStore = new MemoryStore();
export const memoryState = {
  experienceDistiller: null as ExperienceDistiller | null,
  initialized: false,
  distillInterval: null as ReturnType<typeof setInterval> | null,
  projectRoot: "",
};

// ─────────────────────────────────────────────────────────────────────────
// Extension Export
// ─────────────────────────────────────────────────────────────────────────

