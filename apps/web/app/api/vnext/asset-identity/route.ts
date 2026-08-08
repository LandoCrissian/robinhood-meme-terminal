import { NextResponse } from "next/server";
import { getAddress, isAddress, zeroAddress } from "viem";
import type { UniversalMarketResolution } from "../../../../lib/external-market";
import { readRobinhoodTokenIdentity } from "../../../../lib/server/universal-market-resolver";

export async function GET(request: Request) {
  const rawAddress = new URL(request.url).searchParams.get("address");
  if (!rawAddress || !isAddress(rawAddress, { strict: false }) || rawAddress.toLowerCase() === zeroAddress) {
    return NextResponse.json({ error: "A complete nonzero token contract is required." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" }
    });
  }
  const address = getAddress(rawAddress);
  const token = await readRobinhoodTokenIdentity(address);
  if (!token) {
    return NextResponse.json({ error: "Token identity could not be verified on Robinhood Chain." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }
  const resolution: UniversalMarketResolution = {
    chainId: 4_663,
    requestedAddress: address,
    requestedKind: "token",
    status: "token-only",
    token,
    pools: [],
    marketData: "identity-only",
    execution: "view-only",
    provenance: "robinhood-chain-contract-reads",
    resolvedAt: new Date().toISOString()
  };
  return NextResponse.json({ resolution }, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" }
  });
}
