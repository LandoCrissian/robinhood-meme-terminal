import type { VNextLiquidityFeeEvidence } from "../vnext/quote-observation";
import { unavailableVNextQuoteAttempt, type VNextProviderQuoteRequest, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import { quoteUpCl, quoteUpV2, type UpObservedQuote } from "./vnext-up-quote";

const UP_QUOTE_TTL_MS = 20_000;

type UpQuoteDependencies = {
  quoteV2(request: VNextProviderQuoteRequest): Promise<UpObservedQuote | null>;
  quoteCl(request: VNextProviderQuoteRequest): Promise<UpObservedQuote | null>;
};

const liveDependencies: UpQuoteDependencies = {
  quoteV2: (request) => quoteUpV2(request),
  quoteCl: (request) => quoteUpCl(request)
};

function feeEvidence(provider: "up-v2" | "up-cl", quote: UpObservedQuote): VNextLiquidityFeeEvidence[] {
  return quote.legs.map((leg) => ({
    source: provider === "up-v2" ? "up-v2-factory" : "up-cl-pool",
    poolAddress: leg.pool,
    fee: leg.fee,
    denominator: provider === "up-v2" ? 10_000 : 1_000_000,
    stable: "stable" in leg ? leg.stable : null,
    tickSpacing: "tickSpacing" in leg ? leg.tickSpacing : null,
    observedBlock: quote.snapshot.blockNumber.toString(),
    observedBlockHash: quote.snapshot.blockHash
  }));
}

export function createVNextUpAdapters(dependencies: UpQuoteDependencies = liveDependencies) {
  const create = (provider: "up-v2" | "up-cl"): VNextQuoteProviderAdapter => {
    const label = provider === "up-v2" ? "up. v2" : "up. CL";
    const adapter: VNextQuoteProviderAdapter = {
      provider,
      providerLabel: label,
      providerFamily: "up",
      adapterVersion: 1,
      executionKind: "direct_amm",
      capabilities: { strictVerification: false, walletAuthorization: false },
      async quote(request) {
        const startedAtMs = Date.now();
        try {
          const result = provider === "up-v2"
            ? await dependencies.quoteV2(request)
            : await dependencies.quoteCl(request);
          if (!result) return unavailableVNextQuoteAttempt({
            adapter, request, status: "no_route",
            detail: `No complete ${label} direct or WETH-hop route was found for this amount.`,
            startedAtMs
          });
          const quotedAtMs = Date.now();
          return {
            provider,
            providerLabel: label,
            providerFamily: "up",
            adapterVersion: 1,
            status: "indicative",
            chainId: request.chainId,
            inputAsset: request.inputAsset,
            outputAsset: request.outputAsset,
            inputAmountAtomic: request.inputAmountAtomic,
            expectedOutputAtomic: result.amountOut.toString(),
            protectedOutputAtomic: result.protectedAmountOut.toString(),
            outputDecimals: request.outputIdentity.decimals,
            priceImpact: null,
            liquidityFeeEvidence: feeEvidence(provider, result),
            quotedAtMs,
            expiresAtMs: quotedAtMs + UP_QUOTE_TTL_MS,
            latencyMs: quotedAtMs - startedAtMs,
            executionKind: "direct_amm",
            strictVerificationAvailable: false,
            userPaysGas: true,
            providerFeeAsset: null,
            providerFeeAtomic: null,
            gasSponsorshipFeeAsset: null,
            gasSponsorshipFeeAtomic: null,
            explicitProviderFeeOutputAtomic: null,
            rmtFeeOutputAtomic: "0",
            networkFeeNativeAtomic: null,
            networkFeeNativeSymbol: "ETH",
            protectedNetOutputAtomic: null,
            costState: "network_fee_pending",
            authorizationReady: false,
            detail: `Live ${result.routeKind === "direct" ? "direct" : "WETH-hop"} ${label} quote with block-pinned fee evidence. Signing is not enabled.`
          };
        } catch {
          return unavailableVNextQuoteAttempt({
            adapter, request, status: "temporarily_unavailable",
            detail: `${label} observation is temporarily unavailable for this request.`,
            startedAtMs
          });
        }
      }
    };
    return adapter;
  };
  return { v2: create("up-v2"), cl: create("up-cl") } as const;
}

const liveAdapters = createVNextUpAdapters();
export const vNextUpV2Adapter = liveAdapters.v2;
export const vNextUpClAdapter = liveAdapters.cl;

export function configuredVNextUpAdapters() {
  const adapters: VNextQuoteProviderAdapter[] = [];
  if (process.env.RMT_VNEXT_UP_V2_OBSERVATION_ENABLED === "true") adapters.push(vNextUpV2Adapter);
  if (process.env.RMT_VNEXT_UP_CL_OBSERVATION_ENABLED === "true") adapters.push(vNextUpClAdapter);
  return adapters;
}
