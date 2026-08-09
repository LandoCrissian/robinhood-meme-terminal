import { getAddress, isAddress } from "viem";
import { unavailableVNextQuoteAttempt, type VNextProviderQuoteRequest, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";

const ZERO_X_API_URL = "https://api.0x.org";
const ZERO_X_TIMEOUT_MS = 4_000;
const ZERO_X_QUOTE_TTL_MS = 10_000;

type JsonObject = Record<string, unknown>;
type ZeroXMode = "swap" | "gasless";

class ZeroXInvalidResponseError extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atomic(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
}

function optionalFee(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || typeof value.token !== "string" || !isAddress(value.token) || !atomic(value.amount)) throw new ZeroXInvalidResponseError("0x returned an invalid fee.");
  return { asset: getAddress(value.token), amountAtomic: value.amount as string };
}

function parseZeroXPrice(body: unknown, request: VNextProviderQuoteRequest, mode: ZeroXMode) {
  if (!isObject(body) || typeof body.liquidityAvailable !== "boolean") throw new ZeroXInvalidResponseError("0x returned an invalid price response.");
  if (!body.liquidityAvailable) return null;
  const expectedOutputAtomic = atomic(body.buyAmount);
  const protectedOutputAtomic = atomic(body.minBuyAmount);
  if (
    typeof body.sellToken !== "string" || !isAddress(body.sellToken) || getAddress(body.sellToken) !== request.inputAsset
    || typeof body.buyToken !== "string" || !isAddress(body.buyToken) || getAddress(body.buyToken) !== request.outputAsset
    || body.sellAmount !== request.inputAmountAtomic
    || !expectedOutputAtomic || !protectedOutputAtomic
    || BigInt(protectedOutputAtomic) > BigInt(expectedOutputAtomic)
  ) throw new ZeroXInvalidResponseError("0x changed the requested trade economics.");

  const fees = isObject(body.fees) ? body.fees : null;
  if (!fees) throw new ZeroXInvalidResponseError("0x omitted fee disclosure.");
  const providerFee = optionalFee(fees.zeroExFee);
  const gasSponsorshipFee = optionalFee(fees.gasFee);
  const networkFeeNativeAtomic = mode === "swap" ? atomic(body.totalNetworkFee) : null;
  if (mode === "swap" && !networkFeeNativeAtomic) throw new ZeroXInvalidResponseError("0x omitted the direct-swap network fee estimate.");
  if (mode === "gasless" && !gasSponsorshipFee) throw new ZeroXInvalidResponseError("0x omitted the gasless sponsorship fee.");

  return {
    expectedOutputAtomic,
    protectedOutputAtomic,
    providerFee,
    gasSponsorshipFee,
    networkFeeNativeAtomic
  };
}

async function quoteZeroX(request: VNextProviderQuoteRequest, mode: ZeroXMode) {
  const apiKey = process.env.RMT_ZEROX_API_KEY?.trim();
  if (!apiKey) throw new Error("0x server credential is not configured.");
  const url = new URL(mode === "gasless" ? "/gasless/price" : "/swap/allowance-holder/price", ZERO_X_API_URL);
  url.search = new URLSearchParams({
    chainId: String(request.chainId),
    sellToken: request.inputAsset,
    buyToken: request.outputAsset,
    sellAmount: request.inputAmountAtomic,
    taker: request.recipient
  }).toString();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "0x-api-key": apiKey, "0x-version": "v2" },
    cache: "no-store",
    signal: AbortSignal.timeout(ZERO_X_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 400 && isObject(body) && body.name === "NO_LIQUIDITY_AVAILABLE") return null;
    throw new Error(`0x price request failed with ${response.status}.`);
  }
  return parseZeroXPrice(body, request, mode);
}

function createZeroXAdapter(mode: ZeroXMode): VNextQuoteProviderAdapter {
  const gasless = mode === "gasless";
  const adapter: VNextQuoteProviderAdapter = {
    provider: gasless ? "zero-x-gasless" : "zero-x-swap",
    providerLabel: gasless ? "0x Gasless" : "0x Swap",
    providerFamily: "zeroex",
    adapterVersion: 1,
    executionKind: gasless ? "gasless" : "aggregator",
    capabilities: { strictVerification: false, walletAuthorization: false },
    async quote(request) {
      const startedAtMs = Date.now();
      try {
        const price = await quoteZeroX(request, mode);
        if (!price) return unavailableVNextQuoteAttempt({
          adapter,
          request,
          status: "no_route",
          detail: `No complete ${adapter.providerLabel} route was found for this amount.`,
          startedAtMs
        });
        const quotedAtMs = Date.now();
        return {
          provider: adapter.provider,
          providerLabel: adapter.providerLabel,
          providerFamily: adapter.providerFamily,
          adapterVersion: 1,
          status: "indicative",
          chainId: request.chainId,
          inputAsset: request.inputAsset,
          outputAsset: request.outputAsset,
          inputAmountAtomic: request.inputAmountAtomic,
          expectedOutputAtomic: price.expectedOutputAtomic,
          protectedOutputAtomic: price.protectedOutputAtomic,
          outputDecimals: request.outputIdentity.decimals,
          priceImpact: null,
          quotedAtMs,
          expiresAtMs: quotedAtMs + ZERO_X_QUOTE_TTL_MS,
          latencyMs: quotedAtMs - startedAtMs,
          executionKind: adapter.executionKind,
          strictVerificationAvailable: false,
          userPaysGas: !gasless,
          providerFeeAsset: price.providerFee?.asset ?? null,
          providerFeeAtomic: price.providerFee?.amountAtomic ?? null,
          gasSponsorshipFeeAsset: price.gasSponsorshipFee?.asset ?? null,
          gasSponsorshipFeeAtomic: price.gasSponsorshipFee?.amountAtomic ?? null,
          explicitProviderFeeOutputAtomic: price.providerFee?.asset === request.outputAsset ? price.providerFee.amountAtomic : null,
          rmtFeeOutputAtomic: "0",
          networkFeeNativeAtomic: price.networkFeeNativeAtomic,
          networkFeeNativeSymbol: gasless ? null : "ETH",
          protectedNetOutputAtomic: gasless ? price.protectedOutputAtomic : null,
          costState: gasless ? null : "network_fee_pending",
          authorizationReady: false,
          detail: gasless
            ? "Live indicative 0x Gasless price with provider and gas-sponsorship fees reflected in protected output."
            : "Live indicative 0x aggregated price. Exact wallet gas and executable verification have not run."
        };
      } catch (cause) {
        const invalidResponse = cause instanceof ZeroXInvalidResponseError;
        return unavailableVNextQuoteAttempt({
          adapter,
          request,
          status: invalidResponse ? "invalid_response" : "temporarily_unavailable",
          detail: invalidResponse
            ? `RMT rejected an inconsistent ${adapter.providerLabel} response.`
            : `${adapter.providerLabel} is temporarily unavailable for this request.`,
          startedAtMs
        });
      }
    }
  };
  return adapter;
}

export const vNextZeroXSwapAdapter = createZeroXAdapter("swap");
export const vNextZeroXGaslessAdapter = createZeroXAdapter("gasless");

export function configuredVNextZeroXAdapters() {
  return process.env.RMT_VNEXT_ZEROX_OBSERVATION_ENABLED === "true" && Boolean(process.env.RMT_ZEROX_API_KEY?.trim())
    ? [vNextZeroXSwapAdapter, vNextZeroXGaslessAdapter] as const
    : [] as const;
}
