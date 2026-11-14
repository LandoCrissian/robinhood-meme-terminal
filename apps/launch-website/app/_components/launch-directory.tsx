"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isLaunchAddress, type HistoricalLaunch } from "../../lib/launch-data";
import { launchClassificationLabel, launchLifecycleLabel } from "./launch-evidence";
import { ShowcaseIcon } from "./showcase-icon";
import { TokenArtwork } from "./token-artwork";

export type DirectoryRow = Pick<HistoricalLaunch, "name" | "symbol" | "token" | "version" | "lifecycle" | "classification"> & {
  registrationBlock: string;
};

export function LaunchDirectory({ launches }: { launches: DirectoryRow[] }) {
  const [query, setQuery] = useState("");
  const [searchReady, setSearchReady] = useState(false);
  useEffect(() => setSearchReady(true), []);
  const search = query.trim().toLowerCase();
  const exactAddress = isLaunchAddress(search) ? search : null;
  const matching = launches.filter(({ name, symbol, token, classification }) => {
    if (exactAddress) return token.toLowerCase() === exactAddress;
    return classification !== "deployment-test"
      && (name.toLowerCase().includes(search) || symbol.toLowerCase().includes(search) || token.toLowerCase().includes(search));
  });

  return <>
    <label className="rmtMarketSearch lpSearch"><span><ShowcaseIcon name="search" /></span>
      <input aria-label="Search launches" placeholder="Name, symbol or token address" maxLength={160} autoCapitalize="none" spellCheck={false}
        disabled={!searchReady} value={query} onChange={(event) => setQuery(event.target.value)} />
    </label>
    {matching.length ? <div className="rmtMarketTable lpTable">
      <div className="rmtMarketTableHead lpTableGrid" aria-hidden="true">
        <span>Token</span><span>Token address</span><span>Lifecycle</span><span>Registration block</span><span>Source</span>
      </div>
      {matching.map((launch) => <Link className="rmtMarketTableRow lpTableGrid" key={launch.token}
        href={`/launches/${launch.token}`} prefetch={false}>
        <span className="rmtMarketTokenCell"><TokenArtwork symbol={launch.symbol} />
          <span className="lpTokenName"><strong>{launch.symbol}</strong><small>{launchClassificationLabel[launch.classification]} · {launch.name}</small></span>
        </span>
        <span className="lpOpenPrice"><code title={launch.token}>{launch.token.slice(0, 8)}…{launch.token.slice(-6)}</code></span>
        <span className="lpSeed">{launchLifecycleLabel[launch.lifecycle]}</span>
        <span className="lpPoolTokens">{launch.registrationBlock}</span>
        <span className="lpIndex">RMT V{launch.version}</span>
      </Link>)}
    </div> : <div className="lpEmpty">
      <ShowcaseIcon name="market" />
      {exactAddress ? <>
        <h2>Look up a token address</h2>
        <p>Check verified Robinhood Chain factory records for this address.</p>
        <Link className="lpButton lpSecondary" href={`/launches/${exactAddress}`} prefetch={false}>Look up this address</Link>
      </> : <>
        <h2>{search ? "No matching launches" : "No verified launches in this view"}</h2>
        <p>Search this view by name or symbol, or enter a full Robinhood Chain token address.</p>
      </>}
    </div>}
  </>;
}
