"use client";
import { useState } from "react";
import { assetCID, assetPath } from "../../lib/token-artwork";
export function TokenArtwork({ symbol, projectURI }: { symbol: string; projectURI?: string }) {
  const cid = assetCID(projectURI,"metadata.json"), [failed,setFailed] = useState<string>();
  return <span className="rmtMarketArtwork lpArtwork" aria-hidden="true">{cid && cid !== failed
    ? <img src={assetPath(cid,"logo.webp")} alt="" onError={()=>setFailed(cid)} />
    : symbol.slice(0,2).toUpperCase()}</span>;
}
