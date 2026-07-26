import type { Metadata } from "next";
import Link from "next/link";
import { ExternalMarketFeed } from "./external-market-feed";
import { isMainnetRelease } from "../lib/network";
import { SiteFooter } from "./site-footer";
import { LegacyHomeRedirect } from "./legacy-home-redirect";

export const metadata: Metadata = {
  title: "Robinhood Meme Terminal",
  description: "Watch, compare, and trade Robinhood Chain markets across Pons, Lemon, Sushi, Uniswap, and the wider ecosystem.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Robinhood Meme Terminal",
    description: "Watch, compare, and trade Robinhood Chain markets across Pons, Lemon, Sushi, Uniswap, and the wider ecosystem.",
    url: "/",
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary",
    title: "Robinhood Meme Terminal",
    description: "Watch, compare, and trade Robinhood Chain markets across Pons, Lemon, Sushi, Uniswap, and the wider ecosystem.",
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function Home() {
  return (
    <main>
      <LegacyHomeRedirect />
      <section className="terminalIntro">
        <div><p className="eyebrow">RMT · ROBINHOOD CHAIN MARKET INTELLIGENCE</p><h1>See the whole market. Catch what matters.</h1><p>Explore Pons, Lemon, Sushi, Uniswap, and qualified Robinhood Chain markets in one clean, origin-aware terminal.</p></div>
        <div className="terminalIntroActions"><Link className="primaryAction" href="/explore">Explore markets</Link><Link className="secondaryAction" href="/watchlist">Open watchlist</Link></div>
        <div className="trustStrip"><span><b>NETWORK</b>{isMainnetRelease ? "RHC MAINNET · 4663" : "RHC TESTNET · 46630"}</span><span><b>REFRESH</b>30S MARKET DATA</span><span><b>EXECUTION</b>NON-CUSTODIAL</span><span><b>SOURCES</b>PONS · LEMON · DEX</span></div>
      </section>

      <ExternalMarketFeed />
      <SiteFooter />
    </main>
  );
}
