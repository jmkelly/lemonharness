/**
 * Raw TLS + HTTP/1.1 GET request for arXiv API.
 *
 * Node's `https.get()` and `fetch()` (undici) both have connectivity
 * issues with arXiv's Fastly CDN on some networks — they get ECONNRESET
 * or timeouts while Python's `requests` works fine. This function
 * replicates Python's approach: open a raw TLS socket, send HTTP/1.1,
 * parse the response.
 */

import * as tls from "node:tls";

interface HttpsResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

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
        "", "",
      ];
      socket!.write(requestLines.join("\r\n"));
    });

    let rawResponse = "";
    socket.on("data", (chunk: Buffer) => { rawResponse += chunk.toString("utf-8"); });

    socket.on("end", () => {
      if (timedOut) return;
      clearTimeout(timer);
      try {
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
        const headerSection = rawResponse.slice(firstCrlf + 2, headerEnd);
        const headers: Record<string, string> = {};
        for (const line of headerSection.split("\r\n")) {
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) headers[line.slice(0, colonIdx).toLowerCase().trim()] = line.slice(colonIdx + 1).trim();
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

const lastCallTimestamps: Record<string, number> = { ddg: 0, arxiv: 0 };

async function throttle(key: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const elapsed = now - (lastCallTimestamps[key] || 0);
  if (elapsed < minIntervalMs) await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
  lastCallTimestamps[key] = Date.now();
}

export { httpsGet, throttle };
export type { HttpsResponse };
