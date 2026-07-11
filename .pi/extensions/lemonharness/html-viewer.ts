/**
 * LemonHarness HTML Viewer — Extension Setup
 *
 * Registers the `render_html_file` tool and `/render-html`, `/open` commands
 * so you can see HTML files rendered in your browser, not just raw tags.
 *
 * Usage:
 *   User:  `/render-html .lemonharness/execution-report.html`
 *   Agent: `render_html_file` tool (auto-detected from workflow)
 *   Short: `/open file.html`
 *
 * Auto-offers to open the execution report after `/lemonharness:visualize`.
 *
 * Research basis: arXiv:2606.24311 — output visibility as first-class concern.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";

import {
  openInBrowser,
  extractHtmlText,
  startHttpServer,
  findFreePort,
  needsServer,
} from "./html-viewer-core";

// ── Tool: render_html_file ──────────────────────────────────────────

export function setupHtmlViewer(pi: ExtensionAPI) {
  pi.registerTool({
    name: "render_html_file",
    label: "Render HTML File",
    description:
      "Open an HTML file in the default browser so you can see it rendered. " +
      "Serves via local HTTP server if the HTML uses relative assets. " +
      "Optionally shows a text-only preview in the terminal.",
    promptSnippet: "Open HTML files in a browser for visual inspection",
    promptGuidelines: [
      "Use render_html_file when the user wants to see an HTML file visually, not just its raw source.",
      "Pass the path from the project root. The tool resolves it relative to the project directory.",
    ],
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the HTML file (relative to project root)",
      }),
      preview: Type.Optional(
        Type.Boolean({
          description: "Show a text-only preview in the terminal (default: true)",
        }),
      ),
      server: Type.Optional(
        Type.Boolean({
          description:
            "Force serving via local HTTP server even if no relative assets detected",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const absPath = resolve(join(ctx.cwd, params.path));
      const relativePath = relative(ctx.cwd, absPath);

      if (!existsSync(absPath)) {
        return {
          content: [{ type: "text", text: `❌ File not found: ${relativePath}` }],
          isError: true,
          details: { path: relativePath },
        };
      }

      const isHtml =
        /\.(html?|htm)$/i.test(absPath) ||
        (() => {
          try {
            const head = readFileSync(absPath, "utf-8").trimStart();
            return head.startsWith("<!") || head.startsWith("<html");
          } catch {
            return false;
          }
        })();

      if (!isHtml) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️ ${relativePath} doesn't look like an HTML file. Use \`read\` to view raw contents.`,
            },
          ],
          isError: false,
          details: { path: relativePath, rendered: false },
        };
      }

      const result: string[] = [];
      const details: Record<string, unknown> = { path: relativePath };

      // 1. Text-only preview
      if (params.preview !== false) {
        const text = extractHtmlText(absPath);
        if (text) {
          const previewText =
            text.length > 3000
              ? text.slice(0, 3000) + "\n\n…[truncated]…"
              : text;
          result.push(`📄 **Text preview of \`${relativePath}\`:**`, "", "```", previewText, "```", "");
          details.textPreview = text.length;
        }
      }

      // 2. Open in browser
      const serveViaServer = params.server || needsServer(absPath);

      try {
        if (serveViaServer) {
          const port = findFreePort();
          const url = await startHttpServer(absPath, port);
          const opened = openInBrowser(url);
          if (opened) {
            result.push(`✅ Opened in browser via local server: [${url}](${url})`);
          } else {
            result.push(`ℹ️ HTML file served at: ${url}`);
          }
          details.url = url;
          details.server = true;
        } else {
          const opened = openInBrowser(absPath);
          if (opened) {
            result.push(`✅ Opened in browser: \`${relativePath}\``);
          } else {
            result.push(
              "❌ Could not open browser. No supported browser opener found.",
              "   Try installing `xdg-utils` (Linux) or use `python3 -m http.server`.",
            );
          }
          details.rendered = opened;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.push(`⚠️ Error: ${msg}. Try opening the file directly.`);
        details.error = msg;
      }

      result.push("", `💡 Use \`read "${relativePath}"\` to see the raw HTML source.`);

      return {
        content: [{ type: "text", text: result.join("\n") }],
        details,
      };
    },
  });

  // ── Commands ─────────────────────────────────────────────────────

  pi.registerCommand("render-html", {
    description:
      "Open an HTML file in the browser (rendered). Usage: /render-html <path> [--preview] [--server]",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/);
      if (parts.length === 0 || parts[0] === "") {
        ctx.ui.notify("Usage: /render-html <path> [--preview] [--server]", "info");
        return;
      }

      const path = parts[0];
      const showPreview = !parts.includes("--no-preview");
      const forceServer = parts.includes("--server");

      const absPath = resolve(join(ctx.cwd, path));
      const relativePath = relative(ctx.cwd, absPath);

      if (!existsSync(absPath)) {
        ctx.ui.notify(`❌ File not found: ${relativePath}`, "error");
        return;
      }

      if (showPreview) {
        const text = extractHtmlText(absPath);
        if (text) {
          const preview =
            text.length > 2000 ? text.slice(0, 2000) + "\n\n…[truncated]…" : text;
          ctx.ui.notify(`📄 Preview of ${relativePath}:\n${preview}`, "info");
        }
      }

      try {
        const serveViaServer = forceServer || needsServer(absPath);
        if (serveViaServer) {
          const port = findFreePort();
          const url = await startHttpServer(absPath, port);
          const opened = openInBrowser(url);
          if (opened) {
            ctx.ui.notify(`✅ Served + opened in browser: ${url}`, "info");
          } else {
            ctx.ui.notify(`ℹ️ HTML served at: ${url} (no browser opener)`, "info");
          }
        } else {
          const opened = openInBrowser(absPath);
          if (opened) {
            ctx.ui.notify(`✅ Opened in browser: ${relativePath}`, "info");
          } else {
            ctx.ui.notify(`❌ Cannot open browser. Try: xdg-open ${relativePath}`, "error");
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`⚠️ ${msg}`, "warning");
        // Fallback: direct open
        const opened = openInBrowser(absPath);
        if (opened) ctx.ui.notify(`✅ Opened directly: ${relativePath}`, "info");
        else ctx.ui.notify(`❌ Cannot open browser. Try: xdg-open ${relativePath}`, "error");
      }
    },
  });

  pi.registerCommand("open", {
    description:
      "Open a file (HTML in browser, other files with system default). Short alias for /render-html.",
    handler: async (args, ctx) => {
      const path = (args || "").trim();
      if (!path) {
        ctx.ui.notify("Usage: /open <file-path>", "info");
        return;
      }
      const absPath = resolve(join(ctx.cwd, path));
      if (!existsSync(absPath)) {
        ctx.ui.notify(`❌ File not found: ${path}`, "error");
        return;
      }
      const isHtml = /\.(html?|htm)$/i.test(absPath);
      if (isHtml) {
        const text = extractHtmlText(absPath);
        if (text) {
          const preview =
            text.length > 1000 ? text.slice(0, 1000) + "\n\n…" : text;
          ctx.ui.notify(`📄 ${path} preview:\n${preview}`, "info");
        }
        const opened = openInBrowser(absPath);
        if (opened) ctx.ui.notify(`✅ Opened in browser: ${path}`, "info");
        else ctx.ui.notify(`ℹ️ File exists at: ${path}`, "info");
      } else {
        const opened = openInBrowser(absPath);
        if (opened) ctx.ui.notify(`✅ Opened: ${path}`, "info");
        else ctx.ui.notify(`ℹ️ File: ${path}`, "info");
      }
    },
  });

  // ── Auto-open hook for visualization reports ──────────────────────

  pi.on("tool_result", (event, ctx) => {
    if (
      event.toolName === "visualize" ||
      event.toolName === "lemonharness:visualize"
    ) {
      const reportPath = join(ctx.cwd, ".lemonharness", "execution-report.html");
      if (existsSync(reportPath)) {
        ctx.ui.notify(
          "🍋 Report ready! Use /render-html .lemonharness/execution-report.html to see it rendered.",
          "info",
        );
      }
    }
  });
}
