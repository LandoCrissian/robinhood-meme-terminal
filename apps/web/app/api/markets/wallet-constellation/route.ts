import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { verifyExternalSushiMarket } from "../../../../lib/server/external-sushi-market";
import { verifyExternalUniswapMarket } from "../../../../lib/server/external-uniswap-market";
import { fetchTokenRiskEvidence } from "../../../../lib/server/token-risk-evidence";
import {
  buildWalletConstellationGraph,
  fetchWalletConstellationTransfers
} from "../../../../lib/server/wallet-constellation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  token: z.string().refine(isAddress),
  pair: z.string().refine(isAddress),
  venue: z.enum(["sushi", "uniswap"]),
  creator: z.string().refine(isAddress).optional(),
  sourceId: z.enum(["pons", "noxa"]).optional()
});

export async function GET(request: Request) {
  try {
    const parsed = requestSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid wallet constellation request." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const token = getAddress(parsed.data.token);
    const pair = getAddress(parsed.data.pair);
    const creator = parsed.data.creator
      ? getAddress(parsed.data.creator)
      : undefined;
    const verification = parsed.data.venue === "sushi"
      ? verifyExternalSushiMarket({ token, pair })
      : verifyExternalUniswapMarket({ token, pair });
    const [, evidence, transferPage] = await Promise.all([
      verification,
      fetchTokenRiskEvidence({
        token,
        pair,
        creator,
        sourceId: parsed.data.sourceId
      }),
      fetchWalletConstellationTransfers(token)
    ]);
    return Response.json(
      buildWalletConstellationGraph({
        evidence,
        transfers: transferPage.transfers,
        hasMoreTransfers: transferPage.hasMoreTransfers
      }),
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
        }
      }
    );
  } catch {
    return Response.json(
      { error: "Unable to verify wallet relationship evidence for this market." },
      {
        status: 422,
        headers: { "Cache-Control": "no-store", "Retry-After": "10" }
      }
    );
  }
}
