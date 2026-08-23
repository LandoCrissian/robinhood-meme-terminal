import {
  RMT_NFT_EXECUTION_V1_DESCRIPTOR,
  SEAPORT_BUY_FEE_SETTLEMENT_DESIGN,
  SEAPORT_SELL_FEE_SETTLEMENT_DESIGN,
  assertRmtNftExecutionFeeEconomics,
  assertSeaportFeeSettlementAdmission,
  calculateRmtNftExecutionFeeFloor,
  normalizeRmtNftExecutionFeeEconomics,
  plannedRmtNftFeeForWalletAction,
  settledRmtNftExecutionFee,
  type NftMarketOrder,
  type RmtNftExecutionFeePolicy
} from "../src/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FEE SMOKE FAIL: ${message}`);
}
function expectThrows(run: () => unknown, message: string) {
  let threw = false;
  try { run(); } catch { threw = true; }
  assert(threw, message);
}

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const EXECUTOR = "0x4444444444444444444444444444444444444444";
const H = `0x${"11".repeat(32)}`;
const eth = { chainId: 4663 as const, kind: "native" as const, symbol: "ETH" as const };
const weth = { chainId: 4663 as const, kind: "erc20" as const, contract: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", symbol: "WETH", decimals: 18 };

const policy: RmtNftExecutionFeePolicy = {
  ...RMT_NFT_EXECUTION_V1_DESCRIPTOR,
  treasury: C,
  effectiveBoundary: { fromRollupBlock: "40000000", beforeRollupBlock: null },
  policyHash: H
};

const listing: NftMarketOrder = {
  sourceId: "opensea-seaport", venueId: "opensea", protocolId: "seaport-1.6", orderId: "listing-1", orderHash: H,
  kind: "listing", criteria: { kind: "item", item: { chainId: 4663, contract: A, tokenId: "1" } }, maker: B, taker: null,
  paymentAsset: eth, grossAmountAtomic: "1000000000000000000", quantityAtomic: "1", startTimeMs: 1, endTimeMs: 999999,
  status: "active", fillable: true,
  fees: [{ kind: "marketplace", recipient: C, payer: "seller", asset: eth, amountAtomic: "10000000000000000", enforcement: "required_by_order", source: "fixture" }],
  observedAtMs: 1, sourceRef: "fixture"
};
const offer: NftMarketOrder = {
  ...listing,
  orderId: "offer-1",
  kind: "item_offer",
  maker: C,
  paymentAsset: weth,
  fees: [
    { kind: "marketplace", recipient: B, payer: "seller", asset: weth, amountAtomic: "10000000000000000", enforcement: "required_by_order", source: "fixture" },
    { kind: "creator_royalty", recipient: B, payer: "seller", asset: weth, amountAtomic: "25000000000000000", enforcement: "required_by_order", source: "fixture" }
  ]
};

assert(calculateRmtNftExecutionFeeFloor("1000000000000000000") === "2500000000000000", "1 ETH must yield 0.0025 ETH RMT fee");
assert(calculateRmtNftExecutionFeeFloor("399") === "0", "tiny fee must floor to zero with no minimum");

const buy = normalizeRmtNftExecutionFeeEconomics({ policy, order: listing, side: "buy" });
assertRmtNftExecutionFeeEconomics(buy, policy);
assert(buy.userTotalDebitAtomic === "1002500000000000000", "buyer total must add exactly 25 bps once");
assert(buy.venueSellerProceedsBeforeRmtAtomic === null, "buy economics must not manufacture seller proceeds");

const sell = normalizeRmtNftExecutionFeeEconomics({ policy, order: offer, side: "sell" });
assert(sell.venueSellerProceedsBeforeRmtAtomic === "965000000000000000", "seller venue proceeds must preserve venue/royalty deductions");
assert(sell.sellerNetProceedsAtomic === "962500000000000000", "seller net must subtract exactly 25 bps of gross payment once");

assert(plannedRmtNftFeeForWalletAction("nft_approval", sell) === "0", "NFT approval must settle zero fee");
assert(plannedRmtNftFeeForWalletAction("listing_signature", sell) === "0", "listing signature must settle zero fee");
assert(plannedRmtNftFeeForWalletAction("cancel", sell) === "0", "cancel must settle zero fee");
assert(plannedRmtNftFeeForWalletAction("sell", sell) === "2500000000000000", "sell execution must plan exact fee");
assert(settledRmtNftExecutionFee({ receiptStatus: "reverted", atomicSettlementVerified: false, expectedFeeAtomic: sell.expectedFeeAtomic }) === "0", "revert must settle zero fee");
expectThrows(() => settledRmtNftExecutionFee({ receiptStatus: "success", atomicSettlementVerified: false, expectedFeeAtomic: sell.expectedFeeAtomic }), "success without atomic fee proof must fail closed");

assert(SEAPORT_BUY_FEE_SETTLEMENT_DESIGN.providerFunction === "fulfillAdvancedOrder", "buy route must use explicit recipient-capable fulfillment");
assert(SEAPORT_SELL_FEE_SETTLEMENT_DESIGN.providerFunction === "matchAdvancedOrders", "sell route must use seller counter-order matching");

assertSeaportFeeSettlementAdmission({
  order: listing, economics: buy, policy,
  protocolAddress: "0x0000000000000068f116a894984e2db1123eb395",
  executionTarget: EXECUTOR, pinnedExecutorAddress: EXECUTOR,
  providerFunction: "fulfillAdvancedOrder", signedMakerOrderUnmodified: true,
  exactVenueConsiderationPreserved: true, atomicOuterTransaction: true,
  directWalletTargetIsSeaport: false
});

assertSeaportFeeSettlementAdmission({
  order: offer, economics: sell, policy,
  protocolAddress: "0x0000000000000068f116a894984e2db1123eb395",
  executionTarget: EXECUTOR, pinnedExecutorAddress: EXECUTOR,
  providerFunction: "matchAdvancedOrders", signedMakerOrderUnmodified: true,
  exactVenueConsiderationPreserved: true, atomicOuterTransaction: true,
  directWalletTargetIsSeaport: false, sellerCounterOrderBound: true
});

expectThrows(() => assertSeaportFeeSettlementAdmission({
  order: offer, economics: sell, policy,
  protocolAddress: "0x0000000000000068f116a894984e2db1123eb395",
  executionTarget: EXECUTOR, pinnedExecutorAddress: EXECUTOR,
  providerFunction: "fulfillAdvancedOrder", signedMakerOrderUnmodified: true,
  exactVenueConsiderationPreserved: true, atomicOuterTransaction: true,
  directWalletTargetIsSeaport: false, sellerCounterOrderBound: false
}), "seller-side direct fulfillment without a bound counter-order must fail closed");

console.log("RMT_NFT_EXECUTION_FEE_SMOKE: PASS");
