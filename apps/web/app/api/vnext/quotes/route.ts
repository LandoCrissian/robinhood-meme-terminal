import { after } from "next/server";
import { requireVNextStockTokenExecutionEligible, stockTokenExecutionPolicyErrorResponse } from "../../../../lib/server/robinhood-stock-token-registry";
import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { quoteRobinhoodVNextExecution } from "../../../../lib/server/vnext-execution-engine";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { readVNextVerifiedAssetIdentity, vNextExecutionIdentityErrorResponse } from "../../../../lib/server/vnext-asset-identity";
import type { VNextQuoteResponse } from "../../../../lib/vnext/quote-observation";
import {
  projectIdentityAdmissionErrorResponse,
  requireProjectIdentityExecutionAdmitted
} from "../../../../lib/server/project-identity-admission";
import { vNextExecutionEligibilityErrorResponse } from "../../../../lib/server/vnext-execution-eligibility";
import { isVNextWalletExecutionAdmitted } from "../../../../lib/vnext/provider-execution-capability";
import { readVNextPublicExecutionProviderScope } from "../../../../lib/server/vnext-public-execution-provider-scope";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE } from "../../../../lib/vnext/execution-settlement";
import { emitTradeJourney, observedZeroXPhase } from "../../../../lib/vnext/trade-journey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  chainId: z.literal(4_663),
  inputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  outputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  inputAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  recipient: z.string().refine((value) => isAddress(value, { strict: false })),
  canonicalMarket: z.object({
    sourceId: z.literal("uniswap-v4"),
    poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/)
  }).optional()
});

export async function POST(request: Request) {
  let providerRequestAttempted = false;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid VNext quote request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const inputAsset = getAddress(parsed.data.inputAsset);
    const outputAsset = getAddress(parsed.data.outputAsset);
    const recipient = getAddress(parsed.data.recipient);
    if (inputAsset === outputAsset) {
      return Response.json({ error: "Input and output assets must differ." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    await requireAuthenticatedTradeWallet(request, recipient);
    const [inputIdentity, outputIdentity] = await Promise.all([
      readVNextVerifiedAssetIdentity(inputAsset, { scheduleRevalidation: after }),
      readVNextVerifiedAssetIdentity(outputAsset, { scheduleRevalidation: after })
    ]);
    if (!inputIdentity || !outputIdentity) {
      emitTradeJourney({ phase: "IDENTITY_UNAVAILABLE", quoteRequestAttempted: true, providerRequestAttempted: false });
      return Response.json({ error: "Both quote assets require verified Robinhood Chain identity and decimals.", phase: "IDENTITY_UNAVAILABLE", providerRequestAttempted: false }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    await requireProjectIdentityExecutionAdmitted([inputIdentity, outputIdentity].filter(identity => !identity.native).map(identity => ({ address: identity.address, verifiedIdentity: identity })), after);

    await requireVNextStockTokenExecutionEligible({ inputAsset, outputAsset });
    const requestedAtMs = Date.now();
    providerRequestAttempted = process.env.RMT_VNEXT_ZEROX_OBSERVATION_ENABLED === "true" && Boolean(process.env.RMT_ZEROX_API_KEY?.trim());
    const attempts = await quoteRobinhoodVNextExecution({
      chainId: 4_663,
      inputAsset,
      outputAsset,
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      amountIn: BigInt(parsed.data.inputAmountAtomic),
      recipient,
      inputIdentity,
      outputIdentity,
      ...(parsed.data.canonicalMarket ? {
        canonicalMarket: {
          sourceId: parsed.data.canonicalMarket.sourceId,
          poolId: parsed.data.canonicalMarket.poolId as `0x${string}`
        }
      } : {})
    });
    const publicExecutionScope = readVNextPublicExecutionProviderScope();
    providerRequestAttempted = attempts.some((attempt) => attempt.provider === "zero-x-swap");
    emitTradeJourney({ phase: observedZeroXPhase(attempts), quoteRequestAttempted: true, providerRequestAttempted });
    const response: VNextQuoteResponse = {
      requestId: randomUUID(),
      chainId: 4_663,
      inputAsset,
      outputAsset,
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      requestedAtMs,
      completedAtMs: Date.now(),
      attempts: attempts.map((attempt) => ({
        ...attempt,
        publicWalletExecutionEligible: publicExecutionScope.valid
          && publicExecutionScope.providers.includes(attempt.provider)
          && attempt.strictVerificationAvailable
          && isVNextWalletExecutionAdmitted(attempt.provider)
          && ((attempt.provider !== "uniswap-v2" && attempt.provider !== "uniswap-v3")
            || attempt.settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE)
          && (attempt.provider !== "zero-x-swap" || attempt.settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE)
      }))
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const stockTokenResponse = stockTokenExecutionPolicyErrorResponse(cause);
    if (stockTokenResponse) return stockTokenResponse;
    const assetIdentityResponse = vNextExecutionIdentityErrorResponse(cause);
    if (assetIdentityResponse) return assetIdentityResponse;
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const eligibilityResponse = vNextExecutionEligibilityErrorResponse(cause);
    if (eligibilityResponse) return eligibilityResponse;
    const projectIdentityResponse = projectIdentityAdmissionErrorResponse(cause);
    if (projectIdentityResponse) return projectIdentityResponse;
    emitTradeJourney({ phase: "QUOTE_SERVICE_UNAVAILABLE", quoteRequestAttempted: true, providerRequestAttempted });
    return Response.json({ error: "Unable to compare live VNext routes.", phase: "QUOTE_SERVICE_UNAVAILABLE", providerRequestAttempted }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
