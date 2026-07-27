"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import type { LaunchFeedItem, LaunchFeedResponse } from "../lib/launch-feed";
import { activeChain } from "../lib/network";
import { ipfsToHttp } from "../lib/token-metadata";

const balanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }
] as const;

type Holding = {
  launch: LaunchFeedItem;
  balance: bigint;
};

function displaySymbol(symbol: string) {
  return symbol.replace(/^\$+/, "");
}

function tokenAmount(value: bigint) {
  const amount = Number(formatUnits(value, 18));
  if (!Number.isFinite(amount)) return "—";
  if (amount > 0 && amount < 0.0001) return "<0.0001";
  return amount.toLocaleString(undefined, {
    notation: amount >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1 ? 4 : 8
  });
}

export function PortfolioPanel() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const snapshotAddress = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!address || !publicClient) {
      setHoldings([]);
      setReady(false);
      setError(address ? "Wallet data is temporarily unavailable." : null);
      return;
    }

    try {
      setError(null);
      const response = await fetch("/api/launches", { cache: "no-store" });
      if (!response.ok) throw new Error("Launch feed unavailable.");
      const payload = (await response.json()) as LaunchFeedResponse;
      const launches = Array.isArray(payload.launches) ? payload.launches : [];
      if (launches.length === 0) {
        if (currentRequest === requestId.current) {
          setHoldings([]);
          snapshotAddress.current = address.toLowerCase();
          setReady(true);
        }
        return;
      }

      const balances = await publicClient.multicall({
        contracts: launches.map((launch) => ({
          address: launch.token as Address,
          abi: balanceAbi,
          functionName: "balanceOf",
          args: [address]
        })),
        allowFailure: true,
        batchSize: 0,
        deployless: true
      });

      if (currentRequest !== requestId.current) return;
      snapshotAddress.current = address.toLowerCase();
      setHoldings(launches.flatMap((launch, index) => {
        const result = balances[index];
        return result?.status === "success" && typeof result.result === "bigint" && result.result > 0n
          ? [{ launch, balance: result.result }]
          : [];
      }));
      setReady(true);
    } catch {
      if (currentRequest === requestId.current) {
        if (snapshotAddress.current !== address.toLowerCase()) setHoldings([]);
        setReady(true);
        setError("Portfolio data is delayed. Your assets are unchanged.");
      }
    }
  }, [address, publicClient]);

  useEffect(() => {
    if (!isConnected) {
      requestId.current += 1;
      setHoldings([]);
      setReady(false);
      setError(null);
      snapshotAddress.current = null;
      return;
    }

    const connectedAddress = address?.toLowerCase() ?? null;
    if (snapshotAddress.current !== connectedAddress) {
      requestId.current += 1;
      setHoldings([]);
      setReady(false);
      setError(null);
      snapshotAddress.current = null;
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(interval);
  }, [address, isConnected, refresh]);

  const snapshotIsCurrent = Boolean(address && snapshotAddress.current === address.toLowerCase());
  const visibleHoldings = snapshotIsCurrent ? holdings : [];

  if (!isConnected || !address) {
    return (
      <section className="panel portfolioPanel" aria-labelledby="portfolio-title">
        <div className="emptyFeed">
          <strong id="portfolio-title">Connect a wallet to view positions</strong>
          <span>Use Connect Wallet in the header. RMT reads public balances only and never moves assets.</span>
        </div>
      </section>
    );
  }

  if (!ready && visibleHoldings.length === 0) {
    return (
      <section className="panel portfolioPanel" aria-labelledby="portfolio-title" aria-busy="true">
        <div className="emptyFeed">
          <strong id="portfolio-title">Loading verified RMT positions…</strong>
          <span>Checking this wallet against the confirmed V6 launch set.</span>
        </div>
      </section>
    );
  }

  if (error && visibleHoldings.length === 0) {
    return (
      <section className="panel portfolioPanel" aria-labelledby="portfolio-title">
        <div className="emptyFeed">
          <strong id="portfolio-title">Portfolio data is delayed</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>Retry</button>
        </div>
      </section>
    );
  }

  if (visibleHoldings.length === 0) {
    return (
      <section className="panel portfolioPanel" aria-labelledby="portfolio-title">
        <div className="emptyFeed">
          <strong id="portfolio-title">No verified RMT positions yet</strong>
          <span>This connected wallet does not currently hold a token in the active V6 discovery set.</span>
          <Link href="/">Explore RMT tokens</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="panel portfolioPanel" aria-labelledby="portfolio-title">
      <div className="feedHeading portfolioHeading">
        <div>
          <p className="eyebrow">YOUR RMT PORTFOLIO</p>
          <h2 id="portfolio-title">Onchain holdings</h2>
          <p>Live balances for verified RMT tokens held by the connected wallet.</p>
        </div>
        <span className="portfolioCount">{visibleHoldings.length} POSITION{visibleHoldings.length === 1 ? "" : "S"}</span>
      </div>
      {error && <p className="portfolioDelay" role="status">{error} Showing the last confirmed balances. <button type="button" onClick={() => void refresh()}>Retry</button></p>}
      <div className="terminalListHeader portfolioListHeader" aria-hidden="true">
        <span>Asset</span><span>Wallet balance</span><span>Market state</span><span>Open</span>
      </div>
      <div className="portfolioGrid">
        {visibleHoldings.map(({ launch, balance }) => (
          <Link className="portfolioCard" href={`/project/${launch.token}?launch=${launch.launchId}`} key={launch.token}>
            <span className="coin portfolioArtwork">
              {launch.image ? <img src={ipfsToHttp(launch.image)} alt="" loading="lazy" /> : displaySymbol(launch.symbol).slice(0, 2)}
            </span>
            <span className="portfolioIdentity">
              <strong>{launch.name}</strong>
              <small>${displaySymbol(launch.symbol)}</small>
            </span>
            <span className="portfolioBalance">
              <small>Balance</small>
              <strong>{tokenAmount(balance)}</strong>
            </span>
            <span className="portfolioStatus">
              <small>{launch.graduated ? "Graduated" : `${launch.progressBps / 100}% to graduation`}</small>
              <b>Open →</b>
            </span>
          </Link>
        ))}
      </div>
      <p className="portfolioFootnote">Balances refresh every 20 seconds. Open a position for its live sell quote and estimated dollar value.</p>
    </section>
  );
}
