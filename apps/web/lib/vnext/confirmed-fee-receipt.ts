import { formatUnits } from "viem";
import type { VNextExecutionRecord } from "./execution-recovery";

export type VNextConfirmedFeePresentation =
  | { state: "not_applicable" }
  | { state: "unavailable"; display: "RMT fee reconciliation unavailable" }
  | { state: "settled"; display: string };

function formatExactAtomic(value: string, decimals: number) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const grouped = BigInt(whole).toLocaleString();
  const exactFraction = fraction.replace(/0+$/, "");
  return exactFraction ? `${grouped}.${exactFraction}` : grouped;
}

export function confirmedVNextFeePresentation(input: {
  record: VNextExecutionRecord | null | undefined;
  inputDecimals: number;
  outputDecimals: number;
  inputSymbol: string;
  outputSymbol: string;
}): VNextConfirmedFeePresentation {
  const { record } = input;
  if (!record || record.kind !== "swap" || record.state !== "confirmed") return { state: "not_applicable" };
  if (record.feeV2Settlement) {
    const actualFee = record.feeV2Settlement.actualRmtFeeAtomic;
    if (actualFee === undefined || BigInt(actualFee) <= 0n) {
      return { state: "unavailable", display: "RMT fee reconciliation unavailable" };
    }
    return {
      state: "settled",
      display: `${formatExactAtomic(actualFee, input.inputDecimals)} ${input.inputSymbol} · 0.25%`
    };
  }
  if (!record.feeSettlement) return { state: "not_applicable" };
  const actualFee = record.feeSettlement.actualFeeAtomic;
  const actualUserNetOutput = record.feeSettlement.actualUserNetOutputAtomic;
  if (
    actualFee === undefined || BigInt(actualFee) <= 0n
    || actualUserNetOutput === undefined || actualUserNetOutput !== record.outputAmountAtomic
  ) return { state: "unavailable", display: "RMT fee reconciliation unavailable" };
  const feeUsesInput = record.feeSettlement.feeSide === "input";
  return {
    state: "settled",
    display: `${formatExactAtomic(actualFee, feeUsesInput ? input.inputDecimals : input.outputDecimals)} ${feeUsesInput ? input.inputSymbol : input.outputSymbol}`
  };
}
