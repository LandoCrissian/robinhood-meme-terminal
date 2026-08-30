import { getAddress } from "viem";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import {
  discoverExactVNextWalletRequestTransaction,
  vNextWalletRequestDiscoverySchema
} from "../../../../lib/server/vnext-wallet-request-discovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  try {
    const parsed = vNextWalletRequestDiscoverySchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid wallet-request recovery evidence." }, { status: 400, headers: noStore });
    await requireAuthenticatedTradeWallet(request, getAddress(parsed.data.wallet));
    return Response.json(await discoverExactVNextWalletRequestTransaction(parsed.data), { headers: noStore });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    return Response.json({ status: "unavailable" }, { headers: noStore });
  }
}
