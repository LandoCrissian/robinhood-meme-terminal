import type { Metadata } from "next";
import { ExternalMarketFeed } from "../external-market-feed";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Explore Robinhood Chain Markets | RMT",
  description: "Explore trending, new, and active Robinhood Chain markets across Pons, Lemon, Sushi, Uniswap, and the wider ecosystem.",
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Explore Robinhood Chain Markets | RMT",
    description: "One clean, origin-aware view of Robinhood Chain markets.",
    url: "/explore",
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function ExplorePage() {
  return (
    <main className="directoryPage focusedDirectory">
      <ExternalMarketFeed />
      <SiteFooter />
    </main>
  );
}
