// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * SnapshotManager — Workspace Snapshots & Rollback
 *
 * Captures and restores workspace state via file-level snapshots.
 */

import { join, resolve, dirname } from "node:path";
import { mkdir, readdir, readFile, writeFile, rm, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { computeUnifiedDiff, sanitizePathForFile } from "./helpers";
import type { SnapshotFileEntry, SnapshotMeta, SnapshotFileChange } from "./types";

const MAX_AUTO_SNAPSHOTS = 25;

export class SnapshotManager {
  private snapshotsDir: string;

  constructor(workspaceDir: string) {
    this.snapshotsDir = join(workspaceDir, "snapshots");
  }

  async init(): Promise<void> {
    await mkdir(this.snapshotsDir, { recursive: true });
    // Clean up empty/incomplete snapshot directories from prior sessions
    await this.cleanupEmptySnapshots();
  }

  getSnapshotsDir(): string { return this.snapshotsDir; }

  async createSnapshot(id: string, description: string, changedFiles: SnapshotFileChange[]): Promise<SnapshotMeta> {
    const snapshotDir = join(this.snapshotsDir, id);
    await mkdir(snapshotDir, { recursive: true });

    const meta: SnapshotMeta = { id, timestamp: Date.now(), description, totalFiles: changedFiles.length, totalSize: 0, phase: undefined };
    const files: SnapshotFileEntry[] = [];

    try {
      for (const file of changedFiles) {
        const safeName = sanitizePathForFile(file.path);
        const diffFileName = `${safeName}.diff`;
        const diffPath = join(snapshotDir, diffFileName);
        const oldContentFileName = `${safeName}.old`;
        const oldContentPath = join(snapshotDir, oldContentFileName);

        const oldStr = file.oldContent ?? "";
        const newStr = file.newContent ?? "";
        const diff = computeUnifiedDiff(oldStr, newStr, file.path);
        if (diff) { await writeFile(diffPath, diff, "utf-8"); }

        if (file.oldContent !== null) { await writeFile(oldContentPath, file.oldContent, "utf-8"); }

        // Store entry with action info for backward-compatible restore
        const action = file.action || (file.oldContent !== null ? "modify" : "create");
        const entry: SnapshotFileEntry = {
          path: file.path,
          action: action as "create" | "modify" | "delete",
          diffFile: diff ? diffFileName : undefined,
          oldContentFile: file.oldContent !== null ? oldContentFileName : undefined,
          size: 0,
          mode: 0o644,
        };
        files.push(entry);
      }

      meta.files = files;
      meta.totalFiles = files.length;
      const metaPath = join(snapshotDir, "meta.json");
      await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    } catch (e) {
      // Clean up partially-created snapshot directory on failure
      await rm(snapshotDir, { recursive: true, force: true });
      throw e;
    }

    // Enforce max auto-snapshots (remove oldest)
    if (id.startsWith("auto-")) {
      await this.enforceMaxSnapshots();
    }

    return meta;
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    try {
      const entries = await readdir(this.snapshotsDir, { withFileTypes: true });
      const snapshots: SnapshotMeta[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = join(this.snapshotsDir, entry.name, "meta.json");
        try {
          const content = await readFile(metaPath, "utf-8");
          snapshots.push(JSON.parse(content));
        } catch { /* skip */ }
      }
      snapshots.sort((a, b) => b.timestamp - a.timestamp);
      return snapshots;
    } catch { return []; }
  }

  async getSnapshot(id: string): Promise<SnapshotMeta | null> {
    const metaPath = join(this.snapshotsDir, id, "meta.json");
    try {
      const content = await readFile(metaPath, "utf-8");
      return JSON.parse(content);
    } catch { return null; }
  }

  async restoreSnapshot(id: string, projectRoot: string): Promise<{ restored: string[]; errors: string[] }> {
    const meta = await this.getSnapshot(id);
    if (!meta) { throw new Error(`Snapshot "${id}" not found`); }

    const restored: string[] = [];
    const errors: string[] = [];

    for (const file of meta.files) {
      const absPath = resolve(projectRoot, file.path);
      try {
        if (file.oldContentFile) {
          // Modification — restore from saved old content
          const oldContentPath = join(this.snapshotsDir, id, file.oldContentFile);
          const oldContent = await readFile(oldContentPath, "utf-8");
          await mkdir(dirname(absPath), { recursive: true });
          await writeFile(absPath, oldContent, "utf-8");
          restored.push(file.path);
        } else if (file.action === "create" || file.action === undefined) {
          // New file created in snapshot — delete it to rollback
          try {
            await unlink(absPath);
            restored.push(file.path + " (deleted)");
          } catch {
            // File may already be gone
            restored.push(file.path + " (already removed)");
          }
        } else {
          // Unknown action — skip
          errors.push(`${file.path}: unknown action "${file.action}" — cannot restore`);
        }
      } catch (e: any) {
        errors.push(`${file.path}: ${e.message}`);
      }
    }
    return { restored, errors };
  }

  formatSnapshotList(meta: SnapshotMeta): string {
    const date = new Date(meta.timestamp);
    const lines: string[] = [
      `📸 Snapshot: ${meta.id}`,
      `   When: ${date.toLocaleString()}`,
      `   Description: ${meta.description}`,
      `   Files: ${meta.totalFiles}`,
    ];
    if (meta.files) {
      for (const f of meta.files) {
        lines.push(`     ${f.action === "create" ? "+" : f.action === "delete" ? "-" : "~"} ${f.path}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * Remove empty or incomplete snapshot directories (where createSnapshot failed mid-way).
   */
  async cleanupEmptySnapshots(): Promise<number> {
    let removed = 0;
    try {
      const entries = await readdir(this.snapshotsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = join(this.snapshotsDir, entry.name, "meta.json");
        if (!existsSync(metaPath)) {
          await rm(join(this.snapshotsDir, entry.name), { recursive: true, force: true });
          removed++;
        }
      }
    } catch { /* directory may not exist yet */ }
    return removed;
  }

  /**
   * Enforce a cap on auto-snapshots. Removes oldest auto-snapshots (by timestamp)
   * when the count exceeds MAX_AUTO_SNAPSHOTS.
   */
  async enforceMaxSnapshots(): Promise<number> {
    let removed = 0;
    try {
      const entries = await readdir(this.snapshotsDir, { withFileTypes: true });
      const autoDirs: { name: string; timestamp: number }[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith("auto-")) continue;
        const metaPath = join(this.snapshotsDir, entry.name, "meta.json");
        try {
          const content = await readFile(metaPath, "utf-8");
          const meta = JSON.parse(content);
          autoDirs.push({ name: entry.name, timestamp: meta.timestamp || 0 });
        } catch { /* skip */ }
      }
      if (autoDirs.length > MAX_AUTO_SNAPSHOTS) {
        // Sort oldest first
        autoDirs.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = autoDirs.slice(0, autoDirs.length - MAX_AUTO_SNAPSHOTS);
        for (const dir of toRemove) {
          await rm(join(this.snapshotsDir, dir.name), { recursive: true, force: true });
          removed++;
        }
      }
    } catch { /* best-effort */ }
    return removed;
  }
}
