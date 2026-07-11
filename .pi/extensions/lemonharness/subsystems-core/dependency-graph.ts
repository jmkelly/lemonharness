// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * DependencyGraph — Execution Provenance Tracking
 *
 * Tracks dependencies between files, packages, and commands.
 * Enables rollback analysis, targeted revalidation, and regression detection.
 *
 * Research basis: ProjectMem (arXiv:2606.12329)
 */

import { createHash } from "node:crypto";
import type { DependencyNode } from "./types";

/**
 * Tracks dependencies between files, packages, and commands.
 * Enables rollback analysis, targeted revalidation, and regression detection.
 *
 * When a file is modified, the graph reveals what packages it depends on
 * and what commands depend on it — enabling selective revalidation.
 */
export class DependencyGraph {
  private nodes: Map<string, DependencyNode> = new Map();

  registerFile(filePath: string, dependsOnPkg?: string[], dependsOnCmd?: string[]): string {
    const id = `file:${filePath}`;
    const deps: string[] = [];
    if (dependsOnPkg) deps.push(...dependsOnPkg.map(p => `pkg:${p}`));
    if (dependsOnCmd) deps.push(...dependsOnCmd.map(c => `cmd:${c}`));

    if (this.nodes.has(id)) {
      const existing = this.nodes.get(id)!;
      existing.dependsOn = [...new Set([...existing.dependsOn, ...deps])];
    } else {
      this.nodes.set(id, {
        type: "file", id, label: filePath,
        dependsOn: deps, dependedBy: [],
        createdAt: Date.now(), lastValidation: null, lastExitCode: null,
      });
    }

    // Update inverse references
    for (const dep of deps) {
      const depNode = this.nodes.get(dep);
      if (depNode && !depNode.dependedBy.includes(id)) {
        depNode.dependedBy.push(id);
      }
    }
    return id;
  }

  registerPackage(name: string): string {
    const id = `pkg:${name}`;
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        type: "package", id, label: name,
        dependsOn: [], dependedBy: [],
        createdAt: Date.now(), lastValidation: null, lastExitCode: null,
      });
    }
    return id;
  }

  registerCommand(command: string): string {
    const hash = createHash("md5").update(command).digest("hex").slice(0, 8);
    const id = `cmd:${hash}`;
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        type: "command", id, label: command.slice(0, 80),
        dependsOn: [], dependedBy: [],
        createdAt: Date.now(), lastValidation: null, lastExitCode: null,
      });
    }
    return id;
  }

  recordValidation(nodeId: string, passed: boolean, exitCode: number) {
    const node = this.nodes.get(nodeId);
    if (node) { node.lastValidation = passed; node.lastExitCode = exitCode; }
  }

  /**
   * BFS through dependency graph to find all affected nodes.
   */
  findAffectedNodes(nodeId: string): DependencyNode[] {
    const affected: DependencyNode[] = [];
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const node = this.nodes.get(current);
      if (!node) continue;
      for (const depId of node.dependedBy) {
        if (!visited.has(depId)) queue.push(depId);
      }
      affected.push(node);
    }
    return affected;
  }

  /** Get all nodes that failed their last validation */
  getFailedNodes(): DependencyNode[] {
    return [...this.nodes.values()].filter(n => n.lastValidation === false);
  }

  summarize(): string {
    const files = [...this.nodes.values()].filter(n => n.type === "file");
    const pkgs = [...this.nodes.values()].filter(n => n.type === "package");
    const cmds = [...this.nodes.values()].filter(n => n.type === "command");
    const failed = this.getFailedNodes();
    return [
      `📊 Dependency Graph:`,
      `   Files: ${files.length}, Packages: ${pkgs.length}, Commands: ${cmds.length}`,
      `   Validated: ${[...this.nodes.values()].filter(n => n.lastValidation !== null).length}/${this.nodes.size}`,
      failed.length > 0 ? `   ❌ Failed: ${failed.length} (run /lemonharness:status for details)` : `   ✅ No outstanding failures`,
    ].join("\n");
  }

  reset() {
    this.nodes.clear();
  }
}
