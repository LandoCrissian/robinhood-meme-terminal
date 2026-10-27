import { isAddress, zeroAddress } from "viem";
export const CANNACAT_EMBED_VERSION = "rmt-cannacat-embed-v1";
export const CANNACAT_ADDRESS = "0x1139d423c1706bdead91f03507f521635591ed92";
export type CannaCatOperation = "quotes" | "verify" | "authorize" | "native-settlement-trace";
export const allowedKeys: Record<CannaCatOperation, readonly string[]> = {
  quotes: ["chainId", "inputAsset", "outputAsset", "inputAmountAtomic", "recipient"],
  verify: ["chainId", "quoteRequestId", "provider", "inputAsset", "outputAsset", "inputAmountAtomic", "protectedOutputFloorAtomic", "recipient"],
  authorize: ["chainId", "quoteRequestId", "verificationId", "provider", "inputAsset", "outputAsset", "inputAmountAtomic", "recipient", "expectedStatus", "indicativeProtectedOutputFloorAtomic", "expectedProtectedOutputAtomic", "settlementMode", "zeroXFirmQuoteCommitment"],
  "native-settlement-trace": ["txHash", "wallet"]
};
export function validateCannaCatEmbedBody(operation: CannaCatOperation, value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowedKeys[operation].includes(key))) return false;
  if (operation === "native-settlement-trace") {
    return Object.keys(input).length === 2 && typeof input.txHash === "string" && /^0x[0-9a-f]{64}$/i.test(input.txHash)
      && typeof input.wallet === "string" && isAddress(input.wallet, { strict: false });
  }
  if (input.chainId !== 4663 || typeof input.recipient !== "string" || !isAddress(input.recipient, { strict: false })
    || typeof input.inputAmountAtomic !== "string" || !/^[1-9][0-9]{0,77}$/.test(input.inputAmountAtomic)
    || BigInt(input.inputAmountAtomic) >= 2n ** 256n
    || typeof input.inputAsset !== "string" || typeof input.outputAsset !== "string") return false;
  const pair = [input.inputAsset.toLowerCase(), input.outputAsset.toLowerCase()];
  if (!((pair[0] === zeroAddress && pair[1] === CANNACAT_ADDRESS) || (pair[0] === CANNACAT_ADDRESS && pair[1] === zeroAddress))) return false;
  if (operation !== "quotes" && input.provider !== "zero-x-swap") return false;
  if (operation === "authorize" && input.settlementMode !== "PROVIDER_NATIVE_INPUT_FEE") return false;
  return true;
}

