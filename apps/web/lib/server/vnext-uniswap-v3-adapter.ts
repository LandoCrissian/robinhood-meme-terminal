import { prepareVNextUniswapAuthorization, quoteVNextUniswapDirect, verifyVNextUniswapRoute } from "./vnext-uniswap-quote";
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
      const quote = await quoteVNextUniswapDirect({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        amountIn: request.amountIn
      });
      if (!quote) return unavailableVNextQuoteAttempt({
        adapter: vNextUniswapV3Adapter,
        request,
        status: "no_route",
        detail: "No canonical direct or WETH-hop Uniswap v3 route returned a complete quote.",
        startedAtMs
      });
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
        inputAmountAtomic: quote.amountIn.toString(),
        expectedOutputAtomic: quote.quoteOut.toString(),
        protectedOutputAtomic: quote.minimumOut.toString(),
        outputDecimals: request.outputIdentity.decimals,
        priceImpact: null,
        quotedAtMs,
        expiresAtMs: quotedAtMs + 30_000,
        latencyMs: quotedAtMs - startedAtMs,
        executionKind: "direct_amm",
        strictVerificationAvailable: true,
        userPaysGas: true,
        explicitProviderFeeOutputAtomic: null,
        rmtFeeOutputAtomic: "0",
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
      recipient: request.recipient
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
      nowMs: request.nowMs
    });
    return { evidence: { ...prepared.evidence }, transaction: prepared.transaction };
  }
};
