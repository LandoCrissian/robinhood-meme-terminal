"use client";

import { useMemo, useState } from "react";

const rewardDefaults = {
  creator: 30,
  community: 25,
  trader: 15,
  liquidity: 15,
  platform: 15
};

const mockLaunches = [
  { name: "Benchwarmer", ticker: "BENCH", age: "12s", marketCap: "$18.4K", holders: 31, score: 82 },
  { name: "Green Candle", ticker: "WICK", age: "48s", marketCap: "$42.1K", holders: 87, score: 75 },
  { name: "Robin Degen", ticker: "RDEGEN", age: "2m", marketCap: "$96.7K", holders: 143, score: 68 }
];

export default function Home() {
  const [name, setName] = useState("Robinhood Meme Terminal");
  const [ticker, setTicker] = useState("RMT");
  const [supply, setSupply] = useState("1000000000");

  const formattedSupply = useMemo(() => {
    const parsed = Number(supply);
    return Number.isFinite(parsed) ? parsed.toLocaleString() : "Invalid";
  }, [supply]);

  return (
    <main>
      <nav>
        <div><span className="logo">RMT</span><strong>Robinhood Meme Terminal</strong></div>
        <button className="wallet" disabled>Connect Wallet — next slice</button>
      </nav>

      <section className="hero">
        <p className="eyebrow">ROBINHOOD CHAIN • ALPHA</p>
        <h1>Launch first. Find runners faster. Reward the people who build.</h1>
        <p className="sub">A mobile-first meme launchpad and live discovery terminal with transparent creator and community economics.</p>
      </section>

      <div className="grid">
        <section className="panel">
          <div className="sectionTitle"><div><p className="eyebrow">GENESIS LAUNCH</p><h2>Configure your token</h2></div><span className="badge">READ-ONLY PREVIEW</span></div>
          <label>Token name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          <div className="two">
            <label>Ticker<input value={ticker} maxLength={10} onChange={(e) => setTicker(e.target.value.toUpperCase())} /></label>
            <label>Fixed supply<input inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value.replace(/\D/g, ""))} /></label>
          </div>
          <label>Description<textarea placeholder="What makes this meme worth watching?" /></label>
          <div className="summary">
            <div><small>Token</small><strong>{name || "Unnamed"}</strong></div>
            <div><small>Symbol</small><strong>${ticker || "—"}</strong></div>
            <div><small>Supply</small><strong>{formattedSupply}</strong></div>
          </div>
          <button className="launch" disabled>Deployment unlocks after contract tests</button>
          <p className="fineprint">No mint authority • No blacklist • No hidden transfer tax • Wallet-signed transactions only</p>
        </section>

        <section className="panel rewards">
          <p className="eyebrow">COMMUNITY LAUNCH MODEL</p>
          <h2>Where every platform fee goes</h2>
          {Object.entries(rewardDefaults).map(([key, value]) => (
            <div className="reward" key={key}>
              <div><span>{key}</span><strong>{value}%</strong></div>
              <div className="track"><div style={{ width: `${value}%` }} /></div>
            </div>
          ))}
          <div className="callout"><strong>100% disclosed.</strong><span>These percentages apply to the platform fee—not the entire trade value.</span></div>
        </section>
      </div>

      <section className="feed panel">
        <div className="sectionTitle"><div><p className="eyebrow">DISCOVERY TERMINAL</p><h2>Fresh launches</h2></div><span className="badge warning">MOCK DATA</span></div>
        <div className="filters"><button className="active">Fresh</button><button>Trending</button><button>Community-heavy</button><button>Low creator concentration</button></div>
        {mockLaunches.map((token) => (
          <article key={token.ticker}>
            <div className="coin">{token.ticker.slice(0, 2)}</div>
            <div className="identity"><strong>{token.name}</strong><span>${token.ticker} • {token.age}</span></div>
            <div><small>Market cap</small><strong>{token.marketCap}</strong></div>
            <div><small>Holders</small><strong>{token.holders}</strong></div>
            <div><small>Launch score</small><strong>{token.score}/100</strong></div>
          </article>
        ))}
      </section>
    </main>
  );
}
