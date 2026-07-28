import type { Metadata } from "next";
import Link from "next/link";
import { ExternalMarketFeed } from "./external-market-feed";
import { OfficialRmtMarket } from "./official-rmt-market";
import { isMainnetRelease } from "../lib/network";
import { SiteFooter } from "./site-footer";

export const metadata: Metadata = {
  title: "Robinhood Meme Terminal",
  description: "Discover and trade Robinhood Chain tokens launched outside RMT across Pons, Lemon, Sushi, Uniswap, and the wider ecosystem.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Robinhood Meme Terminal",
    description: "Discover and trade Robinhood Chain tokens launched outside RMT across Pons, Lemon, Sushi, Uniswap, and the wider ecosystem.",
    url: "/",
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary",
    title: "Robinhood Meme Terminal",
    description: "Discover and trade Robinhood Chain tokens launched outside RMT across Pons, Lemon, Sushi, Uniswap, and the wider ecosystem.",
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function Home() {
  return (
    <main>
      <section className="terminalIntro">
        <div><p className="eyebrow">TERMINAL · EXTERNAL ROBINHOOD CHAIN MARKETS</p><h1>Trade beyond RMT.</h1><p>Discover tokens launched across Pons, Lemon, Sushi, Uniswap, and the wider Robinhood Chain ecosystem in one origin-aware terminal.</p></div>
        <div className="terminalIntroActions"><Link className="primaryAction" href="/explore">View RMT launches</Link><Link className="secondaryAction" href="/watchlist">Open watchlist</Link></div>
        <div className="trustStrip"><span><b>NETWORK</b>{isMainnetRelease ? "RHC MAINNET · 4663" : "RHC TESTNET · 46630"}</span><span><b>REFRESH</b>30S MARKET DATA</span><span><b>EXECUTION</b>NON-CUSTODIAL</span><span><b>SOURCES</b>PONS · LEMON · DEX</span></div>
      </section>

      <OfficialRmtMarket />
      <ExternalMarketFeed />
      <SiteFooter />
    </main>
  );
}
