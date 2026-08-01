import assert from "node:assert/strict";
import {
  conservativeNetworkFeeReserve,
  curvePriceImpact,
  estimatedNetworkFeeUsd,
  estimatedNetworkFeeWei,
  fractionalTradeAmount,
  priceImpactTone,
  quoteSecondsRemaining,
  saferTradeAmount,
  spendableTradeBalance
} from "./trade-ticket";
import {
  DEFAULT_TRADE_PREFERENCES,
  normalizeBuyPreset,
  normalizeTradePreferences
} from "./trade-preferences";
import {
  protectedOutputRecommendation,
  resilientTradeVenue,
  routeLiquidityDepth,
  routeLiquidityDepthLabel
} from "./trade-route-selection";
import { tradeReadinessStatus } from "./trade-readiness";
import { tokenRiskDecision } from "./token-risk-policy";
import type { TokenRiskEvidence } from "./token-risk-evidence";

assert.equal(spendableTradeBalance(100n, 20n), 80n);
assert.equal(spendableTradeBalance(20n, 20n), 0n);
assert.equal(spendableTradeBalance(10n, 20n), 0n);
assert.equal(fractionalTradeAmount(1_000n, 2_500n), 250n);
assert.equal(fractionalTradeAmount(1_000n, 5_000n), 500n);
assert.equal(fractionalTradeAmount(1_000n, 10_000n), 1_000n);
assert.throws(() => fractionalTradeAmount(1_000n, 10_001n), /basis points/);
assert.equal(quoteSecondsRemaining("130", 100), 30);
assert.equal(quoteSecondsRemaining("90", 100), 0);
assert.equal(quoteSecondsRemaining("not-a-deadline", 100), 0);
assert.equal(priceImpactTone(0.005), "calm");
assert.equal(priceImpactTone(0.02), "caution");
assert.equal(priceImpactTone(0.08), "danger");
assert.equal(saferTradeAmount(1_000n, 0.08), 450n);
assert.equal(saferTradeAmount(1_000n, 0.04), 1_000n);
assert.equal(saferTradeAmount(1_000n, 0.02, 0.01), 450n);
assert.equal(saferTradeAmount(1_000n, undefined), 0n);
assert.throws(() => saferTradeAmount(1_000n, 0.08, 0.05), /blocking threshold/);
assert.equal(curvePriceImpact("buy", 1_000n, 1_050n, 1_000_000_000_000_000_000n), 0.05);
assert.equal(curvePriceImpact("sell", 1_000n, 1_000_000_000_000_000_000n, 970n), 0.03);
assert.equal(curvePriceImpact("buy", 1_000n, 0n, 1n), undefined);
assert.equal(curvePriceImpact("sell", 0n, 1n, 1n), undefined);
assert.equal(estimatedNetworkFeeWei(100_000n, 75_000_000n), 7_500_000_000_000n);
assert.equal(estimatedNetworkFeeWei(0n, 75_000_000n), 0n);
assert.equal(conservativeNetworkFeeReserve(8n, 10n), 16n);
assert.equal(conservativeNetworkFeeReserve(4n, 10n), 10n);
assert.equal(conservativeNetworkFeeReserve(undefined, 10n), 10n);
assert.equal(estimatedNetworkFeeUsd(1_000_000_000_000_000n, 3_000), 3);
assert.equal(estimatedNetworkFeeUsd(undefined, 3_000), undefined);
assert.equal(normalizeBuyPreset("0.0100"), "0.01");
assert.equal(normalizeBuyPreset("999.123"), "999.123");
assert.equal(normalizeBuyPreset("1000"), null);
assert.equal(normalizeBuyPreset("0"), null);
assert.equal(normalizeBuyPreset("1e-3"), null);
assert.deepEqual(normalizeTradePreferences({ buyAmounts: ["0.0002", "0.002", "0.02"] }), {
  buyAmounts: ["0.0002", "0.002", "0.02"],
  routePreference: "automatic",
  maxPriceImpactBps: 500,
  preparationMode: "speed"
});
assert.deepEqual(normalizeTradePreferences({
  buyAmounts: ["0.0002", "0.002", "0.02"],
  routePreference: "sushi",
  maxPriceImpactBps: 100,
  preparationMode: "speed"
}), {
  buyAmounts: ["0.0002", "0.002", "0.02"],
  routePreference: "sushi",
  maxPriceImpactBps: 100,
  preparationMode: "speed"
});
assert.deepEqual(normalizeTradePreferences({
  buyAmounts: ["0.0002", "0.002", "0.02"],
  routePreference: "unknown",
  maxPriceImpactBps: 10_000
}), {
  buyAmounts: ["0.0002", "0.002", "0.02"],
  routePreference: "automatic",
  maxPriceImpactBps: 500,
  preparationMode: "speed"
});
assert.deepEqual(normalizeTradePreferences({ buyAmounts: ["0.01", "0.01", "0.02"] }), DEFAULT_TRADE_PREFERENCES);
assert.deepEqual(normalizeTradePreferences({ buyAmounts: ["bad"] }), DEFAULT_TRADE_PREFERENCES);
assert.equal(routeLiquidityDepth(Number.NaN), "unknown");
assert.equal(routeLiquidityDepth(0), "unknown");
assert.equal(routeLiquidityDepth(9_999.99), "thin");
assert.equal(routeLiquidityDepth(10_000), "moderate");
assert.equal(routeLiquidityDepth(49_999.99), "moderate");
assert.equal(routeLiquidityDepth(50_000), "strong");
assert.equal(routeLiquidityDepth(249_999.99), "strong");
assert.equal(routeLiquidityDepth(250_000), "deep");
assert.equal(routeLiquidityDepthLabel(250_000), "Deep");
assert.deepEqual(tradeReadinessStatus("ready", "blocked"), {
  tone: "blocked",
  headline: "Order blocked · review required"
});
assert.deepEqual(tradeReadinessStatus("ready", "review"), {
  tone: "review",
  headline: "Review required before wallet"
});
assert.deepEqual(tradeReadinessStatus("ready", "checking"), {
  tone: "checking",
  headline: "Reviewing contract evidence"
});
assert.deepEqual(tradeReadinessStatus("ready", "clear"), {
  tone: "ready",
  headline: "Ready for wallet review"
});
assert.deepEqual(tradeReadinessStatus("error", "clear"), {
  tone: "error",
  headline: "Route needs attention"
});
assert.equal(resilientTradeVenue({
  selected: "sushi",
  mode: "automatic",
  venues: ["sushi", "uniswap-v3"],
  health: { sushi: "unavailable", "uniswap-v3": "ready" }
}), "uniswap-v3");
assert.equal(resilientTradeVenue({
  selected: "sushi",
  mode: "manual",
  venues: ["sushi", "uniswap-v3"],
  health: { sushi: "unavailable", "uniswap-v3": "ready" }
}), "sushi");
assert.equal(resilientTradeVenue({
  selected: "sushi",
  mode: "automatic",
  venues: ["sushi", "uniswap-v3"],
  health: { sushi: "loading", "uniswap-v3": "ready" }
}), "sushi");
assert.equal(resilientTradeVenue({
  selected: "sushi",
  mode: "automatic",
  venues: ["sushi", "uniswap-v3"],
  health: { sushi: "unavailable", "uniswap-v3": "unavailable" }
}), "sushi");
const quoteToken = {
  address: "0x1111111111111111111111111111111111111111",
  decimals: 18
};
assert.deepEqual(protectedOutputRecommendation({
  selected: "sushi",
  quotes: [
    { venue: "sushi", minimumOut: "100000", priceImpact: 0.01, outputToken: quoteToken },
    { venue: "uniswap-v3", minimumOut: "101000", priceImpact: 0.008, outputToken: quoteToken }
  ]
}), {
  leader: "uniswap-v3",
  leaderAdvantageBps: 100,
  automaticVenue: "uniswap-v3",
  automaticImprovementBps: 100
});
assert.deepEqual(protectedOutputRecommendation({
  selected: "sushi",
  quotes: [
    { venue: "sushi", minimumOut: "100000", priceImpact: 0.01, outputToken: quoteToken },
    { venue: "uniswap-v3", minimumOut: "101000", priceImpact: 0.008, outputToken: quoteToken },
    { venue: "uniswap-v4", minimumOut: "102000", priceImpact: 0.007, outputToken: quoteToken }
  ]
}), {
  leader: "uniswap-v4",
  leaderAdvantageBps: 99,
  automaticVenue: "uniswap-v4",
  automaticImprovementBps: 200
});
assert.equal(protectedOutputRecommendation({
  selected: "sushi",
  quotes: [
    { venue: "sushi", minimumOut: "100000", priceImpact: 0.01, outputToken: quoteToken },
    { venue: "uniswap-v3", minimumOut: "100200", priceImpact: 0.008, outputToken: quoteToken }
  ]
})?.automaticVenue, "sushi");
assert.equal(protectedOutputRecommendation({
  selected: "uniswap-v3",
  quotes: [
    { venue: "sushi", minimumOut: "100000", priceImpact: 0.009, outputToken: quoteToken },
    { venue: "uniswap-v3", minimumOut: "100000", priceImpact: 0.01, outputToken: quoteToken }
  ]
})?.automaticVenue, "uniswap-v3");
assert.equal(protectedOutputRecommendation({
  selected: "sushi",
  maxPriceImpact: 0.01,
  quotes: [
    { venue: "sushi", minimumOut: "100000", priceImpact: 0.009, outputToken: quoteToken },
    { venue: "uniswap-v3", minimumOut: "110000", priceImpact: 0.02, outputToken: quoteToken }
  ]
}), undefined);
assert.equal(protectedOutputRecommendation({
  selected: "sushi",
  maxPriceImpact: 0.02,
  quotes: [
    { venue: "sushi", minimumOut: "100000", priceImpact: 0.009, outputToken: quoteToken },
    { venue: "uniswap-v3", minimumOut: "110000", priceImpact: 0.02, outputToken: quoteToken }
  ]
})?.automaticVenue, "uniswap-v3");
assert.equal(protectedOutputRecommendation({
  selected: "sushi",
  maxPriceImpact: 0.051,
  quotes: [
    { venue: "sushi", minimumOut: "100000", priceImpact: 0.009, outputToken: quoteToken },
    { venue: "uniswap-v3", minimumOut: "110000", priceImpact: 0.02, outputToken: quoteToken }
  ]
}), undefined);
assert.equal(protectedOutputRecommendation({
  selected: "sushi",
  quotes: [
    { venue: "sushi", minimumOut: "100000", priceImpact: 0.01, outputToken: quoteToken },
    {
      venue: "uniswap-v3",
      minimumOut: "101000",
      priceImpact: 0.008,
      outputToken: { ...quoteToken, address: "0x2222222222222222222222222222222222222222" }
    }
  ]
}), undefined);
assert.equal(protectedOutputRecommendation({
  selected: "sushi",
  quotes: [
    { venue: "sushi", minimumOut: "0", priceImpact: 0.01, outputToken: quoteToken },
    { venue: "uniswap-v3", minimumOut: "101000", priceImpact: 0.008, outputToken: quoteToken }
  ]
}), undefined);

const clearEvidence: TokenRiskEvidence = {
  token: "0x1111111111111111111111111111111111111111",
  pair: "0x2222222222222222222222222222222222222222",
  marketVerified: true,
  coverage: "complete",
  contract: {
    sourcePublished: true,
    isProxy: false,
    bytecodeChanged: false,
    controls: {
      assessment: "no-common-controls-found",
      detected: [],
      customWriteFunctions: [],
      administrator: null,
      activeLaunchRestrictions: false,
      restrictionEndBlock: null,
      maxTransactionBps: null,
      maxWalletBps: null
    }
  },
  liquidity: {
    controlStatus: "burn-address",
    evidenceSource: "launchpad-registry",
    positionManager: "0x3333333333333333333333333333333333333333",
    positionId: "1",
    owner: "0x000000000000000000000000000000000000dEaD",
    approvedOperator: null,
    creatorCanTransfer: false,
    positionLiquidity: "1"
  },
  holders: {
    count: 100,
    poolShareBps: 5_000,
    topNonPoolShareBps: 900,
    topNonPoolHolders: [],
    largestNonPoolHolder: {
      address: "0x4444444444444444444444444444444444444444",
      shareBps: 900
    },
    creator: null,
    creatorShareBps: null
  },
  sellSimulation: {
    status: "passed",
    method: "holder-to-pool-transfer",
    holder: "0x4444444444444444444444444444444444444444",
    amount: "1",
    returnStyle: "boolean-true"
  },
  warnings: [],
  checkedAt: "2026-07-28T00:00:00.000Z"
};
assert.equal(tokenRiskDecision({ status: "ready", evidence: clearEvidence }, "buy").state, "clear");
assert.equal(tokenRiskDecision({
  status: "ready",
  evidence: {
    ...clearEvidence,
    contract: { ...clearEvidence.contract, bytecodeChanged: true }
  }
}, "buy").primaryFinding?.code, "published-bytecode-changed");
assert.equal(tokenRiskDecision({
  status: "ready",
  evidence: {
    ...clearEvidence,
    contract: {
      ...clearEvidence.contract,
      controls: { ...clearEvidence.contract.controls, activeLaunchRestrictions: true }
    }
  }
}, "buy").state, "blocked");
assert.equal(tokenRiskDecision({
  status: "ready",
  evidence: {
    ...clearEvidence,
    sellSimulation: { ...clearEvidence.sellSimulation, status: "blocked", returnStyle: null }
  }
}, "sell").state, "clear");
assert.equal(tokenRiskDecision({ status: "unavailable" }, "buy").state, "review");

console.log("Trade ticket sizing, freshness, and impact classifications passed.");
