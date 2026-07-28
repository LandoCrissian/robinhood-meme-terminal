"use client";

import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import type { ExternalMarket } from "../lib/external-market";
import { summarizeExternalTradeActors, type ExternalPoolTradesPayload } from "../lib/external-trades";
import { formatOwnershipBps } from "../lib/token-risk-evidence";
import { useWalletConstellation } from "../lib/use-wallet-constellation";
import type {
  WalletConstellationNode,
  WalletConstellationNodeRole
} from "../lib/wallet-constellation";

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

  const actorSummary = useMemo(
    () => summarizeExternalTradeActors(payload?.trades ?? []),
    [payload?.trades]
  );
  const largestNetActor = (
    Math.abs(actorSummary.largestNetBuyer?.netVolumeUsd ?? 0)
    >= Math.abs(actorSummary.largestNetSeller?.netVolumeUsd ?? 0)
  ) ? actorSummary.largestNetBuyer : actorSummary.largestNetSeller;

  return (
    <section className="universalTradeTape" aria-labelledby="universal-trade-tape-heading">
      <header>
        <div><small>LIVE TRADE TAPE</small><h3 id="universal-trade-tape-heading">Latest confirmed swaps</h3></div>
        <span>{status === "loading" ? "Syncing…" : status === "error" ? "Retrying" : `${payload?.trades.length ?? 0} shown · 10s`}</span>
      </header>
      {payload?.trades.length ? (
        <>
          <div className="universalActorSummary" aria-label="Recent pool actor summary">
            <span><small>ACTIVE WALLETS</small><strong>{actorSummary.uniqueActors}</strong></span>
            <span><small>REPEAT WALLETS</small><strong>{actorSummary.repeatActors}</strong></span>
            <span>
              <small>LARGEST VISIBLE FLOW</small>
              <strong className={largestNetActor?.netVolumeUsd && largestNetActor.netVolumeUsd < 0 ? "sell" : "buy"}>
                {largestNetActor
                  ? `${largestNetActor.netVolumeUsd < 0 ? "−" : "+"}$${compact(Math.abs(largestNetActor.netVolumeUsd))}`
                  : "—"}
              </strong>
            </span>
          </div>
          <div className="universalActorList" aria-label="Most active recent pool wallets">
            <div className="universalActorListHeading">
              <span>RECENT ACTORS</span><span>BUYS / SELLS</span><span>VISIBLE NET FLOW</span>
            </div>
            {actorSummary.actors.slice(0, 5).map((actor) => (
              <a href={`${EXPLORER}/address/${actor.trader}`} target="_blank" rel="noopener noreferrer" key={actor.trader}>
                <span><strong>{shortAddress(actor.trader)}</strong><small>{relativeTime(actor.lastTimestamp)} ago ↗</small></span>
                <span><b className="buy">{actor.buyCount}</b> / <b className="sell">{actor.sellCount}</b></span>
                <strong className={actor.netVolumeUsd < 0 ? "sell" : "buy"}>
                  {actor.netVolumeUsd < 0 ? "−" : "+"}${compact(Math.abs(actor.netVolumeUsd))}
                </strong>
              </a>
            ))}
          </div>
          <details className="universalTradeTapeDetails">
            <summary>View latest confirmed swaps</summary>
            <div className="universalTradeTapeList">
              {payload.trades.map((trade) => (
                <a href={`${EXPLORER}/tx/${trade.transactionHash}`} target="_blank" rel="noopener noreferrer" key={trade.id}>
                  <span className={trade.side}>{trade.side.toUpperCase()}</span>
                  <span><strong>{compact(trade.tokenAmount)} {market.symbol}</strong><small>{shortAddress(trade.trader)}</small></span>
                  <span><strong>${compact(trade.volumeUsd)}</strong><small>{relativeTime(trade.timestamp)} ago ↗</small></span>
                </a>
              ))}
            </div>
          </details>
        </>
      ) : (
        <div className="universalTradeTapeEmpty">
          <strong>{status === "error" ? "Trade tape delayed" : status === "loading" ? "Loading confirmed swaps…" : "No recent swaps"}</strong>
          <span>{status === "error" ? "The workspace will retry automatically." : "New pool activity will appear here automatically."}</span>
        </div>
      )}
      <footer>Latest {payload?.trades.length ?? 0} swaps from the exact pool only · visible flow is not P&amp;L, identity, or a copy signal · source: GeckoTerminal</footer>
    </section>
  );
}

export function ExternalHolderIntelligence({ market }: { market: ExternalMarket }) {
  const state = useWalletConstellation(market);
  const graph = state.graph;
  const topHolders = graph?.nodes
    .filter((node) => node.holderRank !== null)
    .sort((left, right) => (left.holderRank ?? 999) - (right.holderRank ?? 999))
    ?? [];
  const nodeByAddress = new Map(
    graph?.nodes.map((node) => [node.address.toLowerCase(), node]) ?? []
  );
  const creatorEdges = graph?.edges.filter((edge) =>
    nodeByAddress.get(edge.from.toLowerCase())?.role === "creator"
    || nodeByAddress.get(edge.to.toLowerCase())?.role === "creator"
  ) ?? [];
  const roleLabel = (role: WalletConstellationNodeRole) => {
    if (role === "creator") return "Creator";
    if (role === "pool") return "Pool";
    if (role === "contract") return "Contract";
    if (role === "mint-source") return "Mint source";
    if (role === "burn-address") return "Burn";
    if (role === "holder") return "Holder";
    return "Counterparty";
  };
  const displayNode = (
    node: WalletConstellationNode | undefined,
    address: string
  ) => node?.label || `${roleLabel(node?.role ?? "intermediary")} ${shortAddress(address)}`;

  return (
    <section className="universalHolderIntelligence" aria-labelledby="universal-holder-intelligence-heading">
      <header>
        <div><small>WALLET CONSTELLATION · READ ONLY</small><h3 id="universal-holder-intelligence-heading">Ownership and observed relationships</h3></div>
        <span>{state.status === "loading" ? "Checking…" : graph ? `${graph.edges.length} confirmed links` : "Unavailable"}</span>
      </header>

      {graph ? (
        <>
          <div className="universalHolderSummary">
            <span><small>KNOWN HOLDERS</small><strong>{graph.holderSnapshot.count?.toLocaleString() ?? "—"}</strong></span>
            <span><small>TOP 10 · EXCLUDING POOL</small><strong>{formatOwnershipBps(graph.holderSnapshot.topNonPoolShareBps)}</strong></span>
            <span><small>LARGEST WALLET</small><strong>{formatOwnershipBps(graph.holderSnapshot.largestNonPoolShareBps)}</strong></span>
            <span><small>REPORTED CREATOR</small><strong>{formatOwnershipBps(graph.holderSnapshot.creatorShareBps)}</strong></span>
          </div>

          {topHolders.length > 0 ? (
            <>
              <div className="universalConcentrationTrack" aria-label={`Top visible non-pool holders control ${formatOwnershipBps(graph.holderSnapshot.topNonPoolShareBps)}`}>
                {topHolders.slice(0, 6).map((holder, index) => (
                  <i
                    className={holder.isFlagged ? "flagged" : holder.isContract ? "contract" : ""}
                    style={{ width: `${(holder.supplyShareBps ?? 0) / 100}%` }}
                    title={`${shortAddress(holder.address)} · ${formatOwnershipBps(holder.supplyShareBps)}`}
                    key={holder.address}
                    data-rank={index + 1}
                  />
                ))}
              </div>
              <div className="universalHolderList">
                {topHolders.slice(0, 8).map((holder, index) => {
                  const label = holder.role === "creator"
                    ? "Reported creator"
                    : holder.isFlagged
                      ? "Explorer flagged"
                      : holder.isContract
                        ? "Contract"
                        : "Wallet";
                  return (
                    <a href={`${EXPLORER}/address/${holder.address}`} target="_blank" rel="noopener noreferrer" key={holder.address}>
                      <span>{index + 1}</span>
                      <span><strong>{shortAddress(holder.address)}</strong><small className={holder.isFlagged ? "flagged" : ""}>{label}</small></span>
                      <strong>{formatOwnershipBps(holder.supplyShareBps)}</strong>
                      <span aria-hidden="true">↗</span>
                    </a>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="universalHolderState"><strong>No holder rows available</strong><span>Treat missing concentration data as unknown, not safe.</span></div>
          )}

          <div className="universalRelationshipStrip" aria-label="Observed wallet relationship summary">
            <span><small>TRACKED NODES</small><strong>{graph.nodes.length}</strong></span>
            <span><small>CONFIRMED LINKS</small><strong>{graph.edges.length}</strong></span>
            <span><small>CREATOR-LINKED</small><strong>{creatorEdges.length}</strong></span>
            <span><small>TRANSFER SAMPLE</small><strong>{graph.coverage.sampledTransfers}</strong></span>
          </div>

          {graph.signals.length > 0 && (
            <div className="universalConstellationSignals" aria-label="Wallet relationship signals">
              <header>
                <span><small>EXPLAINABLE RELATIONSHIP SIGNALS</small><strong>What deserves attention</strong></span>
                <em>{graph.signals.filter((signal) => signal.severity === "review").length} review</em>
              </header>
              {graph.signals.slice(0, 4).map((signal) => {
                const href = signal.transactionHashes[0]
                  ? `${EXPLORER}/tx/${signal.transactionHashes[0]}`
                  : `${EXPLORER}/address/${signal.relatedAddresses[0]}`;
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className={signal.severity} key={`${signal.code}:${signal.relatedAddresses.join(":")}`}>
                    <b>{signal.severity === "review" ? "REVIEW" : "OBSERVE"}</b>
                    <span>
                      <strong>{signal.label}</strong>
                      <small className="signalAddresses">{signal.relatedAddresses.map(shortAddress).join(" ↔ ")}</small>
                      <small>{signal.description}</small>
                    </span>
                    <i aria-hidden="true">↗</i>
                  </a>
                );
              })}
            </div>
          )}

          {graph.edges.length > 0 && (
            <details className="universalRelationshipDetails">
              <summary>
                <span><small>OBSERVED TOKEN TRANSFERS</small><strong>Review relationship evidence</strong></span>
                <em>{graph.coverage.hasMoreTransfers ? "Recent sample" : "Available sample"} +</em>
              </summary>
              <div className="universalRelationshipList">
                {graph.edges.slice(0, 6).map((edge) => {
                  const from = nodeByAddress.get(edge.from.toLowerCase());
                  const to = nodeByAddress.get(edge.to.toLowerCase());
                  return (
                    <a href={`${EXPLORER}/tx/${edge.transactionHashes[0]}`} target="_blank" rel="noopener noreferrer" key={edge.id}>
                      <span><small>{roleLabel(from?.role ?? "intermediary")}</small><strong>{displayNode(from, edge.from)}</strong></span>
                      <i aria-hidden="true">→</i>
                      <span><small>{roleLabel(to?.role ?? "intermediary")}</small><strong>{displayNode(to, edge.to)}</strong></span>
                      <em>{edge.transferCount} {edge.transferCount === 1 ? "transfer" : "transfers"} ↗</em>
                    </a>
                  );
                })}
              </div>
              <p>{graph.coverage.description}</p>
            </details>
          )}
        </>
      ) : (
        <div className="universalHolderState">
          <strong>{state.status === "loading" ? "Reading holder and relationship evidence…" : "Wallet relationship evidence unavailable"}</strong>
          <span>{state.status === "loading" ? "Matching current holders to confirmed token transfers." : "Treat unavailable relationships as unknown, not safe."}</span>
        </div>
      )}

      <footer>Read-only public evidence · a transfer proves interaction, not common ownership, coordination, or malicious intent · coverage limits remain visible</footer>
    </section>
  );
}
