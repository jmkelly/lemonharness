/**
 * DuckDuckGo web search via duck-duck-scrape
 */

import { search as ddgSearch, SafeSearchType } from "duck-duck-scrape";
import type { SearchResult } from "./types";
import { throttle } from "./http-helper";

export async function searchWeb(query: string, maxResults = 8): Promise<SearchResult[]> {
  await throttle("ddg", 2000);
  try {
    const results = await ddgSearch(query, { safeSearch: SafeSearchType.MODERATE });
    if (!results || results.noResults || !results.results?.length) return [];
    return results.results.slice(0, maxResults).map(r => ({
      title: r.title || "Untitled",
      url: r.url || "",
      snippet: (r.rawDescription || r.description || "").replace(/<[^>]*>/g, ""),
      source: "web" as const,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ title: `Search error: ${message}`, url: "", snippet: "", source: "error" }];
  }
}
