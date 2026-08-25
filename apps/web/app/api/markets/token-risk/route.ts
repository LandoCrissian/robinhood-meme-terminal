import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { verifyExternalSushiMarket } from "../../../../lib/server/external-sushi-market";
import { fetchTokenRiskEvidence } from "../../../../lib/server/token-risk-evidence";
import { verifyExternalUniswapMarket } from "../../../../lib/server/external-uniswap-market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  token: z.string().refine(isAddress),
  pair: z.string().refine(isAddress).optional(),
  venue: z.enum(["sushi", "uniswap"]).optional(),
  creator: z.string().refine(isAddress).optional(),
  sourceId: z.enum(["pons", "noxa"]).optional()
}).refine((value) => Boolean(value.pair) === Boolean(value.venue), {
  message: "Pair and venue must be supplied together."
});

export async function GET(request: Request) {
  try {
    const input = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid token risk evidence request." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const token = getAddress(parsed.data.token);
    const pair = parsed.data.pair ? getAddress(parsed.data.pair) : undefined;
    const creator = parsed.data.creator ? getAddress(parsed.data.creator) : undefined;
    let verifiedPair: typeof pair;
    if (pair) {
      try {
        if (parsed.data.venue === "sushi") {
          await verifyExternalSushiMarket({ token, pair });
        } else {
          await verifyExternalUniswapMarket({ token, pair });
        }
        verifiedPair = pair;
      } catch {
        // Contract and holder evidence is token-scoped. An unavailable or
        // unsupported address-pool verifier only removes market enrichment.
        verifiedPair = undefined;
      }
    }
    let evidence;
    try {
      evidence = await fetchTokenRiskEvidence({
        token,
        pair: verifiedPair,
        creator,
        sourceId: parsed.data.sourceId
      });
    } catch (cause) {
      if (!verifiedPair) throw cause;
      evidence = await fetchTokenRiskEvidence({
        token,
        creator,
        sourceId: parsed.data.sourceId
      });
    }
    return Response.json(evidence, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" }
    });
  } catch {
    return Response.json(
      { error: "Unable to verify contract and holder evidence for this market." },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}
