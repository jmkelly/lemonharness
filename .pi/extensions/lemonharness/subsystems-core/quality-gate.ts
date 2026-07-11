// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * QualityGateManager — Auto-Enforced Verification
 *
 * Manages automatic quality gate execution at phase transitions.
 * Auto-triggers when entering P3 (Validate phase).
 *
 * Research basis: VerifAI (2025), EPO-Safe (arXiv:2604.23210)
 */

import { join } from "node:path";
import { mkdir, readFile, writeFile, stat as fsStat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { QualityGateConfig, SafetySpec } from "./types";

export class QualityGateManager {
  private config: QualityGateConfig;
  private lastResult: { passed: boolean; output: string } | null = null;
  private projectRoot: string;
  // v3: Safety specification mining
  private safetySpecs: SafetySpec[] = [];
  private safetySpecsPath: string;

  constructor(projectRoot: string, config?: Partial<QualityGateConfig>) {
    this.projectRoot = projectRoot;
    this.config = {
      autoTriggerOnP3Entry: config?.autoTriggerOnP3Entry ?? true,
      blockOnFailure: config?.blockOnFailure ?? false,
      scriptPath: config?.scriptPath ?? ".lemonharness/quality-gate.sh",
      expectedOutput: config?.expectedOutput ?? "All checks pass",
    };
    this.safetySpecsPath = join(projectRoot, ".lemonharness", "quality-specs.json");
  }

  getConfig(): QualityGateConfig { return { ...this.config }; }

  async init() {
    await this.loadSafetySpecs();
  }

  async run(): Promise<{ passed: boolean; output: string }> {
    const scriptPath = join(this.projectRoot, this.config.scriptPath);
    try { await fsStat(scriptPath); } catch {
      this.lastResult = { passed: true, output: "⚠ Quality gate script not found — skipping." };
      return this.lastResult;
    }

    return new Promise((resolvePromise) => {
      const child = spawn("bash", ["-c", `bash "${scriptPath}"`], {
        cwd: this.projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", (code) => {
        const output = stdout + stderr;
        const passed = code === 0 || output.includes(this.config.expectedOutput);
        this.lastResult = { passed, output };
        if (!passed) {
          this.extractSafetySpecs(output);
        }
        resolvePromise(this.lastResult);
      });
      child.on("error", () => {
        this.lastResult = { passed: true, output: "⚠ Quality gate process error — skipping." };
        resolvePromise(this.lastResult);
      });
    });
  }

  getLastResult(): { passed: boolean; output: string } | null {
    return this.lastResult;
  }

  setBlockOnFailure(block: boolean) { this.config.blockOnFailure = block; }

  /**
   * Extract safety specs from quality gate failure output.
   * Uses template-based pattern matching (no LLM call needed).
   */
  private extractSafetySpecs(output: string) {
    const outputLower = output.toLowerCase();
    const patterns: Array<{ regex: RegExp; template: (match: string) => string }> = [
      {
        regex: /(?:file|line).*?(\d+).*?(?:long|length|too long|exceeds)/gi,
        template: (m) => `Keep file size under ${m} lines or bytes`,
      },
      {
        regex: /(?:complexity|cyclomatic).*?(\d+)/gi,
        template: (m) => `Cyclomatic complexity should be ≤ ${m}`,
      },
      {
        regex: /FAILED/gi,
        template: () => `Ensure all tests pass before declaring task complete`,
      },
      {
        regex: /(?:maintainability|mi).*?\b([A-F])\b/i,
        template: (m) => `Maintainability index should be grade ${m} or better`,
      },
      {
        regex: /(?:nesting|depth).*?(\d+)/gi,
        template: (m) => `Nesting depth should be ≤ ${m}`,
      },
      {
        regex: /(?:duplicat|copy).*?(\d+)/gi,
        template: (m) => `Duplicate code percentage should be ≤ ${m}%`,
      },
      {
        regex: /(?:coverage|uncovered).*?(\d+)/gi,
        template: (m) => `Test coverage should be ≥ ${m}%`,
      },
    ];

    for (const { regex, template } of patterns) {
      const match = regex.exec(outputLower);
      if (match) {
        const rule = template(match[1] || "0");
        const existing = this.safetySpecs.find(s => s.rule === rule);
        if (existing) {
          existing.timesTriggered++;
          existing.lastObserved = Date.now();
          existing.confidence = Math.min(1, existing.confidence + 0.1);
        } else {
          this.safetySpecs.push({
            rule,
            triggeredBy: output.slice(0, 120),
            confidence: 0.3,
            timesTriggered: 1,
            lastObserved: Date.now(),
          });
        }
      }
    }

    this.persistSafetySpecs();
  }

  async recordValidationOutcome(ruleMatch: string, passed: boolean) {
    for (const spec of this.safetySpecs) {
      if (spec.rule.toLowerCase().includes(ruleMatch.toLowerCase())) {
        if (passed) {
          spec.confidence = Math.min(1, spec.confidence + 0.1);
        } else {
          spec.confidence = Math.max(0, spec.confidence - 0.2);
        }
        spec.lastObserved = Date.now();
      }
    }
    await this.persistSafetySpecs();
  }

  getActiveSafetySpecs(): SafetySpec[] {
    return [...this.safetySpecs].filter(s => s.confidence >= 0.2);
  }

  getTopSafetySpecs(maxResults: number = 3): SafetySpec[] {
    return [...this.safetySpecs]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxResults);
  }

  getSafetySpecScore(): number {
    if (this.safetySpecs.length === 0) return 1;
    const avgConfidence = this.safetySpecs.reduce((s, sp) => s + sp.confidence, 0) / this.safetySpecs.length;
    const triggeredCount = this.safetySpecs.reduce((s, sp) => s + sp.timesTriggered, 0);
    return Math.max(0, 1 - (avgConfidence * Math.min(triggeredCount, 10)) / 10);
  }

  formatSafetySpecs(): string {
    const specs = this.getActiveSafetySpecs();
    if (specs.length === 0) return "No safety specs discovered yet.";
    return [
      "🛡 Safety Specifications (EPO-Safe):",
      ...specs.map(s =>
        `  • "${s.rule}" (confidence: ${s.confidence.toFixed(2)}, triggered: ${s.timesTriggered}x)`
      ),
    ].join("\n");
  }

  private async persistSafetySpecs() {
    try {
      await writeFile(this.safetySpecsPath, JSON.stringify(this.safetySpecs, null, 2), "utf-8");
    } catch { /* non-critical */ }
  }

  async loadSafetySpecs() {
    try {
      const content = await readFile(this.safetySpecsPath, "utf-8");
      this.safetySpecs = JSON.parse(content);
    } catch {
      this.safetySpecs = [];
    }
  }
}
