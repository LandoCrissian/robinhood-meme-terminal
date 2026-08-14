import assert from "node:assert/strict";
import type { StrategySpec } from "../../../packages/agent-core/src/index.ts";
import { PaperEvaluationScheduler, buildPaperEvaluationKey, paperEvaluationSlotStart, type PaperEvaluationExecutor, type PaperEvaluationScheduleCatalog } from "./paper-evaluation-scheduler.ts";
import { RmtRobinhoodStockMarketSource, type RobinhoodStockRegistryReader, type VNextMarketDirectoryReader } from "./rmt-robinhood-stock-market-source.ts";

const officialNvda = "0x1111111111111111111111111111111111111111" as const;
const spoofNvda = "0x2222222222222222222222222222222222222222" as const;
const officialAmd = "0x3333333333333333333333333333333333333333" as const;
const pair = "0x4444444444444444444444444444444444444444" as const;
const strategy: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"], minimumLiquidityUsd: 25_000 },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 86_400 },
  signals: [{ type: "momentum", weight: 1 }],
  prediction: { enabled: true, minimumConfidence: 0.65 },
  risk: { maximumPositionBps: 500, maximumPortfolioExposureBps: 2_500, maximumOpenPositions: 5, maximumDailyLossBps: 300, maximumDrawdownBps: 1_000, maximumTradesPerDay: 20 },
  execution: { venuePolicy: "RMT_BEST_VERIFIED", maximumSlippageBps: 100, maximumPriceImpactBps: 250 },
  prohibitedActions: ["ARBITRARY_CALL", "UNVERIFIED_VENUE"],
};

class FakeDirectoryReader implements VNextMarketDirectoryReader {
  readonly sourceId = "rmt-vnext-market-directory-v1";
  calls = 0;
  private readonly payload: unknown;

  constructor(payload: unknown) {
    this.payload = payload;
  }

  async read(): Promise<unknown> {
    this.calls += 1;
    return structuredClone(this.payload);
  }
}

class FakeRegistryReader implements RobinhoodStockRegistryReader {
  readonly sourceId = "robinhood-live-asset-registry";
  calls = 0;
  private readonly input: { coverage?: "complete" | "unavailable"; entries: Array<[string, any]> };

  constructor(input: { coverage?: "complete" | "unavailable"; entries: Array<[string, any]> }) {
    this.input = input;
  }

  async read() {
    this.calls += 1;
    return { coverage: this.input.coverage ?? "complete", assetsByAddress: new Map(this.input.entries) };
  }
}

const directoryPayload = {
  updatedAt: "2026-08-14T16:34:00.000Z",
  markets: [
    { address: spoofNvda, name: "Fake NVDA", symbol: "NVDA", priceUsd: 999, liquidityUsd: 9_000_000, volume24h: 1_000_000, priceChange24h: 80, marketCapUsd: 20_000_000, pairAddress: pair, dexId: "spoof-dex" },
    { address: officialNvda, name: "NVIDIA Stock Token", symbol: "NVDA", priceUsd: 150.25, liquidityUsd: 1_000_000, volume24h: 250_000, priceChange24h: 1.5, marketCapUsd: 10_000_000, pairAddress: pair, dexId: "verified-dex" },
    { address: officialAmd, name: "AMD Stock Token", symbol: "AMD", priceUsd: 180, liquidityUsd: 500_000, volume24h: 100_000, priceChange24h: 0.5 },
  ],
};
const directory = new FakeDirectoryReader(directoryPayload);
const registry = new FakeRegistryReader({ entries: [
  [officialNvda, { assetId: "robinhood-nvda", tokenSymbol: "NVDA", tokenName: "NVIDIA Stock Token", contractAddress: officialNvda, currentMultiplier: "1", status: "active" }],
  [officialAmd, { assetId: "robinhood-amd", tokenSymbol: "AMD", tokenName: "AMD Stock Token", contractAddress: officialAmd, currentMultiplier: "1", status: "active" }],
] });
const source = new RmtRobinhoodStockMarketSource({ directory, stockRegistry: registry, config: { maximumObservations: 16 } });
const captured = await source.capture({ agentId: "agent-1", accountId: "account-1", strategy, evaluatedAt: Date.parse("2026-08-14T16:34:01.000Z") }) as { chainId: number; capturedAt: number; observations: Array<Record<string, unknown>> };
assert.equal(captured.chainId, 4_663);
assert.equal(captured.observations.length, 1);
assert.equal(captured.observations[0]?.assetId, "NVDA");
assert.equal(captured.observations[0]?.referencePriceAtomic, "150250000");
assert.equal(captured.observations[0]?.liquidityUsdAtomic, "1000000000000");
assert.equal((captured.observations[0]?.features as Record<string, unknown>).contractAddress, officialNvda);
assert.equal((captured.observations[0]?.features as Record<string, unknown>).registryAssetId, "robinhood-nvda");
assert.equal((captured.observations[0]?.features as Record<string, unknown>).dexId, "verified-dex");
assert.equal(directory.calls, 1);
assert.equal(registry.calls, 1);

await assert.rejects(() => new RmtRobinhoodStockMarketSource({ directory: new FakeDirectoryReader({ ...directoryPayload, stale: true }), stockRegistry: registry, config: { maximumObservations: 16 } }).capture({ agentId: "agent-1", accountId: "account-1", strategy, evaluatedAt: Date.now() }), /directory is stale/);
await assert.rejects(() => new RmtRobinhoodStockMarketSource({ directory, stockRegistry: new FakeRegistryReader({ coverage: "unavailable", entries: [] }), config: { maximumObservations: 16 } }).capture({ agentId: "agent-1", accountId: "account-1", strategy, evaluatedAt: Date.now() }), /registry coverage is unavailable/);
await assert.rejects(() => source.capture({ agentId: "agent-1", accountId: "account-1", strategy: { ...strategy, universe: { ...strategy.universe, assetClasses: ["RWA", "COMMUNITY"] } }, evaluatedAt: Date.now() }), /does not classify COMMUNITY/);
await assert.rejects(() => new RmtRobinhoodStockMarketSource({ directory, stockRegistry: new FakeRegistryReader({ entries: [
  [officialNvda, { assetId: "one", tokenSymbol: "NVDA", tokenName: "One", contractAddress: officialNvda, currentMultiplier: "1", status: "active" }],
  [officialAmd, { assetId: "two", tokenSymbol: "NVDA", tokenName: "Two", contractAddress: officialAmd, currentMultiplier: "1", status: "active" }],
] }), config: { maximumObservations: 16 } }).capture({ agentId: "agent-1", accountId: "account-1", strategy, evaluatedAt: Date.now() }), /symbol is ambiguous/);

assert.equal(paperEvaluationSlotStart(125_000, 60), 120_000);
assert.equal(buildPaperEvaluationKey({ prefix: "paper", agentId: "agent-1", accountId: "account-1", evaluationIntervalSeconds: 60, slotStart: 120_000 }), "paper:agent-1:account-1:60:120000");

class FakeCatalog implements PaperEvaluationScheduleCatalog {
  async listCandidates() {
    return [
      { agentId: "agent-1", accountId: "account-1", evaluationIntervalSeconds: 60 },
      { agentId: "agent-1", accountId: "account-1", evaluationIntervalSeconds: 60 },
      { agentId: "agent-2", accountId: "account-2", evaluationIntervalSeconds: 300 },
    ];
  }
}
class FakeExecutor implements PaperEvaluationExecutor {
  calls: Array<{ agentId: string; accountId: string; evaluationKey: string; evaluatedAt?: number }> = [];

  async evaluate(input: { agentId: string; accountId: string; evaluationKey: string; evaluatedAt?: number }) {
    this.calls.push(input);
    if (input.agentId === "agent-2") throw new Error("simulated evaluation failure");
    return { run: {} as never, decision: {} as never };
  }
}
const executor = new FakeExecutor();
const scheduler = new PaperEvaluationScheduler({ catalog: new FakeCatalog(), executor, config: { maximumCandidates: 10, maximumConcurrency: 2, evaluationKeyPrefix: "paper" } });
const scheduled = await scheduler.runOnce(125_000);
assert.equal(scheduled.length, 2);
assert.equal(executor.calls.length, 2);
assert.equal(scheduled.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(scheduled.filter((result) => result.status === "rejected").length, 1);
assert.ok(executor.calls.some((call) => call.evaluationKey === "paper:agent-1:account-1:60:120000"));
assert.ok(executor.calls.some((call) => call.evaluationKey === "paper:agent-2:account-2:300:0"));
const again = await scheduler.runOnce(125_999);
assert.deepEqual(again.map((result) => result.evaluationKey), scheduled.map((result) => result.evaluationKey));
assert.equal("start" in scheduler, false);
assert.equal("setInterval" in scheduler, false);
console.log("rmt-market-scheduler smoke: ok");