import type { ExternalMarket, ExternalMarketResponse } from "../external-market";
import { canonicalMarketAddress } from "../public-market-discovery";
import { RMT_SITE_URL } from "../site-identity";

const PUBLIC_MARKET_CATALOG_URL = `${RMT_SITE_URL}/api/markets/external`;

export async function fetchPublicMarketCatalog(): Promise<ExternalMarket[]> {
  try {
    const response = await fetch(PUBLIC_MARKET_CATALOG_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 }
    });
    if (!response.ok) return [];
    const payload = await response.json() as ExternalMarketResponse;
    return Array.isArray(payload.markets) ? payload.markets : [];
  } catch {
    return [];
  }
}

export async function fetchPublicMarket(address: string) {
  const canonical = canonicalMarketAddress(address);
  if (!canonical) return null;
  const markets = await fetchPublicMarketCatalog();
  return markets.find((market) => market.address.toLowerCase() === canonical.toLowerCase()) ?? null;
}
