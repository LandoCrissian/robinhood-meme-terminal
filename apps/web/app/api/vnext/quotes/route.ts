import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { quoteRobinhoodVNextExecution } from "../../../../lib/server/vnext-execution-engine";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { readVNextVerifiedAssetIdentity } from "../../../../lib/server/vnext-asset-identity";
import type { VNextQuoteResponse } from "../../../../lib/vnext/quote-observation";
import {
  projectIdentityAdmissionErrorResponse,
  requireProjectIdentityDirectoryAdmitted
} from "../../../../lib/server/project-identity-admission";
import { vNextExecutionEligibilityErrorResponse } from "../../../../lib/server/vnext-execution-eligibility";
import { isVNextWalletExecutionAdmitted } from "../../../../lib/vnext/provider-execution-capability";
import { readVNextPublicExecutionProviderScope } from "../../../../lib/server/vnext-public-execution-provider-scope";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "../../../../lib/vnext/execution-settlement";

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
      readVNextVerifiedAssetIdentity(inputAsset),
      readVNextVerifiedAssetIdentity(outputAsset)
    ]);
    if (!inputIdentity || !outputIdentity) {
      return Response.json({ error: "Both quote assets require verified Robinhood Chain identity and decimals." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    await requireProjectIdentityDirectoryAdmitted([
      { address: inputAsset },
      { address: outputAsset }
    ]);

    const requestedAtMs = Date.now();
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
      }))
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const eligibilityResponse = vNextExecutionEligibilityErrorResponse(cause);
    if (eligibilityResponse) return eligibilityResponse;
    const projectIdentityResponse = projectIdentityAdmissionErrorResponse(cause);
    if (projectIdentityResponse) return projectIdentityResponse;
    return Response.json({ error: "Unable to compare live VNext routes." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
