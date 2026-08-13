import { prepareVNextUniswapAuthorization, quoteVNextUniswapForUser, verifyVNextUniswapRoute } from "./vnext-uniswap-quote";
import { unavailableVNextQuoteAttempt, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";

export const vNextUniswapV3Adapter: VNextQuoteProviderAdapter = {
  provider: "uniswap-v3",
  providerLabel: "Uniswap v3",
  providerFamily: "uniswap",
  adapterVersion: 1,
  executionKind: "direct_amm",
  capabilities: { strictVerification: true, walletAuthorization: true },
  async quote(request) {
    const startedAtMs = Date.now();
    try {
      const result = await quoteVNextUniswapForUser({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        userGrossInput: request.amountIn
      });
      if (!result) return unavailableVNextQuoteAttempt({
        adapter: vNextUniswapV3Adapter,
        request,
        status: "no_route",
        detail: "No canonical direct or WETH-hop Uniswap v3 route returned a complete quote.",
        startedAtMs
      });
      const { quote, netEconomics } = result;
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
        expectedOutputAtomic: netEconomics.expectedUserNetOutputAtomic,
        protectedOutputAtomic: netEconomics.protectedUserNetOutputAtomic,
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
        netEconomics,
        networkFeeNativeAtomic: null,
        networkFeeNativeSymbol: "ETH",
        protectedNetOutputAtomic: null,
        costState: "network_fee_pending",
        authorizationReady: false,
        detail: "Live direct-pool quote. Price impact and executable verification have not run."
      };
    } catch {
      return unavailableVNextQuoteAttempt({
        adapter: vNextUniswapV3Adapter,
        request,
        status: "temporarily_unavailable",
        detail: "Uniswap direct quoting is temporarily unavailable for this request.",
        startedAtMs
      });
    }
  },
  async verify(request) {
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
