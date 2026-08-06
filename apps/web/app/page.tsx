import type { Metadata } from "next";
import Link from "next/link";
import { ExternalMarketFeed } from "./external-market-feed";
import { OfficialRmtMarket } from "./official-rmt-market";
import { isMainnetRelease } from "../lib/network";
import {
  RMT_SITE_ALTERNATE_NAME,
  RMT_SITE_NAME
} from "../lib/site-identity";
import { SiteFooter } from "./site-footer";

const terminalDescription = "Scan live Robinhood Chain markets, inspect origin and liquidity evidence, and prepare self-custodial Sushi or Uniswap trades from one terminal.";

export const metadata: Metadata = {
  title: `${RMT_SITE_NAME} | ${RMT_SITE_ALTERNATE_NAME}`,
  description: terminalDescription,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: RMT_SITE_NAME,
    title: `${RMT_SITE_NAME} | ${RMT_SITE_ALTERNATE_NAME}`,
    description: terminalDescription,
    url: "/",
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary",
    title: `${RMT_SITE_NAME} | ${RMT_SITE_ALTERNATE_NAME}`,
    description: terminalDescription,
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function Home() {
  return (
    <main className="terminalPage">
      <section className="terminalIntro">
        <div className="terminalIntroCopy">
          <p className="eyebrow">ROBINHOOD CHAIN · LIVE MARKET TERMINAL</p>
          <h1>Find the market. Read the evidence. Trade.</h1>
          <p>Live discovery, verified origin, price action, liquidity, and self-custodial execution across Robinhood Chain.</p>
        </div>
        <div className="terminalIntroActions">
          <Link className="primaryAction" href="#market-explorer">Scan markets</Link>
          <Link className="secondaryAction" href="/watchlist">Open watchlist</Link>
        </div>
        <div className="trustStrip" aria-label="Terminal operating status">
          <span><b>NETWORK</b><i aria-hidden="true" />{isMainnetRelease ? "RHC MAINNET · 4663" : "RHC TESTNET · 46630"}</span>
          <span><b>ROUTING</b>SUSHI · UNISWAP</span>
          <span><b>DATA</b>30S LIVE SNAPSHOTS</span>
          <span><b>CONTROL</b>WALLET SIGNS</span>
        </div>
      </section>

      <OfficialRmtMarket />
      <ExternalMarketFeed />
      <SiteFooter />
    </main>
  );
}
