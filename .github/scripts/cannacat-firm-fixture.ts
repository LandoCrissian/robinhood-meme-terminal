// Synthetic browser evidence only; never imported by the delivered SDK.
import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, getAddress, keccak256, zeroAddress, type Address, type Hex } from "viem";
import { createVNextZeroXProviderNativeFee } from "../../apps/web/lib/vnext/zero-x-settlement";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "../../apps/web/lib/vnext/pre-sign-evidence";
import { authorizationPayloadHash, parseVNextAuthorizationBundle, type VNextAuthorizationPlan } from "../../apps/web/lib/vnext/authorization-plan";

export function syntheticCannaCatBundle(input: {
  quoteRequestId: string; inputAsset: Address; outputAsset: Address; inputAmountAtomic: string;
  recipient: Address; protectedOutputFloorAtomic: string;
}) {
  const now = Date.now();
  const approval = input.inputAsset !== zeroAddress;
  const holder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
  const output = String(BigInt(input.inputAmountAtomic) * (approval ? 1n : 10_000_000n) / (approval ? 10_000_000n : 1n));
  const minimum = String(BigInt(output) * 99n / 100n);
  const swapData: Hex = "0xdeadbeef00";
  const actionData = approval ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [holder, BigInt(input.inputAmountAtomic)] }) : swapData;
  const gas = approval ? "60000" : "250000";
  const value = approval ? "0" : input.inputAmountAtomic;
  const fee = createVNextZeroXProviderNativeFee({
    inputAsset: input.inputAsset, outputAsset: input.outputAsset, userGrossInputAtomic: input.inputAmountAtomic,
    expectedOutputAtomic: output, protectedOutputAtomic: minimum, recipient: input.recipient,
    quotedFeeAmountAtomic: approval ? String(BigInt(output) * 25n / 10_000n) : undefined,
    transactionTarget: holder, transactionCalldataHash: keccak256(swapData), transactionValueAtomic: value,
    authorizationState: approval ? "approval_required" : "verified",
    firmQuote: { zid: "synthetic_fixture", observedAtMs: now, expiresAtMs: now + 10_000,
      swapGasLimitUnits: "250000", nextActionGasLimitUnits: gas, gasPriceWei: "1000000000",
      allowanceTarget: approval ? holder : null, providerSimulationIncomplete: true, exactSimulationPassed: false, exactSimulationState: "not_run" }
  });
  const evidence: VNextPreSignEvidence = {
    verificationId: randomUUID(), sourceQuoteRequestId: input.quoteRequestId, provider: "zero-x-swap",
    status: approval ? "approval_required" : "verified", chainId: 4663, inputAsset: input.inputAsset, outputAsset: input.outputAsset,
    inputAmountAtomic: input.inputAmountAtomic, indicativeProtectedOutputFloorAtomic: input.protectedOutputFloorAtomic,
    expectedOutputAtomic: output, protectedOutputAtomic: minimum, recipient: input.recipient,
    router: holder, approvalSpender: holder, approvalRequired: approval, sufficientBalance: true, allowanceAtomic: approval ? "0" : null, balanceAtomic: null,
    route: "aggregated", fees: [], pools: [], deadline: String(Math.floor((now + 10_000) / 1000)), calldataHash: keccak256(swapData),
    nextAction: approval ? "approval" : "swap", nextActionTarget: approval ? input.inputAsset : holder, nextActionCalldataHash: keccak256(actionData),
    transactionValueAtomic: value, nativeBalanceWei: "1000000000000000000", gasPriceWei: "1000000000", feeCeilingWei: "2000000000",
    estimatedGasUnits: gas, gasLimitUnits: gas, estimatedNetworkCostWei: String(BigInt(gas) * 2_000_000_000n),
    estimatedNetworkCostUsdgAtomic: null, networkCostValuationSource: null, networkCostValuedAtMs: null, networkCostValuationExpiresAtMs: null,
    gasState: "sufficient", routerRuntimeHash: `0x${"a".repeat(64)}`, factoryRuntimeHash: null, quoterRuntimeHash: null,
    exactSimulationPassed: false, exactSimulationState: "not_run", userPaysGas: true, rmtFeeEnabled: true,
    settlementMode: "PROVIDER_NATIVE_INPUT_FEE", providerNativeFee: fee,
    providerRequestedSlippagePpm: 9900, maximumUserSlippagePpm: 10000, providerReportedMinBuyAmount: minimum,
    providerSimulationIncomplete: true, zeroXFirmQuoteCommitment: "zx1.synthetic.fixture", approvalKind: approval ? "erc20_to_allowance_holder" : null,
    verifiedAtMs: now, expiresAtMs: now + 10_000, authorizationReady: true
  };
  const plan: VNextAuthorizationPlan = {
    planId: randomUUID(), sourceQuoteRequestId: input.quoteRequestId, sourceVerificationId: evidence.verificationId,
    provider: "zero-x-swap", kind: approval ? "erc20_approval" : "swap", chainId: 4663,
    target: evidence.nextActionTarget!, data: actionData, value, gasLimit: gas, gasPrice: "1000000000", payloadHash: keccak256(actionData),
    inputAsset: input.inputAsset, outputAsset: input.outputAsset, inputAmountAtomic: input.inputAmountAtomic, protectedOutputAtomic: minimum,
    recipient: input.recipient, router: holder, settlementMode: "PROVIDER_NATIVE_INPUT_FEE", providerNativeFee: fee,
    deadline: evidence.deadline, preparedAtMs: now, expiresAtMs: now + 10_000, userAuthorizationRequired: true, serverSubmissionEnabled: false
  };
  plan.payloadHash = authorizationPayloadHash(plan);
  parseVNextPreSignEvidence(evidence, { ...input, provider: "zero-x-swap" }, now);
  parseVNextAuthorizationBundle({ evidence, plan }, evidence, input, now);
  return { evidence, plan };
}
