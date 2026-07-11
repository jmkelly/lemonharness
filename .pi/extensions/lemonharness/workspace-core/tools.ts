/**
 * Custom tool registrations for the LemonHarness workspace extension.
 * Extracted from workspace.ts to keep files under 400 lines.
 *
 * Uses dependency injection to avoid circular imports with workspace.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve, join, dirname } from "node:path";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import type { WorkspaceManager, SnapshotManager, ExecutionLogger } from "../workspace-core";

interface ToolDeps {
  workspaceManager: WorkspaceManager;
  snapshotManager: SnapshotManager;
  executionLogger: ExecutionLogger;
}

export function setupWorkspaceTools(pi: ExtensionAPI, deps: ToolDeps) {
  const { workspaceManager: ws, snapshotManager, executionLogger } = deps;

  pi.registerTool({
    name: "workspace_write",
    label: "Workspace Write",
    description: "Write content to a file within the controlled workspace. Use this instead of the generic write tool for state-changing operations. Paths are relative to the project root.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path within the project" }),
      content: Type.String({ description: "File content to write" }),
      overwrite: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const absPath = resolve(ws.getProjectRoot(), params.path);
      if (ws.wouldBlockWrite(absPath)) {
        return { content: [{ type: "text" as const, text: `Error: Path "${params.path}" is outside the workspace boundary.` }], isError: true, details: {} };
      }
      await mkdir(dirname(absPath), { recursive: true });
      try { await readFile(absPath, "utf-8"); } catch {
        // File doesn't exist — fine, we'll create it
      }
      if (await pathExists(absPath) && !params.overwrite) {
        return { content: [{ type: "text" as const, text: `Error: File "${params.path}" already exists. Set overwrite=true to replace.` }], isError: true, details: {} };
      }
      let oldContent: string | null = null;
      let fileExisted = false;
      if (await pathExists(absPath)) {
        try { oldContent = await readFile(absPath, "utf-8"); fileExisted = true; } catch { /* file inaccessible */ }
      }
      await writeFile(absPath, params.content, "utf-8");
      ws.trackFileWrite(params.path, fileExisted ? "modify" : "create");
      try {
        const snapshotId = `auto-${Date.now()}`;
        await snapshotManager.createSnapshot(snapshotId, `auto: ${fileExisted ? "write" : "create"} ${params.path}`, [{
          path: params.path,
          oldContent,
          newContent: params.content,
          action: fileExisted ? "modify" : "create",
        }]);
      } catch { /* snapshot best-effort */ }
      return { content: [{ type: "text" as const, text: `Written ${params.path} (${params.content.length} chars)` }], details: { path: params.path, size: params.content.length } };
    },
  });

  pi.registerTool({
    name: "workspace_append",
    label: "Workspace Append",
    description: "Append content to a file within the controlled workspace. Creates the file if it doesn't exist.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path within the project" }),
      content: Type.String({ description: "Content to append" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const absPath = resolve(ws.getProjectRoot(), params.path);
      if (ws.wouldBlockWrite(absPath)) {
        return { content: [{ type: "text" as const, text: `Error: Path "${params.path}" is outside the workspace boundary.` }], isError: true, details: {} };
      }
      await mkdir(dirname(absPath), { recursive: true });
      let oldContent: string | null = null;
      let fileExisted = false;
      if (await pathExists(absPath)) {
        try { oldContent = await readFile(absPath, "utf-8"); fileExisted = true; } catch { /* file inaccessible */ }
      }
      await appendFile(absPath, params.content, "utf-8");
      let newContent: string = "";
      try { newContent = await readFile(absPath, "utf-8"); } catch { /* file inaccessible */ }
      ws.trackFileWrite(params.path, "modify");
      try {
        const snapshotId = `auto-${Date.now()}`;
        await snapshotManager.createSnapshot(snapshotId, `auto: append to ${params.path}`, [{
          path: params.path,
          oldContent,
          newContent,
          action: fileExisted ? "modify" : "create",
        }]);
      } catch { /* snapshot best-effort */ }
      return { content: [{ type: "text" as const, text: `Appended to ${params.path}` }], details: { path: params.path } };
    },
  });

  pi.registerTool({
    name: "workspace_state",
    label: "Workspace State",
    description: "Get the current workspace state summary — files modified, processes spawned, dependencies installed.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      return { content: [{ type: "text" as const, text: ws.formatState() }], details: ws.getWorkspaceState() };
    },
  });

  pi.registerTool({
    name: "workspace_exec",
    label: "Workspace Exec",
    description: "Execute a shell command within the project directory. Use this instead of the generic bash tool to ensure commands are tracked.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      return new Promise((resolvePromise, rejectPromise) => {
        const timeout = (params.timeout ?? 30) * 1000;
        const child = spawn("bash", ["-c", params.command], { cwd: ws.getProjectRoot(), stdio: ["pipe", "pipe", "pipe"], signal });
        const timer = setTimeout(() => { child.kill("SIGTERM"); }, timeout);
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code) => {
          clearTimeout(timer);
          const combined = stdout + stderr;
          if (code !== 0) {
            rejectPromise(new Error(combined.slice(0, 5000) || `Process exited with code ${code}`));
          } else {
            resolvePromise({
              content: [{ type: "text" as const, text: combined.slice(0, 5000) || "(no output)" }],
              details: { exitCode: code, stdout: stdout.slice(0, 1000), stderr: stderr.slice(0, 1000) },
            });
          }
        });
        child.on("error", (err) => { clearTimeout(timer); rejectPromise(new Error("Process failed to start: " + err.message)); });
      });
    },
  });

  pi.registerTool({
    name: "workspace_install_dep",
    label: "Install Dependency",
    description: "Install a dependency in the project environment. Supports npm, pip, and apt package managers.",
    parameters: Type.Object({
      package: Type.String({ description: "Package name to install" }),
      manager: Type.Optional(Type.Union([Type.Literal("npm"), Type.Literal("pip"), Type.Literal("apt")], { description: "Package manager: npm, pip, or apt (default: npm)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const mgr = params.manager || "npm";
      const cmd = mgr === "npm" ? `npm install --save-dev ${params.package}` :
                  mgr === "pip" ? `pip install ${params.package}` :
                  `sudo apt install -y ${params.package}`;
      return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("bash", ["-c", cmd], { cwd: ws.getProjectRoot(), stdio: ["pipe", "pipe", "pipe"], signal });
        const timer = setTimeout(() => { child.kill("SIGTERM"); }, 120_000);
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code) => {
          clearTimeout(timer);
          ws.trackDependency(params.package);
          if (code !== 0) {
            rejectPromise(new Error(stderr.slice(0, 300) || `Failed to install ${params.package} (exit ${code})`));
          } else {
            resolvePromise({
              content: [{ type: "text" as const, text: `✅ Installed ${params.package} via ${mgr}` }],
              details: { package: params.package, manager: mgr, exitCode: code },
            });
          }
        });
        child.on("error", (err) => { clearTimeout(timer); rejectPromise(new Error("Process failed to start: " + err.message)); });
      });
    },
  });

  pi.registerTool({
    name: "workspace_validate",
    label: "Validate",
    description: "Run a validation or verification command and record the result. Use this for testing, validation, and verification steps.",
    parameters: Type.Object({
      command: Type.String({ description: "Validation command to run" }),
      expected: Type.Optional(Type.String({ description: "Expected outcome description" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const cmd = params.command;
      return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("bash", ["-c", cmd], { cwd: ws.getProjectRoot(), stdio: ["pipe", "pipe", "pipe"], signal });
        const timer = setTimeout(() => { child.kill("SIGTERM"); }, 60_000);
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code) => {
          clearTimeout(timer);
          const output = stdout + stderr;
          const passed = code === 0;
          executionLogger.logValidation(cmd.slice(0, 60), cmd, passed, output.slice(0, 500));
          if (!passed) {
            rejectPromise(new Error(output.slice(0, 2000) || `Validation failed (exit ${code})`));
          } else {
            resolvePromise({
              content: [{ type: "text" as const, text: `✅ Validation passed\n${output.slice(0, 2000)}` }],
              details: { command: cmd, exitCode: code, passed, expected: params.expected },
            });
          }
        });
        child.on("error", (err) => { clearTimeout(timer); rejectPromise(new Error("Validation process failed to start: " + err.message)); });
      });
    },
  });

  pi.registerTool({
    name: "workspace_create_temp",
    label: "Create Temp",
    description: "Create a temporary directory or artifact within the workspace. Use for intermediate files, caches, or build artifacts.",
    parameters: Type.Object({
      prefix: Type.Optional(Type.String({ description: "Optional prefix for the temp directory name" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const prefix = params.prefix || "lemonharness-tmp";
      const dir = join(ws.getWorkspaceDir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      await mkdir(dir, { recursive: true });
      ws.trackFileWrite(dir, "create");
      return { content: [{ type: "text" as const, text: `Created temporary directory: ${dir}` }], details: { path: dir } };
    },
  });
}

// Helper — check if a file path exists
async function pathExists(filePath: string): Promise<boolean> {
  try { await readFile(filePath); return true; } catch { return false; }
}
