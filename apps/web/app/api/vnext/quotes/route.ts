import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { quoteRobinhoodVNextExecution } from "../../../../lib/server/vnext-execution-engine";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { readRobinhoodTokenIdentity } from "../../../../lib/server/universal-market-resolver";
import type { VNextQuoteResponse } from "../../../../lib/vnext/quote-observation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  chainId: z.literal(4_663),
  inputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  outputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  inputAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  recipient: z.string().refine((value) => isAddress(value, { strict: false }))
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
      readRobinhoodTokenIdentity(inputAsset),
      readRobinhoodTokenIdentity(outputAsset)
    ]);
    if (!inputIdentity || !outputIdentity) {
      return Response.json({ error: "Both quote assets require verified Robinhood Chain identity and decimals." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }

    const requestedAtMs = Date.now();
    const attempts = await quoteRobinhoodVNextExecution({
      chainId: 4_663,
      inputAsset,
      outputAsset,
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      amountIn: BigInt(parsed.data.inputAmountAtomic),
      recipient,
      inputIdentity: { address: inputAsset, symbol: inputIdentity.symbol, decimals: inputIdentity.decimals },
      outputIdentity: { address: outputAsset, symbol: outputIdentity.symbol, decimals: outputIdentity.decimals }
    });
    const response: VNextQuoteResponse = {
      requestId: randomUUID(),
      chainId: 4_663,
      inputAsset,
      outputAsset,
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      requestedAtMs,
      completedAtMs: Date.now(),
      attempts
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    return Response.json({ error: "Unable to compare live VNext routes." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
