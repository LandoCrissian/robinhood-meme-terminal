"use client";

import Link from "next/link";
import { useState } from "react";
import { displayAmount, priceInWei } from "../../../lib/launchpad/direct-v4";
import type { NewLaunchRecord } from "../../../lib/launchpad/launch-record";
import { TerminalIcon } from "../../vnext/terminal-icon";
import { useLaunches } from "./launch-transactions";
import { useLaunchWallet, WalletConnection } from "./launch-wallet";

export function TokenArtwork({ symbol }: { symbol: string }) {
  return <span className="rmtMarketArtwork lpArtwork" aria-hidden="true">{symbol.slice(0, 2).toUpperCase()}</span>;
}

export function LaunchList({ launches }: { launches: NewLaunchRecord[] }) {
  return <div className="rmtMarketTable lpTable">
    <div className="rmtMarketTableHead lpTableGrid" aria-hidden="true">
      <span>Token</span><span>Opening price</span><span>ETH deposited</span><span>Pool tokens</span><span>Directory</span>
    </div>
    {launches.map((launch) => <Link className="rmtMarketTableRow lpTableGrid" key={launch.poolId} href={`/launches/${launch.token}`}>
      <span className="rmtMarketTokenCell">
        <TokenArtwork symbol={launch.symbol} />
        <span className="lpTokenName"><strong>{launch.symbol}</strong><small>{launch.name}</small></span>
      </span>
      <span className="lpOpenPrice">{displayAmount(priceInWei(BigInt(launch.sqrtPriceX96)))} ETH</span>
      <span className="lpSeed">{displayAmount(launch.amount0)} ETH</span>
      <span className="lpPoolTokens">{displayAmount(launch.amount1)}</span>
      <span className="lpIndex">{launch.indexing === "indexed" ? "Indexed" : "Indexing pending"}</span>
    </Link>)}
  </div>;
}

export function LaunchDirectory() {
  const { config, refresh } = useLaunchWallet();
  const { state, reload } = useLaunches();
  const [query, setQuery] = useState("");
  const launches = state?.launches.filter(({ name, symbol, token, poolId }) =>
    [name, symbol, token, poolId].some((value) => value.toLowerCase().includes(query.trim().toLowerCase()))) ?? [];
  return <>
    <header className="lpPageHeading">
      <div><h1>Launches</h1><p>Verified token launches and their starting liquidity.</p></div>
      <Link className="lpButton" href="/create-token">Create token</Link>
    </header>
    <label className="rmtMarketSearch lpSearch">
      <span><TerminalIcon name="search" /></span>
      <input aria-label="Search launches" placeholder="Search token, contract or PoolId" maxLength={160}
        value={query} onChange={(event) => setQuery(event.target.value)} />
    </label>
    {!state && <p role="status" className="lpNotice">Loading verified launches…</p>}
    {state?.status === "disabled" && <p className="lpNotice">Launch preview. Onchain creation and trading are disabled in this environment.</p>}
    {(state?.status === "delayed" || config?.status === "unavailable") && <div className="lpNotice" role="status">
      <span>Launch data is delayed. Recently confirmed launches may still be indexing.</span>
      <button type="button" className="lpButton lpSecondary" onClick={() => { reload(); refresh(); }}>Retry</button>
    </div>}
    {launches.length > 0 && <LaunchList launches={launches} />}
    {state?.status === "ready" && launches.length === 0 && <div className="lpEmpty">
      <TerminalIcon name="market" /><h2>{query ? "No matching launches" : "No launches yet"}</h2>
      <p>{query ? "Search by token name, symbol, contract or PoolId." : "Confirmed, funded launches will appear here."}</p>
    </div>}
  </>;
}

function CreatorDirectory({ address }: { address: `0x${string}` }) {
  const { state, reload } = useLaunches({ creator: address });
  return <>
    {!state && <p role="status">Loading your launches…</p>}
    {state?.status === "disabled" && <p className="lpNotice">Launches are disabled in this preview.</p>}
    {state?.status === "delayed" && <div className="lpNotice">Indexing delayed.
      <button type="button" className="lpButton lpSecondary" onClick={reload}>Retry</button></div>}
    {state && state.launches.length > 0 && <LaunchList launches={state.launches} />}
    {state?.status === "ready" && state.launches.length === 0 && <p className="lpNotice">This wallet has no verified launches yet.</p>}
  </>;
}

export function MyLaunches() {
  const { wallet } = useLaunchWallet();
  return <>
    <header className="lpPageHeading">
      <div><h1>My Launches</h1><p>Open a launch to review its position and collect eligible fees.</p></div>
      <Link className="lpButton" href="/create-token">Create token</Link>
    </header>
    {wallet ? <CreatorDirectory key={wallet.address} address={wallet.address} /> : <WalletConnection />}
  </>;
}
