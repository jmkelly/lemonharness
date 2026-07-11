// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * SaPVerifier — Skill Pseudocode Contract Verification
 *
 * Research basis: arXiv:2605.27955 — Skill-as-Pseudocode
 */

import type { SkillContract, SaPVerificationResult } from "./types";

export class SaPVerifier {
  verifyContract(contract: SkillContract, skillContent: string, existingContracts: SkillContract[] = []): SaPVerificationResult {
    const coverage = this.checkCoverage(contract, skillContent);
    const binding = this.checkBinding(contract);
    const replacement = this.checkReplacement(contract, existingContracts);
    const risk = this.checkRisk(contract);
    const issues: string[] = [];
    if (!coverage) issues.push("Coverage: Pseudocode may not cover all prose operations");
    if (!binding) issues.push("Binding: Some inputs have unresolvable types");
    if (!replacement) issues.push("Replacement: Contract conflicts with existing contracts");
    if (!risk) issues.push("Risk: Potentially dangerous operations not flagged");
    return { name: contract.name, passed: coverage && binding && replacement && risk, coverage, binding, replacement, risk, issues };
  }

  private checkCoverage(contract: SkillContract, skillContent: string): boolean {
    const lowerContent = skillContent.toLowerCase();
    const terms = new Set<string>();
    for (const i of contract.inputs) terms.add(i.name.toLowerCase());
    for (const p of contract.preconditions) p.toLowerCase().split(/\s+/).forEach((w: string) => { if (w.length > 3) terms.add(w); });
    for (const p of contract.postconditions) p.toLowerCase().split(/\s+/).forEach((w: string) => { if (w.length > 3) terms.add(w); });
    let matches = 0;
    for (const t of terms) { if (lowerContent.includes(t)) matches++; }
    return terms.size === 0 || matches / terms.size >= 0.3;
  }

  private checkBinding(contract: SkillContract): boolean {
    for (const inp of contract.inputs) {
      if (!inp.type || inp.type.trim() === "") return false;
      if (inp.required && (!inp.name || inp.name.trim() === "")) return false;
    }
    for (const out of contract.outputs) {
      if (!out.type || out.type.trim() === "") return false;
    }
    if (contract.preconditions.length === 0 && contract.inputs.length > 0) return false;
    if (contract.postconditions.length === 0 && contract.outputs.length > 0) return false;
    return true;
  }

  private checkReplacement(contract: SkillContract, existing: SkillContract[]): boolean {
    for (const ec of existing) {
      if (ec.name === contract.name) continue;
      const ei = new Set(ec.inputs.map(i => i.name));
      const ni = new Set(contract.inputs.map(i => i.name));
      if ([...ei].filter(i => ni.has(i)).length >= 2) return false;
    }
    return true;
  }

  private checkRisk(contract: SkillContract): boolean {
    const dangerous = ["rm", "delete", "remove", "overwrite", "sudo", "chmod", "kill", "reboot", "shutdown", "format"];
    const allText = [...contract.preconditions, ...contract.postconditions, ...contract.errorHandling, ...contract.inputs.map(i => i.description), ...contract.outputs.map(o => o.description)].join(" ").toLowerCase();
    for (const p of dangerous) { if (allText.includes(p) && !contract.errorHandling.some(e => e.toLowerCase().includes(p))) return false; }
    return true;
  }

  formatResult(result: SaPVerificationResult): string {
    const status = result.passed ? "✅" : "❌";
    return [
      `${status} ${result.name}: ${result.passed ? "Passed" : "Issues Found"}`,
      `  • Coverage: ${result.coverage ? "✅" : "❌"}`,
      `  • Binding: ${result.binding ? "✅" : "❌"}`,
      `  • Replacement: ${result.replacement ? "✅" : "❌"}`,
      `  • Risk: ${result.risk ? "✅" : "❌"}`,
      ...(result.issues.length > 0 ? [`  Issues: ${result.issues.join("; ")}`] : []),
    ].join("\n");
  }
}
