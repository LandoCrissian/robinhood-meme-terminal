import type { AgentPerformanceState } from "./schema.ts";

const ALLOWED_TRANSITIONS: Record<AgentPerformanceState, ReadonlySet<AgentPerformanceState>> = {
  INCUBATING: new Set(["PAPER_ACTIVE", "RETIRED"]),
  PAPER_ACTIVE: new Set(["QUALIFIED", "RETIRED"]),
  QUALIFIED: new Set(["ELITE", "PAPER_ACTIVE", "RETIRED"]),
  ELITE: new Set(["QUALIFIED", "RETIRED"]),
  RETIRED: new Set(),
};

export function canTransitionPerformanceState(from: AgentPerformanceState, to: AgentPerformanceState): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function assertPerformanceTransition(from: AgentPerformanceState, to: AgentPerformanceState): void {
  if (!canTransitionPerformanceState(from, to)) throw new Error(`invalid performance transition: ${from} -> ${to}`);
}
