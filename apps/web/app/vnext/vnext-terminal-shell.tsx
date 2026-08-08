"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

type MarketFixture = {
  symbol: string;
  name: string;
  price: string;
  change: string;
  liquidity: string;
  signal: string;
  tone: "positive" | "warning" | "neutral";
  age: string;
  holding: string;
};

const markets: MarketFixture[] = [
  { symbol: "RMT", name: "Robinhood Meme Terminal", price: "$0.00418", change: "+18.4%", liquidity: "$286K", signal: "Momentum", tone: "positive", age: "V6 native", holding: "86,205 RMT" },
  { symbol: "THINK", name: "Thinking Cat", price: "$0.000842", change: "+7.8%", liquidity: "$142K", signal: "Active", tone: "positive", age: "2d", holding: "41,822 THINK" },
  { symbol: "MOG", name: "Mog on Robinhood", price: "$0.0124", change: "−2.1%", liquidity: "$91K", signal: "Review", tone: "warning", age: "6h", holding: "0 MOG" },
  { symbol: "NOVA", name: "Nova Protocol", price: "$0.0781", change: "+1.2%", liquidity: "$418K", signal: "Steady", tone: "neutral", age: "14d", holding: "1,204 NOVA" }
];

const navItems = [
  { label: "Terminal", icon: "⌂" },
  { label: "Markets", icon: "⌕" },
  { label: "Portfolio", icon: "◫" },
  { label: "Activity", icon: "↗" }
];

function MarketMark({ symbol }: { symbol: string }) {
  return <span className={`vnMarketMark vnMarketMark${symbol}`} aria-hidden="true">{symbol.slice(0, 1)}</span>;
}

function TrendChart() {
  return (
    <svg className="vnChart" viewBox="0 0 680 240" role="img" aria-label="Illustrative seven-day RMT price trend">
      <defs>
        <linearGradient id="vnChartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#82f28f" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#82f28f" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="vnChartStroke" x1="0" x2="1">
          <stop offset="0%" stopColor="#6ede7c" />
          <stop offset="100%" stopColor="#b9ff9f" />
        </linearGradient>
      </defs>
      <g className="vnChartGrid">
        <path d="M0 40H680M0 100H680M0 160H680M0 220H680" />
        <path d="M80 0V240M220 0V240M360 0V240M500 0V240M640 0V240" />
      </g>
      <path className="vnChartArea" d="M0 205 C42 196 54 202 84 184 S140 181 165 154 S218 170 252 136 S310 143 338 112 S389 129 421 88 S476 105 509 70 S568 93 604 50 S648 52 680 24 L680 240 L0 240Z" />
      <path className="vnChartLine" d="M0 205 C42 196 54 202 84 184 S140 181 165 154 S218 170 252 136 S310 143 338 112 S389 129 421 88 S476 105 509 70 S568 93 604 50 S648 52 680 24" />
      <circle className="vnChartPoint" cx="680" cy="24" r="5" />
    </svg>
  );
}

export function VNextTerminalShell() {
  const [selectedSymbol, setSelectedSymbol] = useState("RMT");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [query, setQuery] = useState("");

  const selected = markets.find((market) => market.symbol === selectedSymbol) ?? markets[0];
  const filteredMarkets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return markets;
    return markets.filter((market) => `${market.symbol} ${market.name}`.toLowerCase().includes(normalized));
  }, [query]);

  return (
    <main className="rmtVnext">
      <a className="vnSkipLink" href="#vnext-workspace">Skip to trading workspace</a>
      <aside className="vnSidebar" aria-label="VNext navigation">
        <Link className="vnBrand" href="/" aria-label="Return to the current RMT terminal">
          <Image src="/brand/rmt-master-logo.png" alt="" width={42} height={42} priority />
          <span><strong>RMT</strong><small>Terminal</small></span>
        </Link>
        <nav className="vnPrimaryNav">
          {navItems.map((item, index) => (
            <button className={index === 0 ? "isActive" : ""} type="button" key={item.label}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="vnSidebarFoot">
          <span className="vnNetworkDot" aria-hidden="true" />
          <span><strong>Robinhood Chain</strong><small>Mainnet · 4663</small></span>
        </div>
      </aside>

      <div className="vnApp">
        <header className="vnTopbar">
          <div className="vnMobileBrand">
            <Image src="/brand/rmt-master-logo.png" alt="" width={36} height={36} priority />
            <strong>RMT</strong>
          </div>
          <div className="vnTopbarTitle">
            <span className="vnPreviewPill">VNext preview</span>
            <span className="vnChainLabel"><i aria-hidden="true" /> Robinhood Chain</span>
          </div>
          <div className="vnTopbarActions">
            <button className="vnIconButton" type="button" aria-label="Open notifications">○<span className="vnUnread" /></button>
            <button className="vnWalletButton" type="button"><span className="vnWalletAvatar">L</span><span>0xF6d1…830F</span><b aria-hidden="true">⌄</b></button>
          </div>
        </header>

        <div className="vnCanvas" id="vnext-workspace">
          <section className="vnBalanceBar" aria-labelledby="vn-balance-heading">
            <div className="vnBalancePrimary">
              <span id="vn-balance-heading">Available to trade</span>
              <strong>$428.16</strong>
              <small><i aria-hidden="true" /> Settled USDG</small>
            </div>
            <div className="vnBalanceMetric">
              <span>Portfolio</span>
              <strong>$1,862.34</strong>
              <small className="vnPositive">+$84.22 today</small>
            </div>
            <div className="vnBalanceMetric">
              <span>Pending</span>
              <strong>+$102.82</strong>
              <small>Awaiting settlement</small>
            </div>
            <div className="vnBalanceActions">
              <button className="vnPrimaryButton" type="button"><span aria-hidden="true">＋</span> Deposit</button>
              <button className="vnQuietButton" type="button">Withdraw</button>
            </div>
          </section>

          <div className="vnWorkspaceGrid">
            <section className="vnMarketPanel" aria-labelledby="vn-markets-heading">
              <div className="vnSectionHeading">
                <div><span className="vnEyebrow">Discover</span><h1 id="vn-markets-heading">Markets</h1></div>
                <button className="vnFilterButton" type="button">Trending <span aria-hidden="true">⌄</span></button>
              </div>
              <label className="vnSearch">
                <span aria-hidden="true">⌕</span>
                <span className="vnSrOnly">Search markets</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search asset or address" />
                <kbd>/</kbd>
              </label>
              <div className="vnMarketTabs" role="tablist" aria-label="Market categories">
                <button className="isActive" type="button" role="tab" aria-selected="true">Trending</button>
                <button type="button" role="tab" aria-selected="false">New</button>
                <button type="button" role="tab" aria-selected="false">Watchlist</button>
              </div>
              <div className="vnMarketList" aria-live="polite">
                {filteredMarkets.map((market) => (
                  <button
                    className={`vnMarketRow${selected.symbol === market.symbol ? " isSelected" : ""}`}
                    key={market.symbol}
                    type="button"
                    onClick={() => setSelectedSymbol(market.symbol)}
                    aria-pressed={selected.symbol === market.symbol}
                  >
                    <MarketMark symbol={market.symbol} />
                    <span className="vnMarketIdentity"><strong>{market.symbol}</strong><small>{market.name}</small></span>
                    <span className="vnMarketPrice"><strong>{market.price}</strong><small className={market.change.startsWith("+") ? "vnPositive" : "vnNegative"}>{market.change}</small></span>
                    <span className={`vnSignal vnSignal${market.tone}`}><i aria-hidden="true" />{market.signal}</span>
                  </button>
                ))}
                {filteredMarkets.length === 0 && <div className="vnNoResults"><strong>No matching assets</strong><span>Try a symbol, name, or verified contract address.</span></div>}
              </div>
              <button className="vnViewAll" type="button">View all markets <span aria-hidden="true">→</span></button>
            </section>

            <section className="vnAssetPanel" aria-labelledby="vn-asset-heading">
              <div className="vnAssetHeader">
                <div className="vnAssetIdentity">
                  <MarketMark symbol={selected.symbol} />
                  <div><span><h2 id="vn-asset-heading">{selected.name}</h2><b>{selected.symbol}</b></span><small>Robinhood Chain · Verified identity</small></div>
                </div>
                <button className="vnStarButton" type="button" aria-label={`Add ${selected.symbol} to watchlist`}>☆</button>
              </div>
              <div className="vnPriceHeader">
                <div><strong>{selected.price}</strong><span className={selected.change.startsWith("+") ? "vnPositive" : "vnNegative"}>{selected.change} <small>24h</small></span></div>
                <div className="vnTimeframes" aria-label="Chart timeframe">
                  {['1H', '1D', '1W', '1M'].map((timeframe) => <button className={timeframe === '1W' ? 'isActive' : ''} type="button" key={timeframe}>{timeframe}</button>)}
                </div>
              </div>
              <div className="vnChartWrap"><TrendChart /><span className="vnChartNow">Now</span></div>
              <dl className="vnAssetStats">
                <div><dt>Market cap</dt><dd>$4.18M</dd></div>
                <div><dt>Liquidity</dt><dd>{selected.liquidity}</dd></div>
                <div><dt>24h volume</dt><dd>$312K</dd></div>
                <div><dt>Market age</dt><dd>{selected.age}</dd></div>
              </dl>
              <div className="vnEvidence">
                <div><span className="vnEvidenceIcon" aria-hidden="true">✓</span><span><strong>Identity verified</strong><small>Chain and token contract confirmed</small></span></div>
                <button type="button">View market evidence <span aria-hidden="true">→</span></button>
              </div>
            </section>

            <aside className="vnTradePanel" aria-labelledby="vn-trade-heading">
              <div className="vnTradeHeader">
                <div><span className="vnEyebrow">Trade</span><h2 id="vn-trade-heading">{selected.symbol}</h2></div>
                <span className="vnFixtureBadge">Preview data</span>
              </div>
              <div className="vnSideTabs" role="tablist" aria-label="Trade side">
                <button className={side === "buy" ? "isActive" : ""} onClick={() => setSide("buy")} type="button" role="tab" aria-selected={side === "buy"}>Buy</button>
                <button className={side === "sell" ? "isActive" : ""} onClick={() => setSide("sell")} type="button" role="tab" aria-selected={side === "sell"}>Sell</button>
              </div>
              <div className="vnAvailableLine"><span>{side === "buy" ? "Available" : "Your position"}</span><strong>{side === "buy" ? "$428.16" : selected.holding}</strong></div>
              <label className="vnAmountField">
                <span>You {side === "buy" ? "pay" : "sell"}</span>
                <div>{side === "buy" && <span className="vnCurrencyBadge">$</span>}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label={`Amount to ${side}`} /><button type="button">{side === "buy" ? "USDG" : selected.symbol} ⌄</button></div>
              </label>
              <div className="vnQuickAmounts">
                {(side === "buy" ? ["25", "50", "100", "250"] : ["25%", "50%", "75%", "Max"]).map((preset) => (
                  <button className={preset === amount ? "isActive" : ""} type="button" key={preset} onClick={() => setAmount(preset)}>{side === "buy" && preset !== "Max" ? "$" : ""}{preset}</button>
                ))}
              </div>
              <div className="vnSwapDivider"><span aria-hidden="true">↓</span></div>
              <div className="vnReceiveField">
                <span>You receive</span>
                <div><strong>{side === "buy" ? "24,581" : "$102.82"}</strong><button type="button">{side === "buy" ? selected.symbol : "USDG"} ⌄</button></div>
                <small>Protected: {side === "buy" ? `24,312 ${selected.symbol}` : "$101.74 USDG"}</small>
              </div>
              <div className="vnRouteCard">
                <div className="vnRouteTop"><span><i aria-hidden="true" /> Example best execution</span><strong>UniswapX</strong></div>
                <dl>
                  <div><dt>Trader gas</dt><dd>Filler pays</dd></div>
                  <div><dt>Expected settlement</dt><dd>~8 sec</dd></div>
                  <div><dt>RMT fee</dt><dd>Not enabled</dd></div>
                </dl>
                <button type="button">Compare example routes <span aria-hidden="true">⌄</span></button>
              </div>
              <button className="vnReviewButton" type="button" disabled>Preview only — trading disabled</button>
              <p className="vnTradeFootnote">This isolated shell cannot request quotes, approvals, signatures, or transactions.</p>
            </aside>
          </div>
        </div>
      </div>

      <nav className="vnMobileDock" aria-label="VNext mobile navigation">
        {navItems.map((item, index) => <button className={index === 0 ? "isActive" : ""} type="button" key={item.label}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
      </nav>
    </main>
  );
}
