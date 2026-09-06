import { decodeFunctionData, erc20Abi, getAddress, isAddress, keccak256, stringToHex, zeroAddress, type Address, type Hex } from "viem";
import type { VNextAuthorizationPlan } from "./authorization-plan";

export const ZERO_X_NATIVE_TOKEN = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
export const RMT_ZERO_X_FEE_TREASURY = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");
export const RMT_ZERO_X_FEE_BPS = 25 as const;
export const RMT_ZERO_X_FEE_DENOMINATOR = 10_000n;

const POSITIVE_ATOMIC = /^[1-9][0-9]*$/;
const NON_NEGATIVE_ATOMIC = /^(0|[1-9][0-9]*)$/;

export function toZeroXToken(address: string): Address {
  if (!isAddress(address, { strict: false })) throw new Error("RMT rejected an invalid 0x boundary token.");
  return getAddress(address) === zeroAddress ? ZERO_X_NATIVE_TOKEN : getAddress(address);
}

export function fromZeroXToken(address: string): Address {
  if (!isAddress(address, { strict: false })) throw new Error("RMT rejected an invalid 0x response token.");
  if (getAddress(address) === zeroAddress) throw new Error("0x must use its native token sentinel, not zeroAddress.");
  return getAddress(address) === ZERO_X_NATIVE_TOKEN ? zeroAddress : getAddress(address);
}

export function zeroXIntegratorFeeAmount(userGrossInputAtomic: string) {
  if (!POSITIVE_ATOMIC.test(userGrossInputAtomic)) throw new Error("RMT rejected an invalid 0x gross input.");
  return (BigInt(userGrossInputAtomic) * BigInt(RMT_ZERO_X_FEE_BPS) / RMT_ZERO_X_FEE_DENOMINATOR).toString();
}

export type VNextZeroXProviderNativeFee = {
  provider: "zero-x-swap";
  chainId: 4_663;
  outputAsset: Address;
  settlement: "provider-native";
  feeExecutorRequired: false;
  feeBps: 25;
  feeAsset: Address;
  feeAmountAtomic: string;
  treasury: Address;
  userGrossInputAtomic: string;
  providerInputAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  recipient: Address;
  requestSellToken: Address;
  requestFeeRecipient: Address;
  requestFeeBps: 25;
  requestFeeToken: Address;
  transactionTarget: Address | null;
  transactionCalldataHash: Hex | null;
  transactionValueAtomic: string | null;
  providerFeeAsset: Address | null;
  providerFeeAtomic: string | null;
  authorizationState: "indicative" | "approval_required" | "verified" | "blocked";
  firmQuote: null | {
    identity: Hex;
    zid: string | null;
    observedAtMs: number;
    expiresAtMs: number;
    swapGasLimitUnits: string;
    nextActionGasLimitUnits: string;
    gasPriceWei: string | null;
    targetRuntimeHash: Hex;
    allowanceTarget: Address | null;
    allowanceHolderRuntimeHash: Hex | null;
    providerSimulationIncomplete: boolean;
    exactSimulationPassed: boolean;
  };
};

export function zeroXFirmQuoteIdentity(value: VNextZeroXProviderNativeFee): Hex {
  const { firmQuote, ...economics } = value;
  if (!firmQuote) throw new Error("RMT rejected missing 0x firm quote authority.");
  const { identity: _identity, ...authority } = firmQuote;
  return keccak256(stringToHex(JSON.stringify([economics, authority])));
}

export function createVNextZeroXProviderNativeFee(input: {
  inputAsset: Address;
  outputAsset: Address;
  userGrossInputAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  recipient: Address;
  providerFeeAsset?: Address | null;
  providerFeeAtomic?: string | null;
  transactionTarget?: Address | null;
  transactionCalldataHash?: Hex | null;
  transactionValueAtomic?: string | null;
  authorizationState: VNextZeroXProviderNativeFee["authorizationState"];
  firmQuote?: Omit<NonNullable<VNextZeroXProviderNativeFee["firmQuote"]>, "identity">;
}): VNextZeroXProviderNativeFee {
  const feeAmountAtomic = zeroXIntegratorFeeAmount(input.userGrossInputAtomic);
  if (feeAmountAtomic === "0") throw new Error("RMT rejected a zero 0x integrator fee.");
  const providerInputAtomic = (BigInt(input.userGrossInputAtomic) - BigInt(feeAmountAtomic)).toString();
  const result: VNextZeroXProviderNativeFee = {
    provider: "zero-x-swap",
    chainId: 4_663,
    outputAsset: getAddress(input.outputAsset),
    settlement: "provider-native",
    feeExecutorRequired: false,
    feeBps: RMT_ZERO_X_FEE_BPS,
    feeAsset: getAddress(input.inputAsset),
    feeAmountAtomic,
    treasury: RMT_ZERO_X_FEE_TREASURY,
    userGrossInputAtomic: input.userGrossInputAtomic,
    providerInputAtomic,
    expectedOutputAtomic: input.expectedOutputAtomic,
    protectedOutputAtomic: input.protectedOutputAtomic,
    recipient: getAddress(input.recipient),
    requestSellToken: toZeroXToken(input.inputAsset),
    requestFeeRecipient: RMT_ZERO_X_FEE_TREASURY,
    requestFeeBps: RMT_ZERO_X_FEE_BPS,
    requestFeeToken: toZeroXToken(input.inputAsset),
    transactionTarget: input.transactionTarget ?? null,
    transactionCalldataHash: input.transactionCalldataHash ?? null,
    transactionValueAtomic: input.transactionValueAtomic ?? null,
    providerFeeAsset: input.providerFeeAsset ?? null,
    providerFeeAtomic: input.providerFeeAtomic ?? null,
    authorizationState: input.authorizationState,
    firmQuote: input.firmQuote ? { ...input.firmQuote, identity: `0x${"0".repeat(64)}` } : null
  };
  if (result.firmQuote) result.firmQuote.identity = zeroXFirmQuoteIdentity(result);
  assertVNextZeroXProviderNativeFee(result);
  return result;
}

export function assertVNextZeroXProviderNativeFee(value: VNextZeroXProviderNativeFee | undefined) {
  if (!value) throw new Error("RMT rejected missing 0x provider-native fee evidence.");
  const expectedFee = zeroXIntegratorFeeAmount(value.userGrossInputAtomic);
  const indicative = value.authorizationState === "indicative";
  if (
    value.provider !== "zero-x-swap"
    || value.chainId !== 4_663
    || !["indicative", "approval_required", "verified", "blocked"].includes(value.authorizationState)
    || !isAddress(value.outputAsset, { strict: false })
    || getAddress(value.outputAsset) === ZERO_X_NATIVE_TOKEN
    || getAddress(value.outputAsset) === getAddress(value.feeAsset)
    || value.settlement !== "provider-native"
    || value.feeExecutorRequired !== false
    || value.feeBps !== RMT_ZERO_X_FEE_BPS
    || getAddress(value.feeAsset) !== fromZeroXToken(value.requestSellToken)
    || value.feeAmountAtomic !== expectedFee
    || expectedFee === "0"
    || value.providerInputAtomic !== (BigInt(value.userGrossInputAtomic) - BigInt(expectedFee)).toString()
    || !POSITIVE_ATOMIC.test(value.expectedOutputAtomic)
    || !POSITIVE_ATOMIC.test(value.protectedOutputAtomic)
    || BigInt(value.protectedOutputAtomic) > BigInt(value.expectedOutputAtomic)
    || getAddress(value.treasury) !== RMT_ZERO_X_FEE_TREASURY
    || getAddress(value.requestFeeRecipient) !== RMT_ZERO_X_FEE_TREASURY
    || value.requestFeeBps !== RMT_ZERO_X_FEE_BPS
    || getAddress(value.requestFeeToken) !== toZeroXToken(value.feeAsset)
    || getAddress(value.requestFeeToken) !== getAddress(value.requestSellToken)
    || !isAddress(value.recipient, { strict: false })
    || getAddress(value.recipient) === zeroAddress
    || indicative !== (value.firmQuote === null)
    || (value.providerFeeAsset === null) !== (value.providerFeeAtomic === null)
    || (value.providerFeeAtomic !== null && !POSITIVE_ATOMIC.test(value.providerFeeAtomic))
    || (value.providerFeeAsset !== null && !isAddress(value.providerFeeAsset, { strict: false }))
    || indicative !== (value.transactionTarget === null)
    || indicative !== (value.transactionCalldataHash === null)
    || indicative !== (value.transactionValueAtomic === null)
    || (!indicative && (!isAddress(value.transactionTarget!, { strict: false }) || getAddress(value.transactionTarget!) === zeroAddress))
    || (!indicative && !/^0x[0-9a-fA-F]{64}$/.test(value.transactionCalldataHash!))
    || (!indicative && !NON_NEGATIVE_ATOMIC.test(value.transactionValueAtomic!))
  ) throw new Error("RMT rejected inconsistent 0x provider-native fee evidence.");
  if (value.firmQuote) {
    const quote = value.firmQuote;
    const native = getAddress(value.feeAsset) === zeroAddress;
    if (
      quote.identity !== zeroXFirmQuoteIdentity(value)
      || (quote.zid !== null && !/^(?:0x[0-9a-fA-F]{1,128}|[A-Za-z0-9_-]{8,128})$/.test(quote.zid))
      || !Number.isSafeInteger(quote.observedAtMs) || quote.observedAtMs <= 0
      || !Number.isSafeInteger(quote.expiresAtMs) || quote.expiresAtMs <= quote.observedAtMs
      || quote.expiresAtMs - quote.observedAtMs > 10_000
      || !POSITIVE_ATOMIC.test(quote.swapGasLimitUnits) || !POSITIVE_ATOMIC.test(quote.nextActionGasLimitUnits)
      || (quote.gasPriceWei !== null && !POSITIVE_ATOMIC.test(quote.gasPriceWei))
      || !/^0x[0-9a-fA-F]{64}$/.test(quote.targetRuntimeHash)
      || typeof quote.providerSimulationIncomplete !== "boolean" || typeof quote.exactSimulationPassed !== "boolean"
      || (value.authorizationState === "verified") !== quote.exactSimulationPassed
      || (quote.exactSimulationPassed && (quote.providerSimulationIncomplete || quote.swapGasLimitUnits !== quote.nextActionGasLimitUnits))
      || (native && (quote.allowanceTarget !== null || quote.allowanceHolderRuntimeHash !== null || value.authorizationState === "approval_required" || value.transactionValueAtomic === "0"))
      || (!native && (!quote.allowanceTarget || !isAddress(quote.allowanceTarget, { strict: false })
        || getAddress(quote.allowanceTarget) === zeroAddress || getAddress(quote.allowanceTarget) !== getAddress(value.transactionTarget!)
        || quote.allowanceHolderRuntimeHash !== quote.targetRuntimeHash || value.transactionValueAtomic !== "0"))
    ) throw new Error("RMT rejected incomplete 0x firm quote or simulation authority.");
  }
  return true;
}

/** Narrow 0x binding shared by wallet review, interactive authority and recovery. */
export function assertVNextZeroXPlanBinding(plan: VNextAuthorizationPlan) {
  const fee = plan.providerNativeFee;
  assertVNextZeroXProviderNativeFee(fee);
  if (!fee?.firmQuote || plan.provider !== "zero-x-swap" || plan.chainId !== 4_663
    || plan.settlementMode !== "PROVIDER_NATIVE_INPUT_FEE"
    || plan.feeExecution != null || plan.feeV2Authorization !== undefined || plan.feeV2Economics !== undefined
    || plan.netEconomics !== undefined || plan.directNoRmtFee !== undefined || plan.directAuthorization !== undefined || plan.v4Execution !== undefined
    || getAddress(plan.inputAsset) !== getAddress(fee.feeAsset) || getAddress(plan.outputAsset) !== getAddress(fee.outputAsset)
    || plan.inputAmountAtomic !== fee.userGrossInputAtomic || plan.protectedOutputAtomic !== fee.protectedOutputAtomic
    || getAddress(plan.recipient) !== getAddress(fee.recipient) || getAddress(plan.router) !== getAddress(fee.transactionTarget!)
    || plan.gasLimit !== fee.firmQuote.nextActionGasLimitUnits || (plan.gasPrice ?? null) !== fee.firmQuote.gasPriceWei
    || plan.expiresAtMs > fee.firmQuote.expiresAtMs || plan.preparedAtMs < fee.firmQuote.observedAtMs
    || !plan.userAuthorizationRequired || plan.serverSubmissionEnabled
  ) throw new Error("RMT rejected changed 0x wallet fee or transaction authority.");
  if (plan.kind === "swap") {
    if (fee.authorizationState !== "verified" || !fee.firmQuote.exactSimulationPassed || fee.firmQuote.providerSimulationIncomplete
      || getAddress(plan.target) !== getAddress(fee.transactionTarget!) || keccak256(plan.data) !== fee.transactionCalldataHash
      || plan.value !== fee.transactionValueAtomic
    ) throw new Error("RMT rejected a 0x swap that differs from exact simulation.");
  } else {
    if (fee.authorizationState !== "approval_required" || !fee.firmQuote.allowanceTarget || getAddress(plan.inputAsset) === zeroAddress
      || getAddress(plan.target) !== getAddress(plan.inputAsset) || plan.value !== "0"
    ) throw new Error("RMT rejected invalid 0x approval authority.");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
    if (decoded.functionName !== "approve" || getAddress(decoded.args[0]) !== getAddress(fee.firmQuote.allowanceTarget)
      || decoded.args[1] !== BigInt(plan.inputAmountAtomic)
    ) throw new Error("RMT rejected broadened 0x approval authority.");
  }
}
