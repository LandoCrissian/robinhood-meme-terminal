import type { VNextLiquidityFeeEvidence } from "../vnext/quote-observation";
import { disabledVNextFeeEconomics, unavailableVNextQuoteAttempt, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import { prepareVNextUniswapV2Authorization, quoteVNextUniswapV2, verifyVNextUniswapV2 } from "./vnext-uniswap-v2-execution";
import { quoteVNextUniswapV2FeeCandidate } from "./vnext-uniswap-v2-fee-candidate";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "../vnext/execution-settlement";

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
      const candidate = await quoteVNextUniswapV2FeeCandidate({
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        userGrossInput: request.amountIn,
        quoteProvider: ({ amountIn }) => quoteVNextUniswapV2({ ...request, amountIn })
      });
      if (candidate) {
        const quotedAtMs = Date.now();
        const liquidityFeeEvidence: VNextLiquidityFeeEvidence[] = candidate.quote.pools.map((poolAddress) => ({
          source: "uniswap-v2-factory", poolAddress, fee: 30, denominator: 10_000,
          stable: null, tickSpacing: null, observedBlock: candidate.quote.quoteBlock,
          observedBlockHash: candidate.quote.quoteBlockHash
        }));
        return {
          provider: "uniswap-v2", providerLabel: "Uniswap V2", providerFamily: "uniswap", adapterVersion: 1,
          status: "indicative", chainId: request.chainId, inputAsset: request.inputAsset, outputAsset: request.outputAsset,
          inputAmountAtomic: request.inputAmountAtomic,
          expectedOutputAtomic: candidate.economics.expectedUserNetOutputAtomic,
          protectedOutputAtomic: candidate.economics.protectedUserNetOutputAtomic,
          outputDecimals: request.outputIdentity.decimals, priceImpact: null, liquidityFeeEvidence,
          quotedAtMs, expiresAtMs: quotedAtMs + QUOTE_TTL_MS, latencyMs: quotedAtMs - startedAtMs,
          executionKind: "direct_amm", strictVerificationAvailable: true, userPaysGas: true,
          providerFeeAsset: null, providerFeeAtomic: null, gasSponsorshipFeeAsset: null,
          gasSponsorshipFeeAtomic: null, explicitProviderFeeOutputAtomic: null, netEconomics: null,
          settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE, feeV2Economics: candidate.economics,
          networkFeeNativeAtomic: null, networkFeeNativeSymbol: "ETH", protectedNetOutputAtomic: null,
          costState: "network_fee_pending", authorizationReady: false,
          detail: "Source-only Uniswap V2 executor candidate quoted with the disclosed 0.25% input-side fee. Wallet execution remains unavailable until deployment and separate admission."
        };
      }
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
