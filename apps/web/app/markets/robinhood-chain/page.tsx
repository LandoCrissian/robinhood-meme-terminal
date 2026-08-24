import type { Metadata } from "next";
import { RMT_SITE_NAME } from "../../../lib/site-identity";
import { MarketInventory } from "./market-inventory";

const title = "Robinhood Chain Markets, Tokens, Liquidity & Volume | RMT";
const description =
  "Browse canonical and provider-observed Robinhood Chain markets with exact contracts, venues, liquidity, 24-hour volume, prices and market age when available.";

export const revalidate = 300;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/markets/robinhood-chain" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  openGraph: {
    type: "website",
    siteName: RMT_SITE_NAME,
    title,
    description,
    url: "/markets/robinhood-chain",
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function RobinhoodChainMarketsPage() {
  return <MarketInventory view="all" title={title} description={description} />;
}
