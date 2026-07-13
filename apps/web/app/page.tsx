"use client";

import Link from "next/link";
import { ExternalMarketFeed } from "./external-market-feed";
import { FreshLaunchFeed } from "./fresh-launch-feed";
import { LaunchForm } from "./launch-form";
import { WalletButton } from "./wallet-button";
import { WatchlistPanel } from "./watchlist-panel";
import { isMainnetRelease } from "../lib/network";
import "./launch-presets.css";

export default function Home() {
  return (
    <main>
      <nav className="appNav">
        <a className="brandLockup" href="#" aria-label="Robinhood Meme Terminal home"><img className="brandLogo" src="/brand/rmt-master-logo.png" alt="" /><strong>RMT</strong></a>
        <div className="primaryNav" aria-label="Primary navigation"><a href="#explore">Explore</a><a href="#launch">Launch</a><a href="#learn">How it works</a><Link href="/status">Status</Link></div>
        <WalletButton target={isMainnetRelease ? "mainnet" : "testnet"} />
      </nav>

      <section className="hero">
        <p className="eyebrow">ROBINHOOD CHAIN • {isMainnetRelease ? "LIVE MAINNET" : "ALPHA TESTNET"}</p>
        <h1>Find the move.<br />Launch the next one.</h1>
        <p className="sub">Live meme discovery, one-signature launches, transparent rewards, and automatic graduation—all in one focused terminal.</p>
        <div className="heroActions"><a className="primaryAction" href="#explore">See what’s moving</a><a className="secondaryAction" href="#launch">Launch a token</a></div>
        <div className="trustStrip"><span>No hidden minting</span><span>No transfer tax</span><span>Wallet-signed only</span></div>
      </section>

      <FreshLaunchFeed />
      <WatchlistPanel />
      <ExternalMarketFeed />

      <section className="launchZone" id="launch">
        <div className="zoneHeading"><div><p className="eyebrow">CREATE</p><h2>Launch in a few taps</h2></div><p>Name it, add the artwork, choose the launch style, and approve it in your wallet.</p></div>
        <div className="grid">
          <LaunchForm />
          <aside className="panel rewards" id="learn">
            <p className="eyebrow">HOW IT WORKS</p><h2>Simple for newcomers. Transparent for traders.</h2>
            <div className="howSteps">
              <div><b>1</b><span><strong>Connect any compatible wallet</strong><small>Use Robinhood Wallet’s Web3 browser, an installed browser wallet, or WalletConnect on mobile.</small></span></div>
              <div><b>2</b><span><strong>Launch with one signature</strong><small>RMT creates the fixed supply, market, and visible reward destinations together.</small></span></div>
              <div><b>3</b><span><strong>Trade, earn, graduate</strong><small>The curve handles trading and rewards; successful tokens graduate automatically.</small></span></div>
            </div>
            <div className="callout"><strong>{isMainnetRelease ? "Real ETH on mainnet" : "Testnet alpha"}</strong><span>{isMainnetRelease ? "Always review your wallet’s amount and gas estimate before signing." : "Practice launching, trading, and claiming without real funds."}</span></div>
            <Link className="statusLink" href="/status"><span className="statusDot operational" aria-hidden="true" />Live system status</Link>
          </aside>
        </div>
      </section>

      <nav className="mobileDock" aria-label="Mobile navigation"><a href="#explore"><span>◉</span>Explore</a><a href="#launch"><span>＋</span>Launch</a><a href="#learn"><span>?</span>Learn</a></nav>
    </main>
  );
}
