import { formatEther } from "viem";

function decimalPlacesForSignificantDigits(value: number, significantDigits = 4) {
  const absolute = Math.abs(value);
  if (absolute === 0 || absolute >= 1) return 2;
  return Math.min(18, Math.max(2, Math.ceil(-Math.log10(absolute)) + significantDigits - 1));
}

export function formatUsd(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "Unavailable";
  const absolute = Math.abs(value);
  if (absolute === 0) return "$0.00";
  if (absolute >= 0.01) {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    });
  }
  if (absolute < 0.000000000000000001) return value < 0 ? "-<$0.000000000000000001" : "<$0.000000000000000001";
  const formatted = absolute.toLocaleString("en-US", {
    maximumFractionDigits: decimalPlacesForSignificantDigits(absolute),
    useGrouping: false
  });
  return `${value < 0 ? "-" : ""}$${formatted}`;
}

export function formatTokenEthPrice(value: bigint) {
  const numeric = Number(formatEther(value));
  if (numeric === 0) return "0";
  return numeric.toLocaleString("en-US", {
    maximumFractionDigits: decimalPlacesForSignificantDigits(numeric),
    useGrouping: false
  });
}
