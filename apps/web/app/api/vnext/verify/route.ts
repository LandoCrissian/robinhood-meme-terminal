import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { stockTokenExecutionPolicyErrorResponse } from "../../../../lib/server/robinhood-stock-token-registry";
import { readVNextVerifiedAssetIdentity } from "../../../../lib/server/vnext-asset-identity";
import { verifyRobinhoodVNextExecution } from "../../../../lib/server/vnext-execution-engine";
import {
  projectIdentityAdmissionErrorResponse,
  requireProjectIdentityDirectoryAdmitted
} from "../../../../lib/server/project-identity-admission";
import { VNEXT_DIRECT_NO_RMT_FEE } from "../../../../lib/vnext/execution-settlement";
import {
  requireRmtCuratedExecutionAssets,
  rmtCuratedMarketAdmissionErrorResponse
} from "../../../../lib/server/rmt-curated-market-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  chainId: z.literal(4_663),
  quoteRequestId: z.string().uuid(),
  provider: z.enum(["sushi", "uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl"]),
  inputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  outputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  inputAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  protectedOutputFloorAtomic: z.string().regex(/^[1-9][0-9]*$/),
  recipient: z.string().refine((value) => isAddress(value, { strict: false })),
  canonicalMarket: z.object({
    sourceId: z.literal("uniswap-v4"),
    poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/)
  }).optional(),
  v4QuoteEvidence: z.object({
    poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    currency0: z.string().refine((value) => isAddress(value, { strict: false })),
    currency1: z.string().refine((value) => isAddress(value, { strict: false })),
    fee: z.number().int().nonnegative().max(16_777_215),
    tickSpacing: z.number().int().positive().max(32_767),
    hooks: z.string().refine((value) => isAddress(value, { strict: false })),
    recipient: z.string().refine((value) => isAddress(value, { strict: false })),
    observedBlock: z.string().regex(/^[1-9][0-9]*$/),
    observedBlockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    observedAtMs: z.number().int().positive(),
    quotedAtMs: z.number().int().positive(),
    expiresAtMs: z.number().int().positive()
  }).optional()
});

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid VNext verification request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const hasCompleteV4Binding = Boolean(parsed.data.canonicalMarket && parsed.data.v4QuoteEvidence);
    if ((parsed.data.provider === "uniswap-v4") !== hasCompleteV4Binding) {
      return Response.json({ error: "Invalid VNext V4 verification binding." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const recipient = getAddress(parsed.data.recipient);
    const inputAsset = getAddress(parsed.data.inputAsset);
    const outputAsset = getAddress(parsed.data.outputAsset);
    await requireAuthenticatedTradeWallet(request, recipient);
    const [inputIdentity, outputIdentity] = await Promise.all([
      readVNextVerifiedAssetIdentity(inputAsset),
      readVNextVerifiedAssetIdentity(outputAsset)
    ]);
    if (!inputIdentity || !outputIdentity) {
      return Response.json({ error: "Both assets require verified Robinhood Chain identity before route verification." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    requireRmtCuratedExecutionAssets(inputAsset, outputAsset);
    await requireProjectIdentityDirectoryAdmitted([
      { address: inputAsset },
      { address: outputAsset }
    ]);
    const executionId = `0x${randomBytes(32).toString("hex")}` as const;
    const evidence = await verifyRobinhoodVNextExecution(parsed.data.provider, {
      chainId: 4_663,
      inputAsset,
      outputAsset,
      amountIn: BigInt(parsed.data.inputAmountAtomic),
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      recipient,
      indicativeProtectedOutputFloorAtomic: BigInt(parsed.data.protectedOutputFloorAtomic),
      settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
      executionId,
      ...(parsed.data.canonicalMarket ? { canonicalMarket: parsed.data.canonicalMarket as { sourceId: "uniswap-v4"; poolId: `0x${string}` } } : {}),
      ...(parsed.data.v4QuoteEvidence ? { v4QuoteEvidence: parsed.data.v4QuoteEvidence as typeof parsed.data.v4QuoteEvidence & { poolId: `0x${string}`; observedBlockHash: `0x${string}` } } : {})
    });
    return Response.json({
      verificationId: randomUUID(),
      sourceQuoteRequestId: parsed.data.quoteRequestId,
      ...evidence
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const curatedResponse = rmtCuratedMarketAdmissionErrorResponse(cause);
    if (curatedResponse) return curatedResponse;
    const projectIdentityResponse = projectIdentityAdmissionErrorResponse(cause);
    if (projectIdentityResponse) return projectIdentityResponse;
    const stockTokenResponse = stockTokenExecutionPolicyErrorResponse(cause);
    if (stockTokenResponse) return stockTokenResponse;
    const message = cause instanceof Error && /No canonical Uniswap|No up-|runtime bytecode is not approved|dependencies changed|strict verification is not available|moved below the indicative protected-output floor|quote block was reorganized|rejected Uniswap V4 execution/.test(cause.message)
      ? cause.message
      : "Unable to produce strict pre-sign evidence.";
    return Response.json({ error: message }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
