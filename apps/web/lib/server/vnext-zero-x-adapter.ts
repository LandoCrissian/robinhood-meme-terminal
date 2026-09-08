import { RMT_ZERO_X_PROVIDER_REQUEST_SLIPPAGE_PPM } from "../vnext/zero-x-settlement";
import { getAddress, isAddress, type Address } from "viem";
import { disabledVNextFeeEconomics, unavailableVNextQuoteAttempt, type VNextProviderQuoteRequest, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import { prepareZeroXSwapAuthorization, verifyZeroXSwapFirmQuote } from "./vnext-zero-x-firm-quote-verifier";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../vnext/execution-settlement";
import { ZeroXInvalidResponseError, safeZeroXPriceEconomics, type ZeroXPriceDiagnostic } from "./vnext-zero-x-response-diagnostics";
export { ZeroXInvalidResponseError } from "./vnext-zero-x-response-diagnostics";
import {
  createVNextZeroXProviderNativeFee,
  fromZeroXToken,
  RMT_ZERO_X_FEE_BPS,
  RMT_ZERO_X_FEE_TREASURY,
  toZeroXToken,
  zeroXIntegratorFeeAmount
} from "../vnext/zero-x-settlement";

const ZERO_X_API_URL = "https://api.0x.org";
const ZERO_X_TIMEOUT_MS = 4_000;
const ZERO_X_QUOTE_TTL_MS = 10_000;

type JsonObject = Record<string, unknown>;
type ZeroXMode = "swap" | "gasless";

function responseToken(value: string, gasless = false): Address {
  try {
    if (gasless) {
      if (!isAddress(value)) throw new Error();
      return getAddress(value);
    }
    return fromZeroXToken(value);
  } catch {
    throw new ZeroXInvalidResponseError("0x returned an invalid token or zeroAddress instead of its native sentinel.", "INVALID_TOKEN_BINDING");
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveAtomic(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
}

function parseFee(value: unknown, requestedInput: Address, requestedOutput: Address, gasless = false) {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || typeof value.token !== "string" || !isAddress(value.token, { strict: false }) || !positiveAtomic(value.amount)) {
    throw new ZeroXInvalidResponseError("0x returned an invalid fee.", "INVALID_PROVIDER_FEE");
  }
  if (gasless) {
    if (!isAddress(value.token)) throw new ZeroXInvalidResponseError("0x returned an invalid fee.", "INVALID_PROVIDER_FEE");
    return { asset: getAddress(value.token), amountAtomic: value.amount as string };
  }
  const asset = responseToken(value.token);
  if (asset !== requestedInput && asset !== requestedOutput) throw new ZeroXInvalidResponseError("0x returned a fee in an unrelated token.", "INVALID_PROVIDER_FEE");
  return { asset, amountAtomic: value.amount as string };
}

export function parseZeroXIntegratorFee(fees: JsonObject, request: Pick<VNextProviderQuoteRequest, "inputAsset" | "inputAmountAtomic">) {
  const singularEntries = fees.integratorFee == null ? [] : [fees.integratorFee];
  const pluralEntries = fees.integratorFees == null ? [] : Array.isArray(fees.integratorFees) ? fees.integratorFees : [fees.integratorFees];
  if (pluralEntries.length > 1) throw new ZeroXInvalidResponseError("0x returned duplicate integrator fees.", "DUPLICATE_INTEGRATOR_FEE");
  const parse = (value: unknown) => {
    if (!isObject(value) || typeof value.token !== "string" || !isAddress(value.token, { strict: false }) || !positiveAtomic(value.amount)) {
      throw new ZeroXInvalidResponseError("0x returned an invalid integrator fee.", "INVALID_INTEGRATOR_FEE");
    }
    if (value.type !== undefined && value.type !== "volume") throw new ZeroXInvalidResponseError("0x returned an invalid integrator fee type.", "INVALID_INTEGRATOR_FEE_TYPE");
    const token = responseToken(value.token);
    if (token !== request.inputAsset) throw new ZeroXInvalidResponseError("0x returned the integrator fee in the wrong token.", "WRONG_INTEGRATOR_FEE_TOKEN");
    const expected = zeroXIntegratorFeeAmount(request.inputAmountAtomic);
    if (value.amount !== expected || expected === "0") throw new ZeroXInvalidResponseError("0x returned the wrong integrator fee amount.", "WRONG_INTEGRATOR_FEE_AMOUNT");
    return { token, amountAtomic: value.amount as string, type: value.type ?? null };
  };
  const singularFee = singularEntries.map(parse)[0] ?? null;
  const pluralFee = pluralEntries.map(parse)[0] ?? null;
  if (!singularFee && !pluralFee) throw new ZeroXInvalidResponseError("0x omitted the RMT integrator fee.", "MISSING_INTEGRATOR_FEE");
  if (singularFee && pluralFee && (singularFee.token !== pluralFee.token || singularFee.amountAtomic !== pluralFee.amountAtomic || singularFee.type !== pluralFee.type)) {
    throw new ZeroXInvalidResponseError("0x returned duplicate integrator fees.", "DUPLICATE_INTEGRATOR_FEE");
  }
  return singularFee ?? pluralFee!;
}

export function parseZeroXPrice(body: unknown, request: VNextProviderQuoteRequest, mode: ZeroXMode) {
  if (!isObject(body) || typeof body.liquidityAvailable !== "boolean") throw new ZeroXInvalidResponseError("0x returned an invalid price response.");
  if (!body.liquidityAvailable) return null;
  const expectedOutputAtomic = positiveAtomic(body.buyAmount);
  const protectedOutputAtomic = positiveAtomic(body.minBuyAmount);
  const normalize = (token: string) => responseToken(token, mode === "gasless");
  if (
    typeof body.sellToken !== "string" || normalize(body.sellToken) !== request.inputAsset
    || typeof body.buyToken !== "string" || normalize(body.buyToken) !== request.outputAsset
  ) throw new ZeroXInvalidResponseError("0x changed the requested trade economics.", "INVALID_TOKEN_BINDING");
  if (body.sellAmount !== request.inputAmountAtomic) throw new ZeroXInvalidResponseError("0x changed the requested trade economics.", "CHANGED_SELL_AMOUNT");
  if (!expectedOutputAtomic) throw new ZeroXInvalidResponseError("0x changed the requested trade economics.", "INVALID_EXPECTED_OUTPUT");
  if (!protectedOutputAtomic || BigInt(protectedOutputAtomic) > BigInt(expectedOutputAtomic)) throw new ZeroXInvalidResponseError("0x changed the requested trade economics.", "INVALID_MINIMUM_OUTPUT");
  const fees = isObject(body.fees) ? body.fees : null;
  if (!fees) throw new ZeroXInvalidResponseError("0x omitted fee disclosure.", "MISSING_FEE_DISCLOSURE");
  const providerFee = parseFee(fees.zeroExFee, request.inputAsset, request.outputAsset, mode === "gasless");
  const gasSponsorshipFee = parseFee(fees.gasFee, request.inputAsset, request.outputAsset, mode === "gasless");
  const integratorFee = mode === "swap" ? parseZeroXIntegratorFee(fees, request) : null;
  const networkFeeNativeAtomic = mode === "swap" ? positiveAtomic(body.totalNetworkFee) : null;
  if (mode === "swap" && !networkFeeNativeAtomic) throw new ZeroXInvalidResponseError("0x omitted or contradicted direct-swap network fees.", "MISSING_NETWORK_FEE");
  if (mode === "swap" && gasSponsorshipFee) throw new ZeroXInvalidResponseError("0x omitted or contradicted direct-swap network fees.", "CONTRADICTORY_NETWORK_FEE");
  if (mode === "gasless" && !gasSponsorshipFee) throw new ZeroXInvalidResponseError("0x omitted the gasless sponsorship fee.");
  return { expectedOutputAtomic, protectedOutputAtomic, providerFee, gasSponsorshipFee, integratorFee, networkFeeNativeAtomic };
}

async function quoteZeroX(request: VNextProviderQuoteRequest, mode: ZeroXMode, observe?: (value: ZeroXPriceDiagnostic) => void) {
  const apiKey = process.env.RMT_ZEROX_API_KEY?.trim();
  if (!apiKey) throw new Error("0x server credential is not configured.");
  const url = new URL(mode === "gasless" ? "/gasless/price" : "/swap/allowance-holder/price", ZERO_X_API_URL);
  const params: Record<string, string> = {
    chainId: String(request.chainId),
    sellToken: mode === "swap" ? toZeroXToken(request.inputAsset) : request.inputAsset,
    buyToken: mode === "swap" ? toZeroXToken(request.outputAsset) : request.outputAsset,
    sellAmount: request.inputAmountAtomic,
    taker: request.recipient
  };
  if (mode === "swap") Object.assign(params, {
    recipient: request.recipient,
    swapFeeRecipient: RMT_ZERO_X_FEE_TREASURY,
    swapFeeBps: String(RMT_ZERO_X_FEE_BPS),
    swapFeeToken: toZeroXToken(request.inputAsset),
    slippagePpm: String(RMT_ZERO_X_PROVIDER_REQUEST_SLIPPAGE_PPM)
  });
  url.search = new URLSearchParams(params).toString();
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
  try {
    const result = parseZeroXPrice(body, request, mode);
    observe?.({ reason: null, economics: safeZeroXPriceEconomics(body) });
    return result;
  } catch (error) {
    observe?.({ reason: error instanceof ZeroXInvalidResponseError ? error.reason : "OTHER_SCHEMA_VIOLATION", economics: safeZeroXPriceEconomics(body) });
    throw error;
  }
}

function createZeroXAdapter(mode: ZeroXMode, observe?: (value: ZeroXPriceDiagnostic) => void): VNextQuoteProviderAdapter {
  const gasless = mode === "gasless";
  const adapter: VNextQuoteProviderAdapter = {
    provider: gasless ? "zero-x-gasless" : "zero-x-swap",
    providerLabel: gasless ? "0x Gasless" : "0x",
    providerFamily: "zeroex",
    adapterVersion: 1,
    executionKind: gasless ? "gasless" : "aggregator",
    capabilities: { strictVerification: !gasless, walletAuthorization: !gasless },
    async quote(request) {
      const startedAtMs = Date.now();
      try {
        const price = await quoteZeroX(request, mode, observe);
        if (!price) return unavailableVNextQuoteAttempt({ adapter, request, status: "no_route", detail: `No complete ${adapter.providerLabel} route was found for this amount.`, startedAtMs });
        const quotedAtMs = Date.now();
        const providerNativeFee = gasless ? undefined : createVNextZeroXProviderNativeFee({
          inputAsset: request.inputAsset,
          outputAsset: request.outputAsset,
          userGrossInputAtomic: request.inputAmountAtomic,
          expectedOutputAtomic: price.expectedOutputAtomic,
          protectedOutputAtomic: price.protectedOutputAtomic,
          recipient: request.recipient,
          providerFeeAsset: price.providerFee?.asset ?? null,
          providerFeeAtomic: price.providerFee?.amountAtomic ?? null,
          authorizationState: "indicative"
        });
        return {
          provider: adapter.provider, providerLabel: adapter.providerLabel, providerFamily: adapter.providerFamily, adapterVersion: 1,
          status: "indicative", chainId: request.chainId, inputAsset: request.inputAsset, outputAsset: request.outputAsset,
          inputAmountAtomic: request.inputAmountAtomic, expectedOutputAtomic: price.expectedOutputAtomic,
          protectedOutputAtomic: price.protectedOutputAtomic, outputDecimals: request.outputIdentity.decimals,
          priceImpact: null, liquidityFeeEvidence: [], quotedAtMs, expiresAtMs: quotedAtMs + ZERO_X_QUOTE_TTL_MS,
          latencyMs: quotedAtMs - startedAtMs, executionKind: adapter.executionKind,
          strictVerificationAvailable: !gasless, userPaysGas: !gasless,
          providerFeeAsset: price.providerFee?.asset ?? null, providerFeeAtomic: price.providerFee?.amountAtomic ?? null,
          gasSponsorshipFeeAsset: price.gasSponsorshipFee?.asset ?? null, gasSponsorshipFeeAtomic: price.gasSponsorshipFee?.amountAtomic ?? null,
          explicitProviderFeeOutputAtomic: price.providerFee?.asset === request.outputAsset ? price.providerFee.amountAtomic : null,
          netEconomics: gasless ? disabledVNextFeeEconomics({ inputAmountAtomic: request.inputAmountAtomic, expectedOutputAtomic: price.expectedOutputAtomic, protectedOutputAtomic: price.protectedOutputAtomic }) : null,
          ...(providerNativeFee ? { providerNativeFee, settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE } : {}),
          networkFeeNativeAtomic: price.networkFeeNativeAtomic, networkFeeNativeSymbol: gasless ? null : "ETH",
          protectedNetOutputAtomic: gasless ? price.protectedOutputAtomic : null, costState: gasless ? null : "network_fee_pending",
          authorizationReady: false,
          detail: gasless ? "Live indicative 0x Gasless price with provider and gas-sponsorship fees reflected in protected output." : "Live 0x price across the best available Robinhood liquidity, including the exact 0.25% sell-token RMT fee."
        };
      } catch (cause) {
        const invalidResponse = cause instanceof ZeroXInvalidResponseError;
        return unavailableVNextQuoteAttempt({ adapter, request, status: invalidResponse ? "invalid_response" : "temporarily_unavailable", detail: invalidResponse ? `RMT rejected an inconsistent ${adapter.providerLabel} response.` : `${adapter.providerLabel} is temporarily unavailable for this request.`, startedAtMs });
      }
    },
    ...(gasless ? {} : { verify: verifyZeroXSwapFirmQuote, prepareAuthorization: prepareZeroXSwapAuthorization })
  };
  return adapter;
}

export const vNextZeroXSwapAdapter = createZeroXAdapter("swap");
export const vNextZeroXGaslessAdapter = createZeroXAdapter("gasless");

// Test/server diagnostic entrypoint, identical adapter admission. No diagnostics
// are added to the public quote response and no observer runs in normal use.
export const createZeroXSwapDiagnosticAdapter = (observe: (value: ZeroXPriceDiagnostic) => void) => createZeroXAdapter("swap", observe);

export function configuredVNextZeroXAdapters() {
  return process.env.RMT_VNEXT_ZEROX_OBSERVATION_ENABLED === "true" && Boolean(process.env.RMT_ZEROX_API_KEY?.trim())
    ? [vNextZeroXSwapAdapter, vNextZeroXGaslessAdapter] as const
    : [] as const;
}
