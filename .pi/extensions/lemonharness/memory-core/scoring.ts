// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * TF-IDF and hybrid similarity scoring utilities for HarnessMem.
 *
 * These are extracted from MemoryStore for reuse and to keep
 * memory-store.ts under the 400-line limit.
 */

/**
 * Simple stemmer: removes common English suffixes.
 */
function simpleStem(word: string): string {
  if (word.length <= 4) return word;
  const suffixes = ["ing", "tion", "sion", "ment", "ness", "able", "ible", "ful", "less", "ly", "ed", "es", "s"];
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return word;
}

/**
 * Simple tokenizer with stemming for TF-IDF computation.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2 && t.length <= 40)
    .map(t => simpleStem(t));
}

/**
 * TF-IDF cosine similarity between query and document text.
 *
 * Research basis: TF-IDF outperforms Jaccard by 15-25% for agent memory
 * retrieval (2025 comparisons).
 */
export function tfidfSimilarity(query: string, document: string): number {
  const queryTokens = tokenize(query);
  const docTokens = tokenize(document);

  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const queryTF = new Map<string, number>();
  const docTF = new Map<string, number>();

  for (const t of queryTokens) queryTF.set(t, (queryTF.get(t) || 0) + 1);
  for (const t of docTokens) docTF.set(t, (docTF.get(t) || 0) + 1);

  for (const [t, f] of queryTF) queryTF.set(t, 1 + Math.log2(f));
  for (const [t, f] of docTF) docTF.set(t, 1 + Math.log2(f));

  const allTerms = new Set([...queryTF.keys(), ...docTF.keys()]);
  let dotProduct = 0, queryMag = 0, docMag = 0;

  for (const term of allTerms) {
    const qFreq = queryTF.get(term) || 0;
    const dFreq = docTF.get(term) || 0;
    const docFreq = (qFreq > 0 ? 1 : 0) + (dFreq > 0 ? 1 : 0);
    const idf = Math.log2((2 + 1) / (docFreq + 1)) + 1;
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
 */
export function hybridSimilarity(query: string, document: string): number {
  const tfidf = tfidfSimilarity(query, document);
  const queryWords = new Set(tokenize(query));
  const docWords = new Set(tokenize(document));
  const intersection = new Set([...queryWords].filter(w => docWords.has(w)));
  const union = new Set([...queryWords, ...docWords]);
  const jaccard = union.size > 0 ? intersection.size / union.size : 0;
  return tfidf * 0.6 + jaccard * 0.4;
}

/**
 * Calculate confidence score with time-based decay (Ebbinghaus forgetting curve).
 */
export function calculateConfidence(
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

  // Ebbinghaus forgetting curve with configurable half-life
  const baseHalfLifeDays = 30;
  const reuseMultiplier = 1 + Math.min(reuseCount, 6) * 0.5;
  if (lastAccessTime && lastAccessTime > 0) {
    const daysSinceAccess = (Date.now() - lastAccessTime) / (1000 * 60 * 60 * 24);
    if (daysSinceAccess > 7) {
      const decayFactor = Math.exp(-daysSinceAccess / (baseHalfLifeDays * reuseMultiplier));
      confidence *= Math.max(0.05, decayFactor);
    }
  }
  return Math.max(0, Math.min(1, confidence));
}
