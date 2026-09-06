import { formatUnits } from "viem";
import type { VNextQuoteAttempt } from "./quote-observation";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";

export type VNextIndicativeFeePresentation =
  | {
      state: "planned";
      feeBps: number;
      feeSide: "input" | "output";
      feeAsset: string;
      expectedFeeAtomic: string;
      providerInputAtomic: string;
    }
  | { state: "no_rmt_fee" }
  | { state: "unavailable" };

export type VNextQuoteFeePresentation = {
  bestObserved: VNextIndicativeFeePresentation | null;
  bestExecutable: VNextIndicativeFeePresentation | null;
  separateContexts: boolean;
};

function feePresentationForQuote(attempt: VNextQuoteAttempt | undefined): VNextIndicativeFeePresentation | null {
  if (!attempt) return null;
  if (attempt.providerNativeFee) {
    return {
      state: "planned",
      feeBps: attempt.providerNativeFee.feeBps,
      feeSide: "input",
      feeAsset: attempt.providerNativeFee.feeAsset,
      expectedFeeAtomic: attempt.providerNativeFee.feeAmountAtomic,
      providerInputAtomic: attempt.providerNativeFee.providerInputAtomic
    };
  }
  if (attempt.feeV2Economics) {
    return {
      state: "planned",
      feeBps: attempt.feeV2Economics.feeBps,
      feeSide: attempt.feeV2Economics.feeSide,
      feeAsset: attempt.feeV2Economics.feeAsset,
      expectedFeeAtomic: attempt.feeV2Economics.expectedFeeAtomic,
      providerInputAtomic: attempt.feeV2Economics.providerInputAtomic
    };
  }
  if (attempt.netEconomics?.rmtFee.state === "planned") {
    return {
      state: "planned",
      feeBps: attempt.netEconomics.rmtFee.feeBps,
      feeSide: attempt.netEconomics.rmtFee.feeSide,
      feeAsset: attempt.netEconomics.rmtFee.feeAssetId,
      expectedFeeAtomic: attempt.netEconomics.rmtFee.expectedFeeAtomic,
      providerInputAtomic: attempt.netEconomics.providerInputAtomic
    };
  }
  if (
    attempt.publicWalletExecutionEligible === true
    && attempt.provider === "uniswap-v3"
    && attempt.settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE
  ) return { state: "unavailable" };
  return { state: "no_rmt_fee" };
}

export function vNextQuoteFeePresentation(input: {
  bestObserved: VNextQuoteAttempt | undefined;
  bestExecutable: VNextQuoteAttempt | undefined;
}): VNextQuoteFeePresentation {
  return {
    bestObserved: feePresentationForQuote(input.bestObserved),
    bestExecutable: feePresentationForQuote(input.bestExecutable),
    separateContexts: Boolean(
      input.bestObserved
      && input.bestExecutable
      && input.bestObserved.provider !== input.bestExecutable.provider
    )
  };
}

export function formatVNextFeeAtomic(value: string, decimals: number) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const grouped = BigInt(whole).toLocaleString();
  const visibleFraction = fraction.replace(/0+$/, "");
  return visibleFraction ? `${grouped}.${visibleFraction}` : grouped;
}
