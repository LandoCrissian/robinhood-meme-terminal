import type {
  AgentDecision,
  AgentRecord,
  PaperAccountRecord,
  PaperFillRecord,
  PaperOrderRecord,
  PortfolioSnapshot,
  PredictionRecord,
  RiskEventRecord,
  ScoreSnapshotRecord,
  SeasonRecord,
  StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";

export interface AgentEngineSnapshot {
  schemaVersion: 1;
  seasons: SeasonRecord[];
  agents: AgentRecord[];
  strategyVersions: StrategyVersionRecord[];
  paperAccounts: PaperAccountRecord[];
  decisions: AgentDecision[];
  predictions: PredictionRecord[];
  paperOrders: PaperOrderRecord[];
  paperFills: PaperFillRecord[];
  portfolioSnapshots: PortfolioSnapshot[];
  riskEvents: RiskEventRecord[];
  scoreSnapshots: ScoreSnapshotRecord[];
}

export function emptyAgentEngineSnapshot(): AgentEngineSnapshot {
  return {
    schemaVersion: 1,
    seasons: [],
    agents: [],
    strategyVersions: [],
    paperAccounts: [],
    decisions: [],
    predictions: [],
    paperOrders: [],
    paperFills: [],
    portfolioSnapshots: [],
    riskEvents: [],
    scoreSnapshots: [],
  };
}
