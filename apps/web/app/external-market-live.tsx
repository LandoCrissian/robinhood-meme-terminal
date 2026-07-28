"use client";

import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import type { ExternalMarket } from "../lib/external-market";
import type { ExternalPoolTradesPayload } from "../lib/external-trades";

const EXPLORER = "https://robinhoodchain.blockscout.com";

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function compact(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString(undefined, {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits
  });
}

function relativeTime(timestamp: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h`;
}

export function ExternalWalletPosition({
  market,
  onBuy,
  onSell
}: {
  market: ExternalMarket;
  onBuy: () => void;
  onSell: () => void;
}) {
  const { address } = useAccount();
  const token = market.address as Address;
  const decimals = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: 4663,
    query: { retry: false }
  });
  const balance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: 4663,
    query: { enabled: Boolean(address), retry: false, refetchInterval: 10_000 }
  });
  const units = useMemo(() => {
    if (balance.data === undefined || decimals.data === undefined) return null;
    const parsed = Number(formatUnits(balance.data, decimals.data));
    return Number.isFinite(parsed) ? parsed : null;
  }, [balance.data, decimals.data]);

  return (
    <section className="universalPosition" aria-labelledby="universal-position-heading">
      <header><div><small>YOUR POSITION</small><h3 id="universal-position-heading">{address ? `Wallet ${shortAddress(address)}` : "Connect to see holdings"}</h3></div><span>Onchain balance</span></header>
      {address ? (
        <div className="universalPositionBody">
          <span><small>HOLDINGS</small><strong>{units === null ? "Reading…" : `${compact(units, 4)} ${market.symbol}`}</strong></span>
          <span><small>CURRENT VALUE</small><strong>{units === null ? "—" : `$${compact(units * market.priceUsd)}`}</strong></span>
          <div><button type="button" onClick={onBuy}>Buy more</button><button type="button" onClick={onSell}>Sell position</button></div>
        </div>
      ) : <p>Connect from the order ticket to display this wallet’s token balance and current market value.</p>}
      <footer>Cost basis and P&amp;L are withheld until RMT can prove complete wallet history.</footer>
    </section>
  );
}

export function ExternalTradeTape({ market }: { market: ExternalMarket }) {
  const [payload, setPayload] = useState<ExternalPoolTradesPayload>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    const load = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const query = new URLSearchParams({ token: market.address, pair: market.pairAddress });
        const response = await fetch(`/api/markets/external-trades?${query}`, { signal: controller.signal });
        const next = await response.json() as ExternalPoolTradesPayload | { error?: string };
        if (!response.ok || !("trades" in next)) throw new Error("Trade tape unavailable.");
        if (
          next.token.toLowerCase() !== market.address.toLowerCase()
          || next.pair.toLowerCase() !== market.pairAddress.toLowerCase()
          || !Array.isArray(next.trades)
        ) throw new Error("RMT rejected mismatched trade data.");
        if (active) {
          setPayload(next);
          setStatus("ready");
        }
      } catch {
        if (active) setStatus("error");
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [market.address, market.pairAddress]);

  return (
    <section className="universalTradeTape" aria-labelledby="universal-trade-tape-heading">
      <header>
        <div><small>LIVE TRADE TAPE</small><h3 id="universal-trade-tape-heading">Latest confirmed swaps</h3></div>
        <span>{status === "loading" ? "Syncing…" : status === "error" ? "Retrying" : `${payload?.trades.length ?? 0} shown · 10s`}</span>
      </header>
      {payload?.trades.length ? (
        <div className="universalTradeTapeList">
          {payload.trades.map((trade) => (
            <a href={`${EXPLORER}/tx/${trade.transactionHash}`} target="_blank" rel="noopener noreferrer" key={trade.id}>
              <span className={trade.side}>{trade.side.toUpperCase()}</span>
              <span><strong>{compact(trade.tokenAmount)} {market.symbol}</strong><small>{shortAddress(trade.trader)}</small></span>
              <span><strong>${compact(trade.volumeUsd)}</strong><small>{relativeTime(trade.timestamp)} ago ↗</small></span>
            </a>
          ))}
        </div>
      ) : (
        <div className="universalTradeTapeEmpty">
          <strong>{status === "error" ? "Trade tape delayed" : status === "loading" ? "Loading confirmed swaps…" : "No recent swaps"}</strong>
          <span>{status === "error" ? "The workspace will retry automatically." : "New pool activity will appear here automatically."}</span>
        </div>
      )}
      <footer>Read-only activity from the exact displayed pool · source: GeckoTerminal</footer>
    </section>
  );
}
