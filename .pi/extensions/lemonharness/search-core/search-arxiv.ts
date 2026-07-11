/**
 * arXiv API search with raw TLS HTTP/1.1 and Semantic Scholar fallback
 */

import { XMLParser } from "fast-xml-parser";
import type { SearchResult } from "./types";
import { httpsGet, throttle } from "./http-helper";

export async function searchArxiv(query: string, maxResults = 8, yearFrom?: number): Promise<SearchResult[]> {
  const cleanQuery = query.replace(/[^\w\s-]/g, " ").trim();
  if (!cleanQuery) return [];

  const primaryResults = await tryArxivPrimary(cleanQuery, maxResults, yearFrom);
  if (primaryResults.length > 0 && primaryResults[0].source !== "error") return primaryResults;

  const fallbackResults = await tryArxivViaSemanticScholar(cleanQuery, maxResults, yearFrom);
  if (fallbackResults.length > 0) return fallbackResults;
  if (primaryResults.length === 1 && primaryResults[0].source === "error") return primaryResults;
  return [];
}

async function tryArxivPrimary(query: string, maxResults: number, yearFrom?: number): Promise<SearchResult[]> {
  await throttle("arxiv", 3000);
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");
  const apiUrl = url.toString();
  const delays = [2000, 4000, 8000];
  let lastError = "";

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await httpsGet(apiUrl, 25_000);
      if (response.statusCode === 429) {
        lastError = "Rate limited (429)";
        const retryAfter = parseInt(response.headers["retry-after"] || "10", 10);
        const waitMs = Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 10000, 20000);
        if (attempt < delays.length) { await new Promise(r => setTimeout(r, waitMs)); continue; }
        break;
      }
      if (response.statusCode !== 200) {
        lastError = `arXiv API returned ${response.statusCode}`;
        if (attempt < delays.length) { await new Promise(r => setTimeout(r, delays[attempt])); continue; }
        break;
      }
      return parseArxivResponse(response.body, yearFrom);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < delays.length) await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
  return [{ title: `arXiv API error after ${delays.length + 1} attempts: ${lastError}`, url: "", snippet: "", source: "error" }];
}

function parseArxivResponse(xml: string, yearFrom?: number): SearchResult[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
  const parsed = parser.parse(xml);
  const feed = parsed.feed || parsed;
  const rawEntries = feed.entry;
  const entries = rawEntries ? (Array.isArray(rawEntries) ? rawEntries : [rawEntries]) : [];
  const results: SearchResult[] = [];

  for (const entry of entries) {
    const title = (entry.title || "").replace(/\s+/g, " ").trim();
    const summary = (entry.summary || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const idStr = entry.id || "";
    const paperId = idStr.includes("/abs/") ? idStr.split("/abs/")[1] : idStr;
    const published = (entry.published || "").slice(0, 10);
    const updated = (entry.updated || "").slice(0, 10);
    const rawAuthors = entry.author;
    const authorList = rawAuthors ? (Array.isArray(rawAuthors) ? rawAuthors : [rawAuthors]) : [];
    const authors = authorList.map((a: any) => (typeof a === "string" ? a : a.name || a["atom:name"] || "")).filter(Boolean);
    const rawCats = entry.category;
    const categories = rawCats ? (Array.isArray(rawCats) ? rawCats : [rawCats]) : [];
    const catTerms = categories.map((c: any) => (typeof c === "string" ? c : c["@_term"] || c.term || "")).filter(Boolean);
    let url = `https://arxiv.org/abs/${paperId}`;
    if (entry.link) {
      const links = Array.isArray(entry.link) ? entry.link : [entry.link];
      const altLink = links.find((l: any) => l["@_rel"] === "alternate" || l.rel === "alternate");
      if (altLink) url = altLink["@_href"] || altLink.href || url;
    }
    const year = published ? parseInt(published.slice(0, 4), 10) : 0;
    results.push({ title: title || "Untitled", url, snippet: summary, authors: authors.slice(0, 5), published: published || updated, year, categories: catTerms.slice(0, 3), source: "arxiv" });
  }
  if (yearFrom) return results.filter(r => r.year && r.year >= yearFrom);
  return results;
}

async function tryArxivViaSemanticScholar(query: string, maxResults: number, yearFrom?: number): Promise<SearchResult[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set("fields", "title,url,abstract,authors,year,venue,citationCount,publicationDate,externalIds");
  if (yearFrom) url.searchParams.set("year", `${yearFrom}-`);
  try {
    const response = await fetch(url.toString(), { headers: { "User-Agent": "LemonHarness/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return [];
    const data: any = await response.json();
    if (!data.data || !Array.isArray(data.data)) return [];
    return data.data.filter((p: any) => { const e = p.externalIds || {}; return !!e.ArXiv; }).slice(0, maxResults).map((paper: any) => {
      const authors = paper.authors?.map((a: any) => a.name || "").filter(Boolean) || [];
      const published = paper.publicationDate || (paper.year ? String(paper.year) : "");
      const extIds = paper.externalIds || {};
      const arxivId = extIds.ArXiv || "";
      return { title: paper.title || "Untitled", url: arxivId ? `https://arxiv.org/abs/${arxivId}` : paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`, snippet: (paper.abstract || "").slice(0, 300), authors: authors.slice(0, 5), published: published.slice(0, 10), year: paper.year || 0, venue: paper.venue || "", citationCount: paper.citationCount || 0, arxivId, source: "arxiv" as const };
    });
  } catch { return []; }
}
