/**
 * LemonHarness HTML Viewer — Core Helpers
 *
 * Utility functions for opening HTML files in browser, extracting text previews,
 * and serving HTML via local HTTP server.
 *
 * Research basis: arXiv:2606.24311 — output visibility as a first-class concern.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ── Browser Opener ──────────────────────────────────────────────────

export function findBrowserOpener(): string | null {
  for (const cmd of ["xdg-open", "open", "gio open"]) {
    try {
      execSync(`which ${cmd.split(" ")[0]} 2>/dev/null`, { stdio: "ignore" });
      return cmd;
    } catch { /* not found */ }
  }
  const browser = process.env.BROWSER;
  if (browser) return browser;
  return null;
}

export function openInBrowser(filePath: string): boolean {
  const opener = findBrowserOpener();
  if (!opener) return false;
  try {
    execSync(`${opener} "${filePath}" 2>/dev/null`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── HTML Text Extraction (Python stdlib, no deps) ──────────────────

export function extractHtmlText(filePath: string): string | null {
  try {
    const html = readFileSync(filePath, "utf-8");
    const script = `
import sys, html.parser, re

class TextExtract(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.text_parts = []
        self.skip = False
        self.tag_stack = []
    def handle_starttag(self, tag, attrs):
        self.tag_stack.append(tag)
        if tag in ('script', 'style'):
            self.skip = True
    def handle_endtag(self, tag):
        if self.tag_stack and self.tag_stack[-1] == tag:
            self.tag_stack.pop()
        if tag in ('script', 'style'):
            self.skip = False
        if tag in ('p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'div'):
            self.text_parts.append('\\\\n')
    def handle_data(self, data):
        if not self.skip:
            text = data.strip()
            if text:
                self.text_parts.append(text + ' ')
    def handle_entityref(self, name):
        if not self.skip:
            import html
            self.text_parts.append(html.entities.html5.get(name, f'&{name};'))
    def handle_charref(self, name):
        if not self.skip:
            try:
                if name.startswith('x'):
                    self.text_parts.append(chr(int(name[1:], 16)))
                else:
                    self.text_parts.append(chr(int(name)))
            except:
                pass

extractor = TextExtract()
extractor.feed(sys.stdin.read())
extractor.close()
result = ''.join(extractor.text_parts)
result = re.sub(r'\\\\n{3,}', '\\\\n\\\\n', result)
result = re.sub(r' {2,}', ' ', result)
print(result.strip())
`.trim();
    const result = execSync(`echo "${html.replace(/"/g, '\\"')}" | python3 -c "${script}"`, {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return result.trim() || null;
  } catch {
    // Fallback: regex-based tag stripping
    try {
      const html = readFileSync(filePath, "utf-8");
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/g, " ")
        .replace(/&#\d+;/g, " ")
        .replace(/\s{3,}/g, "\n\n")
        .trim();
    } catch {
      return null;
    }
  }
}

// ── Local HTTP Server ──────────────────────────────────────────────

let httpServerProcess: ChildProcess | null = null;

export function killHttpServer(): void {
  if (httpServerProcess) {
    try { httpServerProcess.kill(); } catch { /* already dead */ }
    httpServerProcess = null;
  }
}

export function startHttpServer(filePath: string, port: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const dir = dirname(resolve(filePath));
    const fileName = resolve(filePath);
    const escapedDir = dir.replace(/"/g, '\\"');

    killHttpServer();
    httpServerProcess = spawn("python3", [
      "-c",
      `
import http.server, socketserver, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="${escapedDir}", **kwargs)
    def log_message(self, format, *args):
        pass  # Suppress logs

PORT = ${port}
os.chdir("${escapedDir}")
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    httpd.serve_forever()
      `.trim(),
    ], {
      stdio: "ignore",
      detached: true,
    });

    httpServerProcess.unref();
    httpServerProcess.on("error", (err) => reject(err));

    // Give it a moment to start
    setTimeout(() => {
      const relPath = fileName.replace(dir, "").replace(/^\//, "");
      const url = `http://127.0.0.1:${port}/${relPath}`;
      resolvePromise(url);
    }, 500);
  });
}

export function findFreePort(): number {
  return 9876 + Math.floor(Math.random() * 1000);
}

export function needsServer(filePath: string): boolean {
  try {
    const html = readFileSync(filePath, "utf-8");
    const relativeRefs = html.match(
      /(?:src|href)\s*=\s*"(?!https?:\/\/|\/\/|\/|[a-z]+:)/gi
    );
    if (!relativeRefs) return false;
    return relativeRefs.length > 0;
  } catch {
    return false;
  }
}
