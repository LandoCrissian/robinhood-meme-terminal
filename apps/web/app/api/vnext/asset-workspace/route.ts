import { NextResponse } from "next/server";
import { getAddress, isAddress, zeroAddress } from "viem";
import { fetchRobinhoodStockRegistry } from "../../../../lib/server/robinhood-stock-token-registry";
import { readVNextEcosystemIntelligence } from "../../../../lib/server/vnext-ecosystem-intelligence";
import { resolveUniversalMarketAddress } from "../../../../lib/server/universal-market-resolver";
import { unavailableVNextEcosystemIntelligence } from "../../../../lib/vnext/ecosystem-intelligence";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const rawAddress = searchParams.get("address");
  if (!rawAddress || !isAddress(rawAddress, { strict: false }) || rawAddress.toLowerCase() === zeroAddress) {
    return NextResponse.json({ error: "A complete nonzero token contract is required." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const address = getAddress(rawAddress);
  const rawPair = searchParams.get("pair");
  const displayedPools = rawPair && isAddress(rawPair, { strict: false }) && rawPair.toLowerCase() !== zeroAddress
    ? [getAddress(rawPair)]
    : [];
  const stockRegistry = await fetchRobinhoodStockRegistry();
  const [resolution, ecosystem] = await Promise.all([
    resolveUniversalMarketAddress(address, stockRegistry),
    readVNextEcosystemIntelligence(address, undefined, undefined, displayedPools)
      .catch(() => unavailableVNextEcosystemIntelligence(address))
  ]);
  if (!resolution || resolution.token.address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: "Asset workspace identity could not be verified on Robinhood Chain." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }

  return NextResponse.json({
    resolution,
    ecosystem,
    stockAssetCoverage: stockRegistry.coverage,
    updatedAt: new Date().toISOString()
  }, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" }
  });
}
