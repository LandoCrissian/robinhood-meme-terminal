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
    <main className="terminalPage">
      <section className="terminalIntro">
        <div className="terminalIntroCopy">
          <p className="eyebrow">RMT MARKET TERMINAL</p>
          <h1>Robinhood Chain, in one view.</h1>
          <p>Scan live markets, verify project origin, compare activity, and review non-custodial execution without leaving RMT.</p>
        </div>
        <div className="terminalIntroActions">
          <Link className="primaryAction" href="/watchlist">Open watchlist</Link>
          <Link className="secondaryAction" href="/explore">RMT projects</Link>
        </div>
        <div className="trustStrip" aria-label="Terminal operating status">
          <span><b>NETWORK</b><i aria-hidden="true" />{isMainnetRelease ? "RHC MAINNET · 4663" : "RHC TESTNET · 46630"}</span>
          <span><b>MARKETS</b>PONS · LEMON · SUSHI · UNISWAP</span>
          <span><b>DATA</b>30S SNAPSHOTS</span>
          <span><b>EXECUTION</b>SELF-CUSTODY</span>
        </div>
      </section>

      <OfficialRmtMarket />
      <ExternalMarketFeed />
      <SiteFooter />
    </main>
  );
}
