// @ts-nocheck — Runtime utility module, not a pi extension

/**
 * PrivilegeManager — Tool Privilege Hierarchy & Escalation Ladder
 *
 * Implements a 4-level tool privilege system with escalation tracking.
 * Research basis: arXiv:2606.20023 — Over-Privileged Tool Selection
 */

import { ToolPrivilegeLevel, type ToolPrivilege, type EscalationStep, type EscalationPattern } from "./types";

export class PrivilegeManager {
  private toolPrivileges: Map<string, ToolPrivilege> = new Map();
  private escalationHistory: Array<{ toolName: string; timestamp: number; suggestedAlternative: string | null; wasOverride: boolean; context: string }> = [];
  private totalToolCalls: number = 0;

  // ── Escalation Ladder ───────────────────────────────────────────
  private escalationChains: Map<string, EscalationPattern> = new Map();
  private specificEscalation: Map<string, string> = new Map();

  constructor() {
    this.registerDefaultTools();
    this.registerEscalationAlternatives();
  }

  private registerEscalationAlternatives() {
    this.specificEscalation.set("read", "workspace_write");
    this.specificEscalation.set("workspace_state", "workspace_exec");
    this.specificEscalation.set("workspace_memory_search", "bash");
    this.specificEscalation.set("workspace_memory_stats", "bash");
    this.specificEscalation.set("workspace_memory_list_code", "bash");
    this.specificEscalation.set("workspace_write", "workspace_exec");
    this.specificEscalation.set("workspace_append", "workspace_exec");
    this.specificEscalation.set("workspace_create_temp", "workspace_exec");
    this.specificEscalation.set("workspace_memory_record", "workspace_exec");
    this.specificEscalation.set("workspace_memory_feedback", "workspace_exec");
    this.specificEscalation.set("workspace_exec", "workspace_install_dep");
    this.specificEscalation.set("workspace_validate", "workspace_exec");
    this.specificEscalation.set("bash", "workspace_exec");
    this.specificEscalation.set("write", "workspace_exec");
    this.specificEscalation.set("edit", "workspace_validate");
  }

  private registerDefaultTools() {
    this.registerTool("read", ToolPrivilegeLevel.READ, "Read file contents", []);
    this.registerTool("workspace_state", ToolPrivilegeLevel.READ, "Get workspace state", []);
    this.registerTool("workspace_memory_search", ToolPrivilegeLevel.READ, "Search memory", []);
    this.registerTool("workspace_memory_stats", ToolPrivilegeLevel.READ, "Memory stats", []);
    this.registerTool("workspace_memory_list_code", ToolPrivilegeLevel.READ, "List code tools", []);
    this.registerTool("workspace_write", ToolPrivilegeLevel.SCOPED_WRITE, "Write file in workspace", []);
    this.registerTool("workspace_append", ToolPrivilegeLevel.SCOPED_WRITE, "Append to file", []);
    this.registerTool("workspace_create_temp", ToolPrivilegeLevel.SCOPED_WRITE, "Create temp dir", []);
    this.registerTool("workspace_memory_record", ToolPrivilegeLevel.SCOPED_WRITE, "Record memory", []);
    this.registerTool("workspace_memory_feedback", ToolPrivilegeLevel.SCOPED_WRITE, "Memory feedback", []);
    this.registerTool("workspace_exec", ToolPrivilegeLevel.EXECUTION, "Execute command", ["bash (read-only)"]);
    this.registerTool("workspace_validate", ToolPrivilegeLevel.EXECUTION, "Run validation", ["workspace_exec"]);
    this.registerTool("bash", ToolPrivilegeLevel.EXECUTION, "Run bash command", []);
    this.registerTool("workspace_install_dep", ToolPrivilegeLevel.MANAGEMENT, "Install dependency", ["workspace_exec (pip/npm via exec)"]);
    this.registerTool("write", ToolPrivilegeLevel.MANAGEMENT, "Write any file", ["workspace_write"]);
    this.registerTool("edit", ToolPrivilegeLevel.MANAGEMENT, "Edit any file", ["workspace_write"]);
  }

  registerTool(name: string, level: ToolPrivilegeLevel, description: string, alternatives: string[]) {
    this.toolPrivileges.set(name, { toolName: name, level, description, sufficientAlternatives: alternatives });
  }

  getPrivilegeLevel(toolName: string): ToolPrivilegeLevel | null {
    return this.toolPrivileges.get(toolName)?.level ?? null;
  }

  checkPrivilege(requestedTool: string, context: { recentErrors: boolean; taskType?: string }): { isOverPrivileged: boolean; suggestedAlternative: string | null } {
    this.totalToolCalls++;
    const privilege = this.toolPrivileges.get(requestedTool);
    if (!privilege || privilege.level <= ToolPrivilegeLevel.SCOPED_WRITE) return { isOverPrivileged: false, suggestedAlternative: null };
    if (privilege.sufficientAlternatives.length > 0 && !context.recentErrors) {
      const alt = privilege.sufficientAlternatives[0];
      this.escalationHistory.push({ toolName: requestedTool, timestamp: Date.now(), suggestedAlternative: alt, wasOverride: false, context: context.taskType || "unknown" });
      return { isOverPrivileged: true, suggestedAlternative: alt };
    }
    return { isOverPrivileged: false, suggestedAlternative: null };
  }

  attemptEscalation(failedTool: string, context: string): {
    alternativeTool: string | null;
    alternativeLevel: ToolPrivilegeLevel | null;
    chain: EscalationStep[];
    shouldSuggestConfig: boolean;
  } {
    const privilege = this.toolPrivileges.get(failedTool);
    if (!privilege) {
      return { alternativeTool: null, alternativeLevel: null, chain: [], shouldSuggestConfig: false };
    }
    const currentLevel = privilege.level;
    if (currentLevel >= ToolPrivilegeLevel.MANAGEMENT) {
      return { alternativeTool: null, alternativeLevel: null, chain: [], shouldSuggestConfig: false };
    }
    const nextLevel = (currentLevel + 1) as ToolPrivilegeLevel;
    let alternativeTool: string | null = this.specificEscalation.get(failedTool) ?? null;
    if (!alternativeTool) {
      const toolsAtNextLevel = [...this.toolPrivileges.values()]
        .filter(tp => tp.level === nextLevel && tp.toolName !== failedTool);
      alternativeTool = toolsAtNextLevel.length > 0 ? toolsAtNextLevel[0].toolName : null;
    } else {
      const altPriv = this.toolPrivileges.get(alternativeTool);
      if (!altPriv || altPriv.level !== nextLevel) {
        const toolsAtNextLevel = [...this.toolPrivileges.values()]
          .filter(tp => tp.level === nextLevel && tp.toolName !== failedTool);
        alternativeTool = toolsAtNextLevel.length > 0 ? toolsAtNextLevel[0].toolName : null;
      }
    }
    const step: EscalationStep = {
      level: currentLevel, toolName: failedTool, timestamp: Date.now(),
      alternativeTool, alternativeLevel: alternativeTool ? nextLevel : null,
      success: null, context,
    };
    const pattern = this.getEscalationPattern(failedTool);
    let chain = this.escalationChains.get(pattern);
    if (!chain) {
      chain = { pattern, chain: [], count: 0, lastEscalation: Date.now(), configSuggested: false };
      this.escalationChains.set(pattern, chain);
    }
    chain.chain.push(step);
    chain.count++;
    chain.lastEscalation = Date.now();
    this.escalationHistory.push({
      toolName: failedTool, timestamp: Date.now(),
      suggestedAlternative: alternativeTool, wasOverride: true,
      context: `escalation_ladder: ${context}`,
    });
    const shouldSuggestConfig = chain.count >= 3 && !chain.configSuggested;
    if (shouldSuggestConfig) { chain.configSuggested = true; }
    return { alternativeTool, alternativeLevel: alternativeTool ? nextLevel : null, chain: chain.chain, shouldSuggestConfig };
  }

  recordEscalationResult(toolName: string, succeeded: boolean, context: string): void {
    for (const [, chain] of this.escalationChains) {
      for (let i = chain.chain.length - 1; i >= 0; i--) {
        const step = chain.chain[i];
        if (step.alternativeTool === toolName && step.success === null) {
          step.success = succeeded;
          step.context = context;
          return;
        }
      }
    }
  }

  private getEscalationPattern(failedTool: string): string { return failedTool; }

  getEscalationChains(): Map<string, EscalationPattern> { return new Map(this.escalationChains); }

  getChainCount(toolPattern: string): number {
    const chain = this.escalationChains.get(toolPattern);
    return chain ? chain.count : 0;
  }

  getEscalationChainSummary(): string {
    if (this.escalationChains.size === 0) return "  No escalation chains recorded.";
    const chains = [...this.escalationChains.values()]
      .sort((a, b) => b.lastEscalation - a.lastEscalation).slice(0, 5);
    const lines: string[] = [`  Escalation Chain History (last ${Math.min(this.escalationChains.size, 5)} of ${this.escalationChains.size}):`];
    for (const chain of chains) {
      const steps = chain.chain.map(s => {
        const levelName = ToolPrivilegeLevel[s.level];
        const altName = s.alternativeTool
          ? `→ ${ToolPrivilegeLevel[s.alternativeLevel!]}:${s.alternativeTool}` : "→ (none)";
        const status = s.success === null ? "⏳" : s.success ? "✅" : "❌";
        return `${levelName}:${s.toolName} ${altName} ${status}`;
      });
      lines.push(`    • ${steps.join(" > ")} (${chain.count}x)`);
    }
    return lines.join("\n");
  }

  recordEscalation(toolName: string, alternative: string | null, context: string) {
    this.escalationHistory.push({ toolName, timestamp: Date.now(), suggestedAlternative: alternative, wasOverride: true, context });
  }

  getEscalationRate(): number {
    if (this.totalToolCalls === 0) return 0;
    return this.escalationHistory.filter(e => e.wasOverride).length / this.totalToolCalls;
  }

  getToolsAtLevel(level: ToolPrivilegeLevel): ToolPrivilege[] {
    return [...this.toolPrivileges.values()].filter(tp => tp.level <= level);
  }

  formatStatus(): string {
    const total = this.toolPrivileges.size;
    const escalations = this.escalationHistory.filter(e => e.wasOverride).length;
    const rate = this.totalToolCalls > 0 ? (escalations / this.totalToolCalls * 100).toFixed(0) : "0";
    const compliance = this.totalToolCalls > 0 ? ((1 - this.getEscalationRate()) * 100).toFixed(0) : "100";
    const lines: string[] = [
      `🔒 Tool Privileges:`,
      `  ${total} tools registered`,
      `  Escalation rate: ${rate}% (${escalations} escalations in ${this.totalToolCalls} calls)`,
      `  Least-privilege compliance: ${compliance}%`,
      ``,
      this.getEscalationChainSummary(),
    ];
    const chainsNeedingConfig = [...this.escalationChains.values()].filter(c => c.configSuggested);
    if (chainsNeedingConfig.length > 0) {
      lines.push(``);
      lines.push(`⚙️ Configuration Suggestions:`);
      for (const c of chainsNeedingConfig) {
        lines.push(`  • Tool "${c.pattern}" has been escalated ${c.count} times. Consider adjusting tool privilege settings in .pi/settings.json.`);
      }
    }
    return lines.join("\n");
  }

  reset() {
    this.toolPrivileges.clear();
    this.escalationHistory = [];
    this.totalToolCalls = 0;
    this.escalationChains.clear();
    this.specificEscalation.clear();
    this.registerDefaultTools();
    this.registerEscalationAlternatives();
  }
}
