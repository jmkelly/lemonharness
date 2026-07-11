// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * SnapshotManager — Workspace Snapshots & Rollback
 *
 * Captures and restores workspace state via file-level snapshots.
 */

import { join, resolve, dirname } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { computeUnifiedDiff, sanitizePathForFile } from "./helpers";
import type { SnapshotFileEntry, SnapshotMeta, SnapshotFileChange } from "./types";

export class SnapshotManager {
  private snapshotsDir: string;

  constructor(workspaceDir: string) {
    this.snapshotsDir = join(workspaceDir, "snapshots");
  }

  async init(): Promise<void> {
    await mkdir(this.snapshotsDir, { recursive: true });
  }

  getSnapshotsDir(): string { return this.snapshotsDir; }

  async createSnapshot(id: string, description: string, changedFiles: SnapshotFileChange[]): Promise<SnapshotMeta> {
    const snapshotDir = join(this.snapshotsDir, id);
    await mkdir(snapshotDir, { recursive: true });

    const meta: SnapshotMeta = { id, timestamp: Date.now(), description, totalFiles: changedFiles.length, totalSize: 0, phase: undefined };
    const files: SnapshotFileEntry[] = [];

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

      const entry: SnapshotFileEntry = { path: file.path, size: 0, mode: 0o644 };
      files.push(entry);
    }

    meta.files = files;
    meta.totalFiles = files.length;
    const metaPath = join(snapshotDir, "meta.json");
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

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
        const oldContentFileName = `${sanitizePathForFile(file.path)}.old`;
        const oldContentPath = join(this.snapshotsDir, id, oldContentFileName);
        const oldContent = await readFile(oldContentPath, "utf-8");
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, oldContent, "utf-8");
        restored.push(file.path);
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
    return lines.join("\n");
  }
}
