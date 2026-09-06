import {
  prepareVNextUniswapAuthorization,
  quoteVNextUniswapForUser,
  selectVNextUniswapV3SettlementMode,
  verifyVNextUniswapRoute
} from "./vnext-uniswap-quote";
import { VNEXT_DIRECT_NO_RMT_FEE, VNEXT_LEGACY_V1_FEE, VNEXT_PROVIDER_NATIVE_INPUT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE } from "../vnext/execution-settlement";
import { unavailableVNextQuoteAttempt, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import {
  evaluateVNextUniswapRouteV2,
  prepareVNextUniswapAuthorizationV2,
  quoteVNextUniswapForUserV2,
  type VerifiedVNextUniswapFeeExecutorV2Config
} from "./vnext-uniswap-v3-v2-execution";
import {
  requireVNextUniswapV3V2AuthorizationEnabled,
  requireVNextUniswapV3V2ReleaseRecipient
} from "./vnext-uniswap-fee-executor-v2";

export function createVNextUniswapV3Adapter(input: {
  walletAuthorization?: boolean;
  v2Config?: VerifiedVNextUniswapFeeExecutorV2Config | null;
  v2QuoteProvider?: Parameters<typeof quoteVNextUniswapForUserV2>[0]["quoteProvider"];
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
      const settlementMode = selectVNextUniswapV3SettlementMode({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        recipient: request.recipient,
        v2Configured: input.v2Config !== undefined && input.v2Config !== null
      });
      if (settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE) {
        requireVNextUniswapV3V2AuthorizationEnabled();
        const result = await quoteVNextUniswapForUserV2({
          inputAsset: request.inputAsset,
          outputAsset: request.outputAsset,
          userGrossInput: request.amountIn,
          ...(input.v2Config !== undefined ? { config: input.v2Config } : {}),
          ...(input.v2QuoteProvider ? { quoteProvider: input.v2QuoteProvider } : {})
        });
        if (!result) return unavailableVNextQuoteAttempt({
          adapter,
          request,
          status: "no_route",
          detail: "No canonical direct or WETH-hop Uniswap v3 V2 route returned a complete quote.",
          startedAtMs
        });
        const quotedAtMs = Date.now();
        return {
          provider: "uniswap-v3", providerLabel: "Uniswap v3", providerFamily: "uniswap", adapterVersion: 1,
          status: "indicative", chainId: request.chainId, inputAsset: request.inputAsset, outputAsset: request.outputAsset,
          inputAmountAtomic: request.inputAmountAtomic,
          expectedOutputAtomic: result.economics.expectedUserNetOutputAtomic,
          protectedOutputAtomic: result.economics.protectedUserNetOutputAtomic,
          outputDecimals: request.outputIdentity.decimals, priceImpact: null, liquidityFeeEvidence: [],
          quotedAtMs, expiresAtMs: quotedAtMs + 30_000, latencyMs: quotedAtMs - startedAtMs,
          executionKind: "direct_amm", strictVerificationAvailable: true, userPaysGas: true,
          providerFeeAsset: null, providerFeeAtomic: null, gasSponsorshipFeeAsset: null,
          gasSponsorshipFeeAtomic: null, explicitProviderFeeOutputAtomic: null, netEconomics: null,
          settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE, executionTarget: result.config.executor,
          feeV2Economics: result.economics, networkFeeNativeAtomic: null, networkFeeNativeSymbol: "ETH",
          protectedNetOutputAtomic: null, costState: "network_fee_pending", authorizationReady: false,
          detail: "Live Uniswap V3 quote net of the disclosed 0.25% input-side RMT execution fee. Exact executor verification runs again before authorization."
        };
      }
      const result = await quoteVNextUniswapForUser({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        userGrossInput: request.amountIn,
        recipient: request.recipient,
        settlementMode
      });
      if (!result) return unavailableVNextQuoteAttempt({
        adapter,
        request,
        status: "no_route",
        detail: "No canonical direct or WETH-hop Uniswap v3 route returned a complete quote.",
        startedAtMs
      });
      const { quote } = result;
      const expectedOutputAtomic = result.netEconomics.expectedUserNetOutputAtomic;
      const protectedOutputAtomic = result.netEconomics.protectedUserNetOutputAtomic;
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
        netEconomics: result.netEconomics,
        ...(result.netEconomics.rmtFee.state === "planned" ? {
          settlementMode: VNEXT_LEGACY_V1_FEE,
          executionTarget: result.feeContext!.verified.executor
        } : {}),
        networkFeeNativeAtomic: null,
        networkFeeNativeSymbol: "ETH",
        protectedNetOutputAtomic: null,
        costState: "network_fee_pending",
        authorizationReady: false,
        detail: result.netEconomics.rmtFee.state === "planned"
          ? "Live Uniswap V3 quote net of the disclosed 0.25% RMT execution fee. Exact executor verification has not run."
          : "Live Uniswap V3 route with no RMT platform fee. Price impact and executable verification have not run."
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
    const settlementMode = request.settlementMode ?? VNEXT_DIRECT_NO_RMT_FEE;
    if (settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE) {
      throw new Error("Uniswap V3 does not support provider-native fee settlement.");
    }
    if (settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE) {
      requireVNextUniswapV3V2AuthorizationEnabled();
      requireVNextUniswapV3V2ReleaseRecipient(request.recipient);
      if (!request.executionId) throw new Error("Uniswap V3 V2 verification requires an execution ID.");
      return (await evaluateVNextUniswapRouteV2({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        amountIn: request.amountIn,
        recipient: request.recipient,
        executionId: request.executionId,
        indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
        ...(input.v2Config !== undefined ? { config: input.v2Config } : {}),
        ...(input.v2QuoteProvider ? { quoteProvider: input.v2QuoteProvider } : {})
      })).evidence;
    }
    return { ...await verifyVNextUniswapRoute({
      inputAsset: request.inputAsset,
      outputAsset: request.outputAsset,
      amountIn: request.amountIn,
      recipient: request.recipient,
      protectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
      indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
      executionId: request.executionId,
      settlementMode
    }) };
  },
  async prepareAuthorization(request) {
    if (!walletAuthorization) {
      throw new Error("Uniswap V3 wallet authorization is not available yet.");
    }
    const settlementMode = request.settlementMode ?? VNEXT_DIRECT_NO_RMT_FEE;
    if (settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE) {
      throw new Error("Uniswap V3 does not support provider-native fee settlement.");
    }
    const common = {
      inputAsset: request.inputAsset,
      outputAsset: request.outputAsset,
      amountIn: request.amountIn,
      recipient: request.recipient,
      deadlineSeconds: request.deadlineSeconds,
      protectedOutputFloorAtomic: request.protectedOutputFloorAtomic,
      indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
      nowMs: request.nowMs
    };
    if (settlementMode === VNEXT_DIRECT_NO_RMT_FEE) {
      return prepareVNextUniswapAuthorization({ ...common, executionId: request.executionId });
    }
    if (settlementMode === VNEXT_LEGACY_V1_FEE) {
      if (!request.executionId) throw new Error("Uniswap V3 V1 authorization requires an execution ID.");
      return prepareVNextUniswapAuthorization({ ...common, executionId: request.executionId, settlementMode });
    }
    if (!request.executionId) throw new Error("Uniswap V3 V2 authorization requires an execution ID.");
    requireVNextUniswapV3V2AuthorizationEnabled();
    requireVNextUniswapV3V2ReleaseRecipient(request.recipient);
    const prepared = await prepareVNextUniswapAuthorizationV2({
      ...common,
      executionId: request.executionId,
      ...(input.v2Config !== undefined ? { config: input.v2Config } : {}),
      ...(input.v2QuoteProvider ? { quoteProvider: input.v2QuoteProvider } : {})
    });
    return {
      evidence: prepared.evidence,
      feeV2Authorization: prepared.feeV2Authorization,
      transaction: prepared.transaction
    };
  }
  };
  return adapter;
}

// Provider execution is admitted; the global VNext authorization boundary still
// controls whether an interactive wallet plan can be issued.
export const vNextUniswapV3Adapter = createVNextUniswapV3Adapter({ walletAuthorization: true });
