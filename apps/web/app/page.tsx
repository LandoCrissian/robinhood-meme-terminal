"use client";

import { FreshLaunchFeed } from "./fresh-launch-feed";
import { LaunchForm } from "./launch-form";
import { WalletButton } from "./wallet-button";

const rewardDefaults = { creator: 30, community: 25, trader: 15, liquidity: 15, platform: 15 };

export default function Home() {
  return (
    <main>
      <nav>
        <div><span className="logo">RMT</span><strong>Robinhood Meme Terminal</strong></div>
        <WalletButton />
      </nav>
      <section className="hero">
        <p className="eyebrow">ROBINHOOD CHAIN • ALPHA</p>
        <h1>Launch first. Find runners faster. Reward the people who build.</h1>
        <p className="sub">A mobile-first meme launchpad and live discovery terminal with transparent creator and community economics.</p>
      </section>
      <div className="grid">
        <LaunchForm />
        <section className="panel rewards">
          <p className="eyebrow">COMMUNITY LAUNCH MODEL</p><h2>Where every platform fee goes</h2>
          {Object.entries(rewardDefaults).map(([key, value]) => <div className="reward" key={key}><div><span>{key}</span><strong>{value}%</strong></div><div className="track"><div style={{ width: `${value}%` }} /></div></div>)}
          <div className="callout"><strong>100% disclosed.</strong><span>These percentages apply to the platform fee—not the entire trade value.</span></div>
        </section>
      </div>
      <FreshLaunchFeed />
    </main>
  );
}
