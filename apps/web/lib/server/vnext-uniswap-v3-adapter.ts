import { prepareVNextUniswapAuthorization, quoteVNextUniswapForUser, verifyVNextUniswapRoute } from "./vnext-uniswap-quote";
import { unavailableVNextQuoteAttempt, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import {
  evaluateVNextUniswapRouteV2,
  prepareVNextUniswapAuthorizationV2,
  quoteVNextUniswapForUserV2,
  type VerifiedVNextUniswapFeeExecutorV2Config
} from "./vnext-uniswap-v3-v2-execution";

export function createVNextUniswapV3Adapter(input: {
  walletAuthorization?: boolean;
  v2Config?: VerifiedVNextUniswapFeeExecutorV2Config | null;
} = {}): VNextQuoteProviderAdapter {
  const walletAuthorization = input.walletAuthorization === true;
  const adapter: VNextQuoteProviderAdapter = {
  provider: "uniswap-v3",
  providerLabel: "Uniswap v3",
  providerFamily: "uniswap",
  adapterVersion: 1,
  executionKind: "direct_amm",
  capabilities: { strictVerification: true, walletAuthorization },
  async quote(request) {
    const startedAtMs = Date.now();
    try {
      const v2Result = await quoteVNextUniswapForUserV2({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        userGrossInput: request.amountIn,
        ...(input.v2Config !== undefined ? { config: input.v2Config } : {})
      });
      const result = v2Result ?? await quoteVNextUniswapForUser({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        userGrossInput: request.amountIn,
        recipient: request.recipient
      });
      if (!result) return unavailableVNextQuoteAttempt({
        adapter,
        request,
        status: "no_route",
        detail: "No canonical direct or WETH-hop Uniswap v3 route returned a complete quote.",
        startedAtMs
      });
      const { quote } = result;
      const expectedOutputAtomic = "economics" in result
        ? result.economics.expectedUserNetOutputAtomic
        : result.netEconomics.expectedUserNetOutputAtomic;
      const protectedOutputAtomic = "economics" in result
        ? result.economics.protectedUserNetOutputAtomic
        : result.netEconomics.protectedUserNetOutputAtomic;
      const quotedAtMs = Date.now();
      return {
        provider: "uniswap-v3",
        providerLabel: "Uniswap v3",
        providerFamily: "uniswap",
        adapterVersion: 1,
        status: "indicative",
        chainId: request.chainId,
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        inputAmountAtomic: request.inputAmountAtomic,
        expectedOutputAtomic,
        protectedOutputAtomic,
        outputDecimals: request.outputIdentity.decimals,
        priceImpact: null,
        liquidityFeeEvidence: [],
        quotedAtMs,
        expiresAtMs: quotedAtMs + 30_000,
        latencyMs: quotedAtMs - startedAtMs,
        executionKind: "direct_amm",
        strictVerificationAvailable: true,
        userPaysGas: true,
        providerFeeAsset: null,
        providerFeeAtomic: null,
        gasSponsorshipFeeAsset: null,
        gasSponsorshipFeeAtomic: null,
        explicitProviderFeeOutputAtomic: null,
        netEconomics: "netEconomics" in result ? result.netEconomics : null,
        ...(v2Result ? { feeV2Economics: v2Result.economics } : {}),
        networkFeeNativeAtomic: null,
        networkFeeNativeSymbol: "ETH",
        protectedNetOutputAtomic: null,
        costState: "network_fee_pending",
        authorizationReady: false,
        detail: "economics" in result
          ? "Live Uniswap V3 quote using provider input after the exact RMT_EXECUTION_V2 fee."
          : "Live direct-pool quote. Price impact and executable verification have not run."
      };
    } catch {
      return unavailableVNextQuoteAttempt({
        adapter,
        request,
        status: "temporarily_unavailable",
        detail: "Uniswap direct quoting is temporarily unavailable for this request.",
        startedAtMs
      });
    }
  },
  async verify(request) {
    if (walletAuthorization) {
      if (!request.executionId) throw new Error("Uniswap V3 V2 verification requires an execution ID.");
      return (await evaluateVNextUniswapRouteV2({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        amountIn: request.amountIn,
        recipient: request.recipient,
        executionId: request.executionId,
        indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
        ...(input.v2Config !== undefined ? { config: input.v2Config } : {})
      })).evidence;
    }
    return { ...await verifyVNextUniswapRoute({
      inputAsset: request.inputAsset,
      outputAsset: request.outputAsset,
      amountIn: request.amountIn,
      recipient: request.recipient,
      protectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
      indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
      executionId: request.executionId
    }) };
  },
  async prepareAuthorization(request) {
    if (walletAuthorization) {
      if (!request.executionId) throw new Error("Uniswap V3 V2 authorization requires an execution ID.");
      const prepared = await prepareVNextUniswapAuthorizationV2({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        amountIn: request.amountIn,
        recipient: request.recipient,
        executionId: request.executionId,
        deadlineSeconds: request.deadlineSeconds,
        protectedOutputFloorAtomic: request.protectedOutputFloorAtomic,
        indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
        nowMs: request.nowMs,
        ...(input.v2Config !== undefined ? { config: input.v2Config } : {})
      });
      return {
        evidence: prepared.evidence,
        feeV2Authorization: prepared.feeV2Authorization,
        transaction: prepared.transaction
      };
    }
    const prepared = await prepareVNextUniswapAuthorization({
      inputAsset: request.inputAsset,
      outputAsset: request.outputAsset,
      amountIn: request.amountIn,
      recipient: request.recipient,
      deadlineSeconds: request.deadlineSeconds,
      protectedOutputFloorAtomic: request.protectedOutputFloorAtomic,
      indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
      nowMs: request.nowMs,
      executionId: request.executionId
    });
    return { evidence: { ...prepared.evidence }, transaction: prepared.transaction };
  }
  };
  return adapter;
}

// Production remains quote-only until a reviewed V2 deployment and policy are
// explicitly admitted. Tests inject the same adapter with wallet authority on.
export const vNextUniswapV3Adapter = createVNextUniswapV3Adapter();
