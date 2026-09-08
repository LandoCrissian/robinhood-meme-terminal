import { isAddress } from "viem";

export const ZERO_X_INVALID_RESPONSE_REASONS = [
  "INVALID_TOKEN_BINDING", "CHANGED_SELL_AMOUNT", "INVALID_EXPECTED_OUTPUT", "INVALID_MINIMUM_OUTPUT",
  "MISSING_FEE_DISCLOSURE", "INVALID_PROVIDER_FEE", "MISSING_INTEGRATOR_FEE", "INVALID_INTEGRATOR_FEE",
  "DUPLICATE_INTEGRATOR_FEE", "WRONG_INTEGRATOR_FEE_TOKEN", "WRONG_INTEGRATOR_FEE_AMOUNT",
  "INVALID_INTEGRATOR_FEE_TYPE", "MISSING_NETWORK_FEE", "CONTRADICTORY_NETWORK_FEE", "OTHER_SCHEMA_VIOLATION"
] as const;
export type ZeroXInvalidResponseReason = typeof ZERO_X_INVALID_RESPONSE_REASONS[number];

export class ZeroXInvalidResponseError extends Error {
  constructor(message: string, readonly reason: ZeroXInvalidResponseReason = "OTHER_SCHEMA_VIOLATION") {
    super(message);
    this.name = "ZeroXInvalidResponseError";
  }
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const atomic = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]{0,99})$/.test(value) ? value : null;
const address = (value: unknown) => typeof value === "string" && isAddress(value, { strict: false }) ? value.toLowerCase() : null;
function fee(value: unknown) {
  if (value == null) return null;
  const entry = object(value);
  return { asset: address(entry.token), amount: atomic(entry.amount),
    type: entry.type === "volume" ? "volume" : entry.type === "gas" ? "gas" : entry.type === undefined ? "ABSENT" : "OTHER" };
}

// Diagnostics-only allowlist. No body, calldata, URL, error message, header, or
// unbounded provider text is retained. The public adapter still fails closed.
export function safeZeroXPriceEconomics(value: unknown) {
  const body = object(value);
  const fees = object(body.fees);
  return {
    sellAsset: address(body.sellToken), buyAsset: address(body.buyToken), sellAmount: atomic(body.sellAmount),
    buyAmount: atomic(body.buyAmount), minBuyAmount: atomic(body.minBuyAmount), totalNetworkFee: atomic(body.totalNetworkFee),
    integratorFee: fee(fees.integratorFee), zeroExFee: fee(fees.zeroExFee), gasFee: fee(fees.gasFee),
    integratorFees: Array.isArray(fees.integratorFees) ? fees.integratorFees.slice(0, 2).map(fee) : [],
    integratorFeesOverflow: Array.isArray(fees.integratorFees) && fees.integratorFees.length > 2
  };
}
export type ZeroXPriceDiagnostic = {
  reason: ZeroXInvalidResponseReason | null;
  economics: ReturnType<typeof safeZeroXPriceEconomics>;
};
