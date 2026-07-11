/**
 * search-core.ts — Pure TypeScript search backend
 *
 * Replaces search.py with native TypeScript implementations.
 * All search logic is in TypeScript — no Python dependency.
 *
 * HTTP clients used:
 * - DuckDuckGo web search: `duck-duck-scrape` (VQD-handling library)
 * - arXiv API: Raw `tls.connect()` + HTTP/1.1 (bypasses issues
 *   with https.get/undici on arXiv's Fastly CDN)
 * - Semantic Scholar API: built-in `fetch` (works reliably)
 */

import { XMLParser } from "fast-xml-parser";
import {
  search as ddgSearch,
  SafeSearchType,
} from "duck-duck-scrape";
import * as tls from "node:tls";

// ─── Types ───────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "web" | "arxiv" | "semantic-scholar" | "error";
  /** First 5 author names (arxiv, semantic-scholar) */
  authors?: string[];
  /** Publication date (arxiv, semantic-scholar) */
  published?: string;
  /** Publication year */
  year?: number;
  /** Venue / journal name (semantic-scholar) */
  venue?: string;
  /** Citation count (semantic-scholar) */
  citationCount?: number;
  /** arXiv ID (semantic-scholar) */
  arxivId?: string;
  /** Semantic Scholar paper ID */
  paperId?: string;
  /** Category labels (arxiv) */
  categories?: string[];
}

// ─── HTTPS Helper (for arXiv) ────────────────────────────────────

interface HttpsResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Raw TLS + HTTP/1.1 GET request.
 *
 * Node's `https.get()` and `fetch()` (undici) both have connectivity
 * issues with arXiv's Fastly CDN on some networks — they get ECONNRESET
 * or timeouts while Python's `requests` works fine. This function
 * replicates Python's approach: open a raw TLS socket, send HTTP/1.1,
 * parse the response.
 */
function httpsGet(
  url: string,
  timeoutMs = 25_000,
): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    const path = parsedUrl.pathname + parsedUrl.search;
    let socket: tls.TLSSocket | null = null;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (socket) { socket.destroy(); socket = null; }
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket = tls.connect({
      host: hostname,
      port: 443,
      servername: hostname,
      rejectUnauthorized: true,
    });

    socket.on("error", (err: Error) => {
      if (!timedOut) {
        clearTimeout(timer);
        if (socket) { socket.destroy(); socket = null; }
        reject(err);
      }
    });

    socket.on("connect", () => {
      const requestLines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${hostname}`,
        "User-Agent: LemonHarness/1.0 (research-citation-tool)",
        "Accept: application/atom+xml, application/xml, text/xml, */*",
        "Connection: close",
        "",
        "",
      ];
      socket!.write(requestLines.join("\r\n"));
    });

    let rawResponse = "";

    socket.on("data", (chunk: Buffer) => {
      rawResponse += chunk.toString("utf-8");
    });

    socket.on("end", () => {
      if (timedOut) return;
      clearTimeout(timer);

      try {
        // Parse HTTP/1.1 response
        const firstCrlf = rawResponse.indexOf("\r\n");
        const headerEnd = rawResponse.indexOf("\r\n\r\n");

        if (firstCrlf === -1 || headerEnd === -1) {
          if (socket) { socket.destroy(); socket = null; }
          resolve({ statusCode: 0, headers: {}, body: rawResponse });
          return;
        }

        const statusLine = rawResponse.slice(0, firstCrlf);
        const statusMatch = statusLine.match(/HTTP\/(\d+\.\d+) (\d+)/);
        const statusCode = statusMatch ? parseInt(statusMatch[2], 10) : 0;

        // Parse headers
        const headerSection = rawResponse.slice(firstCrlf + 2, headerEnd);
        const headers: Record<string, string> = {};
        for (const line of headerSection.split("\r\n")) {
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) {
            headers[line.slice(0, colonIdx).toLowerCase().trim()] =
              line.slice(colonIdx + 1).trim();
          }
        }

        const body = rawResponse.slice(headerEnd + 4);

        if (socket) { socket.destroy(); socket = null; }
        resolve({ statusCode, headers, body });
      } catch (err) {
        if (socket) { socket.destroy(); socket = null; }
        reject(err);
      }
    });
  });
}

// ─── Rate Limiting ───────────────────────────────────────────────

const lastCallTimestamps: Record<string, number> = {
  ddg: 0,
  arxiv: 0,
};

async function throttle(key: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const elapsed = now - (lastCallTimestamps[key] || 0);
  if (elapsed < minIntervalMs) {
    await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
  }
  lastCallTimestamps[key] = Date.now();
}

// ─── DuckDuckGo Web Search ──────────────────────────────────────

/**
 * Search the web via DuckDuckGo. No API key needed.
 * Uses `duck-duck-scrape` which handles VQD token negotiation
 * and HTML parsing internally.
 */
export async function searchWeb(
  query: string,
  maxResults = 8,
): Promise<SearchResult[]> {
  await throttle("ddg", 2000);

  try {
    const results = await ddgSearch(query, {
      safeSearch: SafeSearchType.MODERATE,
    });

    if (!results || results.noResults || !results.results?.length) {
      return [];
    }

    return results.results.slice(0, maxResults).map((r) => ({
      title: r.title || "Untitled",
      url: r.url || "",
      snippet: (r.rawDescription || r.description || "").replace(
        /<[^>]*>/g,
        "",
      ),
      source: "web" as const,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        title: `Search error: ${message}`,
        url: "",
        snippet: "",
        source: "error",
      },
    ];
  }
}

// ─── arXiv API Search ────────────────────────────────────────────

/**
 * Search arXiv via OAI-PMH API. Free, no API key needed.
 *
 * Strategy:
 * 1. Try raw TLS + HTTP/1.1 to the primary arXiv API with up to 3
 *    retries (exponential backoff: 2s, 4s, 8s).
 * 2. If all retries fail, fall back to Semantic Scholar API and filter
 *    for papers that have an `arxivId`, returning them as arXiv results.
 */
export async function searchArxiv(
  query: string,
  maxResults = 8,
  yearFrom?: number,
): Promise<SearchResult[]> {
  const cleanQuery = query.replace(/[^\w\s-]/g, " ").trim();
  if (!cleanQuery) return [];

  // Attempt 1: Primary arXiv API with retries
  const primaryResults = await tryArxivPrimary(cleanQuery, maxResults, yearFrom);
  if (primaryResults.length > 0 && primaryResults[0].source !== "error") {
    return primaryResults;
  }

  // Attempt 2: Fallback via Semantic Scholar (indexes arXiv papers)
  const fallbackResults = await tryArxivViaSemanticScholar(
    cleanQuery, maxResults, yearFrom,
  );
  if (fallbackResults.length > 0) {
    return fallbackResults;
  }

  // If primary failed with an error, return it to the caller
  if (primaryResults.length === 1 && primaryResults[0].source === "error") {
    return primaryResults;
  }

  return [];
}

/**
 * Try the primary arXiv API using raw TLS + HTTP/1.1, which avoids
 * the ECONNRESET/timeout issues that `https.get()` and `fetch()` have
 * with arXiv's Fastly CDN on some networks.
 *
 * Retry with exponential backoff: 2s → 4s → 8s.
 * Handles 429 Rate Limited with Retry-After header.
 */
async function tryArxivPrimary(
  query: string,
  maxResults: number,
  yearFrom?: number,
): Promise<SearchResult[]> {
  await throttle("arxiv", 3000);

  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");

  const apiUrl = url.toString();
  const delays = [2000, 4000, 8000];
  let lastError: string = "";

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await httpsGet(apiUrl, 25_000);

      if (response.statusCode === 429) {
        lastError = `Rate limited (429)`;
        const retryAfter = parseInt(
          response.headers["retry-after"] || "10", 10,
        );
        const waitMs = Math.min(
          Number.isFinite(retryAfter) ? retryAfter * 1000 : 10000,
          20000,
        );
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        break;
      }

      if (response.statusCode !== 200) {
        lastError = `arXiv API returned ${response.statusCode}`;
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        break;
      }

      return parseArxivResponse(response.body, yearFrom);

    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }

  return [
    {
      title: `arXiv API error after ${delays.length + 1} attempts: ${lastError}`,
      url: "",
      snippet: "",
      source: "error",
    },
  ];
}

/**
 * Parse arXiv Atom XML response into SearchResult objects.
 */
function parseArxivResponse(xml: string, yearFrom?: number): SearchResult[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });

  const parsed = parser.parse(xml);
  const feed = parsed.feed || parsed;
  const rawEntries = feed.entry;
  const entries = rawEntries
    ? Array.isArray(rawEntries)
      ? rawEntries
      : [rawEntries]
    : [];

  const results: SearchResult[] = [];

  for (const entry of entries) {
    const title = (entry.title || "").replace(/\s+/g, " ").trim();
    const summary = (entry.summary || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);

    const idStr = entry.id || "";
    const paperId = idStr.includes("/abs/")
      ? idStr.split("/abs/")[1]
      : idStr;

    const published = (entry.published || "").slice(0, 10);
    const updated = (entry.updated || "").slice(0, 10);

    const rawAuthors = entry.author;
    const authorList = rawAuthors
      ? Array.isArray(rawAuthors) ? rawAuthors : [rawAuthors]
      : [];
    const authors = authorList
      .map((a: any) =>
        typeof a === "string" ? a : a.name || a["atom:name"] || "",
      )
      .filter(Boolean);

    const rawCats = entry.category;
    const categories = rawCats
      ? Array.isArray(rawCats) ? rawCats : [rawCats]
      : [];
    const catTerms = categories
      .map((c: any) =>
        typeof c === "string" ? c : c["@_term"] || c.term || "",
      )
      .filter(Boolean);

    let url = `https://arxiv.org/abs/${paperId}`;
    if (entry.link) {
      const links = Array.isArray(entry.link) ? entry.link : [entry.link];
      const altLink = links.find(
        (l: any) => l["@_rel"] === "alternate" || l.rel === "alternate",
      );
      if (altLink) {
        url = altLink["@_href"] || altLink.href || url;
      }
    }

    const year = published ? parseInt(published.slice(0, 4), 10) : 0;

    results.push({
      title: title || "Untitled",
      url,
      snippet: summary,
      authors: authors.slice(0, 5),
      published: published || updated,
      year,
      categories: catTerms.slice(0, 3),
      source: "arxiv",
    });
  }

  if (yearFrom) {
    return results.filter((r) => r.year && r.year >= yearFrom);
  }
  return results;
}

/**
 * Fallback: Use Semantic Scholar API to find arXiv papers.
 * Semantic Scholar indexes arXiv papers and returns arxivId in externalIds.
 */
async function tryArxivViaSemanticScholar(
  query: string,
  maxResults: number,
  yearFrom?: number,
): Promise<SearchResult[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set(
    "fields",
    "title,url,abstract,authors,year,venue,citationCount,publicationDate,externalIds",
  );
  if (yearFrom) {
    url.searchParams.set("year", `${yearFrom}-`);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "LemonHarness/1.0" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return [];

    const data: any = await response.json();
    if (!data.data || !Array.isArray(data.data)) return [];

    return data.data
      .filter((paper: any) => {
        const extIds = paper.externalIds || {};
        return !!extIds.ArXiv;
      })
      .slice(0, maxResults)
      .map((paper: any) => {
        const authors =
          paper.authors?.map((a: any) => a.name || "").filter(Boolean) || [];
        const published =
          paper.publicationDate || (paper.year ? String(paper.year) : "");
        const extIds = paper.externalIds || {};
        const arxivId = extIds.ArXiv || "";

        return {
          title: paper.title || "Untitled",
          url: arxivId
            ? `https://arxiv.org/abs/${arxivId}`
            : paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
          snippet: (paper.abstract || "").slice(0, 300),
          authors: authors.slice(0, 5),
          published: published.slice(0, 10),
          year: paper.year || 0,
          venue: paper.venue || "",
          citationCount: paper.citationCount || 0,
          arxivId,
          source: "arxiv" as const,
        };
      });
  } catch {
    return [];
  }
}

// ─── Semantic Scholar Search ─────────────────────────────────────

/**
 * Search Semantic Scholar API for academic papers.
 * Uses built-in `fetch` with JSON response parsing.
 */
export async function searchSemanticScholar(
  query: string,
  maxResults = 8,
  yearFrom?: number,
): Promise<SearchResult[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set(
    "fields",
    "title,url,abstract,authors,year,venue,citationCount,publicationDate,externalIds",
  );
  if (yearFrom) {
    url.searchParams.set("year", `${yearFrom}-`);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "LemonHarness/1.0" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Semantic Scholar API returned ${response.status}`);
    }

    const data: any = await response.json();
    if (!data.data || !Array.isArray(data.data)) return [];

    return data.data.map((paper: any) => {
      const authors =
        paper.authors?.map((a: any) => a.name || "").filter(Boolean) || [];
      const published =
        paper.publicationDate || (paper.year ? String(paper.year) : "");
      const extIds = paper.externalIds || {};

      return {
        title: paper.title || "Untitled",
        url: paper.url ||
          (paper.paperId
            ? `https://www.semanticscholar.org/paper/${paper.paperId}`
            : ""),
        snippet: (paper.abstract || "").slice(0, 300),
        authors: authors.slice(0, 5),
        published: published.slice(0, 10),
        year: paper.year || 0,
        venue: paper.venue || "",
        citationCount: paper.citationCount || 0,
        arxivId: extIds.ArXiv || "",
        paperId: paper.paperId || "",
        source: "semantic-scholar" as const,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        title: `Semantic Scholar error: ${message}`,
        url: "",
        snippet: "",
        source: "error",
      },
    ];
  }
}

// ─── Combined Recent Search ──────────────────────────────────────

/**
 * Search for recent papers (current year - 1) across arXiv and
 * Semantic Scholar. Falls back to DDG web search if both fail.
 */
export async function searchRecent(
  query: string,
  maxResults = 8,
): Promise<SearchResult[]> {
  const year = new Date().getFullYear();

  const [arxivResults, semanticResults] = await Promise.all([
    searchArxiv(query, Math.ceil(maxResults / 2), year - 1),
    searchSemanticScholar(query, Math.ceil(maxResults / 2), year - 1),
  ]);

  const allResults = [...arxivResults, ...semanticResults].filter(
    (r) => r.source !== "error",
  );

  if (allResults.length > 0) return allResults;
  return searchWeb(`${query} ${year}`);
}

// ─── Formatting ──────────────────────────────────────────────────

/**
 * Format search results as a human-readable string with citations.
 * Matches the output style of the original Python search.py.
 */
export function formatResults(
  results: SearchResult[],
  sourceLabel: string,
): string {
  if (!results || results.length === 0) {
    return `No results found from ${sourceLabel}.`;
  }

  if (results.length === 1 && results[0].source === "error") {
    return `⚠ Search error: ${results[0].title}`;
  }

  const lines: string[] = [`📚 Search Results (${sourceLabel}):`, ""];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const num = i + 1;

    lines.push(`  [${num}] ${r.title || "Untitled"}`);

    if (r.authors && r.authors.length > 0) {
      const authorStr = r.authors.slice(0, 3).join(", ");
      lines.push(
        `      Authors: ${authorStr}${r.authors.length > 3 ? " et al." : ""}`,
      );
    }

    if (r.published) lines.push(`      Date: ${r.published}`);
    if (r.year) lines.push(`      Year: ${r.year}`);
    if (r.venue) lines.push(`      Venue: ${r.venue}`);
    if (r.citationCount && r.citationCount > 0) {
      lines.push(`      Citations: ${r.citationCount}`);
    }
    if (r.categories?.length) {
      lines.push(`      Categories: ${r.categories.join(", ")}`);
    }
    if (r.arxivId) lines.push(`      arXiv: ${r.arxivId}`);
    if (r.url) lines.push(`      URL: ${r.url}`);
    if (r.snippet) lines.push(`      ${r.snippet.slice(0, 200)}`);

    lines.push("");
  }

  return lines.join("\n");
}
