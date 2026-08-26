import type { VNextLiquidityFeeEvidence } from "../vnext/quote-observation";
import { disabledVNextFeeEconomics, unavailableVNextQuoteAttempt, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import { prepareVNextUniswapV2Authorization, quoteVNextUniswapV2, verifyVNextUniswapV2 } from "./vnext-uniswap-v2-execution";

const QUOTE_TTL_MS = 20_000;

export const vNextUniswapV2Adapter: VNextQuoteProviderAdapter = {
  provider: "uniswap-v2",
  providerLabel: "Uniswap V2",
  providerFamily: "uniswap",
  adapterVersion: 1,
  executionKind: "direct_amm",
  capabilities: { strictVerification: true, walletAuthorization: true },
  async quote(request) {
    const startedAtMs = Date.now();
    try {
      const quote = await quoteVNextUniswapV2(request);
      const quotedAtMs = Date.now();
      const liquidityFeeEvidence: VNextLiquidityFeeEvidence[] = quote.pools.map((poolAddress) => ({
        source: "uniswap-v2-factory", poolAddress, fee: 30, denominator: 10_000,
        stable: null, tickSpacing: null, observedBlock: quote.quoteBlock, observedBlockHash: quote.quoteBlockHash
      }));
      return {
        provider: "uniswap-v2", providerLabel: "Uniswap V2", providerFamily: "uniswap", adapterVersion: 1,
        status: "indicative", chainId: request.chainId, inputAsset: request.inputAsset, outputAsset: request.outputAsset,
        inputAmountAtomic: request.inputAmountAtomic, expectedOutputAtomic: quote.expectedOutputAtomic,
        protectedOutputAtomic: quote.protectedOutputAtomic, outputDecimals: request.outputIdentity.decimals,
        priceImpact: null, liquidityFeeEvidence, quotedAtMs, expiresAtMs: quotedAtMs + QUOTE_TTL_MS,
        latencyMs: quotedAtMs - startedAtMs, executionKind: "direct_amm", strictVerificationAvailable: true,
        userPaysGas: true, providerFeeAsset: null, providerFeeAtomic: null, gasSponsorshipFeeAsset: null,
        gasSponsorshipFeeAtomic: null, explicitProviderFeeOutputAtomic: null,
        netEconomics: disabledVNextFeeEconomics({
          inputAmountAtomic: request.inputAmountAtomic,
          expectedOutputAtomic: quote.expectedOutputAtomic,
          protectedOutputAtomic: quote.protectedOutputAtomic
        }),
        networkFeeNativeAtomic: null, networkFeeNativeSymbol: "ETH", protectedNetOutputAtomic: null,
        costState: "network_fee_pending", authorizationReady: false,
        detail: `Live ${quote.route === "direct" ? "direct" : "WETH-hop"} Uniswap V2 quote with block-pinned canonical pair evidence.`
      };
    } catch {
      return unavailableVNextQuoteAttempt({
        adapter: vNextUniswapV2Adapter, request, status: "no_route",
        detail: "No complete canonical Uniswap V2 direct or WETH-hop route was found for this amount.", startedAtMs
      });
    }
  },
  verify: verifyVNextUniswapV2,
  prepareAuthorization: prepareVNextUniswapV2Authorization
};
