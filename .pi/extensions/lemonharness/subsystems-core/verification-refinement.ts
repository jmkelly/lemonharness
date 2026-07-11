// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * VerificationRefinement — Validation-Pattern Correlation
 *
 * Research basis: arXiv:2603.13258 — MemCoder framework
 */

import type { ValidationCorrelation } from "./types";

export class VerificationRefinement {
  private correlations: Map<string, ValidationCorrelation> = new Map();

  promoteOnPass(_validationCommand: string, relatedPatterns: string[]) {
    for (const pattern of relatedPatterns) {
      const key = pattern.toLowerCase().trim();
      let corr = this.correlations.get(key);
      if (!corr) {
        corr = { patternDescription: pattern, totalApplications: 0, passedValidations: 0, correlation: 0 };
        this.correlations.set(key, corr);
      }
      corr.totalApplications++; corr.passedValidations++;
      corr.correlation = corr.passedValidations / corr.totalApplications;
    }
  }

  demoteOnFail(_validationCommand: string, _output: string, relatedPatterns: string[]) {
    for (const pattern of relatedPatterns) {
      const key = pattern.toLowerCase().trim();
      let corr = this.correlations.get(key);
      if (!corr) {
        corr = { patternDescription: pattern, totalApplications: 0, passedValidations: 0, correlation: 0 };
        this.correlations.set(key, corr);
      }
      corr.totalApplications++;
      corr.correlation = corr.passedValidations / corr.totalApplications;
    }
  }

  getCorrelation(pattern: string): ValidationCorrelation | undefined {
    return this.correlations.get(pattern.toLowerCase().trim());
  }

  getAllCorrelations(): ValidationCorrelation[] {
    return [...this.correlations.values()].sort((a, b) => b.correlation - a.correlation);
  }

  getCorrelationReport(): string {
    const all = this.getAllCorrelations();
    if (all.length === 0) return "No validation-pattern correlation data yet.";
    return [
      "📊 Validation-Pattern Correlation:",
      ...all.slice(0, 10).map(c =>
        `  • "${c.patternDescription.slice(0, 50)}" → ${c.passedValidations}/${c.totalApplications} passes (${(c.correlation * 100).toFixed(0)}% correlation)`
      ),
    ].join("\n");
  }
}
