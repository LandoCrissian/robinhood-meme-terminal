"use client";

import { FreshLaunchFeed } from "./fresh-launch-feed";
import { LaunchForm } from "./launch-form";
import { WalletButton } from "./wallet-button";
import "./launch-presets.css";

export default function Home() {
  return (
    <main>
      <nav>
        <div className="brandLockup"><img className="brandLogo" src="/brand/rmt-master-logo.png" alt="Robinhood Meme Terminal" /><strong>Robinhood Meme Terminal</strong></div>
        <div><WalletButton /></div>
      </nav>
      <section className="hero">
        <p className="eyebrow">ROBINHOOD CHAIN • ALPHA</p>
        <h1>Launch first. Find runners faster. Reward the people who build.</h1>
        <p className="sub">A mobile-first meme launchpad and live discovery terminal with transparent creator and community economics.</p>
      </section>
      <div className="grid">
        <LaunchForm />
        <section className="panel rewards">
          <p className="eyebrow">AUTOMATIC BY DESIGN</p><h2>Launch without the technical setup</h2>
          <div className="automaticList"><div><b>✓</b><span>Fixed supply and market created together</span></div><div><b>✓</b><span>Trading begins on the bonding curve</span></div><div><b>✓</b><span>Graduation liquidity builds automatically</span></div><div><b>✓</b><span>Every fee destination remains visible onchain</span></div></div>
          <div className="callout"><strong>Three fields. One signature.</strong><span>Choose a launch style and the protocol handles everything else.</span></div>
        </section>
      </div>
      <FreshLaunchFeed />
    </main>
  );
}
