import { getAddress, isAddress, type Hex } from "viem";
import { isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import { unavailableVNextQuoteAttempt, type VNextProviderQuoteRequest, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import {
  ROBINHOOD_UNISWAPX_V3_REACTOR,
  UniswapXV3OrderVerificationError,
  verifyUniswapXV3Order,
  type VerifiedUniswapXV3Order
} from "./vnext-uniswapx-order-verifier";

const UNISWAP_TRADE_API_URL = "https://trade-api.gateway.uniswap.org/v1";
const UNISWAPX_TIMEOUT_MS = 4_000;
const UNISWAPX_QUOTE_TTL_MS = 10_000;
const ROBINHOOD_UNIVERSAL_ROUTER_VERSION = "2.1.1";

type JsonObject = Record<string, unknown>;

class UniswapXInvalidResponseError extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveAtomic(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
}

function zeroOrAbsent(value: unknown) {
  return value === undefined || value === null || value === 0 || value === "0";
}

async function parseUniswapXQuote(body: unknown, request: VNextProviderQuoteRequest) {
  if (!isObject(body) || body.routing !== "DUTCH_V3" || !isObject(body.quote)) {
    throw new UniswapXInvalidResponseError("Uniswap returned an unexpected routing response.");
  }
  const quote = body.quote;
  const input = isObject(quote.input) ? quote.input : null;
  const output = isObject(quote.output) ? quote.output : null;
  const orderInfo = isObject(quote.orderInfo) ? quote.orderInfo : null;
  if (
    !input || !output || !orderInfo
    || typeof input.token !== "string" || !isAddress(input.token)
    || getAddress(input.token) !== request.inputAsset
    || input.amount !== request.inputAmountAtomic
    || typeof output.token !== "string" || !isAddress(output.token)
    || getAddress(output.token) !== request.outputAsset
    || typeof output.recipient !== "string" || !isAddress(output.recipient)
    || getAddress(output.recipient) !== request.recipient
    || orderInfo.chainId !== request.chainId
    || typeof orderInfo.swapper !== "string" || !isAddress(orderInfo.swapper)
    || getAddress(orderInfo.swapper) !== request.recipient
    || typeof orderInfo.reactor !== "string" || !isAddress(orderInfo.reactor)
    || getAddress(orderInfo.reactor) !== ROBINHOOD_UNISWAPX_V3_REACTOR
  ) throw new UniswapXInvalidResponseError("UniswapX changed the requested trade identity.");

  const expectedOutputAtomic = positiveAtomic(output.amount);
  const protectedOutputAtomic = positiveAtomic(output.minimumAmount);
  if (
    !expectedOutputAtomic || !protectedOutputAtomic
    || BigInt(protectedOutputAtomic) > BigInt(expectedOutputAtomic)
  ) throw new UniswapXInvalidResponseError("UniswapX returned invalid output economics.");

  // RMT has not activated a service fee. The Trading API documents that an
  // API-key fee can sit outside the headline EXACT_INPUT output amount, so a
  // non-zero portion must fail closed instead of being shown as fee-free.
  if (!zeroOrAbsent(quote.portionBips) || !zeroOrAbsent(quote.portionAmount)) {
    throw new UniswapXInvalidResponseError("UniswapX returned an unexpected service fee.");
  }

  let verifiedOrder: VerifiedUniswapXV3Order;
  try {
    verifiedOrder = await verifyUniswapXV3Order({
      encodedOrder: quote.encodedOrder,
      orderId: quote.orderId,
      permitData: body.permitData,
      request,
      expectedOutputAtomic,
      protectedOutputAtomic
    });
  } catch (cause) {
    if (cause instanceof UniswapXV3OrderVerificationError) {
      throw new UniswapXInvalidResponseError(cause.message);
    }
    throw cause;
  }

  return {
    expectedOutputAtomic,
    protectedOutputAtomic,
    verifiedOrder,
    submissionPayload: { routing: "DUTCH_V3" as const, quote }
  };
}

function isNoRouteResponse(status: number, body: unknown) {
  if (status === 404) return true;
  if (!isObject(body)) return false;
  const message = [body.detail, body.message, body.error]
    .find((value): value is string => typeof value === "string");
  return status === 400 && Boolean(message?.toLowerCase().includes("no quote"));
}

async function quoteUniswapX(request: VNextProviderQuoteRequest) {
  const apiKey = process.env.RMT_UNISWAP_API_KEY?.trim();
  if (!apiKey) throw new Error("Uniswap server credential is not configured.");
  const response = await fetch(`${UNISWAP_TRADE_API_URL}/quote`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "x-universal-router-version": ROBINHOOD_UNIVERSAL_ROUTER_VERSION
    },
    body: JSON.stringify({
      type: "EXACT_INPUT",
      amount: request.inputAmountAtomic,
      tokenInChainId: request.chainId,
      tokenOutChainId: request.chainId,
      tokenIn: request.inputAsset,
      tokenOut: request.outputAsset,
      swapper: request.recipient,
      recipient: request.recipient,
      slippageTolerance: 1,
      routingPreference: "BEST_PRICE",
      protocols: ["UNISWAPX_V3"]
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(UNISWAPX_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isNoRouteResponse(response.status, body)) return null;
    throw new Error(`UniswapX quote request failed with ${response.status}.`);
  }
  return await parseUniswapXQuote(body, request);
}

export type PreparedVNextUniswapXIntent = {
  provider: "uniswapx";
  chainId: 4_663;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  orderId: string;
  deadline: string;
  permit2: string;
  reactor: string;
  permitPayloadHash: Hex;
  permitData: VerifiedUniswapXV3Order["permitData"];
  submissionPayload: { routing: "DUTCH_V3"; quote: JsonObject };
};

/**
 * Produces a fresh, fully decoded server-only intent for the authorization
 * layer. The public quote adapter deliberately discards this payload.
 */
export async function prepareVNextUniswapXIntent(
  request: VNextProviderQuoteRequest,
  protectedOutputFloorAtomic: bigint
): Promise<PreparedVNextUniswapXIntent> {
  if (isRobinhoodNativeAsset(request.inputAsset)) {
    throw new Error("UniswapX native ETH authorization is not enabled.");
  }
  if (protectedOutputFloorAtomic <= 0n) throw new Error("UniswapX requires a positive protected-output floor.");
  const prepared = await quoteUniswapX(request);
  if (!prepared) throw new Error("No complete UniswapX V3 intent quote was found for this amount.");
  if (BigInt(prepared.protectedOutputAtomic) < protectedOutputFloorAtomic) {
    throw new Error("The fresh UniswapX intent moved below the protected-output floor.");
  }
  return {
    provider: "uniswapx",
    chainId: 4_663,
    inputAsset: request.inputAsset,
    outputAsset: request.outputAsset,
    inputAmountAtomic: request.inputAmountAtomic,
    expectedOutputAtomic: prepared.expectedOutputAtomic,
    protectedOutputAtomic: prepared.protectedOutputAtomic,
    recipient: request.recipient,
    orderId: prepared.verifiedOrder.orderHash,
    deadline: prepared.verifiedOrder.deadline.toString(),
    permit2: prepared.verifiedOrder.permit2,
    reactor: prepared.verifiedOrder.reactor,
    permitPayloadHash: prepared.verifiedOrder.permitPayloadHash,
    permitData: prepared.verifiedOrder.permitData,
    submissionPayload: prepared.submissionPayload
  };
}

export const vNextUniswapXAdapter: VNextQuoteProviderAdapter = {
  provider: "uniswapx",
  providerLabel: "UniswapX",
  providerFamily: "uniswapx",
  adapterVersion: 1,
  executionKind: "rfq_intent",
  capabilities: { strictVerification: false, walletAuthorization: false },
  async quote(request) {
    const startedAtMs = Date.now();
    if (isRobinhoodNativeAsset(request.inputAsset)) {
      return unavailableVNextQuoteAttempt({
        adapter: vNextUniswapXAdapter,
        request,
        status: "no_route",
        detail: "UniswapX native ETH requires a separately verified smart-wallet authorization path; direct execution remains available.",
        startedAtMs
      });
    }
    try {
      const quote = await quoteUniswapX(request);
      if (!quote) return unavailableVNextQuoteAttempt({
        adapter: vNextUniswapXAdapter,
        request,
        status: "no_route",
        detail: "No complete UniswapX V3 intent quote was found for this amount.",
        startedAtMs
      });
      const quotedAtMs = Date.now();
      return {
        provider: "uniswapx",
        providerLabel: "UniswapX",
        providerFamily: "uniswapx",
        adapterVersion: 1,
        status: "indicative",
        chainId: request.chainId,
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        inputAmountAtomic: request.inputAmountAtomic,
        expectedOutputAtomic: quote.expectedOutputAtomic,
        protectedOutputAtomic: quote.protectedOutputAtomic,
        outputDecimals: request.outputIdentity.decimals,
        priceImpact: null,
        liquidityFeeEvidence: [],
        quotedAtMs,
        expiresAtMs: quotedAtMs + UNISWAPX_QUOTE_TTL_MS,
        latencyMs: quotedAtMs - startedAtMs,
        executionKind: "rfq_intent",
        strictVerificationAvailable: false,
        userPaysGas: false,
        providerFeeAsset: null,
        providerFeeAtomic: null,
        gasSponsorshipFeeAsset: null,
        gasSponsorshipFeeAtomic: null,
        explicitProviderFeeOutputAtomic: null,
        rmtFeeOutputAtomic: "0",
        networkFeeNativeAtomic: null,
        networkFeeNativeSymbol: null,
        protectedNetOutputAtomic: quote.protectedOutputAtomic,
        costState: null,
        authorizationReady: false,
        detail: "Live UniswapX V3 intent with exact encoded-order and cosigner verification. Trader signing and order submission remain disabled."
      };
    } catch (cause) {
      const invalidResponse = cause instanceof UniswapXInvalidResponseError;
      return unavailableVNextQuoteAttempt({
        adapter: vNextUniswapXAdapter,
        request,
        status: invalidResponse ? "invalid_response" : "temporarily_unavailable",
        detail: invalidResponse
          ? "RMT rejected an inconsistent UniswapX response."
          : "UniswapX is temporarily unavailable for this request.",
        startedAtMs
      });
    }
  }
};

export function configuredVNextUniswapXAdapters() {
  return process.env.RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED === "true" && Boolean(process.env.RMT_UNISWAP_API_KEY?.trim())
    ? [vNextUniswapXAdapter] as const
    : [] as const;
}
