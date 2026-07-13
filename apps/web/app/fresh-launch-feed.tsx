"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type Address, type Hash } from "viem";
import { usePublicClient } from "wagmi";
import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { memeLaunchFactoryAbi } from "../lib/contracts";
import { useFactoryAddress } from "../lib/use-factory-address";
import { ipfsToHttp, resolveTokenMetadata } from "../lib/token-metadata";

type LaunchItem = {
  launchId: bigint;
  token: Address;
  creator: Address;
  rewardVault: Address;
  name: string;
  symbol: string;
  creatorBps: number;
  communityBps: number;
  transactionHash: Hash;
  blockNumber: bigint;
  metadataURI: string;
  image?: string;
};

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function FreshLaunchFeed() {
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const factoryAddress = useFactoryAddress();
  const [launches, setLaunches] = useState<LaunchItem[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [message, setMessage] = useState("Factory deployment pending.");

  const refresh = useCallback(async () => {
    if (!publicClient || !factoryAddress) {
      setStatus("idle");
      setMessage("Factory deployment pending. Live launches will appear here after testnet activation.");
      return;
    }

    setStatus((current) => current === "live" ? "live" : "loading");
    try {
      const latestBlock = await publicClient.getBlockNumber();
      const configuredStart = process.env.NEXT_PUBLIC_FACTORY_START_BLOCK;
      const requestedStart = configuredStart && /^\d+$/.test(configuredStart) ? BigInt(configuredStart) : latestBlock > 20_000n ? latestBlock - 20_000n : 0n;
      const logs = await publicClient.getContractEvents({
        address: factoryAddress,
        abi: memeLaunchFactoryAbi,
        eventName: "TokenLaunched",
        fromBlock: requestedStart,
        toBlock: "latest",
        strict: true
      });

      const parsed = logs.map((log) => ({
        launchId: log.args.launchId,
        token: log.args.token,
        creator: log.args.creator,
        rewardVault: log.args.rewardVault,
        name: log.args.name,
        symbol: log.args.symbol,
        creatorBps: Number(log.args.rewardBps[0]),
        communityBps: Number(log.args.rewardBps[1]),
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        metadataURI: log.args.metadataURI
      })).sort((a, b) => a.blockNumber > b.blockNumber ? -1 : 1).slice(0, 25);

      const enriched = await Promise.all(parsed.map(async (launch) => {
        const metadata = await resolveTokenMetadata(launch.metadataURI);
        return { ...launch, image: metadata?.image };
      }));
      setLaunches(enriched);
      setStatus("live");
      setMessage(parsed.length === 0 ? "Factory connected. No testnet launches yet." : `${parsed.length} verified factory launch${parsed.length === 1 ? "" : "es"}.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to read factory events.");
    }
  }, [factoryAddress, publicClient]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return (
    <section className="feed panel">
      <div className="sectionTitle">
        <div><p className="eyebrow">DISCOVERY TERMINAL</p><h2>Fresh launches</h2></div>
        <span className={`badge ${status === "live" ? "liveBadge" : status === "error" ? "errorBadge" : "warning"}`}>
          {status === "live" ? "LIVE TESTNET" : status === "error" ? "RPC ERROR" : status === "loading" ? "SYNCING" : "AWAITING FACTORY"}
        </span>
      </div>
      <div className="filters"><button className="active">Fresh</button><button disabled>Trending</button><button disabled>Community-heavy</button><button disabled>Low creator concentration</button></div>
      {launches.length === 0 ? <div className="emptyFeed"><strong>{status === "loading" ? "Reading Robinhood Chain…" : "No launches to display"}</strong><span>{message}</span>{status === "error" && <button onClick={() => void refresh()}>Retry</button>}</div> : launches.map((launch) => (
        <Link className="launchRow" href={`/token/${launch.token}`} key={`${launch.transactionHash}-${launch.launchId.toString()}`}>
          <article>
            <div className="coin launchArtwork">{launch.image ? <img src={ipfsToHttp(launch.image)} alt="" loading="lazy" /> : launch.symbol.slice(0, 2)}</div>
            <div className="identity"><strong>{launch.name}</strong><span>${launch.symbol} • #{launch.launchId.toString()}</span></div>
            <div><small>Fixed supply</small><strong>1,000,000,000</strong></div>
            <div><small>Community share</small><strong>{launch.communityBps / 100}%</strong></div>
            <div><small>Creator</small><strong title={launch.creator}>{shortAddress(launch.creator)}</strong></div>
          </article>
        </Link>
      ))}
      {launches.length > 0 && <p className="feedStatus">{message} Refreshes every 10 seconds.</p>}
    </section>
  );
}
