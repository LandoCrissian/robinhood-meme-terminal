import type { Metadata } from "next";
import { ExternalMarketWorkspace } from "../../external-market-workspace";
import {
  buildPublicMarketMetadata,
  publicMarketStructuredData
} from "../../../lib/public-market-discovery";
import { fetchPublicMarket } from "../../../lib/server/public-market-catalog";

type MarketRouteProps = {
  params: Promise<{ address: string }>;
};

export async function generateMetadata({ params }: MarketRouteProps): Promise<Metadata> {
  const { address } = await params;
  const market = await fetchPublicMarket(address);
  return buildPublicMarketMetadata(address, market);
}

export default async function ExternalMarketPage({ params }: MarketRouteProps) {
  const { address } = await params;
  const market = await fetchPublicMarket(address);
  const structuredData = market ? publicMarketStructuredData(market) : null;
  return (
    <>
      {structuredData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</g, "\\u003c")
          }}
        />
      )}
      <ExternalMarketWorkspace initialMarket={market ?? undefined} />
    </>
  );
}
