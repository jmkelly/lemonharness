/**
 * Semantic Scholar API search
 */

import type { SearchResult } from "./types";

export async function searchSemanticScholar(query: string, maxResults = 8, yearFrom?: number): Promise<SearchResult[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set("fields", "title,url,abstract,authors,year,venue,citationCount,publicationDate,externalIds");
  if (yearFrom) url.searchParams.set("year", `${yearFrom}-`);
  try {
    const response = await fetch(url.toString(), { headers: { "User-Agent": "LemonHarness/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Semantic Scholar API returned ${response.status}`);
    const data: any = await response.json();
    if (!data.data || !Array.isArray(data.data)) return [];
    return data.data.map((paper: any) => {
      const authors = paper.authors?.map((a: any) => a.name || "").filter(Boolean) || [];
      const published = paper.publicationDate || (paper.year ? String(paper.year) : "");
      const extIds = paper.externalIds || {};
      return { title: paper.title || "Untitled", url: paper.url || (paper.paperId ? `https://www.semanticscholar.org/paper/${paper.paperId}` : ""), snippet: (paper.abstract || "").slice(0, 300), authors: authors.slice(0, 5), published: published.slice(0, 10), year: paper.year || 0, venue: paper.venue || "", citationCount: paper.citationCount || 0, arxivId: extIds.ArXiv || "", paperId: paper.paperId || "", source: "semantic-scholar" as const };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ title: `Semantic Scholar error: ${message}`, url: "", snippet: "", source: "error" }];
  }
}

/**
 * Search for recent papers (current year - 1) across arXiv and Semantic Scholar.
 */
export async function searchRecent(query: string, maxResults = 8): Promise<SearchResult[]> {
  const year = new Date().getFullYear();
  const { searchArxiv } = await import("./search-arxiv");
  const [arxivResults, semanticResults] = await Promise.all([
    searchArxiv(query, Math.ceil(maxResults / 2), year - 1),
    searchSemanticScholar(query, Math.ceil(maxResults / 2), year - 1),
  ]);
  const allResults = [...arxivResults, ...semanticResults].filter(r => r.source !== "error");
  if (allResults.length > 0) return allResults;
  const { searchWeb } = await import("./search-web");
  return searchWeb(`${query} ${year}`);
}
