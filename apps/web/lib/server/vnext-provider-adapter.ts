import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { assertVNextQuoteAttempt, type VNextQuoteAttempt, type VNextQuoteAttemptStatus, type VNextQuoteProvider } from "../vnext/quote-observation";

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
};

export type VNextProviderVerificationRequest = Pick<VNextProviderQuoteRequest,
  "chainId" | "inputAsset" | "outputAsset" | "inputAmountAtomic" | "amountIn" | "recipient"
> & { indicativeProtectedOutputFloorAtomic: bigint };

export type VNextProviderVerificationEvidence = Record<string, unknown> & {
  provider: VNextQuoteProvider;
  status: "verified" | "approval_required" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  chainId: 4_663;
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  indicativeProtectedOutputFloorAtomic: string;
  protectedOutputAtomic: string;
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
};

export type VNextProviderAuthorizationRequest = VNextProviderVerificationRequest & {
  deadlineSeconds: bigint;
  protectedOutputFloorAtomic: bigint;
  nowMs: number;
};

export type VNextPreparedProviderAuthorization = {
  evidence: VNextProviderVerificationEvidence;
  transaction: {
    kind: "erc20_approval" | "swap";
    target: Address;
    data: Hex;
    value: string;
    gasLimit: string;
  };
};

export type VNextQuoteProviderAdapter = {
  provider: VNextQuoteProvider;
  providerLabel: string;
  providerFamily: "sushi" | "uniswap" | "uniswapx" | "zeroex";
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
    rmtFeeOutputAtomic: null,
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
  if (adapters.length === 0 || adapters.length > 8 || new Set(adapters.map((adapter) => adapter.provider)).size !== adapters.length) {
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
  adapters: readonly VNextQuoteProviderAdapter[]
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
