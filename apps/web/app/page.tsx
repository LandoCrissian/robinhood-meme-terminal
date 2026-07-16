"use client";

import Link from "next/link";
import { DiscoverySearch } from "./discovery-search";
import { ExternalMarketFeed } from "./external-market-feed";
import { FreshLaunchFeed } from "./fresh-launch-feed";
import { LaunchpadNetwork } from "./launchpad-network";
import { PortfolioPanel } from "./portfolio-panel";
import { WalletButton } from "./wallet-button";
import { WatchlistPanel } from "./watchlist-panel";
import { isMainnetRelease } from "../lib/network";

export default function Home() {
  return (
    <main>
      <nav className="appNav">
        <a className="brandLockup" href="/" aria-label="Robinhood Meme Terminal home"><img className="brandLogo" src="/brand/rmt-master-logo.png" alt="" /><strong>RMT</strong></a>
        <div className="primaryNav" aria-label="Primary navigation"><a href="#explore">Terminal</a><Link href="/launch">Launch</Link><Link href="/status">Status</Link><Link href="/support">Support</Link></div>
        <WalletButton target={isMainnetRelease ? "mainnet" : "testnet"} />
      </nav>

      <section className="terminalIntro">
        <div><p className="eyebrow">ROBINHOOD CHAIN · {isMainnetRelease ? "V6 MAINNET" : "V6 TESTNET"}</p><h1>Discover. Trade. Launch.</h1><p>Verified RMT V6 launches plus clearly labeled external Robinhood Chain market discovery in one terminal.</p></div>
        <div className="terminalIntroActions"><a className="primaryAction" href="#explore">View live tokens</a><Link className="secondaryAction" href="/launch">Launch yours</Link></div>
        <div className="trustStrip"><span>Fixed supply</span><span>No transfer tax</span><span>Permissionless graduation</span></div>
      </section>

      <DiscoverySearch />
      <FreshLaunchFeed />
      <LaunchpadNetwork />
      <ExternalMarketFeed />
      <PortfolioPanel />
      <WatchlistPanel />

      <footer className="siteFooter">
        <Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/risks">Risks</Link><Link href="/support">Support</Link><Link href="/status">Status</Link>
        {isMainnetRelease && <span className="betaDisclosure">Mainnet beta · Contracts are not independently audited</span>}
        <span>Robinhood Meme Terminal is independent software and is not Robinhood Markets, Inc. or an endorsement by Robinhood.</span>
      </footer>

      <nav className="mobileDock" aria-label="Mobile navigation"><a href="#explore"><span>◉</span>Terminal</a><Link href="/launch"><span>＋</span>Launch</Link><Link href="/status"><span>●</span>Status</Link></nav>
    </main>
  );
}
