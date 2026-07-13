"use client";

import { useMemo, useState } from "react";
import type { Address } from "viem";

type TokenShareActionsProps = {
  address: Address;
  name: string;
  symbol: string;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function TokenShareActions({ address, name, symbol }: TokenShareActionsProps) {
  const [notice, setNotice] = useState("");
  const cleanSymbol = symbol.replace(/^\$+/, "");
  const shareText = useMemo(
    () => `Check out ${name} ($${cleanSymbol}) on Robinhood Meme Terminal.\n\nCA: ${address}`,
    [address, cleanSymbol, name]
  );
  const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(typeof window === "undefined" ? "" : window.location.href)}`;

  async function copyContract() {
    try {
      await navigator.clipboard.writeText(address);
      setNotice("Contract address copied");
    } catch {
      setNotice("Could not copy automatically");
    }
  }

  async function shareToken() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${name} on RMT`, text: shareText, url });
        setNotice("Token shared");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${shareText}\n${url}`);
      setNotice("Share link copied");
    } catch {
      setNotice("Could not open sharing");
    }
  }

  return (
    <div className="tokenShareArea">
      <div className="tokenContractQuick" title={address}>
        <span>Contract</span>
        <strong>{shortAddress(address)}</strong>
      </div>
      <div className="tokenShareActions" aria-label="Token actions">
        <button type="button" onClick={() => void copyContract()}>Copy CA</button>
        <button type="button" onClick={() => void shareToken()}>Share</button>
        <a href={xUrl} target="_blank" rel="noreferrer">Post on X ↗</a>
      </div>
      <span className="tokenActionNotice" role="status" aria-live="polite">{notice}</span>
    </div>
  );
}
