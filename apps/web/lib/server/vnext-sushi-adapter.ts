import { quoteSushiAssetRoute } from "./sushi-trade";
import { SUSHI_NATIVE_TOKEN } from "../sushi";
import { isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import { disabledVNextFeeEconomics, unavailableVNextQuoteAttempt, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";

export const vNextSushiAdapter: VNextQuoteProviderAdapter = {
  provider: "sushi",
  providerLabel: "Sushi",
  providerFamily: "sushi",
  adapterVersion: 1,
  executionKind: "aggregator",
  capabilities: { strictVerification: false, walletAuthorization: false },
  async quote(request) {
    const startedAtMs = Date.now();
    try {
      const quote = await quoteSushiAssetRoute({
        inputAsset: isRobinhoodNativeAsset(request.inputAsset) ? SUSHI_NATIVE_TOKEN : request.inputAsset,
        outputAsset: request.outputAsset,
        amountIn: request.amountIn
      }, { chainId: request.chainId, requireTokenMetadata: true });
      if (
        quote.inputToken?.decimals !== request.inputIdentity.decimals
        || quote.outputToken?.decimals !== request.outputIdentity.decimals
        || quote.inputToken.symbol !== request.inputIdentity.symbol
        || quote.outputToken.symbol !== request.outputIdentity.symbol
      ) throw new Error("Sushi returned token metadata that does not match verified onchain identity.");
      const quotedAtMs = Date.now();
      return {
        provider: "sushi",
        providerLabel: "Sushi",
        providerFamily: "sushi",
        adapterVersion: 1,
        status: "indicative",
        chainId: request.chainId,
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        inputAmountAtomic: quote.amountIn,
        expectedOutputAtomic: quote.quoteOut,
        protectedOutputAtomic: quote.minimumOut,
        outputDecimals: request.outputIdentity.decimals,
        priceImpact: quote.priceImpact,
        liquidityFeeEvidence: [],
        quotedAtMs,
        expiresAtMs: quotedAtMs + 30_000,
        latencyMs: quotedAtMs - startedAtMs,
        executionKind: "aggregator",
        strictVerificationAvailable: false,
        userPaysGas: true,
        providerFeeAsset: null,
        providerFeeAtomic: null,
        gasSponsorshipFeeAsset: null,
        gasSponsorshipFeeAtomic: null,
        explicitProviderFeeOutputAtomic: null,
        netEconomics: disabledVNextFeeEconomics({
          inputAmountAtomic: quote.amountIn,
          expectedOutputAtomic: quote.quoteOut,
          protectedOutputAtomic: quote.minimumOut
        }),
        networkFeeNativeAtomic: null,
        networkFeeNativeSymbol: "ETH",
        protectedNetOutputAtomic: null,
        costState: "network_fee_pending",
        authorizationReady: false,
        detail: "Live indicative Sushi route. Exact executable verification has not run."
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sushi quote request failed.";
      const invalid = /invalid|different|incomplete/i.test(message);
      const noRoute = /does not have a route|cannot fill/i.test(message);
      return unavailableVNextQuoteAttempt({
        adapter: vNextSushiAdapter,
        request,
        status: invalid ? "invalid_response" : noRoute ? "no_route" : "temporarily_unavailable",
        detail: invalid ? "RMT rejected an inconsistent Sushi response." : noRoute ? "No complete Sushi route was found for this amount." : "Sushi is temporarily unavailable for this request.",
        startedAtMs
      });
    }
  }
};
