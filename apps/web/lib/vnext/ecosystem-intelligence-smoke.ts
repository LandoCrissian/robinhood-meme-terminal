import assert from "node:assert/strict";
import { getAddress, zeroAddress, type Address } from "viem";
import {
  readVNextEcosystemIntelligence,
  type VNextEcosystemReader
} from "../server/vnext-ecosystem-intelligence";
import { ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";

const token = getAddress("0x1111111111111111111111111111111111111111");
const displayedQuote = getAddress("0x2222222222222222222222222222222222222222");
const v2Pool = getAddress("0x3333333333333333333333333333333333333333");
const clPool = getAddress("0x4444444444444444444444444444444444444444");
const displayedPool = getAddress("0x5555555555555555555555555555555555555555");
const gauge = getAddress("0x6666666666666666666666666666666666666666");
const snapshot = {
  blockNumber: 34_800_000n,
  blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const
};

function pairKey(left: Address, right: Address) {
  return [left.toLowerCase(), right.toLowerCase()].sort().join(":");
}

const v2Pairs = new Map([[pairKey(token, ROBINHOOD_USDG_ADDRESS), v2Pool]]);
const clPairs = new Map([[pairKey(token, ROBINHOOD_WETH_ADDRESS), clPool]]);

const reader: VNextEcosystemReader = {
  async snapshot() { return snapshot; },
  async confirmSnapshot(value) { assert.deepEqual(value, snapshot); },
  async verifyDependencies() {},
  async clTickSpacings() { return [60]; },
  async v2Pool(asset, quote, stable) {
    return stable ? zeroAddress : v2Pairs.get(pairKey(asset, quote)) ?? zeroAddress;
  },
  async clPool(asset, quote, tickSpacing) {
    return tickSpacing === 60 ? clPairs.get(pairKey(asset, quote)) ?? zeroAddress : zeroAddress;
  },
  async poolRegistration(pool) {
    return { v2: pool === v2Pool || pool === displayedPool, cl: pool === clPool };
  },
  async v2Stable() { return false; },
  async v2PoolEvidence(pool) {
    if (pool === displayedPool) return { recognized: true, token0: token, token1: displayedQuote, fee: 25, tickSpacing: null };
    return { recognized: pool === v2Pool, token0: token, token1: ROBINHOOD_USDG_ADDRESS, fee: 30, tickSpacing: null };
  },
  async clPoolEvidence(pool) {
    return { recognized: pool === clPool, token0: ROBINHOOD_WETH_ADDRESS, token1: token, fee: 500, tickSpacing: 60 };
  },
  async gaugeEvidence(pool) {
    return pool === clPool ? {
      gaugeState: "live", gaugeAddress: gauge, gaugeWeight: "42", gaugeClaimable: "7",
      feesAddress: getAddress("0x7777777777777777777777777777777777777777"),
      bribeAddress: getAddress("0x8888888888888888888888888888888888888888")
    } : {
      gaugeState: "none", gaugeAddress: null, gaugeWeight: null, gaugeClaimable: null,
      feesAddress: null, bribeAddress: null
    };
  }
};

async function run() {
  const evidence = await readVNextEcosystemIntelligence(
    token,
    reader,
    () => new Date("2026-08-12T18:00:00.000Z"),
    [displayedPool]
  );
  assert.equal(evidence.status, "ready");
  assert.equal(evidence.authoritative, true);
  assert.equal(evidence.observedBlock, snapshot.blockNumber.toString());
  assert.deepEqual(evidence.upMarkets.map((market) => market.poolAddress).sort(), [clPool, displayedPool, v2Pool].sort());
  assert.equal(evidence.upMarkets.find((market) => market.poolAddress === v2Pool)?.stable, false);
  assert.equal(evidence.upMarkets.find((market) => market.poolAddress === clPool)?.tickSpacing, 60);
  assert.equal(evidence.upMarkets.find((market) => market.poolAddress === clPool)?.gaugeState, "live");
  assert.equal(evidence.upMarkets.find((market) => market.poolAddress === displayedPool)?.quoteToken, displayedQuote);

  assert.equal(evidence.stonkBrokers.tokenCreated, false);
  assert.equal(evidence.stonkBrokers.sourceListed, false);
  assert.equal(evidence.stonkBrokers.authoritative, false);
  assert.equal(evidence.stonkBrokers.attributionState, "production-source-unverified");

  await assert.rejects(() => readVNextEcosystemIntelligence(token, {
    ...reader,
    async confirmSnapshot() { throw new Error("reorganized"); }
  }), /reorganized/);
  await assert.rejects(() => readVNextEcosystemIntelligence(token, {
    ...reader,
    async clTickSpacings() { return []; }
  }), /tick spacing registry/);

  console.log("VNext Stonk/up ecosystem intelligence smoke passed.");
}

run().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
