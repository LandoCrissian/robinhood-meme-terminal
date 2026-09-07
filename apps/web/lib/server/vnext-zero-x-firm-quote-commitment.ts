import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, keccak256 } from "viem";
import { parseVNextPreSignEvidence } from "../vnext/pre-sign-evidence";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../vnext/execution-settlement";
import { vNextV2VerificationCommitmentSecret } from "./vnext-v2-verification-commitment";
import type { ZeroXSwapFirmQuoteVerificationEvidence } from "./vnext-zero-x-firm-quote-verifier";
import type { VNextProviderAuthorizationRequest, VNextProviderVerificationEvidence } from "./vnext-provider-adapter";

const DOMAIN = "rmt:zerox-firm-quote:v1";
const KIND = "ZERO_X_FIRM_QUOTE_COMMITMENT_V1";
const MAX_TOKEN_LENGTH = 262_144;

export class ZeroXFirmQuoteCommitmentError extends Error {
  constructor() { super("The committed 0x firm quote is invalid or expired. Requote and review again."); }
}

export type ZeroXFirmQuoteContext = {
  identityId: string;
  sessionToken: string;
  wallet: string;
  quoteRequestId: string;
  verificationId: string;
};

function identityBinding(context: ZeroXFirmQuoteContext) {
  if (!context.identityId || !context.sessionToken || !context.quoteRequestId || !context.verificationId) {
    throw new ZeroXFirmQuoteCommitmentError();
  }
  return createHash("sha256").update(JSON.stringify([
    DOMAIN, context.identityId, context.sessionToken, getAddress(context.wallet),
    context.quoteRequestId, context.verificationId
  ])).digest("hex");
}

function mac(payload: string) {
  return createHmac("sha256", vNextV2VerificationCommitmentSecret()).update(`${DOMAIN}.${payload}`).digest();
}

// The full server evidence (including calldata) is authenticated, not reconstructed
// from browser claims. The token contains no identity token or API credential.
export function createZeroXFirmQuoteCommitment(evidence: VNextProviderVerificationEvidence, context: ZeroXFirmQuoteContext, nowMs: number) {
  const { zeroXFirmQuoteCommitment: _oldCommitment, ...authority } = evidence;
  const payload = Buffer.from(JSON.stringify({ kind: KIND, binding: identityBinding(context), evidence: authority })).toString("base64url");
  const token = `zx1.${payload}.${mac(payload).toString("base64url")}`;
  verifyZeroXFirmQuoteCommitment(token, context, nowMs);
  return token;
}

export function verifyZeroXFirmQuoteCommitment(token: string, context: ZeroXFirmQuoteContext, nowMs: number): ZeroXSwapFirmQuoteVerificationEvidence {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !/^zx1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new ZeroXFirmQuoteCommitmentError();
  }
  const [, payload, signature] = token.split(".");
  const actual = Buffer.from(signature, "base64url");
  const expected = mac(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ZeroXFirmQuoteCommitmentError();
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.kind !== KIND || claims.binding !== identityBinding(context)) throw new ZeroXFirmQuoteCommitmentError();
    const evidence = claims.evidence as ZeroXSwapFirmQuoteVerificationEvidence;
    const firm = evidence.providerNativeFee?.firmQuote;
    if (evidence.provider !== "zero-x-swap" || evidence.chainId !== 4_663
      || evidence.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE
      || (evidence.status !== "verified" && evidence.status !== "approval_required")
      || !firm || !Number.isSafeInteger(nowMs) || nowMs < firm.observedAtMs || nowMs >= firm.expiresAtMs
      || firm.expiresAtMs - firm.observedAtMs > 10_000
      || getAddress(evidence.recipient) !== getAddress(context.wallet)
      || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(evidence.transactionData)
      || keccak256(evidence.transactionData) !== evidence.calldataHash
      || evidence.swapTransactionValueAtomic !== evidence.providerNativeFee?.transactionValueAtomic
      || BigInt(evidence.deadline) * 1_000n <= BigInt(nowMs)) throw new ZeroXFirmQuoteCommitmentError();
    parseVNextPreSignEvidence({
      ...evidence, verificationId: context.verificationId, sourceQuoteRequestId: context.quoteRequestId,
      zeroXFirmQuoteCommitment: token
    }, {
      quoteRequestId: context.quoteRequestId, provider: "zero-x-swap", inputAsset: evidence.inputAsset,
      outputAsset: evidence.outputAsset, inputAmountAtomic: evidence.inputAmountAtomic,
      recipient: context.wallet, protectedOutputFloorAtomic: evidence.indicativeProtectedOutputFloorAtomic
    }, nowMs);
    return { ...evidence, zeroXFirmQuoteCommitment: token };
  } catch {
    throw new ZeroXFirmQuoteCommitmentError();
  }
}

export function committedZeroXAuthorizationEvidence(request: VNextProviderAuthorizationRequest) {
  if (!request.zeroXFirmQuoteCommitment || !request.zeroXFirmQuoteContext) throw new ZeroXFirmQuoteCommitmentError();
  const evidence = verifyZeroXFirmQuoteCommitment(request.zeroXFirmQuoteCommitment, request.zeroXFirmQuoteContext, Date.now());
  if (request.chainId !== evidence.chainId || request.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE
    || request.executionId !== undefined || request.canonicalMarket !== undefined || request.v4QuoteEvidence !== undefined
    || getAddress(request.inputAsset) !== getAddress(evidence.inputAsset)
    || getAddress(request.outputAsset) !== getAddress(evidence.outputAsset)
    || getAddress(request.recipient) !== getAddress(evidence.recipient)
    || request.inputAmountAtomic !== evidence.inputAmountAtomic || request.amountIn.toString() !== evidence.inputAmountAtomic
    || request.indicativeProtectedOutputFloorAtomic.toString() !== evidence.indicativeProtectedOutputFloorAtomic
    || request.protectedOutputFloorAtomic.toString() !== evidence.protectedOutputAtomic
    || request.deadlineSeconds.toString() !== evidence.deadline
    || request.zeroXExpectedStatus !== evidence.status) throw new ZeroXFirmQuoteCommitmentError();
  return evidence;
}
