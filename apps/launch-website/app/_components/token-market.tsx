"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  checkpointFresh,
  ethTarget,
  intervalNames,
  marketIntervals,
  maxSold,
  validMarket,
  validMarketAbsence,
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
    [absence, setAbsence] = useState<{ token: string; timestamp: string } | null>(null),
    [failed, setFailed] = useState(false),
    [time, setTime] = useState(Date.now),
    [before, setBefore] = useState<number | null>(null),
    [attempt, setAttempt] = useState(0);
  const [side, setSide] = useState("Buy"),
    [quoteInput, setQuoteInput] = useState(""),
    [limitBps, setLimitBps] = useState(100);
  const order = useRef<HTMLElement>(null);
  const [orderVisible, setOrderVisible] = useState(false), [editing, setEditing] = useState(false);
  useEffect(() => {
    const element = order.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOrderVisible(entry.isIntersecting),
      { rootMargin: "-60px 0px 0px 0px" });
    observer.observe(element);
    const checkFocus = () => setEditing(!!element.contains(document.activeElement)
      && !!document.activeElement?.matches("input,textarea,select"));
    document.addEventListener("focusin", checkFocus);
    document.addEventListener("focusout", checkFocus);
    return () => { observer.disconnect(); document.removeEventListener("focusin", checkFocus); document.removeEventListener("focusout", checkFocus); };
  }, []);
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
    setActive(previous => previous?.token === token && previous.interval === interval ? previous : null);
    setAbsence(null);
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
        const data = await r.json();
        if (r.status === 404 && validMarketAbsence(data, token)) {
          if (alive) { setActive(null); setFailed(false); setAbsence({ token, timestamp: data.checkpoint.timestamp }); setTime(Date.now()); }
          return;
        }
        if (!r.ok) throw Error();
        if (!validMarket(data, token, interval)) throw Error();
        if (alive) {
          setAbsence(null);
          setActive(data);
          setFailed(false);
          setTime(Date.now());
        }
      } catch {
        if (alive) { setAbsence(null); setFailed(true); }
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
  }, [token, interval, before, replay, attempt]);
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
  const lastCandle = market?.candles.at(-1);
  const price = lastCandle?.close;
  const shownVolume = market?.candles.reduce((sum, candle) => sum + BigInt(candle.volumeWei), 0n);
  const priceText = (value: number) => value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
  if (absence?.token === token) {
    const current = time - Date.parse(absence.timestamp) < 120000;
    return <section className="lpNotice" role="status">
      <h2>{current ? "Token not found" : "Market verification pending"}</h2>
      <p>{current ? "The factory has no registration for this address at the verified checkpoint." : "Waiting for a fresh checkpoint."}</p>
    </section>;
  }
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
      <div className="rmSummary" aria-label="Market summary">
        <div><span>{before ? "Period close" : "Last trade"}</span><strong>{price === undefined ? "—" : priceText(price)} <small>ETH</small></strong></div>
        <div><span>FDV</span><strong>{price === undefined ? "—" : priceText(price * 1_000_000_000)} <small>ETH</small></strong></div>
        <div><span>Chart volume</span><strong>{shownVolume === undefined ? "—" : fmt(Number(shownVolume) / 1e18, 6)} <small>ETH</small></strong></div>
      </div>
      {(failed || stale) && <div className="rmRefreshNotice" role="status"><span>{market ? "Showing the last update. Reconnecting…" : "Market data is temporarily unavailable."}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
      <a className="rmTradeDock" href="#trade" hidden={orderVisible || editing}>
        {children ? "Trade " + symbol : "View trading status"}<span aria-hidden="true">↑↓</span>
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
                  ? "FDV in ETH"
                  : "Price in gwei"}
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
                    ? "Chart unavailable"
                    : "Loading chart…"}
              </h3>
              <p>
                {market
                  ? "Trades will appear here."
                  : failed ? "Retry when the connection recovers." : ""}
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
            <details className="rmDataDetails"><summary>Chart details</summary><div>
              <p>Volume covers the displayed candles, after trading fees and excluding gas. Empty intervals have no candle. FDV uses the last recorded price and the fixed 1B supply.</p>
              {market && <p>Block {market.checkpoint.blockNumber} · {new Date(market.checkpoint.timestamp).toISOString().slice(11, 19)} UTC. L2 observation; Ethereum L1 settlement unverified.</p>}
              {market?.graduation && <p>Graduated {new Date(market.graduation.time * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC.</p>}
            </div></details>
            <a
              href="https://www.tradingview.com/"
              target="_blank"
              rel="noreferrer"
            >
              Lightweight Charts™ by TradingView
            </a>
          </footer>
        </section>
        <aside ref={order} className="rmOrder" id="trade" tabIndex={-1}>
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
      <section className="rmProgress" aria-label="Graduation progress">
        <div>
          <strong>{market ? state : "Graduation progress"}</strong>
          <span className="rmStatus">
            {replay
              ? "Recorded checkpoint"
              : stale
                ? "Last verified · stale"
                : fresh
                  ? "Updated"
                  : failed
                    ? "Reconnecting"
                    : "Updating…"}
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
                  ETH backing{" "}
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
            Waiting for the latest update.
          </p>
        )}
      </section>
    </div>
  );
}
