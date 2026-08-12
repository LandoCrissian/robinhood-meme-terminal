import { NextResponse } from "next/server";
import { getAddress, isAddress, zeroAddress } from "viem";
import { fetchRobinhoodStockRegistry } from "../../../../lib/server/robinhood-stock-token-registry";
import { resolveUniversalMarketAddress } from "../../../../lib/server/universal-market-resolver";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rawAddress = new URL(request.url).searchParams.get("address");
  if (!rawAddress || !isAddress(rawAddress, { strict: false }) || rawAddress.toLowerCase() === zeroAddress) {
    return NextResponse.json({ error: "A complete nonzero token contract is required." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const address = getAddress(rawAddress);
  const stockRegistry = await fetchRobinhoodStockRegistry();
  const resolution = await resolveUniversalMarketAddress(address, stockRegistry);
  if (!resolution || resolution.token.address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: "Asset workspace identity could not be verified on Robinhood Chain." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }

  return NextResponse.json({
    resolution,
    stockAssetCoverage: stockRegistry.coverage,
    updatedAt: new Date().toISOString()
  }, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" }
  });
}
