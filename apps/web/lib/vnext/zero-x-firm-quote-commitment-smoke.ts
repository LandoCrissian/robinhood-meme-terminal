import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyZeroXFirmQuoteCommitment } from "../server/vnext-zero-x-firm-quote-commitment";
import { prepareZeroXSwapAuthorization } from "../server/vnext-zero-x-firm-quote-verifier";
import type { VNextProviderAuthorizationRequest } from "../server/vnext-provider-adapter";

export async function assertZeroXCommitmentAdversarialMatrix(request: VNextProviderAuthorizationRequest) {
  const token = request.zeroXFirmQuoteCommitment!;
  const context = request.zeroXFirmQuoteContext!;
  const [prefix, payload, signature] = token.split(".");
  const original = JSON.parse(Buffer.from(payload, "base64url").toString());
  const fields = [
    "provider", "chainId", "inputAsset", "outputAsset", "inputAmountAtomic", "recipient",
    "expectedOutputAtomic", "protectedOutputAtomic", "indicativeProtectedOutputFloorAtomic",
    "router", "calldataHash", "transactionData", "transactionValueAtomic", "swapTransactionValueAtomic",
    "gasLimitUnits", "gasPriceWei", "approvalSpender", "approvalRequired", "allowanceAtomic",
    "deadline", "expiresAtMs", "verifiedAtMs", "status", "nextAction", "exactSimulationPassed",
    "providerNativeFee.feeAsset", "providerNativeFee.feeAmountAtomic", "providerNativeFee.feeBps",
    "providerNativeFee.treasury", "providerNativeFee.providerFeeAsset", "providerNativeFee.providerFeeAtomic",
    "providerNativeFee.firmQuote.identity", "providerNativeFee.firmQuote.allowanceHolderRuntimeHash",
    "providerNativeFee.firmQuote.targetRuntimeHash", "providerNativeFee.firmQuote.expiresAtMs",
    "providerNativeFee.firmQuote.allowanceTarget", "providerNativeFee.firmQuote.swapGasLimitUnits"
  ];
  for (const field of fields) {
    const claims = structuredClone(original);
    const path = field.split(".");
    let target = claims.evidence;
    for (const part of path.slice(0, -1)) target = target[part];
    target[path.at(-1)!] = "tampered";
    const tampered = `${prefix}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
    await assert.rejects(() => prepareZeroXSwapAuthorization({ ...request, zeroXFirmQuoteCommitment: tampered }), /invalid or expired/, field);
  }
  for (const field of ["identityId", "sessionToken", "quoteRequestId", "verificationId", "wallet"] as const) {
    const changed = { ...context, [field]: field === "wallet" ? "0x0000000000000000000000000000000000000001" : "different" };
    assert.throws(() => verifyZeroXFirmQuoteCommitment(token, changed, Date.now()), /invalid or expired/, field);
  }
  assert.throws(() => verifyZeroXFirmQuoteCommitment(token, context, original.evidence.providerNativeFee.firmQuote.expiresAtMs), /invalid or expired/);
  const wrongDomain = createHmac("sha256", process.env.RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET!)
    .update(`rmt-vnext-v2-verification-commitment-v1.${payload}`).digest("base64url");
  assert.throws(() => verifyZeroXFirmQuoteCommitment(`${prefix}.${payload}.${wrongDomain}`, context, Date.now()), /invalid or expired/);
  await assert.rejects(() => prepareZeroXSwapAuthorization({ ...request, zeroXFirmQuoteCommitment: undefined }), /invalid or expired/);
  await assert.rejects(() => prepareZeroXSwapAuthorization({ ...request, protectedOutputFloorAtomic: request.protectedOutputFloorAtomic - 1n }), /invalid or expired/);
  await assert.rejects(() => prepareZeroXSwapAuthorization({ ...request, amountIn: request.amountIn + 1n }), /invalid or expired/);
}
