"use client";
import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  checkpointFresh,
  ethTarget,
  intervalNames,
  marketIntervals,
  maxSold,
  validMarket,
  type MarketSnapshot,
} from "../../lib/token-market";
const MarketChart = dynamic(
  () => import("./market-chart").then((m) => m.MarketChart),
  { ssr: false, loading: () => <div className="rmEmpty">Loading chart…</div> },
);
export type ReplayFrame = Omit<
  MarketSnapshot,
  "interval" | "earlier" | "candles"
> & {
  label: string;
  quotes: {
    side: string;
    input: string;
    outputWei: string;
    refundWei: string;
  }[];
  charts: Record<string, MarketSnapshot["candles"]>;
};
const fmt = (n: number, digits = 5) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits });
export function TokenMarket({
  token,
  symbol,
  children,
  replay,
}: {
  token: string;
  symbol: string;
  children?: ReactNode;
  replay?: ReplayFrame[];
}) {
  const [interval, setIntervalValue] = useState(60),
    [fdv, setFdv] = useState(false),
    [index, setIndex] = useState((replay?.length ?? 1) - 1);
  const [active, setActive] = useState<MarketSnapshot | null>(null),
    [failed, setFailed] = useState(false),
    [time, setTime] = useState(Date.now),
    [before, setBefore] = useState<number | null>(null);
  const [side, setSide] = useState("Buy"),
    [quoteInput, setQuoteInput] = useState(""),
    [limitBps, setLimitBps] = useState(100);
  const frame = replay?.[index],
    recorded = frame
      ? { ...frame, interval, candles: frame.charts[interval], earlier: false }
      : null;
  const market =
    recorded && validMarket(recorded, token, interval)
      ? recorded
      : active?.token === token && active.interval === interval
        ? active
        : null;
  useEffect(() => {
    if (replay) return;
    let alive = true;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setActive(null);
    setFailed(false);
    async function refresh() {
      try {
        const r = await fetch(
          "/api/launchpad/market/" +
            token +
            "?interval=" +
            interval +
            (before ? "&before=" + before : ""),
          {
            cache: "no-store",
            signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(11000)]),
          },
        );
        if (!r.ok) throw Error();
        const data = await r.json();
        if (!validMarket(data, token, interval)) throw Error();
        if (alive) {
          setActive(data);
          setFailed(false);
          setTime(Date.now());
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) timer = setTimeout(refresh, 15000);
      }
    }
    void refresh();
    const tick = setInterval(() => setTime(Date.now()), 1000);
    return () => {
      alive = false;
      ctrl.abort();
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [token, interval, before, replay]);
  const fresh = !!market && !failed && checkpointFresh(market, time),
    stale = !!market && !replay && !fresh;
  const pct = market
    ? Number((BigInt(market.soldWei) * 10000n) / maxSold) / 100
    : null;
  const state =
    market?.phase === "graduated"
      ? "Graduated to Uniswap v4"
      : market?.phase === "eligible"
        ? "Graduation pending"
        : "Bonding curve";
  const options = frame?.quotes?.filter((q) => q.side === side) ?? [],
    quoted = options.find((q) => q.input === quoteInput) ?? options[0];
  return (
    <div className="rmWorkspace">
      {replay && (
        <label className="rmReplay">
          Isolated fork replay{" "}
          <select
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {replay.map((f, i) => (
              <option key={i} value={i}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <section className="rmProgress" aria-label="Graduation progress">
        <div>
          <strong>{market ? state : "Graduation progress"}</strong>
          <span className="rmStatus">
            {replay
              ? "Recorded checkpoint"
              : stale
                ? "Last verified · stale"
                : fresh
                  ? "Live · confirmed L2"
                  : failed
                    ? "Feed unavailable"
                    : "Checking indexer…"}
          </span>
        </div>
        {pct !== null && market ? (
          <>
            <div className="rmNumbers">
              <span>
                <b>{fmt(Number(market.soldWei) / 1e18, 2)}</b> / 600M tokens net
                sold
              </span>
              <strong>{pct === 100 ? "100" : fmt(pct, 2)}%</strong>
            </div>
            <progress
              aria-label="Net curve tokens sold"
              max="100"
              value={pct}
            />
            <p>
              {market.graduation ? (
                <>
                  Graduation funding <b>2 ETH</b> · sent to the locked position{" "}
                  <b>
                    ≈{fmt(Number(market.graduation.nativeUsedWei) / 1e18, 8)}{" "}
                    ETH
                  </b>{" "}
                  · current curve backing 0 ETH
                </>
              ) : (
                <>
                  Real curve backing{" "}
                  <b>
                    {fmt(Number(market.backingWei) / 1e18, 8)} /{" "}
                    {Number(ethTarget) / 1e18} ETH
                  </b>
                </>
              )}
              {market.phase === "eligible" &&
                " · Awaiting the graduation transaction."}
            </p>
          </>
        ) : (
          <p>
            Verified token sales and real backing will appear when the canonical
            checkpoint is available.
          </p>
        )}
      </section>
      <a className="rmTradeJump" href="#trade">
        Buy / Sell ↓
      </a>
      <div className="rmGrid">
        <section className="rmChart" aria-label="Token trading chart">
          <header>
            <div>
              <h2>
                {symbol} <small>/ ETH</small>
              </h2>
              <p>
                {fdv
                  ? "Fully diluted valuation · ETH · 1B fixed supply"
                  : "Execution price · gwei per token"}
              </p>
            </div>
            <div className="rmToggle">
              {["Price", "FDV"].map((label, i) => (
                <button
                  key={label}
                  aria-pressed={fdv === Boolean(i)}
                  onClick={() => setFdv(Boolean(i))}
                >
                  {label}
                </button>
              ))}
            </div>
          </header>
          <nav className="rmIntervals" aria-label="Candle interval">
            {marketIntervals.map((v, i) => (
              <button
                key={v}
                onClick={() => {
                  setBefore(null);
                  setIntervalValue(v);
                }}
                aria-pressed={interval === v}
              >
                {intervalNames[i]}
              </button>
            ))}
          </nav>
          {market?.candles.length ? (
            <MarketChart market={market} fdv={fdv} />
          ) : (
            <div className="rmEmpty">
              <h3>
                {market
                  ? "No trades in this window"
                  : failed
                    ? "Trade history unavailable"
                    : "Waiting for trade history"}
              </h3>
              <p>
                {market
                  ? "The first verified fill in this window will form a candle."
                  : "Candles require a verified market feed."}
              </p>
            </div>
          )}
          {(market?.earlier || before) && (
            <div className="rmIntervals">
              {market?.earlier && (
                <button onClick={() => setBefore(market.candles[0].time)}>
                  Earlier candles
                </button>
              )}
              {before && (
                <button onClick={() => setBefore(null)}>Latest candles</button>
              )}
            </div>
          )}
          <footer>
            ETH volume measures amounts paid on buys and received on sells,
            after trading fees. Gas is excluded. Empty intervals have no candle.
            {market && (
              <span>
                Block {market.checkpoint.blockNumber} ·{" "}
                {new Date(market.checkpoint.timestamp)
                  .toISOString()
                  .slice(11, 19)}{" "}
                UTC
              </span>
            )}
            {market?.graduation && (
              <span>
                Graduated{" "}
                {new Date(market.graduation.time * 1000)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19)}{" "}
                UTC
              </span>
            )}
            <a
              href="https://www.tradingview.com/"
              target="_blank"
              rel="noreferrer"
            >
              Lightweight Charts™ by TradingView
            </a>
          </footer>
        </section>
        <aside className="rmOrder" id="trade">
          {children || (
            <>
              <h2>Trade {symbol}</h2>
              <div className="rmToggle">
                {["Buy", "Sell"].map((s) => (
                  <button
                    key={s}
                    aria-pressed={side === s}
                    onClick={() => setSide(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p>
                {side === "Buy"
                  ? "Pay ETH to receive " + symbol + "."
                  : "Sell " + symbol + " to receive ETH."}
              </p>
              {replay &&
                (quoted ? (
                  <div className="rmQuoteForm">
                    <label>
                      Quote amount{" "}
                      <select
                        value={quoted.input}
                        onChange={(e) => setQuoteInput(e.target.value)}
                      >
                        {options.map((q) => (
                          <option key={q.input} value={q.input}>
                            {q.input} {side === "Buy" ? "ETH" : symbol}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>
                      Quoted output{" "}
                      <b>
                        {fmt(Number(quoted.outputWei) / 1e18, 8)}{" "}
                        {side === "Buy" ? symbol : "ETH"}
                      </b>
                    </p>
                    <small>Contract quote at this recorded block</small>
                    <details
                      key={
                        frame?.checkpoint.blockHash +
                        ":" +
                        quoted.side +
                        ":" +
                        quoted.input
                      }
                    >
                      <summary>Review quote</summary>
                      <label>
                        Slippage limit{" "}
                        <select
                          value={limitBps}
                          onChange={(e) => setLimitBps(Number(e.target.value))}
                        >
                          {[10, 50, 100, 200, 500].map((bps) => (
                            <option key={bps} value={bps}>
                              {bps / 100}%
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>
                        Minimum received{" "}
                        <b>
                          {fmt(
                            Number(
                              (BigInt(quoted.outputWei) *
                                BigInt(10000 - limitBps)) /
                                10000n,
                            ) / 1e18,
                            8,
                          )}{" "}
                          {side === "Buy" ? symbol : "ETH"}
                        </b>
                      </p>
                      {BigInt(quoted.refundWei) > 0n && (
                        <p>
                          Expected refund{" "}
                          <b>{fmt(Number(quoted.refundWei) / 1e18, 8)} ETH</b>
                        </p>
                      )}
                    </details>
                  </div>
                ) : (
                  <p>No executable quote at this checkpoint.</p>
                ))}
              <button className="rmDisabled" disabled>
                {side} unavailable
              </button>
              <small>
                {replay
                  ? "Read-only fork replay. Wallet requests are disabled."
                  : "Website trading is disabled."}
              </small>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
