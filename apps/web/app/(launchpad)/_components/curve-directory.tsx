"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { CurveLaunch } from "../../../lib/launchpad/curve-v1";
import { displayAmount } from "../../../lib/launchpad/direct-v4";
import { TerminalIcon } from "../../vnext/terminal-icon";
import { TokenArtwork } from "./launch-directory";
import { useLaunchWallet, WalletConnection } from "./launch-wallet";

type Directory = { status: "ready" | "disabled" | "delayed"; launches?: CurveLaunch[]; reason?: string };

export function CurveDirectory({ mine = false }: { mine?: boolean }) {
  const { config, wallet } = useLaunchWallet();
  const creator = mine ? wallet?.address : undefined;
  const [directory, setDirectory] = useState<Directory>();
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const enabled = config?.status === "ready" && Boolean(config.curve);
  useEffect(() => {
    if (!enabled || (mine && !creator)) return;
    const controller = new AbortController();
    const params = creator ? new URLSearchParams({ creator }) : "";
    setDirectory(undefined);
    fetch(`/api/launchpad/curve?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as Directory;
        if (!controller.signal.aborted) setDirectory(response.ok && data.status === "ready" && Array.isArray(data.launches)
          ? data : { status: "delayed", reason: data.reason });
      }).catch(() => { if (!controller.signal.aborted) setDirectory({ status: "delayed" }); });
    return () => controller.abort();
  }, [enabled, creator, mine, attempt]);
  const matching = (directory?.launches ?? []).filter((launch) =>
    [launch.name, launch.symbol, launch.token, launch.curve].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())));
  return <>
    <header className="lpPageHeading">
      <div><h1>{mine ? "My Launches" : "Launches"}</h1><p>{mine ? "Review your launches and eligible project revenue." : "Bonding-curve launches with a path to locked Uniswap v4 liquidity."}</p></div>
      <Link className="lpButton" href="/create-token">Create token</Link>
    </header>
    {!mine && <label className="rmtMarketSearch lpSearch"><span><TerminalIcon name="search" /></span>
      <input aria-label="Search launches" placeholder="Search token, symbol or contract" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} />
    </label>}
    {mine && !creator && <WalletConnection />}
    {config && !enabled && <p className="lpNotice">Preview only. Onchain creation and trading are disabled on this deployment.</p>}
    {((enabled && (!mine || creator)) || !config) && !directory && <p className="lpNotice" role="status">Loading verified curve launches…</p>}
    {enabled && directory?.status === "delayed" && <div className="lpNotice" role="status">
      <span>{directory.reason ?? "Curve data is delayed."}</span><button className="lpButton lpSecondary" type="button" onClick={() => setAttempt((prior) => prior + 1)}>Retry</button>
    </div>}
    {enabled && matching.length > 0 && (!mine || creator) && <CurveList launches={matching} creator={creator} />}
    {enabled && directory?.status === "ready" && matching.length === 0 && (!mine || creator) && <div className="lpEmpty">
      <TerminalIcon name="market" /><h2>{query ? "No matching launches" : "No curve launches yet"}</h2>
      <p>{query ? "Search by token name, symbol or address." : "Confirmed curve launches will appear here."}</p>
    </div>}
  </>;
}

function CurveList({ launches, creator }: { launches: CurveLaunch[]; creator?: Address }) {
  return <div className="rmtMarketTable lpTable">
    <div className="rmtMarketTableHead lpTableGrid" aria-hidden="true">
      <span>Token</span><span>Fixed supply</span><span>{creator ? "Treasury share" : "Curve trade fee"}</span><span>Graduation</span><span>Directory</span>
    </div>
    {launches.map((launch) => <Link className="rmtMarketTableRow lpTableGrid" key={launch.token} href={`/launches/${launch.token}`}>
      <span className="rmtMarketTokenCell"><TokenArtwork symbol={launch.symbol} />
        <span className="lpTokenName"><strong>{launch.symbol}</strong><small>{launch.name}</small></span>
      </span>
      <span className="lpOpenPrice">{displayAmount(launch.totalSupply)}</span>
      <span className="lpSeed">{creator ? `${launch.treasuryShareBps / 100}%` : "1%"}</span>
      <span className="lpPoolTokens">60% net sold</span><span className="lpIndex">Indexed</span>
    </Link>)}
  </div>;
}
