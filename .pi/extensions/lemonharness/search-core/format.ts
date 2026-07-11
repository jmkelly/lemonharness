/**
 * Format search results as a human-readable string with citations.
 */

import type { SearchResult } from "./types";

export function formatResults(results: SearchResult[], sourceLabel: string): string {
  if (!results || results.length === 0) return `No results found from ${sourceLabel}.`;
  if (results.length === 1 && results[0].source === "error") return `⚠ Search error: ${results[0].title}`;
  const lines: string[] = [`📚 Search Results (${sourceLabel}):`, ""];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const num = i + 1;
    lines.push(`  [${num}] ${r.title || "Untitled"}`);
    if (r.authors && r.authors.length > 0) {
      const authorStr = r.authors.slice(0, 3).join(", ");
      lines.push(`      Authors: ${authorStr}${r.authors.length > 3 ? " et al." : ""}`);
    }
    if (r.published) lines.push(`      Date: ${r.published}`);
    if (r.year) lines.push(`      Year: ${r.year}`);
    if (r.venue) lines.push(`      Venue: ${r.venue}`);
    if (r.citationCount && r.citationCount > 0) lines.push(`      Citations: ${r.citationCount}`);
    if (r.categories?.length) lines.push(`      Categories: ${r.categories.join(", ")}`);
    if (r.arxivId) lines.push(`      arXiv: ${r.arxivId}`);
    if (r.url) lines.push(`      URL: ${r.url}`);
    if (r.snippet) lines.push(`      ${r.snippet.slice(0, 200)}`);
    lines.push("");
  }
  return lines.join("\n");
}
