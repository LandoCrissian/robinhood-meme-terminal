"use client";

import Link from "next/link";
import { useState } from "react";
import { curveShowcaseExamples, curveShowcaseStage } from "../../lib/curve-showcase";
import { ShowcaseIcon } from "./showcase-icon";
import { TokenArtwork } from "./token-artwork";

export function ShowcaseDirectory() {
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const matching = curveShowcaseExamples.filter(({ name, symbol }) =>
    name.toLowerCase().includes(search) || symbol.toLowerCase().includes(search));

  return <>
    <header className="lpPageHeading">
      <div><h1>Launches</h1><p>Bonding-curve launches with a path to locked Uniswap v4 liquidity.</p></div>
      <Link className="lpButton" href="/create-token">Create token</Link>
    </header>
    <p className="lpNotice">Read-only preview. These examples are illustrative. Token creation and trading are disabled.</p>
    <label className="rmtMarketSearch lpSearch"><span><ShowcaseIcon name="search" /></span>
      <input aria-label="Search launches" placeholder="Search examples by name or symbol" maxLength={160}
        value={query} onChange={(event) => setQuery(event.target.value)} />
    </label>
    {matching.length ? <div className="rmtMarketTable lpTable">
      <div className="rmtMarketTableHead lpTableGrid" aria-hidden="true">
        <span>Token</span><span>Fixed supply</span><span>Stage</span><span>Net curve tokens sold</span><span>Evidence</span>
      </div>
      {matching.map((example) => <Link className="rmtMarketTableRow lpTableGrid" key={example.slug} href={`/launches/${example.slug}`}>
        <span className="rmtMarketTokenCell"><TokenArtwork symbol={example.symbol} />
          <span className="lpTokenName"><strong>{example.symbol}</strong><small>{example.name}</small></span>
        </span>
        <span className="lpOpenPrice">{example.supply.toLocaleString("en-US")}</span>
        <span className="lpSeed">{curveShowcaseStage(example)}</span>
        <span className="lpPoolTokens">{example.netSold.toLocaleString("en-US")}</span>
        <span className="lpIndex">Sample</span>
      </Link>)}
    </div> : <div className="lpEmpty">
      <ShowcaseIcon name="market" /><h2>No matching launches</h2><p>Search by example name or symbol.</p>
    </div>}
  </>;
}
