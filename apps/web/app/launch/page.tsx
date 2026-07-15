"use client";

import Link from "next/link";
import { isMainnetRelease } from "../../lib/network";
import { LaunchForm } from "../launch-form";
import { WalletButton } from "../wallet-button";
import "../launch-presets.css";

export default function LaunchPage() {
  return (
    <main className="launchPage">
      <nav className="appNav launchPageNav">
        <Link className="brandLockup" href="/" aria-label="Robinhood Meme Terminal home"><img className="brandLogo" src="/brand/rmt-master-logo.png" alt="" /><strong>RMT</strong></Link>
        <div className="primaryNav" aria-label="Primary navigation"><Link href="/">Terminal</Link><Link href="/launch">Launch</Link><Link href="/status">Status</Link><Link href="/support">Support</Link></div>
        <WalletButton target={isMainnetRelease ? "mainnet" : "testnet"} />
      </nav>

      <header className="launchPageHeader">
        <div><p className="eyebrow">CREATE ON RMT V6</p><h1>Launch a meme in one transaction.</h1><p>Name it, add the artwork, choose Fair Start protection, and approve the complete launch in your wallet.</p></div>
        <div className="launchAssurances"><span>Fixed 1B supply</span><span>Unique name + ticker</span><span>No mint or transfer tax</span></div>
      </header>

      <div className="launchPageGrid">
        <LaunchForm />
        <aside className="panel rewards launchGuide">
          <p className="eyebrow">WHAT HAPPENS</p><h2>Simple to launch. Clear to verify.</h2>
          <div className="howSteps">
            <div><b>1</b><span><strong>Connect a compatible wallet</strong><small>Use Robinhood Wallet, an installed EVM wallet, or WalletConnect on mobile.</small></span></div>
            <div><b>2</b><span><strong>Confirm one launch transaction</strong><small>RMT creates the fixed-supply token, bonding curve, and fee splitter together.</small></span></div>
            <div><b>3</b><span><strong>Share, trade, and graduate</strong><small>Your verified page appears automatically. Creator rewards continue through graduation under the launch’s permanent split.</small></span></div>
          </div>
          <div className="callout"><strong>{isMainnetRelease ? "Mainnet uses real ETH" : "Testnet practice mode"}</strong><span>{isMainnetRelease ? "Review every field and your wallet’s network and gas details before signing." : "Practice launching and trading without real funds."}</span></div>
          <Link className="statusLink" href="/status"><span className="statusDot operational" aria-hidden="true" />View live system status</Link>
        </aside>
      </div>

      <footer className="siteFooter"><Link href="/terms">Terms</Link><Link href="/risks">Risks</Link><Link href="/support">Support</Link><Link href="/status">Status</Link><span>RMT is independent software and is not Robinhood Markets, Inc.</span></footer>
      <nav className="mobileDock" aria-label="Mobile navigation"><Link href="/"><span>◉</span>Terminal</Link><Link href="/launch"><span>＋</span>Launch</Link><Link href="/status"><span>●</span>Status</Link></nav>
    </main>
  );
}
