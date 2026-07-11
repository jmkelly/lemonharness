// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * CommitAwareMemory — Git-Context Memory Augmentation
 *
 * Research basis: arXiv:2603.13258 — MemCoder framework
 */

import { execSync } from "node:child_process";

export class CommitAwareMemory {
  private projectRoot: string;

  constructor(projectRoot: string) { this.projectRoot = projectRoot; }

  async extractIntentMapping(filePath: string): Promise<{
    commits: Array<{ hash: string; message: string; files: string[]; timestamp: number }>;
    intent: string; implementation: string;
  } | null> {
    try {
      const gitLog = execSync(
        `git log --oneline -5 -- "${filePath}" 2>/dev/null || echo "NOT_TRACKED"`,
        { cwd: this.projectRoot, encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (gitLog === "NOT_TRACKED" || !gitLog) return null;
      const lines = gitLog.split("\n").filter((l: string) => l.trim());
      const commits = lines.map((line: string) => {
        const [hash, ...msg] = line.split(" ");
        return { hash: hash || "unknown", message: msg.join(" ") || "", files: [filePath], timestamp: Date.now() };
      });
      const msgs = commits.map((c: { hash: string; message: string }) => c.message).join(" ");
      let intent = "modified file";
      if (/^fix|^bug|^hotfix/i.test(msgs)) intent = "bug fix";
      else if (/^feat|^feature|^add/i.test(msgs)) intent = "feature addition";
      else if (/^refactor/i.test(msgs)) intent = "refactoring";
      else if (/^docs/i.test(msgs)) intent = "documentation";
      else if (/^test/i.test(msgs)) intent = "test addition/modification";
      else if (/^perf|^optimize/i.test(msgs)) intent = "performance optimization";
      return { commits, intent, implementation: msgs.slice(0, 200) };
    } catch { return null; }
  }

  async augmentWithGitContext(filePath: string, memory: { details?: string; tags?: string }): Promise<{ details: string; tags: string; codeRef?: string }> {
    const result = await this.extractIntentMapping(filePath);
    if (!result) return { details: memory.details || "", tags: memory.tags || "" };
    return {
      details: [
        memory.details || "",
        "",
        "--- Git Context ---",
        `File: ${filePath}`,
        `Intent: ${result.intent}`,
        `Recent commits: ${result.commits.map(c => `${c.hash}: ${c.message}`).join("; ")}`,
      ].join("\n"),
      tags: [memory.tags || "", "git-tracked"].filter(Boolean).join(","),
      codeRef: result.commits[0]?.hash || "unknown",
    };
  }
}
