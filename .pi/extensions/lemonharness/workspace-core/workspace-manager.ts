// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * WorkspaceManager — Singleton for workspace tracking
 *
 * Manages workspace state: files modified, processes spawned, dependencies.
 * Path validation and write blocking.
 */

import { join, resolve } from "node:path";
import type { WorkspaceFileEntry, WorkspaceProcessEntry, WorkspaceState } from "./types";

export class WorkspaceManager {
  private workspaceDir: string = "";
  private projectRoot: string = "";
  private files: WorkspaceFileEntry[] = [];
  private processes: WorkspaceProcessEntry[] = [];
  private dependencies: string[] = [];
  private allowedPaths: string[] = [];
  private blockOutsideWrites: boolean = true;
  private lastReset: number = Date.now();

  initialize(projectRoot: string, config?: { dir?: string; allowedPaths?: string[]; blockOutsideWrites?: boolean }) {
    this.projectRoot = projectRoot;
    this.workspaceDir = join(projectRoot, config?.dir || ".lemonharness");
    this.allowedPaths = config?.allowedPaths ?? [];
    this.blockOutsideWrites = config?.blockOutsideWrites ?? true;
    this.lastReset = Date.now();
  }

  getWorkspaceDir(): string { return this.workspaceDir; }
  getProjectRoot(): string { return this.projectRoot; }

  getWorkspaceState(): WorkspaceState {
    return {
      files: [...this.files],
      processes: [...this.processes],
      dependencies: [...this.dependencies],
      elapsedMs: Date.now() - this.lastReset,
      lastReset: this.lastReset,
    };
  }

  isInWorkspace(absPath: string): boolean {
    const resolved = resolve(absPath);
    if (resolved.startsWith(join(this.projectRoot, ".pi"))) return true;
    if (resolved.startsWith(this.workspaceDir)) return true;
    if (resolved === this.projectRoot || resolved.startsWith(this.projectRoot + "/")) return true;
    for (const allowed of this.allowedPaths) {
      const resolvedAllowed = resolve(allowed.replace(/^~/, process.env.HOME || ""));
      if (resolved.startsWith(resolvedAllowed)) return true;
    }
    return false;
  }

  wouldBlockWrite(absPath: string): boolean {
    if (!this.blockOutsideWrites) return false;
    const resolved = resolve(absPath);
    if (resolved.startsWith(this.workspaceDir)) return false;
    if (resolved.startsWith(join(this.projectRoot, ".pi"))) return false;
    if (resolved === this.projectRoot) return false;
    if (resolved.startsWith(this.projectRoot + "/")) return false;
    for (const allowed of this.allowedPaths) {
      const resolvedAllowed = resolve(allowed.replace(/^~/, process.env.HOME || ""));
      if (resolved.startsWith(resolvedAllowed)) return false;
    }
    return true;
  }

  trackFileWrite(filePath: string, action: "create" | "modify" | "delete") {
    const entry: any = { path: filePath, action, timestamp: Date.now() };
    const existing = this.files.findIndex(f => f.path === filePath);
    if (existing >= 0) {
      this.files[existing] = entry;
    } else {
      this.files.push(entry);
    }
  }

  trackProcess(command: string, pid: number) {
    this.processes.push({ command: command.slice(0, 120), pid, startedAt: Date.now() });
  }

  trackDependency(name: string) {
    if (!this.dependencies.includes(name)) this.dependencies.push(name);
  }

  formatState(): string {
    const state = this.getWorkspaceState();
    const lines = [
      "📁 Workspace State:",
      `  Files: ${state.files.length} (${state.files.filter(f => f.action === "create").length} created, ${state.files.filter(f => f.action === "modify").length} modified)`,
      `  Processes spawned: ${state.processes.length}`,
      `  Dependencies: ${state.dependencies.length}`,
    ];
    if (state.files.length > 0) {
      lines.push("  Recent files:");
      for (const f of state.files.slice(-5)) {
        lines.push(`    ${f.action === "create" ? "+" : f.action === "delete" ? "-" : "~"} ${f.path}`);
      }
    }
    return lines.join("\n");
  }

  async reset() {
    this.files = [];
    this.processes = [];
    this.dependencies = [];
    this.lastReset = Date.now();
  }
}
