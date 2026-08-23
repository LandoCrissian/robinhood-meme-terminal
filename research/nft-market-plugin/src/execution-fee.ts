import {
  ROBINHOOD_CHAIN_ID,
  assertOrder,
  assertPaymentAsset,
  itemKey,
  normalizeAddress,
  normalizeHash32,
  positiveAtomic,
  type NftItemId,
  type NftMarketOrder,
  type PaymentAsset
} from "./domain.ts";
import { buyerTotalAtomic, sellerProceedsAtomic } from "./market.ts";

export const RMT_NFT_EXECUTION_V1_DESCRIPTOR = Object.freeze({
  policyId: "RMT_NFT_EXECUTION_V1" as const,
  version: 1 as const,
  chainId: ROBINHOOD_CHAIN_ID,
  feeBps: 25 as const,
  feeBasis: "venue_gross_payment" as const,
  roundingMode: "floor" as const,
  eligibleExecutionOrigin: "authenticated_rmt" as const,
  allowedSettlementModes: Object.freeze([
    "nft-v1-atomic-buyer-surcharge",
    "nft-v1-atomic-seller-proceeds"
  ] as const)
});

export const RMT_NFT_EXECUTION_BPS_DENOMINATOR = 10_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type RmtNftExecutionSide = "buy" | "sell";
export type RmtNftSettlementMode =
  | "nft-v1-atomic-buyer-surcharge"
  | "nft-v1-atomic-seller-proceeds";

export type RmtNftExecutionFeePolicy = {
  policyId: "RMT_NFT_EXECUTION_V1";
  version: 1;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  feeBps: 25;
  feeBasis: "venue_gross_payment";
  roundingMode: "floor";
  eligibleExecutionOrigin: "authenticated_rmt";
  allowedSettlementModes: readonly ["nft-v1-atomic-buyer-surcharge", "nft-v1-atomic-seller-proceeds"];
  treasury: string;
  effectiveBoundary: { fromRollupBlock: string; beforeRollupBlock: string | null };
  policyHash: string;
};

export type RmtNftExecutionFeeEconomics = {
  state: "planned";
  side: RmtNftExecutionSide;
  paymentAsset: PaymentAsset;
  venueGrossPaymentAtomic: string;
  feeBasisAtomic: string;
  feeBps: 25;
  expectedFeeAtomic: string;
  maximumFeeAtomic: string;
  venueBuyerDebitBeforeRmtAtomic: string | null;
  venueSellerProceedsBeforeRmtAtomic: string | null;
  userTotalDebitAtomic: string | null;
  sellerNetProceedsAtomic: string | null;
  treasury: string;
  policyId: "RMT_NFT_EXECUTION_V1";
  policyVersion: 1;
  policyHash: string;
  roundingMode: "floor";
  settlementMode: RmtNftSettlementMode;
  executionOrigin: "authenticated_rmt";
};

export type RmtNftFeeAwareQuote = {
  order: NftMarketOrder;
  item: NftItemId;
  economics: RmtNftExecutionFeeEconomics;
  rmtFeeState: "explicit_policy_bound";
};

export type RmtNftAtomicFeeSettlementProof = {
  verificationState: "verified_atomic";
  side: RmtNftExecutionSide;
  settlementMode: RmtNftSettlementMode;
  venueId: string;
  protocolId: string;
  orderHash: string;
  quoteId: string;
  itemKey: string;
  wallet: string;
  nftRecipient: string;
  executionTarget: string;
  providerTarget: string;
  providerCalldataHash: string;
  executionId: string;
  deadlineSeconds: string;
  paymentAsset: PaymentAsset;
  venueGrossPaymentAtomic: string;
  expectedFeeAtomic: string;
  treasury: string;
  policyId: "RMT_NFT_EXECUTION_V1";
  policyVersion: 1;
  policyHash: string;
  signedOrderUnmodified: true;
  exactVenueConsiderationPreserved: true;
  atomicFeeSettlement: true;
  revertsAtomically: true;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT NFT execution fee rejected: ${message}.`);
}

function samePaymentAsset(left: PaymentAsset, right: PaymentAsset) {
  if (left.chainId !== right.chainId || left.kind !== right.kind) return false;
  if (left.kind === "native") return true;
  return right.kind === "erc20" && normalizeAddress(left.contract) === normalizeAddress(right.contract);
}

export function calculateRmtNftExecutionFeeFloor(venueGrossPaymentAtomic: string) {
  const gross = BigInt(positiveAtomic(venueGrossPaymentAtomic));
  return (gross * 25n / RMT_NFT_EXECUTION_BPS_DENOMINATOR).toString();
}

export function assertRmtNftExecutionFeePolicy(policy: RmtNftExecutionFeePolicy) {
  invariant(policy.policyId === "RMT_NFT_EXECUTION_V1" && policy.version === 1, "policy identity changed");
  invariant(policy.chainId === ROBINHOOD_CHAIN_ID, "policy chain changed");
  invariant(policy.feeBps === 25, "fee rate changed from exactly 25 basis points");
  invariant(policy.feeBasis === "venue_gross_payment", "fee basis changed");
  invariant(policy.roundingMode === "floor", "rounding mode changed");
  invariant(policy.eligibleExecutionOrigin === "authenticated_rmt", "execution origin changed");
  invariant(policy.allowedSettlementModes.length === 2
    && policy.allowedSettlementModes[0] === "nft-v1-atomic-buyer-surcharge"
    && policy.allowedSettlementModes[1] === "nft-v1-atomic-seller-proceeds", "settlement modes changed");
  invariant(normalizeAddress(policy.treasury) !== ZERO_ADDRESS, "treasury cannot be zero");
  normalizeHash32(policy.policyHash);
  invariant(!/^0x0{64}$/.test(policy.policyHash.toLowerCase()), "policy hash cannot be zero");
  const from = BigInt(positiveAtomic(policy.effectiveBoundary.fromRollupBlock));
  if (policy.effectiveBoundary.beforeRollupBlock !== null) {
    const before = BigInt(positiveAtomic(policy.effectiveBoundary.beforeRollupBlock));
    invariant(before > from, "effective end must follow start");
  }
  return true;
}

export function normalizeRmtNftExecutionFeeEconomics(input: {
  policy: RmtNftExecutionFeePolicy;
  order: NftMarketOrder;
  side: RmtNftExecutionSide;
}): RmtNftExecutionFeeEconomics {
  assertRmtNftExecutionFeePolicy(input.policy);
  assertOrder(input.order);
  assertPaymentAsset(input.order.paymentAsset);
  const gross = BigInt(positiveAtomic(input.order.grossAmountAtomic));
  const fee = BigInt(calculateRmtNftExecutionFeeFloor(gross.toString()));
  const mode: RmtNftSettlementMode = input.side === "buy"
    ? "nft-v1-atomic-buyer-surcharge"
    : "nft-v1-atomic-seller-proceeds";
  invariant(input.policy.allowedSettlementModes.includes(mode), "settlement mode is not admitted by the policy");

  const buyerBefore = input.side === "buy" ? BigInt(buyerTotalAtomic(input.order)) : null;
  const sellerBefore = input.side === "sell" ? BigInt(sellerProceedsAtomic(input.order)) : null;
  if (sellerBefore !== null) invariant(sellerBefore > fee, "RMT fee would consume all seller proceeds");

  const economics: RmtNftExecutionFeeEconomics = {
    state: "planned",
    side: input.side,
    paymentAsset: input.order.paymentAsset,
    venueGrossPaymentAtomic: gross.toString(),
    feeBasisAtomic: gross.toString(),
    feeBps: 25,
    expectedFeeAtomic: fee.toString(),
    maximumFeeAtomic: fee.toString(),
    venueBuyerDebitBeforeRmtAtomic: buyerBefore?.toString() ?? null,
    venueSellerProceedsBeforeRmtAtomic: sellerBefore?.toString() ?? null,
    userTotalDebitAtomic: buyerBefore === null ? null : (buyerBefore + fee).toString(),
    sellerNetProceedsAtomic: sellerBefore === null ? null : (sellerBefore - fee).toString(),
    treasury: normalizeAddress(input.policy.treasury),
    policyId: input.policy.policyId,
    policyVersion: input.policy.version,
    policyHash: normalizeHash32(input.policy.policyHash),
    roundingMode: "floor",
    settlementMode: mode,
    executionOrigin: "authenticated_rmt"
  };
  assertRmtNftExecutionFeeEconomics(economics, input.policy);
  return economics;
}

export function assertRmtNftExecutionFeeEconomics(
  economics: RmtNftExecutionFeeEconomics,
  policy: RmtNftExecutionFeePolicy
) {
  assertRmtNftExecutionFeePolicy(policy);
  invariant(economics.state === "planned", "economics are not planned");
  invariant(economics.policyId === policy.policyId && economics.policyVersion === policy.version, "policy identity changed");
  invariant(normalizeHash32(economics.policyHash) === normalizeHash32(policy.policyHash), "policy hash changed");
  invariant(normalizeAddress(economics.treasury) === normalizeAddress(policy.treasury), "treasury changed");
  invariant(economics.feeBps === 25 && economics.roundingMode === "floor", "fee terms changed");
  invariant(economics.executionOrigin === "authenticated_rmt", "execution origin changed");
  assertPaymentAsset(economics.paymentAsset);
  const gross = BigInt(positiveAtomic(economics.venueGrossPaymentAtomic));
  const basis = BigInt(positiveAtomic(economics.feeBasisAtomic));
  const expectedFee = BigInt(positiveAtomic(economics.expectedFeeAtomic, { allowZero: true }));
  const maximumFee = BigInt(positiveAtomic(economics.maximumFeeAtomic, { allowZero: true }));
  invariant(basis === gross, "fee basis must equal venue gross payment");
  invariant(expectedFee === BigInt(calculateRmtNftExecutionFeeFloor(gross.toString())), "fee math changed");
  invariant(maximumFee === expectedFee, "maximum fee must equal exact floor fee");
  if (economics.side === "buy") {
    invariant(economics.settlementMode === "nft-v1-atomic-buyer-surcharge", "buy settlement mode changed");
    invariant(economics.venueBuyerDebitBeforeRmtAtomic !== null && economics.userTotalDebitAtomic !== null, "buy debit evidence missing");
    invariant(economics.venueSellerProceedsBeforeRmtAtomic === null && economics.sellerNetProceedsAtomic === null, "buy economics contain seller fields");
    invariant(BigInt(economics.userTotalDebitAtomic) === BigInt(economics.venueBuyerDebitBeforeRmtAtomic) + expectedFee, "buyer total does not equal venue debit plus RMT fee");
  } else {
    invariant(economics.settlementMode === "nft-v1-atomic-seller-proceeds", "sell settlement mode changed");
    invariant(economics.venueSellerProceedsBeforeRmtAtomic !== null && economics.sellerNetProceedsAtomic !== null, "seller proceeds evidence missing");
    invariant(economics.venueBuyerDebitBeforeRmtAtomic === null && economics.userTotalDebitAtomic === null, "sell economics contain buyer fields");
    const sellerBefore = BigInt(economics.venueSellerProceedsBeforeRmtAtomic);
    invariant(sellerBefore > expectedFee, "fee leaves no seller proceeds");
    invariant(BigInt(economics.sellerNetProceedsAtomic) + expectedFee === sellerBefore, "seller net does not equal venue proceeds minus RMT fee");
  }
  return true;
}

export function bindRmtNftExecutionFeeQuote(input: {
  policy: RmtNftExecutionFeePolicy;
  order: NftMarketOrder;
  item: NftItemId;
  side: RmtNftExecutionSide;
}): RmtNftFeeAwareQuote {
  return {
    order: input.order,
    item: input.item,
    economics: normalizeRmtNftExecutionFeeEconomics(input),
    rmtFeeState: "explicit_policy_bound"
  };
}

export function assertRmtNftAtomicFeeSettlementProof(input: {
  proof: RmtNftAtomicFeeSettlementProof;
  economics: RmtNftExecutionFeeEconomics;
  policy: RmtNftExecutionFeePolicy;
  order: NftMarketOrder;
  item: NftItemId;
}) {
  const { proof, economics, policy, order, item } = input;
  assertRmtNftExecutionFeeEconomics(economics, policy);
  assertOrder(order);
  invariant(order.orderHash !== null, "execution-admitted order must have a canonical order hash");
  invariant(proof.verificationState === "verified_atomic", "settlement is not verified atomic");
  invariant(proof.side === economics.side && proof.settlementMode === economics.settlementMode, "side or settlement mode changed");
  invariant(proof.venueId === order.venueId && proof.protocolId === order.protocolId, "venue or protocol identity changed");
  invariant(normalizeHash32(proof.orderHash) === normalizeHash32(order.orderHash), "order hash changed");
  invariant(proof.itemKey === itemKey(item), "item identity changed");
  normalizeAddress(proof.wallet);
  normalizeAddress(proof.nftRecipient);
  normalizeAddress(proof.executionTarget);
  normalizeAddress(proof.providerTarget);
  normalizeHash32(proof.providerCalldataHash);
  normalizeHash32(proof.executionId);
  positiveAtomic(proof.deadlineSeconds);
  invariant(samePaymentAsset(proof.paymentAsset, economics.paymentAsset), "payment asset changed");
  invariant(BigInt(proof.venueGrossPaymentAtomic) === BigInt(economics.venueGrossPaymentAtomic), "venue gross payment changed");
  invariant(BigInt(proof.expectedFeeAtomic) === BigInt(economics.expectedFeeAtomic), "RMT fee amount changed");
  invariant(normalizeAddress(proof.treasury) === normalizeAddress(policy.treasury), "treasury changed");
  invariant(proof.policyId === policy.policyId && proof.policyVersion === policy.version, "policy identity changed");
  invariant(normalizeHash32(proof.policyHash) === normalizeHash32(policy.policyHash), "policy hash changed");
  invariant(proof.signedOrderUnmodified === true, "signed provider order was modified");
  invariant(proof.exactVenueConsiderationPreserved === true, "venue consideration was not preserved exactly");
  invariant(proof.atomicFeeSettlement === true && proof.revertsAtomically === true, "provider fill and RMT fee are not one atomic outcome");
  return true;
}

export function settledRmtNftExecutionFee(input: {
  receiptStatus: "success" | "reverted" | "failed" | "not_submitted";
  atomicSettlementVerified: boolean;
  expectedFeeAtomic: string;
}) {
  const expected = BigInt(positiveAtomic(input.expectedFeeAtomic, { allowZero: true }));
  if (input.receiptStatus !== "success") return "0";
  invariant(input.atomicSettlementVerified, "successful receipt lacks verified atomic fee settlement");
  return expected.toString();
}

export function plannedRmtNftFeeForWalletAction(
  kind: "nft_approval" | "erc20_approval" | "listing_signature" | "cancel" | "buy" | "sell",
  economics: RmtNftExecutionFeeEconomics
) {
  positiveAtomic(economics.expectedFeeAtomic, { allowZero: true });
  return kind === "buy" || kind === "sell" ? economics.expectedFeeAtomic : "0";
}
