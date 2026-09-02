import type { VNextLiquidityFeeEvidence } from "../vnext/quote-observation";
import { disabledVNextFeeEconomics, unavailableVNextQuoteAttempt, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import { prepareVNextUniswapV2Authorization, quoteVNextUniswapV2, verifyVNextUniswapV2 } from "./vnext-uniswap-v2-execution";
import { VNEXT_DIRECT_NO_RMT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE } from "../vnext/execution-settlement";
import {
  evaluateVNextUniswapV2RouteV2,
  prepareVNextUniswapV2AuthorizationV2,
  quoteVNextUniswapV2ForUserV2,
  selectVNextUniswapV2SettlementMode,
  type VerifiedVNextUniswapV2FeeExecutorV2Config,
  type VNextUniswapV2V2AuthorityVerifier,
  type VNextUniswapV2V2CanonicalityVerifier,
  type VNextUniswapV2V2ExecutionClient
} from "./vnext-uniswap-v2-v2-execution";
import {
  requireVNextUniswapV2V2AuthorizationEnabled,
  requireVNextUniswapV2V2ReleaseRecipient
} from "./vnext-uniswap-v2-fee-executor-v2";

const QUOTE_TTL_MS = 20_000;

export function createVNextUniswapV2Adapter(input: {
  walletAuthorization?: boolean;
  v2Config?: VerifiedVNextUniswapV2FeeExecutorV2Config | null;
  v2QuoteProvider?: Parameters<typeof quoteVNextUniswapV2ForUserV2>[0]["quoteProvider"];
  v2ExecutionClient?: VNextUniswapV2V2ExecutionClient;
  v2AuthorityVerifier?: VNextUniswapV2V2AuthorityVerifier;
  v2CanonicalityVerifier?: VNextUniswapV2V2CanonicalityVerifier;
} = {}): VNextQuoteProviderAdapter {
  const walletAuthorization = input.walletAuthorization !== false;
  const adapter: VNextQuoteProviderAdapter = {
    provider: "uniswap-v2",
    providerLabel: "Uniswap V2",
    providerFamily: "uniswap",
    adapterVersion: 1,
    executionKind: "direct_amm",
    capabilities: { strictVerification: true, walletAuthorization },
    async quote(request) {
      const startedAtMs = Date.now();
      try {
        const settlementMode = selectVNextUniswapV2SettlementMode({
          recipient: request.recipient,
          v2Configured: input.v2Config !== undefined && input.v2Config !== null
        });
        if (settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE) {
          requireVNextUniswapV2V2AuthorizationEnabled();
          requireVNextUniswapV2V2ReleaseRecipient(request.recipient);
          const candidate = await quoteVNextUniswapV2ForUserV2({
            inputAsset: request.inputAsset,
            outputAsset: request.outputAsset,
            userGrossInput: request.amountIn,
            ...(input.v2Config !== undefined ? { config: input.v2Config } : {}),
            ...(input.v2QuoteProvider ? { quoteProvider: input.v2QuoteProvider } : {})
          });
          if (!candidate) throw new Error("The admitted Uniswap V2 V2 executor is unavailable.");
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
            settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE, executionTarget: candidate.config.executor,
            feeV2Economics: candidate.economics, networkFeeNativeAtomic: null, networkFeeNativeSymbol: "ETH",
            protectedNetOutputAtomic: null, costState: "network_fee_pending", authorizationReady: false,
            detail: "Uniswap V2 quote net of the disclosed 0.25% input-side RMT fee. Exact executor and infrastructure verification runs again before authorization."
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
          adapter, request, status: "no_route",
          detail: "No complete canonical Uniswap V2 direct or WETH-hop route was found for this amount.", startedAtMs
        });
      }
    },
    async verify(request) {
      const settlementMode = request.settlementMode ?? VNEXT_DIRECT_NO_RMT_FEE;
      if (settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE) {
        requireVNextUniswapV2V2AuthorizationEnabled();
        requireVNextUniswapV2V2ReleaseRecipient(request.recipient);
        if (!request.executionId) throw new Error("Uniswap V2 V2 verification requires an execution ID.");
        return (await evaluateVNextUniswapV2RouteV2({
          inputAsset: request.inputAsset, outputAsset: request.outputAsset, amountIn: request.amountIn,
          recipient: request.recipient, executionId: request.executionId,
          indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
          ...(input.v2Config !== undefined ? { config: input.v2Config } : {}),
          ...(input.v2QuoteProvider ? { quoteProvider: input.v2QuoteProvider } : {}),
          ...(input.v2ExecutionClient ? { executionClient: input.v2ExecutionClient } : {})
        })).evidence;
      }
      return verifyVNextUniswapV2(request);
    },
    async prepareAuthorization(request) {
      if (!walletAuthorization) throw new Error("Uniswap V2 wallet authorization is not available yet.");
      const settlementMode = request.settlementMode ?? VNEXT_DIRECT_NO_RMT_FEE;
      if (settlementMode === VNEXT_DIRECT_NO_RMT_FEE) return prepareVNextUniswapV2Authorization(request);
      requireVNextUniswapV2V2AuthorizationEnabled();
      requireVNextUniswapV2V2ReleaseRecipient(request.recipient);
      if (!request.executionId) throw new Error("Uniswap V2 V2 authorization requires an execution ID.");
      const prepared = await prepareVNextUniswapV2AuthorizationV2({
        inputAsset: request.inputAsset, outputAsset: request.outputAsset, amountIn: request.amountIn,
        recipient: request.recipient, executionId: request.executionId,
        indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic,
        protectedOutputFloorAtomic: request.protectedOutputFloorAtomic,
        deadlineSeconds: request.deadlineSeconds, nowMs: request.nowMs,
        ...(request.infrastructureVerifiedAtBlock ? { infrastructureVerifiedAtBlock: request.infrastructureVerifiedAtBlock } : {}),
        ...(request.infrastructureVerifiedAtBlockHash ? { infrastructureVerifiedAtBlockHash: request.infrastructureVerifiedAtBlockHash } : {}),
        ...(input.v2Config !== undefined ? { config: input.v2Config } : {}),
        ...(input.v2QuoteProvider ? { quoteProvider: input.v2QuoteProvider } : {}),
        ...(input.v2ExecutionClient ? { executionClient: input.v2ExecutionClient } : {}),
        ...(input.v2AuthorityVerifier ? { authorityVerifier: input.v2AuthorityVerifier } : {}),
        ...(input.v2CanonicalityVerifier ? { canonicalityVerifier: input.v2CanonicalityVerifier } : {})
      });
      return { evidence: prepared.evidence, feeV2Authorization: prepared.feeV2Authorization, transaction: prepared.transaction };
    }
  };
  return adapter;
}

export const vNextUniswapV2Adapter = createVNextUniswapV2Adapter({ walletAuthorization: true });
