import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { readVNextVerifiedAssetIdentity } from "../../../../lib/server/vnext-asset-identity";
import { verifyRobinhoodVNextExecution } from "../../../../lib/server/vnext-execution-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  chainId: z.literal(4_663),
  quoteRequestId: z.string().uuid(),
  provider: z.enum(["sushi", "uniswap-v3", "up-v2", "up-cl"]),
  inputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  outputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  inputAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  protectedOutputFloorAtomic: z.string().regex(/^[1-9][0-9]*$/),
  recipient: z.string().refine((value) => isAddress(value, { strict: false }))
});

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid VNext verification request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
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
    const executionId = `0x${randomBytes(32).toString("hex")}` as const;
    const evidence = await verifyRobinhoodVNextExecution(parsed.data.provider, {
      chainId: 4_663,
      inputAsset,
      outputAsset,
      amountIn: BigInt(parsed.data.inputAmountAtomic),
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      recipient,
      indicativeProtectedOutputFloorAtomic: BigInt(parsed.data.protectedOutputFloorAtomic),
      executionId
    });
    return Response.json({
      verificationId: randomUUID(),
      sourceQuoteRequestId: parsed.data.quoteRequestId,
      ...evidence
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const message = cause instanceof Error && /No canonical Uniswap|No up-|runtime bytecode is not approved|dependencies changed|strict verification is not available|moved below the indicative protected-output floor|quote block was reorganized/.test(cause.message)
      ? cause.message
      : "Unable to produce strict pre-sign evidence.";
    return Response.json({ error: message }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
