/**
 * Web Search Extension for LemonHarness
 *
 * Registers a `web_search` tool that the agent can use to search
 * arXiv, the web, and Semantic Scholar for academic research.
 *
 * Usage from agent:
 *   web_search query="agentic memory systems 2026"
 *   web_search query="lemonharness agentic framework" source="arxiv"
 *
 * Research mode examples:
 *   web_search query="best practices agentic systems" source="web"
 *   web_search query="memory retrieval agents" source="arxiv"
 *
 * Dependencies:
 *   Python venv at /tmp/search-env with ddgs and requests installed.
 *   Setup: python3 -m venv /tmp/search-env && /tmp/search-env/bin/pip install ddgs requests lxml
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SEARCH_SCRIPT = join(".lemonharness", "search.py");
const PYTHON_VENV = "/tmp/search-env/bin/python3";

export default function (pi: ExtensionAPI) {
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
        }, { description: "Search source: web (general), arxiv (academic papers), recent (2026 papers)" }),
      ),
      max_results: Type.Optional(
        Type.Number({ description: "Maximum results to return (default: 5, max: 10)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const projectRoot = _ctx.cwd;
      // Validate search script exists
      const scriptPath = join(projectRoot, SEARCH_SCRIPT);
      if (!existsSync(scriptPath)) {
        return {
          content: [{ type: "text" as const, text: `Error: Search script not found at ${scriptPath}` }],
          isError: true,
          details: {},
        };
      }

      // Validate Python venv exists
      if (!existsSync(PYTHON_VENV)) {
        return {
          content: [{ type: "text" as const, text: "Error: Python venv not found. Run: python3 -m venv /tmp/search-env && /tmp/search-env/bin/pip install ddgs requests lxml" }],
          isError: true,
          details: {},
        };
      }

      // Determine flag
      const source = params.source || "web";
      let flag: string;
      switch (source) {
        case "arxiv": flag = "--arxiv"; break;
        case "recent": flag = "--recent"; break;
        default: flag = "--web"; break;
      }

      // Cap max results
      const maxResults = Math.min(params.max_results || 5, 10);

      // Run search
      return new Promise((resolvePromise) => {
        const child = spawn(PYTHON_VENV, [
          scriptPath,
          flag,
          params.query,
          "--max-results",
          String(maxResults),
        ].filter(Boolean), {
          cwd: projectRoot,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        child.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        child.on("close", (code) => {
          // Check for deprecated package warning and strip it
          const lines = stdout.split("\n").filter(
            (l) => !l.includes("RuntimeWarning") && !l.includes("has been renamed"),
          );

          const output = lines.join("\n").trim();
          const errors = stderr
            .split("\n")
            .filter((l) => !l.includes("RuntimeWarning") && !l.includes("has been renamed"))
            .join("\n")
            .trim();

          const resultText = [
            output,
            errors ? `\n\nstderr:\n${errors}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          resolvePromise({
            content: [{ type: "text" as const, text: resultText || "No results found." }],
            details: { source, query: params.query, exitCode: code, resultLength: resultText.length },
          });
        });

        child.on("error", (err) => {
          resolvePromise({
            content: [{ type: "text" as const, text: `Search failed: ${err.message}` }],
            isError: true,
            details: {},
          });
        });
      });
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
      let source = "web";

      if (query.startsWith("arxiv:")) {
        source = "arxiv";
        query = query.slice(6).trim();
      } else if (query.startsWith("recent:")) {
        source = "recent";
        query = query.slice(7).trim();
      }

      ctx.ui.notify(`🔍 Searching ${source} for: ${query}...`, "info");

      const scriptPath = join(ctx.cwd, SEARCH_SCRIPT);
      const flag = source === "arxiv" ? "--arxiv" : source === "recent" ? "--recent" : "--web";

      const child = spawn(PYTHON_VENV, [scriptPath, flag, query], {
        cwd: ctx.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.on("close", () => {
        const clean = stdout.split("\n")
          .filter(l => !l.includes("RuntimeWarning") && !l.includes("has been renamed"))
          .join("\n")
          .trim();
        ctx.ui.notify(clean.slice(0, 3000), "info");
      });
    },
  });
}
