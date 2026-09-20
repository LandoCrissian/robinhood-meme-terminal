// Closed diagnostic vocabulary, not an execution/action admission list.
export const envelopeReasons = [
  "TRANSACTION_VALUE_MISMATCH", "ALLOWANCEHOLDER_DECODE_FAILED", "ALLOWANCEHOLDER_NONCANONICAL",
  "INPUT_AMOUNT_MISMATCH", "OPERATOR_MISMATCH", "INPUT_TOKEN_MISMATCH", "SETTLER_TARGET_INVALID",
  "ALLOWANCEHOLDER_REQUIRED", "SETTLER_DECODE_FAILED", "SETTLER_NONCANONICAL",
  "RECIPIENT_MISMATCH", "OUTPUT_TOKEN_MISMATCH", "MINIMUM_INVALID", "ACTION_COUNT_INVALID",
  "MALFORMED_ACTION", "EARLY_SLIPPAGE", "UNSUPPORTED_ACTION", "NONCANONICAL_ACTION",
  "MISSING_ACTION", "INPUT_ACTION_MISMATCH", "INPUT_TRANSFER_BINDING_MISMATCH",
  "FEE_ACTION_MISMATCH", "FEE_TOKEN_MISMATCH", "FEE_RATE_MISMATCH", "FEE_RECIPIENT_MISMATCH",
  "FEE_TRANSFER_ENCODING_MISMATCH", "PROVIDER_FEE_DISCLOSURE_MISMATCH",
  "NATIVE_WRAP_MISMATCH", "ROUTE_RECIPIENT_MISMATCH", "ROUTE_RATE_MISMATCH",
  "ROUTE_PATH_INVALID", "ROUTE_INPUT_MISMATCH", "ROUTE_RUNTIME_UNSUPPORTED",
  "ROUTE_FEE_ON_TRANSFER_UNSUPPORTED", "ROUTE_FILL_TRUNCATED", "ROUTE_FILL_LIMIT",
  "ROUTE_FILL_ENCODING_INVALID", "ROUTE_SELF_SWAP", "UNSUPPORTED_HOOK",
  "UNSUPPORTED_POOL_MANAGER", "UNSUPPORTED_ROUTE", "NATIVE_UNWRAP_MISMATCH",
  "POSITIVE_SLIPPAGE_MISMATCH", "PROVIDER_FEE_COUNT_MISMATCH", "EXTRA_ACTION",
  "ROUTE_HASH_INVALID", "UNSUPPORTED_EKUBO_EXTENSION", "ROUTE_POOL_INVALID", "ROUTE_HOOK_DATA_LIMIT",
  "MALFORMED_ENVELOPE"
] as const;
export type EnvelopeReason = typeof envelopeReasons[number];
const functions = ["decodeZeroXExecutableMinimum", "verifyZeroXEncodedFee"] as const;
export type EnvelopeFunction = typeof functions[number];
const kinds = ["NATIVE_CHECK", "TRANSFER_FROM", "BASIC", "UNISWAPV3", "EKUBOV3", "UNISWAPV4", "PANCAKE_INFINITY", "POSITIVE_SLIPPAGE", "CHECK_SLIPPAGE"];
export type EnvelopeDiagnostic = { envelopeReason: EnvelopeReason; envelopeFunction: EnvelopeFunction; actionIndex: number | null; actionKind: string | null };
export function safeEnvelopeDiagnostic(input: Partial<Record<keyof EnvelopeDiagnostic, unknown>>) {
  return {
    envelopeReason: typeof input.envelopeReason === "string" && (envelopeReasons as readonly string[]).includes(input.envelopeReason) ? input.envelopeReason as EnvelopeReason : null,
    envelopeFunction: typeof input.envelopeFunction === "string" && (functions as readonly string[]).includes(input.envelopeFunction) ? input.envelopeFunction as EnvelopeFunction : null,
    actionIndex: typeof input.actionIndex === "number" && Number.isInteger(input.actionIndex) && input.actionIndex >= 0 && input.actionIndex < 256 ? input.actionIndex : null,
    // A four-byte unknown selector identifies grammar without exposing arguments.
    actionKind: typeof input.actionKind === "string" && (kinds.includes(input.actionKind) || /^0x[0-9a-f]{8}$/i.test(input.actionKind)) ? input.actionKind : null
  };
}
