import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { assertVNextQuoteAttempt, type VNextQuoteAttempt, type VNextQuoteAttemptStatus, type VNextQuoteProvider } from "../vnext/quote-observation";
import { assertRmtNetExecutionEconomics, normalizeDisabledRmtFee, type RmtNetExecutionEconomics } from "../vnext/execution-fee-policy";
import {
  configuredRmtExecutionFeeV2Policy,
  type RmtExecutionFeeV2Economics,
  type RmtExecutionFeeV2Policy
} from "../vnext/execution-fee-policy-v2";
import {
  VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY,
  assertVNextWalletFeeAdmission,
  type VNextAtomicFeeAuthorizationBinding,
  type VNextAtomicFeeSettlementProof,
  type VNextProviderFeeSettlementCapability
} from "../vnext/provider-fee-settlement";
import { assertRmtUniswapV3FeeExecution, type RmtUniswapV3FeeExecution } from "../vnext/uniswap-v3-fee-executor";
import {
  assertVNextDirectNoRmtFeeSettlement,
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_LEGACY_V1_FEE,
  VNEXT_PROVIDER_NATIVE_INPUT_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE,
  type VNextDirectNoRmtFeeSettlement,
  type VNextExecutionSettlementMode
} from "../vnext/execution-settlement";
import { assertVNextZeroXProviderNativeFee, type VNextZeroXProviderNativeFee } from "../vnext/zero-x-settlement";

export type VNextVerifiedTokenIdentity = {
  address: Address;
  symbol: string;
  decimals: number;
};

export type VNextProviderQuoteRequest = {
  chainId: 4_663;
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  amountIn: bigint;
  recipient: Address;
  inputIdentity: VNextVerifiedTokenIdentity;
  outputIdentity: VNextVerifiedTokenIdentity;
  canonicalMarket?: { sourceId: "uniswap-v4"; poolId: Hex };
};

export type VNextUniswapV4QuoteBinding = {
  poolId: Hex;
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  recipient: Address;
  observedBlock: string;
  observedBlockHash: Hex;
  observedAtMs: number;
  quotedAtMs: number;
  expiresAtMs: number;
};

export type VNextProviderSettlementSelection =
  | typeof VNEXT_DIRECT_NO_RMT_FEE
  | typeof VNEXT_LEGACY_V1_FEE
  | typeof VNEXT_PROVIDER_NATIVE_INPUT_FEE
  | typeof VNEXT_V2_ATOMIC_INPUT_FEE;

export type VNextProviderVerificationRequest = Pick<VNextProviderQuoteRequest,
  "chainId" | "inputAsset" | "outputAsset" | "inputAmountAtomic" | "amountIn" | "recipient"
> & {
  indicativeProtectedOutputFloorAtomic: bigint;
  executionId?: Hex;
  settlementMode?: VNextProviderSettlementSelection;
  canonicalMarket?: { sourceId: "uniswap-v4"; poolId: Hex };
  v4QuoteEvidence?: VNextUniswapV4QuoteBinding;
  deadlineSeconds?: bigint;
  nowMs?: number;
};

export type VNextProviderVerificationEvidence = Record<string, unknown> & {
  provider: VNextQuoteProvider;
  status: "verified" | "approval_required" | "approval_simulation_failed" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  chainId: 4_663;
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  indicativeProtectedOutputFloorAtomic: string;
  protectedOutputAtomic: string;
  expectedOutputAtomic?: string;
  recipient: Address;
  router: Address;
  approvalSpender: Address;
  deadline: string;
  calldataHash: Hex;
  nextAction: "approval" | "swap" | null;
  nextActionTarget: Address | null;
  nextActionCalldataHash: Hex | null;
  transactionValueAtomic: string;
  gasLimitUnits: string | null;
  estimatedNetworkCostUsdgAtomic: string | null;
  networkCostValuationSource: "canonical_uniswap_v3_weth_usdg_quote_plus_1pct" | null;
  networkCostValuedAtMs: number | null;
  networkCostValuationExpiresAtMs: number | null;
  netEconomics?: RmtNetExecutionEconomics;
  feeExecution?: RmtUniswapV3FeeExecution | null;
  feeV2Economics?: RmtExecutionFeeV2Economics;
  feeV2Settlement?: VNextAtomicFeeSettlementProof;
  providerNativeFee?: VNextZeroXProviderNativeFee;
  infrastructureVerifiedAtBlock?: string;
  infrastructureVerifiedAtBlockHash?: Hex;
  authorizationInfrastructureVerifiedAtBlock?: string;
  authorizationInfrastructureVerifiedAtBlockHash?: Hex;
  settlementMode: VNextExecutionSettlementMode;
  directNoRmtFee?: VNextDirectNoRmtFeeSettlement;
  approvalKind?: "erc20_to_permit2" | "permit2_to_router" | "erc20_to_allowance_holder" | null;
  v4Execution?: import("./vnext-uniswap-v4-execution").VNextUniswapV4ExecutionEvidence;
};

export type VNextProviderAuthorizationRequest = VNextProviderVerificationRequest & {
  deadlineSeconds: bigint;
  protectedOutputFloorAtomic: bigint;
  nowMs: number;
  infrastructureVerifiedAtBlock?: string;
  infrastructureVerifiedAtBlockHash?: Hex;
};

export type VNextPreparedProviderAuthorization = {
  evidence: VNextProviderVerificationEvidence;
  feeV2Authorization?: VNextAtomicFeeAuthorizationBinding;
  feeV2SwapCalldata?: Hex;
  transaction: {
    kind: "erc20_approval" | "swap";
    target: Address;
    data: Hex;
    value: string;
    gasLimit: string;
    gasPrice?: string;
  };
};

export type VNextWalletFeeAdmissionContext = {
  policy?: RmtExecutionFeeV2Policy | null;
  capability?: VNextProviderFeeSettlementCapability;
};

export type VNextQuoteProviderAdapter = {
  provider: VNextQuoteProvider;
  providerLabel: string;
  providerFamily: "sushi" | "uniswap" | "uniswapx" | "zeroex" | "up";
  adapterVersion: 1;
  executionKind: "aggregator" | "direct_amm" | "gasless" | "rfq_intent";
  capabilities: {
    strictVerification: boolean;
    walletAuthorization: boolean;
  };
  quote(request: VNextProviderQuoteRequest): Promise<VNextQuoteAttempt>;
  verify?(request: VNextProviderVerificationRequest): Promise<VNextProviderVerificationEvidence>;
  prepareAuthorization?(request: VNextProviderAuthorizationRequest): Promise<VNextPreparedProviderAuthorization>;
};

export function disabledVNextFeeEconomics(input: {
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
}) {
  return normalizeDisabledRmtFee({
    userGrossInputAtomic: input.inputAmountAtomic,
    providerGrossExpectedOutputAtomic: input.expectedOutputAtomic,
    providerProtectedOutputAtomic: input.protectedOutputAtomic
  });
}

export function unavailableVNextQuoteAttempt(input: {
  adapter: VNextQuoteProviderAdapter;
  request: VNextProviderQuoteRequest;
  status: Exclude<VNextQuoteAttemptStatus, "indicative">;
  detail: string;
  startedAtMs: number;
}): VNextQuoteAttempt {
  return {
    provider: input.adapter.provider,
    providerLabel: input.adapter.providerLabel,
    providerFamily: input.adapter.providerFamily,
    adapterVersion: input.adapter.adapterVersion,
    executionKind: input.adapter.executionKind,
    status: input.status,
    detail: input.detail,
    chainId: input.request.chainId,
    inputAsset: input.request.inputAsset,
    outputAsset: input.request.outputAsset,
    inputAmountAtomic: input.request.inputAmountAtomic,
    expectedOutputAtomic: null,
    protectedOutputAtomic: null,
    outputDecimals: null,
    priceImpact: null,
    liquidityFeeEvidence: [],
    quotedAtMs: null,
    expiresAtMs: null,
    latencyMs: Math.max(0, Date.now() - input.startedAtMs),
    strictVerificationAvailable: input.adapter.capabilities.strictVerification,
    userPaysGas: null,
    providerFeeAsset: null,
    providerFeeAtomic: null,
    gasSponsorshipFeeAsset: null,
    gasSponsorshipFeeAtomic: null,
    explicitProviderFeeOutputAtomic: null,
    netEconomics: null,
    networkFeeNativeAtomic: null,
    networkFeeNativeSymbol: null,
    protectedNetOutputAtomic: null,
    costState: null,
    authorizationReady: false
  };
}

export async function quoteVNextExecutionProviders(
  request: VNextProviderQuoteRequest,
  adapters: readonly VNextQuoteProviderAdapter[]
) {
  if (request.chainId !== 4_663 || request.amountIn <= 0n || request.inputAmountAtomic !== request.amountIn.toString()) {
    throw new Error("RMT rejected an inconsistent provider quote request.");
  }
  if (getAddress(request.inputAsset) === getAddress(request.outputAsset)) throw new Error("Input and output assets must differ.");
  if (adapters.length === 0 || adapters.length > 9 || new Set(adapters.map((adapter) => adapter.provider)).size !== adapters.length) {
    throw new Error("RMT rejected an invalid provider adapter registry.");
  }
  const attempts = await Promise.all(adapters.map(async (adapter) => {
    const startedAtMs = Date.now();
    let attempt: VNextQuoteAttempt;
    try {
      attempt = await adapter.quote(request);
    } catch {
      return unavailableVNextQuoteAttempt({
        adapter, request, status: "temporarily_unavailable",
        detail: `${adapter.providerLabel} is temporarily unavailable for this request.`, startedAtMs
      });
    }
    try {
      assertVNextQuoteAttempt(attempt, request, Date.now());
      if (
        attempt.provider !== adapter.provider || attempt.providerFamily !== adapter.providerFamily
        || attempt.adapterVersion !== adapter.adapterVersion || attempt.executionKind !== adapter.executionKind
        || attempt.strictVerificationAvailable !== adapter.capabilities.strictVerification
      ) {
        throw new Error("Provider adapter identity changed.");
      }
      return attempt;
    } catch {
      return unavailableVNextQuoteAttempt({
        adapter,
        request,
        status: "invalid_response",
        detail: `RMT rejected an inconsistent ${adapter.providerLabel} adapter response.`,
        startedAtMs
      });
    }
  }));
  return attempts;
}

function adapterForProvider(provider: VNextQuoteProvider, adapters: readonly VNextQuoteProviderAdapter[]) {
  const adapter = adapters.find((candidate) => candidate.provider === provider);
  if (!adapter) throw new Error("RMT does not recognize the requested execution provider.");
  return adapter;
}

function assertVerificationEvidence(
  evidence: VNextProviderVerificationEvidence,
  adapter: VNextQuoteProviderAdapter,
  request: VNextProviderVerificationRequest
) {
  if (
    evidence.provider !== adapter.provider
    || evidence.chainId !== request.chainId
    || !isAddress(evidence.inputAsset)
    || getAddress(evidence.inputAsset) !== getAddress(request.inputAsset)
    || !isAddress(evidence.outputAsset)
    || getAddress(evidence.outputAsset) !== getAddress(request.outputAsset)
    || evidence.inputAmountAtomic !== request.inputAmountAtomic
    || evidence.inputAmountAtomic !== request.amountIn.toString()
    || evidence.indicativeProtectedOutputFloorAtomic !== request.indicativeProtectedOutputFloorAtomic.toString()
    || request.indicativeProtectedOutputFloorAtomic <= 0n
    || !isAddress(evidence.recipient)
    || getAddress(evidence.recipient) !== getAddress(request.recipient)
    || !isAddress(evidence.router)
    || !isAddress(evidence.approvalSpender)
    || evidence.settlementMode !== (request.settlementMode ?? VNEXT_DIRECT_NO_RMT_FEE)
    || !/^[1-9][0-9]*$/.test(evidence.protectedOutputAtomic)
    || BigInt(evidence.protectedOutputAtomic) < request.indicativeProtectedOutputFloorAtomic
    || !/^[1-9][0-9]*$/.test(evidence.deadline)
    || !/^0x[0-9a-fA-F]{64}$/.test(evidence.calldataHash)
    || (evidence.nextActionTarget !== null && !isAddress(evidence.nextActionTarget))
    || (evidence.nextActionCalldataHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(evidence.nextActionCalldataHash))
    || !/^(0|[1-9][0-9]*)$/.test(evidence.transactionValueAtomic)
    || (evidence.gasLimitUnits !== null && !/^[1-9][0-9]*$/.test(evidence.gasLimitUnits))
  ) throw new Error(`RMT rejected inconsistent ${adapter.providerLabel} verification evidence.`);
}

export async function verifyVNextExecutionProvider(
  provider: VNextQuoteProvider,
  request: VNextProviderVerificationRequest,
  adapters: readonly VNextQuoteProviderAdapter[]
) {
  if (request.indicativeProtectedOutputFloorAtomic <= 0n) throw new Error("RMT rejected an invalid indicative protected-output floor.");
  const adapter = adapterForProvider(provider, adapters);
  if (!adapter.capabilities.strictVerification || !adapter.verify) {
    throw new Error(`${adapter.providerLabel} strict verification is not available yet.`);
  }
  const evidence = await adapter.verify(request);
  assertVerificationEvidence(evidence, adapter, request);
  return evidence;
}

export async function prepareVNextProviderAuthorization(
  provider: VNextQuoteProvider,
  request: VNextProviderAuthorizationRequest,
  adapters: readonly VNextQuoteProviderAdapter[],
  feeAdmission: VNextWalletFeeAdmissionContext = {}
) {
  if (
    request.protectedOutputFloorAtomic <= 0n
    || request.indicativeProtectedOutputFloorAtomic <= 0n
    || request.indicativeProtectedOutputFloorAtomic > request.protectedOutputFloorAtomic
  ) throw new Error("RMT rejected an invalid protected output floor.");
  const adapter = adapterForProvider(provider, adapters);
  if (!adapter.capabilities.walletAuthorization || !adapter.prepareAuthorization) {
    throw new Error(`${adapter.providerLabel} wallet authorization is not available yet.`);
  }
  const prepared = await adapter.prepareAuthorization(request);
  assertVerificationEvidence(prepared.evidence, adapter, request);
  const settlementMode = request.settlementMode ?? VNEXT_DIRECT_NO_RMT_FEE;
  if (settlementMode === VNEXT_DIRECT_NO_RMT_FEE) {
    if (prepared.evidence.settlementMode !== VNEXT_DIRECT_NO_RMT_FEE || prepared.feeV2Authorization !== undefined) {
      throw new Error(`${adapter.providerLabel} returned fee authority for a fee-free wallet request.`);
    }
    assertVNextDirectNoRmtFeeSettlement(prepared.evidence.directNoRmtFee, request.inputAmountAtomic);
  } else if (settlementMode === VNEXT_LEGACY_V1_FEE) {
    if (
      provider !== "uniswap-v3"
      || prepared.evidence.settlementMode !== VNEXT_LEGACY_V1_FEE
      || prepared.evidence.rmtFeeEnabled !== true
      || !prepared.evidence.netEconomics
      || prepared.evidence.netEconomics.rmtFee.state !== "planned"
      || !prepared.evidence.feeExecution
      || prepared.evidence.directNoRmtFee !== undefined
      || prepared.evidence.feeV2Economics !== undefined
      || prepared.feeV2Authorization !== undefined
    ) throw new Error("Uniswap V3 did not return complete V1 atomic fee authority.");
    assertRmtNetExecutionEconomics(prepared.evidence.netEconomics);
    assertRmtUniswapV3FeeExecution(prepared.evidence.feeExecution, prepared.evidence.netEconomics);
  } else if (settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE) {
    const capability = feeAdmission.capability ?? VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY[provider];
    if (provider !== "zero-x-swap" || capability.state !== "PROVIDER_NATIVE_INPUT_FEE") {
      throw new Error(`${adapter.providerLabel} does not have admitted provider-native fee settlement.`);
    }
    if (
      prepared.evidence.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE
      || prepared.evidence.rmtFeeEnabled !== true
      || prepared.evidence.directNoRmtFee !== undefined
      || prepared.evidence.feeExecution != null
      || prepared.evidence.feeV2Economics !== undefined
      || prepared.evidence.feeV2Settlement !== undefined
      || prepared.feeV2Authorization !== undefined
    ) throw new Error("0x did not return complete provider-native fee authority.");
    assertVNextZeroXProviderNativeFee(prepared.evidence.providerNativeFee);
    if ((prepared.transaction.gasPrice ?? null) !== prepared.evidence.providerNativeFee!.firmQuote?.gasPriceWei
      || (prepared.transaction.kind === "swap" && (prepared.evidence.exactSimulationPassed !== true || prepared.evidence.authorizationReady !== true))
    ) throw new Error("0x did not bind the exact simulated gas-price envelope.");
  } else {
    const capability = feeAdmission.capability ?? VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY[provider];
    if (capability.state !== "V2_ATOMIC_INPUT_FEE") {
      throw new Error(`${adapter.providerLabel} wallet authorization is quote-only until its V2 atomic fee settlement is admitted.`);
    }
    const policy = feeAdmission.policy === undefined ? configuredRmtExecutionFeeV2Policy() : feeAdmission.policy;
    if (!policy) throw new Error(`${adapter.providerLabel} wallet authorization requires the active RMT_EXECUTION_V2 policy.`);
    if (prepared.evidence.settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE) {
      throw new Error(`${adapter.providerLabel} did not return V2 atomic fee evidence.`);
    }
    assertVNextWalletFeeAdmission({
      provider,
      policy,
      economics: prepared.evidence.feeV2Economics,
      verification: prepared.evidence.feeV2Settlement,
      authorization: prepared.feeV2Authorization,
      capability
    });
  }
  if (
    prepared.evidence.deadline !== request.deadlineSeconds.toString()
    || BigInt(prepared.evidence.protectedOutputAtomic) < request.protectedOutputFloorAtomic
    || prepared.evidence.nextAction === null
    || prepared.evidence.nextActionTarget === null
    || prepared.evidence.nextActionCalldataHash === null
    || prepared.evidence.gasLimitUnits === null
    || (prepared.evidence.nextAction === "approval") !== (prepared.transaction.kind === "erc20_approval")
    || !isAddress(prepared.transaction.target)
    || getAddress(prepared.transaction.target) !== getAddress(prepared.evidence.nextActionTarget)
    || !/^0x(?:[0-9a-fA-F]{2})+$/.test(prepared.transaction.data)
    || keccak256(prepared.transaction.data).toLowerCase() !== prepared.evidence.nextActionCalldataHash.toLowerCase()
    || !/^(0|[1-9][0-9]*)$/.test(prepared.transaction.value)
    || prepared.transaction.value !== prepared.evidence.transactionValueAtomic
    || !/^[1-9][0-9]*$/.test(prepared.transaction.gasLimit)
    || prepared.transaction.gasLimit !== prepared.evidence.gasLimitUnits
  ) throw new Error(`RMT rejected an invalid ${adapter.providerLabel} wallet request.`);
  return prepared;
}
