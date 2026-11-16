import { isTestCreationPayouts, isTestCreationRequest, isTransactionHash, type TestCreationPayouts, type TestCreationRequest } from "./test-creation";
import { isLaunchAddress } from "./launch-data";

export const mobileReviewPage = "/wallet/mobile-review";
export const mobileReviewApi = "/api/launchpad/test-mobile-review";
export const mobileReviewProfile = "local-reviewed-31337";
export const proposedProductionSender = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
export const mobileTestFields = Object.freeze({
  name: "Mobile review rehearsal", symbol: "MOB", projectURI: "https://example.test/rmt-mobile-review",
  treasury: "", treasuryShareBps: 0,
});

type Hex = `0x${string}`;
export type MobileReview = {
  request: TestCreationRequest;
  payouts: TestCreationPayouts;
  expectedToken: Hex;
  expectedCurve: Hex;
  calldataHash: Hex;
  nonce: Hex;
  gas: Hex;
  gasPrice: Hex;
  estimatedL2Wei: string;
  l1DataFeeWei: "0";
  reviewBlockNumber: Hex;
  reviewBlockHash: Hex;
  expiresAt: number;
  attestation: Hex;
};

export type ObservedSender = {
  observedAt: string;
  expiresAt: string;
  blockNumber: string;
  blockHash: Hex;
  accountType: "CODE_EMPTY" | "EIP_7702_DELEGATION" | "CONTRACT_CODE";
  confirmedNonce: string;
  pendingNonce: string;
  safes: { role: string; address: Hex; l2Wei: string; l1Wei: string; totalWei: string }[];
};

export type MobilePlan = {
  observation: ObservedSender | null;
  rows: {
    id: string; label: string; scope: "PROPOSED_SAFE_REVIEW_ONLY" | "LOOPBACK_FIXTURE_ONLY";
    dependencies: string[]; from: Hex | null; to: Hex | null; nonce: string | null; valueWei: string;
    dataHash: Hex | null; expectedAddress: Hex | null; observedForkGas: string | null; authorization: string;
    receiptHash: Hex | null; receiptBlock: { number: string; hash: Hex } | null;
    safe: { owners: Hex[]; saltNonce: Hex } | null;
  }[];
};

export const isMobileAddress = (value: unknown): value is Hex => isLaunchAddress(value) && !/^0x0{40}$/i.test(value);
export const isMobileQuantity = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,19})$/.test(value);

export function isMobileReview(value: unknown): value is MobileReview {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 14) return false;
  const x = value as Partial<MobileReview>;
  return isTestCreationRequest(x.request) && isTestCreationPayouts(x.payouts, false)
    && isMobileAddress(x.expectedToken) && isMobileAddress(x.expectedCurve) && isTransactionHash(x.calldataHash)
    && isMobileQuantity(x.nonce) && isMobileQuantity(x.gas) && BigInt(x.gas) > 0n
    && isMobileQuantity(x.gasPrice) && BigInt(x.gasPrice) > 0n && x.estimatedL2Wei === (BigInt(x.gas) * BigInt(x.gasPrice)).toString()
    && x.l1DataFeeWei === "0" && isMobileQuantity(x.reviewBlockNumber) && isTransactionHash(x.reviewBlockHash)
    && typeof x.expiresAt === "number" && Number.isSafeInteger(x.expiresAt) && x.expiresAt > 0 && isTransactionHash(x.attestation);
}
