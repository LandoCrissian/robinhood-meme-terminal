const smokes = [
  "../../../packages/agent-core/src/smoke.ts",
  "../../../packages/agent-core/src/participant-smoke.ts",
  "./smoke.ts",
  "./human-paper-account-smoke.ts",
  "./human-paper-risk-capacity-smoke.ts",
  "./human-paper-order-admission-smoke.ts",
  "./human-paper-order-submission-gate-smoke.ts",
  "./human-paper-order-submission-smoke.ts",
  "./human-paper-fill-orchestration-smoke.ts",
  "./human-paper-persistence-smoke.ts",
  "./durability-smoke.ts",
  "./strategy-compiler-smoke.ts",
  "./paper-evaluation-smoke.ts",
  "./rmt-market-scheduler-smoke.ts",
  "./rmt-paper-quote-smoke.ts",
  "./paper-risk-capacity-smoke.ts",
  "./paper-order-admission-smoke.ts",
  "./paper-order-submission-smoke.ts",
  "./paper-fill-cost-smoke.ts",
  "./paper-fill-orchestration-smoke.ts",
  "./paper-trade-request-smoke.ts",
  "./paper-trade-capacity-smoke.ts",
  "./paper-open-position-admission-smoke.ts",
  "./paper-position-book-smoke.ts",
  "./paper-liquidation-valuation-smoke.ts",
  "./paper-canonical-valuation-smoke.ts",
  "./paper-arena-performance-smoke.ts",
  "./paper-arena-leaderboard-smoke.ts",
  "./paper-external-cost-valuation-smoke.ts",
  "./paper-arena-net-performance-smoke.ts",
  "./paper-arena-net-leaderboard-smoke.ts",
  "./human-canonical-risk-snapshot-smoke.ts",
  "./human-canonical-paper-execution-smoke.ts",
] as const;

for (const smoke of smokes) {
  process.stdout.write(`\n[agent-foundation] ${smoke}\n`);
  await import(smoke);
}

console.log(`\nagent foundation smoke runner: ok (${smokes.length} lanes)`);
