"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

  const refresh = useCallback(async () => {
    if (!address || !publicClient) {
      setHoldings([]);
      setReady(false);
      return;
    }

    try {
      const response = await fetch("/api/launches", { cache: "no-store" });
      if (!response.ok) throw new Error("Launch feed unavailable.");
      const payload = (await response.json()) as LaunchFeedResponse;
      const launches = Array.isArray(payload.launches) ? payload.launches : [];

      const balances = await publicClient.multicall({
        contracts: launches.map((launch) => ({
          address: launch.token as Address,
          abi: balanceAbi,
          functionName: "balanceOf",
          args: [address]
        })),
        allowFailure: true
      });

      setHoldings(launches.flatMap((launch, index) => {
        const result = balances[index];
        return result?.status === "success" && typeof result.result === "bigint" && result.result > 0n
          ? [{ launch, balance: result.result }]
          : [];
      }));
      setReady(true);
    } catch {
      setReady(true);
    }
  }, [address, publicClient]);

  useEffect(() => {
    if (!isConnected) {
      setHoldings([]);
      setReady(false);
      return;
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(interval);
  }, [isConnected, refresh]);

  if (!isConnected || !address || !ready || holdings.length === 0) return null;

  return (
    <section className="panel portfolioPanel" aria-labelledby="portfolio-title">
      <div className="feedHeading portfolioHeading">
        <div>
          <p className="eyebrow">YOUR RMT PORTFOLIO</p>
          <h2 id="portfolio-title">Onchain holdings</h2>
          <p>Live balances for verified RMT tokens held by the connected wallet.</p>
        </div>
        <span className="portfolioCount">{holdings.length} POSITION{holdings.length === 1 ? "" : "S"}</span>
      </div>
      <div className="portfolioGrid">
        {holdings.map(({ launch, balance }) => (
          <Link className="portfolioCard" href={`/token/${launch.token}`} key={launch.token}>
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
