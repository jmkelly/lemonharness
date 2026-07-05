/**
 * LemonHarness Shared Utilities
 *
 * Consolidated helpers used across multiple extensions:
 * - TF-IDF vectorization and similarity (both implementations merged)
 * - String and formatting utilities
 * - File helpers
 *
 * Created to eliminate duplicate implementations across:
 *   lemonharness-memory.ts  (MemoryStore.tfidfSimilarity + hybridSimilarity)
 *   lemonharness-subsystems.ts (cosineTFIDFSimilarity + hybridSimilarity)
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tokenization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tokenize text into normalized, stemmed tokens.
 * Strips punctuation, filters short/long tokens, and applies simple stemming.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2 && t.length <= 40)
    .map(t => simpleStem(t));
}

/**
 * Simple English stemmer: removes common suffixes.
 * Not as accurate as Porter2, but sufficient for memory retrieval.
 */
export function simpleStem(word: string): string {
  if (word.length <= 4) return word;
  const suffixes = [
    "ing", "tion", "sion", "ment", "ness",
    "able", "ible", "ful", "less",
    "ly", "ed", "es", "s",
  ];
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

// ═══════════════════════════════════════════════════════════════════════════
// TF-IDF Computation
// ═══════════════════════════════════════════════════════════════════════════

interface TokenVector {
  tokens: Map<string, number>;
  magnitude: number;
}

/**
 * Build a document-frequency map from a corpus of documents.
 * Used to compute IDF weights for TF-IDF.
 */
export function buildDocumentFrequency(documents: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of documents) {
    const terms = new Set(tokenize(doc));
    for (const term of terms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }
  return df;
}

/**
 * Compute TF-IDF vector for one document in a corpus, filtered by query terms.
 * Returns only the terms that appear in the query.
 */
export function computeTFIDFVector(
  query: string,
  corpus: string[],
  docIndex: number,
): TokenVector {
  const queryTerms = tokenize(query);
  const docTerms = tokenize(corpus[docIndex] || "");

  if (queryTerms.length === 0 || docTerms.length === 0) {
    return { tokens: new Map(), magnitude: 0 };
  }

  const df = buildDocumentFrequency(corpus);
  const N = corpus.length;

  const tokens = new Map<string, number>();
  const querySet = new Set(queryTerms);
  let magnitude = 0;

  for (const term of docTerms) {
    if (!querySet.has(term)) continue;
    // Log-frequency TF
    const termFreq = docTerms.filter(t => t === term).length;
    const tf = 1 + Math.log2(termFreq + 1);
    // IDF with smoothing
    const docFreq = df.get(term) || 1;
    const idf = Math.log2((N + 1) / (docFreq + 1)) + 1;
    const tfidf = tf * idf;
    tokens.set(term, tfidf);
    magnitude += tfidf * tfidf;
  }

  return { tokens, magnitude: Math.sqrt(magnitude) };
}

/**
 * Pure TF-IDF cosine similarity between query and a document in a corpus.
 */
export function cosineTFIDFSimilarity(
  query: string,
  document: string,
  corpus?: string[],
): number {
  if (!query.trim() || !document.trim()) return 0;

  const actualCorpus = corpus ?? [document, query];
  const docIndex = actualCorpus.indexOf(document);

  if (docIndex < 0) {
    // Fallback to Jaccard if document isn't in corpus
    const docTerms = tokenize(document);
    const qTerms = tokenize(query);
    const intersection = docTerms.filter(t => qTerms.includes(t));
    const union = new Set([...docTerms, ...qTerms]);
    return union.size > 0 ? intersection.length / union.size : 0;
  }

  const corpusForIdf = [...actualCorpus, query];
  const docVec = computeTFIDFVector(query, corpusForIdf, docIndex);
  const queryVec = computeTFIDFVector(query, corpusForIdf, corpusForIdf.length - 1);

  if (docVec.magnitude === 0 || queryVec.magnitude === 0) return 0;

  let dotProduct = 0;
  for (const [term, score] of docVec.tokens) {
    const qScore = queryVec.tokens.get(term) || 0;
    dotProduct += score * qScore;
  }

  return dotProduct / (docVec.magnitude * queryVec.magnitude);
}

// ═══════════════════════════════════════════════════════════════════════════
// Hybrid Similarity (TF-IDF 60% + Jaccard 40%)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hybrid similarity combining TF-IDF cosine and Jaccard overlap.
 * Weighted: 60% TF-IDF, 40% Jaccard.
 *
 * This captures both term frequency information (TF-IDF) and
 * broad lexical overlap (Jaccard).
 */
export function hybridSimilarity(
  query: string,
  document: string,
  corpus?: string[],
): number {
  const tfidf = cosineTFIDFSimilarity(query, document, corpus);

  const queryWords = new Set(tokenize(query));
  const docWords = new Set(tokenize(document));
  const intersection = new Set([...queryWords].filter(w => docWords.has(w)));
  const union = new Set([...queryWords, ...docWords]);
  const jaccard = union.size > 0 ? intersection.size / union.size : 0;

  return tfidf * 0.6 + jaccard * 0.4;
}

/**
 * Compute Jaccard similarity between two texts.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format a duration in milliseconds to a human-readable string.
 * e.g., "5m 30s" or "1s"
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}

/**
 * Sanitize a path for use as a filename (replace special characters).
 */
export function sanitizePathForFile(p: string): string {
  return p.replace(/[^a-zA-Z0-9_\-.]/g, "_");
}

/**
 * Escape HTML entities in a string.
 */
export function escapeHtml(str: unknown): string {
  if (typeof str !== "string") return String(str ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Truncate a string to a maximum length, appending "..." if truncated.
 */
export function truncate(str: string, maxLen: number = 80): string {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Simple unified diff between two strings (single-hunk).
 */
export function computeUnifiedDiff(oldStr: string, newStr: string, relPath: string): string {
  if (oldStr === newStr) return "";

  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  const minLen = Math.min(oldLines.length, newLines.length);
  let firstDiff = 0;
  while (firstDiff < minLen && oldLines[firstDiff] === newLines[firstDiff]) {
    firstDiff++;
  }

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > firstDiff && newEnd > firstDiff && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const contextSize = 3;
  const hunkStart = Math.max(0, firstDiff - contextSize);
  const oldHunkEnd = Math.min(oldLines.length, oldEnd + contextSize);
  const newHunkEnd = Math.min(newLines.length, newEnd + contextSize);

  const lines: string[] = [];
  lines.push(`--- a/${relPath}`);
  lines.push(`+++ b/${relPath}`);

  const hdrOldLen = oldHunkEnd - hunkStart;
  const hdrNewLen = newHunkEnd - hunkStart;
  lines.push(`@@ -${hunkStart + 1},${hdrOldLen} +${hunkStart + 1},${hdrNewLen} @@`);

  for (let k = hunkStart; k < firstDiff; k++) {
    lines.push(` ${oldLines[k]}`);
  }
  for (let k = firstDiff; k < oldEnd; k++) {
    lines.push(`-${oldLines[k]}`);
  }
  for (let k = firstDiff; k < newEnd; k++) {
    lines.push(`+${newLines[k]}`);
  }

  const contextEnd = Math.min(oldHunkEnd, newHunkEnd);
  for (let k = oldEnd; k < contextEnd; k++) {
    lines.push(` ${newLines[k]}`);
  }

  return lines.join("\n");
}

/**
 * Estimate tokens from text content.
 * Heuristic: 1 token ≈ 4 chars for text, 1 token ≈ 1 char for code.
 */
export function estimateTokens(text: string, isCode: boolean = false): number {
  if (!text) return 0;
  const chars = text.length;
  if (isCode) return Math.ceil(chars);
  return Math.ceil(chars / 4);
}

/**
 * Auto-detect if content looks like code vs natural text.
 */
export function detectIsCode(content: unknown): boolean {
  if (typeof content !== "string") return false;
  const codePatterns = [
    /function\s+\w+\s*\(/, /=>\s*{/, /import\s+.*from/, /export\s+(default\s+)?/,
    /const\s+\w+\s*=/, /let\s+\w+\s*=/, /var\s+\w+\s*=/, /class\s+\w+/,
    /if\s*\(/, /for\s*\(/, /while\s*\(/, /switch\s*\(/, /try\s*{/,
    /\.\w+\(/, /;\s*$/, /```/, /\bdef\s+\w+\s*\(/, /\bclass\s+\w+/,
    /^\s*#\s*include/, /^\s*using\s+namespace/, /^\s*import\s+/, /\bconsole\./,
    /\bmodule\.exports/, /\brequire\(/, /^\s*<\?php/, /^\s*#!/,
  ];
  let matches = 0;
  for (const pattern of codePatterns) {
    if (pattern.test(content)) matches++;
    if (matches >= 2) return true;
  }
  return false;
}

/**
 * Generate a unique short ID with a prefix.
 */
export function generateId(prefix: string): string {
  const { randomUUID } = require("node:crypto");
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
