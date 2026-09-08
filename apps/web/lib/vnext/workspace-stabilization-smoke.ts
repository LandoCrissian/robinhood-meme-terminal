import assert from "node:assert/strict";
import { mock } from "node:test";
import { loadBoundedWorkspaceEvidence } from "../bounded-workspace-evidence";
import { workspaceCanonicalMarkets, workspaceEvidenceStates, workspacePoolFeeLabel } from "./workspace-presentation";
import type { TokenRiskEvidence, TokenRiskEvidenceState } from "../token-risk-evidence";
import type { WalletConstellationGraph } from "../wallet-constellation";
import type { VNextUniversalMarketSearchPool } from "./universal-market-search-contract";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const token = address(1);
const pools = Array.from({ length: 12 }, (_, index) => ({
  sourceId: "uniswap-v3", protocol: "uniswap", version: 3, poolKey: address(index + 10),
  poolAddress: address(index + 10), token0: token, token1: address(2), fee: 3000
} as VNextUniversalMarketSearchPool));
const admitted = workspaceCanonicalMarkets({ address: token,
  canonicalMarkets: [...pools, { ...pools[0] }, { ...pools[0], poolKey: address(99), token0: address(3) }] });
assert.equal(admitted.length, 12);
assert.equal(new Set(admitted.map((pool) => pool.poolKey)).size, 12);
assert.ok(admitted.every((pool) => pool.token0 === token || pool.token1 === token));
assert.match(workspacePoolFeeLabel(3000, 2), /0\.30%/);
assert.match(workspacePoolFeeLabel(null, 2), /read at quote/);
assert.match(workspacePoolFeeLabel(500, 3), /0\.05%/);
assert.match(workspacePoolFeeLabel(3000, 4), /Configured static LP fee.*0\.30%/);
assert.match(workspacePoolFeeLabel(0x800000, 4), /Dynamic fee/);
assert.ok(!workspacePoolFeeLabel(0x800000, 4).includes("838.8608"));
assert.match(workspacePoolFeeLabel(999999, 4), /Configured static LP fee.*99\.9999%.*not an execution quote/,
  "Uniswap v4 permits this extreme static fee; do not falsify its onchain evidence");
for (const fee of [NaN, Infinity, -1, 1.5, 1000001, 0x400000, 0xffffff]) {
  assert.match(workspacePoolFeeLabel(fee, 4), /read at quote/);
  assert.ok(!workspacePoolFeeLabel(fee, 4).includes("%"));
}
assert.match(workspacePoolFeeLabel(3000, 3, "up"), /read at quote/, "up live fees require their own denominator, not Uniswap units");

const evidence = { holders: { count: null, topHolders: [] }, liquidity: { evidenceSource: "none" }, freshness: "fresh",
  domains: { token: "ready", holders: "unavailable", liquidity: "unavailable", contract: "ready", abi: "ready", sell: "unavailable", creator: "unavailable" }
} as unknown as TokenRiskEvidence;
const risk: TokenRiskEvidenceState = { status: "ready", evidence };
assert.deepEqual(workspaceEvidenceStates(risk, { status: "unavailable" }, 25000), { holders: "unavailable", liquidity: "ready", risk: "ready" });
const graph = { holderSnapshot: { count: 3 }, nodes: [] } as unknown as WalletConstellationGraph;
assert.deepEqual(workspaceEvidenceStates({ status: "loading" }, { status: "ready", graph }), { holders: "ready", liquidity: "checking", risk: "checking" });
assert.deepEqual(workspaceEvidenceStates({ status: "unavailable" }, { status: "ready", graph }, 10), { holders: "ready", liquidity: "ready", risk: "unavailable" });
assert.equal(workspaceEvidenceStates({ status: "ready", evidence: { ...evidence, freshness: "stale" } }, { status: "unavailable" }).risk, "stale");
assert.equal(workspaceEvidenceStates({ status: "ready", evidence: { ...evidence, domains: { ...evidence.domains!, contract: "unavailable", abi: "unavailable", sell: "unavailable" } } }, { status: "unavailable" }).risk, "unavailable");

async function main() {
  const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const results: string[] = [];
    let resolve!: (value: string) => void;
    let signal: AbortSignal | undefined;
    loadBoundedWorkspaceEvidence({ read: (input) => { signal = input; return new Promise<string>((yes) => { resolve = yes; }); },
      ready: (value) => results.push(value), unavailable: () => results.push("unavailable") });
    await flush();
    mock.timers.tick(14999); await flush(); assert.deepEqual([...results], []);
    mock.timers.tick(1); await flush(); assert.deepEqual([...results], ["unavailable"]);
    assert.equal(signal?.aborted, true);
    resolve("stale late body"); await flush(); assert.deepEqual([...results], ["unavailable"], "a late body cannot replace bounded unavailable state");
    const cancel = loadBoundedWorkspaceEvidence({ read: async () => "unmounted", ready: (value) => results.push(value), unavailable: () => results.push("wrong") });
    cancel(); await flush(); mock.timers.tick(15000); await flush();
    assert.deepEqual([...results], ["unavailable"], "unmount/token change cannot publish an obsolete domain result");
    loadBoundedWorkspaceEvidence({ read: async () => "ready", ready: (value) => results.push(value), unavailable: () => results.push("wrong") });
    await flush(); mock.timers.tick(15000); await flush(); assert.deepEqual([...results], ["unavailable", "ready"]);
  } finally { mock.timers.reset(); }
  console.log("Workspace stabilization: token attachment/dedup, protocol fee semantics, independent evidence and bounded loading PASS.");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
