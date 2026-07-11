/**
 * Types and phase configuration for LemonHarness visualization.
 */

import type { TimePhaseName } from "../workspace-core";

export interface BudgetData {
  totalBudgetMs: number;
  elapsedMs: number;
  remainingMs: number;
}

export interface PhaseInfo {
  name: TimePhaseName;
  label: string;
  startRatio: number;
  endRatio: number;
  color: string;
  bgColor: string;
}

export const PHASES: PhaseInfo[] = [
  { name: "explore",    label: "Explore",    startRatio: 0.0,  endRatio: 0.3,  color: "#1a73e8", bgColor: "#e8f0fe" },
  { name: "implement",  label: "Implement",  startRatio: 0.3,  endRatio: 0.6,  color: "#e67e22", bgColor: "#fef3e8" },
  { name: "validate",   label: "Validate",   startRatio: 0.6,  endRatio: 0.9,  color: "#27ae60", bgColor: "#e8f5e9" },
  { name: "reserve",    label: "Reserve",    startRatio: 0.9,  endRatio: 1.0,  color: "#8e44ad", bgColor: "#f3e8fd" },
];

export const PHASE_MAP: Record<string, PhaseInfo> = Object.fromEntries(
  PHASES.map(p => [p.name, p]),
);
