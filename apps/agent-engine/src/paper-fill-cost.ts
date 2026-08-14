import {
  assertAtomicAmount,
  hashCanonicalPayload,
  type PaperExecutionCosts,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtNormalizedPaperQuoteAttempt,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";

export const ROBINHOOD_NATIVE_ETH_ASSET_ID = "eip155:4663/native" as const;

export type PaperFillCostStatus = "READY" | "BLOCKED_NETWORK_FEE_PENDING";

export interface PaperFillCostPlan {
  schemaVersion: 1;
  status: PaperFillCostStatus;
  quoteResultHash: string;
  quoteEvidenceHash: string;
  selectedAttemptHash: string;
  protectedOutputIncludesRouteFees: true;
  networkGasAssetId: typeof ROBINHOOD_NATIVE_ETH_ASSET_ID | null;
  networkGasCostAtomic: string | null;
  costs: PaperExecutionCosts | null;
  costHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function selectedAttempt(result: RmtPaperQuoteResult): RmtNormalizedPaperQuoteAttempt {
  const matches = result.comparison.attempts.filter((attempt) => hashCanonicalPayload(attempt) === result.selectedAttemptHash);
  if (matches.length !== 1) fail("paper fill cost cannot identify exactly one selected quote attempt");
  return matches[0]!;
}

export function assertPaperFillCostPlan(plan: PaperFillCostPlan, quoteResult?: RmtPaperQuoteResult): void {
  if (plan.schemaVersion !== 1) fail("unsupported paper fill cost schema version");
  if (plan.status !== "READY" && plan.status !== "BLOCKED_NETWORK_FEE_PENDING") fail("paper fill cost status is invalid");
  assertHash(plan.quoteResultHash, "paper fill quoteResultHash");
  assertHash(plan.quoteEvidenceHash, "paper fill quoteEvidenceHash");
  assertHash(plan.selectedAttemptHash, "paper fill selectedAttemptHash");
  if (plan.protectedOutputIncludesRouteFees !== true) fail("paper fill route-fee basis changed");
  if (plan.status === "BLOCKED_NETWORK_FEE_PENDING") {
    if (plan.networkGasAssetId !== ROBINHOOD_NATIVE_ETH_ASSET_ID) fail("pending network fee must identify Robinhood native ETH");
    if (plan.networkGasCostAtomic !== null || plan.costs !== null) fail("pending network fee cannot expose guessed paper costs");
  } else {
    if (!plan.costs) fail("ready paper fill cost plan requires costs");
    assertAtomicAmount(plan.costs.feeAmountAtomic, "paper fill feeAmountAtomic");
    assertAtomicAmount(plan.costs.gasCostAtomic, "paper fill gasCostAtomic");
    if (plan.costs.feeAmountAtomic !== "0" || plan.costs.feeAssetId !== undefined) {
      fail("paper fill must not double-count route fees already reflected in protected output");
    }
    if (plan.networkGasAssetId === null) {
      if (plan.networkGasCostAtomic !== null || plan.costs.gasAssetId !== undefined || plan.costs.gasCostAtomic !== "0") {
        fail("no-separate-gas route exposed a paper gas debit");
      }
    } else {
      if (plan.networkGasAssetId !== ROBINHOOD_NATIVE_ETH_ASSET_ID || plan.networkGasCostAtomic === null) {
        fail("wallet-paid gas must use Robinhood native ETH");
      }
      assertAtomicAmount(plan.networkGasCostAtomic, "paper fill networkGasCostAtomic");
      if (plan.costs.gasAssetId !== ROBINHOOD_NATIVE_ETH_ASSET_ID || plan.costs.gasCostAtomic !== plan.networkGasCostAtomic) {
        fail("paper fill gas debit does not match network-fee evidence");
      }
    }
  }
  assertHash(plan.costHash, "paper fill costHash");
  const { costHash, ...payload } = plan;
  if (costHash !== hashCanonicalPayload(payload)) fail("paper fill cost hash mismatch");

  if (quoteResult) {
    assertRmtPaperQuoteResult(quoteResult);
    if (plan.quoteResultHash !== quoteResult.resultHash) fail("paper fill cost quote result mismatch");
    if (plan.quoteEvidenceHash !== quoteResult.evidence.evidenceHash) fail("paper fill cost quote evidence mismatch");
    if (plan.selectedAttemptHash !== quoteResult.selectedAttemptHash) fail("paper fill cost selected attempt mismatch");
    const attempt = selectedAttempt(quoteResult);
    if (attempt.userPaysGas) {
      if (attempt.networkFeeNativeSymbol !== "ETH" || attempt.costState !== "network_fee_pending") {
        fail("paper fill cost wallet-gas evidence is inconsistent");
      }
      if (attempt.networkFeeNativeAtomic === null) {
        if (plan.status !== "BLOCKED_NETWORK_FEE_PENDING") fail("unknown network fee must block paper fill costs");
      } else if (
        plan.status !== "READY"
        || plan.networkGasAssetId !== ROBINHOOD_NATIVE_ETH_ASSET_ID
        || plan.networkGasCostAtomic !== attempt.networkFeeNativeAtomic
      ) {
        fail("paper fill cost does not match known wallet network fee");
      }
    } else if (plan.status !== "READY" || plan.networkGasAssetId !== null || plan.networkGasCostAtomic !== null) {
      fail("non-wallet-gas route must not create separate network gas cost");
    }
  }
}

export function buildPaperFillCostPlan(quoteResult: RmtPaperQuoteResult): PaperFillCostPlan {
  assertRmtPaperQuoteResult(quoteResult);
  const attempt = selectedAttempt(quoteResult);
  let status: PaperFillCostStatus;
  let networkGasAssetId: typeof ROBINHOOD_NATIVE_ETH_ASSET_ID | null;
  let networkGasCostAtomic: string | null;
  let costs: PaperExecutionCosts | null;

  if (!attempt.userPaysGas) {
    status = "READY";
    networkGasAssetId = null;
    networkGasCostAtomic = null;
    costs = { feeAmountAtomic: "0", gasCostAtomic: "0" };
  } else if (attempt.networkFeeNativeAtomic === null) {
    status = "BLOCKED_NETWORK_FEE_PENDING";
    networkGasAssetId = ROBINHOOD_NATIVE_ETH_ASSET_ID;
    networkGasCostAtomic = null;
    costs = null;
  } else {
    assertAtomicAmount(attempt.networkFeeNativeAtomic, "paper fill network fee");
    status = "READY";
    networkGasAssetId = ROBINHOOD_NATIVE_ETH_ASSET_ID;
    networkGasCostAtomic = attempt.networkFeeNativeAtomic;
    costs = {
      feeAmountAtomic: "0",
      gasAssetId: ROBINHOOD_NATIVE_ETH_ASSET_ID,
      gasCostAtomic: attempt.networkFeeNativeAtomic,
    };
  }

  const payload: Omit<PaperFillCostPlan, "costHash"> = {
    schemaVersion: 1,
    status,
    quoteResultHash: quoteResult.resultHash,
    quoteEvidenceHash: quoteResult.evidence.evidenceHash,
    selectedAttemptHash: quoteResult.selectedAttemptHash,
    protectedOutputIncludesRouteFees: true,
    networkGasAssetId,
    networkGasCostAtomic,
    costs,
  };
  const plan: PaperFillCostPlan = { ...payload, costHash: hashCanonicalPayload(payload) };
  assertPaperFillCostPlan(plan, quoteResult);
  return plan;
}
