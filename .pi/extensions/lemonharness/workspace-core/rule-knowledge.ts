// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * RuleKnowledgeManager — Skill Discovery & Domain Detection
 *
 * Discovers skills from the skills directory, detects domains from prompts,
 * and provides skill content retrieval.
 */

import { join, dirname } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { pathExists } from "./helpers";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  content: string;
  loadedAt: number;
}

export class RuleKnowledgeManager {
  private skills: SkillInfo[] = [];

  async discover(skillsDir: string): Promise<SkillInfo[]> {
    this.skills = [];
    try {
      if (!(await pathExists(skillsDir))) return this.skills;
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(skillsDir, entry.name);
        const skillFile = join(skillPath, "SKILL.md");
        if (await pathExists(skillFile)) {
          const content = await readFile(skillFile, "utf-8");
          const description = this.extractFrontmatterField(content, "description") || entry.name;
          this.skills.push({ name: entry.name, description, path: skillPath, content, loadedAt: Date.now() });
        }
      }
    } catch { /* Skills directory may not exist yet */ }
    return this.skills;
  }

  getSkills(): SkillInfo[] { return [...this.skills]; }

  getSkill(name: string): SkillInfo | undefined { return this.skills.find(s => s.name === name); }

  async getSkillContent(name: string): Promise<string | null> {
    const skill = this.getSkill(name);
    if (!skill) return null;
    try { return await readFile(join(skill.path, "SKILL.md"), "utf-8"); } catch { return null; }
  }

  detectDomain(prompt: string): string[] {
    const promptLower = prompt.toLowerCase();
    const matched: string[] = [];
    const patterns: Array<{ name: string; keywords: string[] }> = [
      { name: "ml-workflows", keywords: ["train", "neural network", "deep learning", "machine learning", "model", "dataset", "pytorch", "tensorflow", "loss", "accuracy", "epoch", "batch", "validation", "test set", "random seed"] },
      { name: "bio-design", keywords: ["protein", "dna", "rna", "biological", "genome", "gene", "sequence", "molecular", "drug", "synthesis"] },
      { name: "vision-media", keywords: ["image", "video", "frame", "mask", "pixel", "computer vision", "object detection", "segmentation", "visual", "render"] },
      { name: "systems-recovery", keywords: ["recover", "crash", "backup", "restore", "failover", "disaster", "integrity", "probe", "build system"] },
      { name: "game-logic", keywords: ["game", "player", "score", "move", "state machine", "turn-based", "board", "strategy", "transition"] },
    ];
    for (const pattern of patterns) {
      if (pattern.keywords.filter(kw => promptLower.includes(kw)).length >= 2) {
        matched.push(pattern.name);
      }
    }
    const baseSkills = ["general-rules", "engineering-practices", "self-improvement"];
    for (const base of baseSkills) {
      if (!matched.includes(base)) matched.unshift(base);
    }
    return matched;
  }

  private extractFrontmatterField(content: string, field: string): string | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const line = match[1].split("\n").find(l => l.startsWith(`${field}:`));
    return line ? line.slice(field.length + 1).trim() : null;
  }
}
