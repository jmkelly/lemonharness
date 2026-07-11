/**
 * LemonHarness Integration — Delegation Tool & Commands
 *
 * Extracted from integration.ts for file size compliance.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { platform } from "node:os";

export interface DelegateRecord {
  id: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "timed_out";
  startedAt: number;
  completedAt?: number;
  budgetMs: number;
  scope?: string;
  summary?: string;
  files?: string[];
  toolCalls?: number;
  error?: string;
}

export function setupIntegrationDelegation(
  pi: ExtensionAPI,
  delegates: Map<string, DelegateRecord>,
  delegateCounter: { value: number },
  cwd: string,
) {
  const DELEGATE_RUNNER = ".lemonharness/delegate-runner.mjs";

  // ── workspace_delegate tool ─────────────────────────────────────────
  pi.registerTool({
    name: "workspace_delegate",
    label: "Delegate Task",
    description: "Delegate a bounded sub-task to a sub-agent with its own budget and scope. " +
      "The sub-agent runs independently, reads files, makes changes, and reports back. " +
      "Use for parallelizable work, independent sub-tasks, or exploring alternative approaches.",
    promptSnippet: "Delegate a bounded sub-task to an independent sub-agent",
    promptGuidelines: [
      "Use workspace_delegate for work that can be done independently by a sub-agent with limited budget.",
      "Be specific in the task description — include file paths, expected outcomes, and constraints.",
      "The sub-agent has read, bash, write, and edit tools. It cannot install dependencies or access the network.",
      "Check results with /lemonharness:delegates after spawning sub-agents.",
      "Use context parameter to pass relevant information the sub-agent needs.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "What the sub-agent should accomplish — be specific and include file paths" }),
      budget_seconds: Type.Optional(Type.Number({ description: "Max execution time in seconds (default: 120, max: 600)" })),
      context: Type.Optional(Type.String({ description: "Additional context, reference info, or prior work for the sub-agent" })),
      scope: Type.Optional(Type.String({ description: "Subdirectory to constrain the sub-agent's work to (e.g., '.pi/extensions/')" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const id = `delegate-${++delegateCounter.value}-${Date.now().toString(36)}`;
      const task = params.task;
      const budgetMs = Math.min((params.budget_seconds || 120) * 1000, 600_000);
      const context = params.context || "";
      const scope = params.scope || "";

      const delegateDir = join(ctx.cwd, ".lemonharness", "delegates", id);
      await mkdir(delegateDir, { recursive: true });

      const record: DelegateRecord = {
        id, task, status: "running",
        startedAt: Date.now(),
        budgetMs, scope,
      };
      delegates.set(id, record);

      const input = JSON.stringify({
        task, cwd: ctx.cwd, budgetMs, context,
        constraint: scope ? `All work must be within the '${scope}' directory.` : "",
        outputDir: join(".lemonharness", "delegates", id),
      });

      const runnerPath = join(ctx.cwd, DELEGATE_RUNNER);
      if (!existsSync(runnerPath)) {
        delegates.set(id, { ...record, status: "failed", error: "Delegate runner not found" });
        return {
          content: [{ type: "text" as const, text: `Error: Delegate runner not found at ${DELEGATE_RUNNER}` }],
          isError: true, details: {},
        };
      }

      // Use node for the runner script (which spawns pi as subprocess)
      const nodeCmd = platform() === "win32" ? "node.exe" : "node";
      const child = spawn(nodeCmd, [runnerPath], {
        cwd: ctx.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NODE_PATH: join(ctx.cwd, "node_modules") },
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.stdin?.write(input);
      child.stdin?.end();

      const exitPromise = new Promise<void>((resolvePromise) => {
        let settled = false;

        function settle() {
          if (settled) return;
          settled = true;

          const lines = stdout.trim().split("\n").filter(Boolean);
          const lastLine = lines[lines.length - 1];
          let result: any = null;
          if (lastLine) {
            try { result = JSON.parse(lastLine); } catch { /* not JSON */ }
          }

          if (result?.type === "result") {
            record.status = result.success ? "completed" : "failed";
            record.completedAt = Date.now();
            record.summary = result.summary?.slice(0, 500);
            record.files = result.files || [];
            record.toolCalls = result.toolCalls || 0;
          } else {
            record.status = "failed";
            record.completedAt = Date.now();
            record.summary = stdout.slice(0, 500);
            record.error = stderr.slice(0, 300);
          }
          resolvePromise();
        }

        child.on("close", settle);
        child.on("error", (err) => {
          record.error = err.message;
          settle();
        });

        setTimeout(() => {
          if (!settled) {
            child.kill("SIGTERM");
            record.status = "timed_out";
            record.completedAt = Date.now();
            record.summary = stdout.slice(0, 500);
            settle();
          }
        }, budgetMs + 10_000);
      });

      await exitPromise;

      const summary = record.summary || "Delegate completed";
      const filesList = record.files?.length
        ? `\n\nFiles modified: ${record.files.join(", ")}`
        : "";
      const toolInfo = record.toolCalls ? `\nTool calls: ${record.toolCalls}` : "";
      const errorInfo = record.error ? `\nError: ${record.error}` : "";

      const text = record.status === "completed"
        ? `✅ Delegate [${id}] completed\n\n${summary.slice(0, 3000)}${filesList}${toolInfo}`
        : `❌ Delegate [${id}] ${record.status}: ${record.error || "Unknown error"}\n\nPartial output: ${summary.slice(0, 1000)}`;

      return {
        content: [{ type: "text" as const, text }],
        details: { delegateId: id, status: record.status, summary: summary.slice(0, 500) },
        isError: record.status !== "completed",
      };
    },
  });

  // ── /lemonharness:delegates — Show delegate status ─────────────────
  pi.registerCommand("lemonharness:delegates", {
    description: "Show status of all spawned delegates (sub-agents)",
    handler: async (_args, ctx) => {
      const all = [...delegates.values()];
      if (all.length === 0) {
        ctx.ui.notify("No delegates have been spawned this session.", "info");
        return;
      }
      const lines = [
        "🤖 Delegate Summary",
        "───────────────────",
        ...all.map(d => {
          const statusIcon =
            d.status === "completed" ? "✅" :
            d.status === "failed" ? "❌" :
            d.status === "timed_out" ? "⏰" :
            "🔄";
          const time = d.completedAt
            ? `${((d.completedAt - d.startedAt) / 1000).toFixed(0)}s`
            : "running...";
          return `  ${statusIcon} ${d.id}: ${d.task.slice(0, 60)} [${time}, ${d.status}]`;
        }),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // /lemonharness:delegate <id> — Show detailed delegate result
  pi.registerCommand("lemonharness:delegate", {
    description: "Show detailed result of a specific delegate. Usage: /lemonharness:delegate <id>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) { ctx.ui.notify("Usage: /lemonharness:delegate <id>", "error"); return; }
      const d = delegates.get(id);
      if (!d) { ctx.ui.notify(`Delegate "${id}" not found.`, "error"); return; }
      const lines = [
        `🤖 Delegate: ${d.id}`,
        `  Task: ${d.task}`,
        `  Status: ${d.status}`,
        `  Budget: ${(d.budgetMs / 1000).toFixed(0)}s`,
        `  Duration: ${d.completedAt ? ((d.completedAt - d.startedAt) / 1000).toFixed(0) + "s" : "running..."}`,
        `  Scope: ${d.scope || "(none)"}`,
      ];
      if (d.summary) lines.push(`  Summary: ${d.summary.slice(0, 1000)}`);
      if (d.files?.length) lines.push(`  Files: ${d.files.join(", ")}`);
      if (d.error) lines.push(`  Error: ${d.error}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
