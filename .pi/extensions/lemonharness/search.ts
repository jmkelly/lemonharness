/**
 * Web Search Extension for LemonHarness
 *
 * Registers a `web_search` tool that the agent can use to search
 * arXiv, the web, and Semantic Scholar for academic research.
 *
 * Pure TypeScript implementation — no Python required.
 * Uses:
 *   - `duck-duck-scrape` for general web search (via DuckDuckGo)
 *   - Built-in `fetch` + `fast-xml-parser` for arXiv API
 *   - Built-in `fetch` for Semantic Scholar API
 *
 * Usage from agent:
 *   web_search query="agentic memory systems 2026"
 *   web_search query="lemonharness agentic framework" source="arxiv"
 *
 * Research mode examples:
 *   web_search query="best practices agentic systems" source="web"
 *   web_search query="memory retrieval agents" source="arxiv"
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  searchWeb,
  searchArxiv,
  searchRecent,
  formatResults,
} from "./search-core";

export function setupSearch(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web, arXiv, or Semantic Scholar for information. " +
      "Use for researching academic papers, best practices, documentation, " +
      "or recent developments. Results include titles, URLs, and dates for citation.",
    promptSnippet: "Search the web or arXiv for information, papers, or documentation",
    promptGuidelines: [
      "Use web_search when you need up-to-date information not in your training data.",
      "Use source='arxiv' for academic papers and research.",
      "Use source='web' for general information, documentation, and best practices.",
      "Cite search results by their URL and date when referencing them.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query — be specific for best results" }),
      source: Type.Optional(
        Type.Enum({
          web: "web",
          arxiv: "arxiv",
          recent: "recent",
        }, { description: "Search source: web (general), arxiv (academic papers), recent (2026+ papers)" }),
      ),
      max_results: Type.Optional(
        Type.Number({ description: "Maximum results to return (default: 5, max: 10)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const source = params.source || "web";
      const maxResults = Math.min(params.max_results || 5, 10);

      try {
        let results;
        let label: string;

        switch (source) {
          case "arxiv": {
            results = await searchArxiv(params.query, maxResults);
            label = "arXiv";
            break;
          }
          case "recent": {
            results = await searchRecent(params.query, maxResults);
            label = "Recent Papers";
            break;
          }
          default: {
            results = await searchWeb(params.query, maxResults);
            label = "web";
            break;
          }
        }

        const text = formatResults(results, label);

        return {
          content: [{ type: "text" as const, text: text || "No results found." }],
          details: { source, query: params.query, resultCount: results.length },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Search failed: ${message}` }],
          isError: true,
          details: { source, query: params.query },
        };
      }
    },
  });

  // Also register a convenient /search command
  pi.registerCommand("search", {
    description: "Search the web or arXiv. Usage: /search <query> or /search arxiv:<query>",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("Usage: /search <query> or /search arxiv:<query>", "warning");
        return;
      }

      let query = args.trim();
      let source: "web" | "arxiv" | "recent" = "web";

      if (query.startsWith("arxiv:")) {
        source = "arxiv";
        query = query.slice(6).trim();
      } else if (query.startsWith("recent:")) {
        source = "recent";
        query = query.slice(7).trim();
      }

      ctx.ui.notify(`🔍 Searching ${source} for: ${query}...`, "info");

      try {
        let results;
        let label: string;

        switch (source) {
          case "arxiv": {
            results = await searchArxiv(query, 5);
            label = "arXiv";
            break;
          }
          case "recent": {
            results = await searchRecent(query, 5);
            label = "Recent Papers";
            break;
          }
          default: {
            results = await searchWeb(query, 5);
            label = "web";
            break;
          }
        }

        const text = formatResults(results, label);
        ctx.ui.notify(text.slice(0, 3000), "info");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Search failed: ${message}`, "error");
      }
    },
  });
}
