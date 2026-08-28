"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { useRmtIdentity } from "../../rmt-identity";
import { ExplorerLink } from "../../vnext/terminal-links";
import {
  readRmtNftMintExecutionRecords,
  resolveRmtNftMintExecutionRecord,
  rmtNftMintReceiptRequestBody,
  writeRmtNftMintExecutionRecord,
  type RmtNftMintExecutionRecord,
} from "../../../lib/nft-mint-execution";
import type { RmtNftMintReceiptReport } from "../../../lib/server/nft-mint-receipt";
import styles from "../nft-terminal.module.css";

const executionEnabled = process.env.NEXT_PUBLIC_RMT_NFT_MINT_EXECUTION_ENABLED === "true";

function eth(value: string) {
  const [whole, fraction = ""] = formatEther(BigInt(value)).split(".");
  const bounded = fraction.slice(0, 5).replace(/0+$/, "");
  return `${bounded ? `${whole}.${bounded}` : whole} ETH`;
}

export function NftMintExecutionRecovery() {
  const { address } = useAccount();
  const identity = useRmtIdentity();
  const [record, setRecord] = useState<RmtNftMintExecutionRecord | null>(null);

  useEffect(() => {
    if (!executionEnabled || !address || !identity.authenticated || !identity.identityToken) return;
    const recovered = [...readRmtNftMintExecutionRecords(window.localStorage)].reverse()
      .find((item) => item.wallet.toLowerCase() === address.toLowerCase()) ?? null;
    setRecord(recovered);
  }, [address, identity.authenticated, identity.identityToken]);

  const verify = useCallback(async (pending: RmtNftMintExecutionRecord) => {
    if (!identity.identityToken) return pending;
    const response = await fetch("/api/nft/mint-receipt", {
      method: "POST",
      headers: { "content-type": "application/json", "privy-id-token": identity.identityToken },
      body: JSON.stringify(rmtNftMintReceiptRequestBody(pending)),
    });
    const report = await response.json() as RmtNftMintReceiptReport | { error?: unknown };
    if (!response.ok || !("status" in report)) return pending;
    const resolved = resolveRmtNftMintExecutionRecord(pending, report);
    if (resolved !== pending) {
      setRecord(resolved);
      try { writeRmtNftMintExecutionRecord(window.localStorage, resolved); } catch { /* The verified chain result remains visible. */ }
    }
    return resolved;
  }, [identity.identityToken]);

  useEffect(() => {
    if (!record || record.state !== "PENDING") return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled || attempts >= 15) return;
      attempts += 1;
      try {
        const next = await verify(record);
        if (!cancelled && next.state === "PENDING") timer = setTimeout(poll, 4_000);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 4_000);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [record, verify]);

  if (!executionEnabled || !record) return null;
  const heading = record.state === "CONFIRMED" ? "MINT CONFIRMED"
    : record.state === "FAILED" ? "MINT FAILED"
      : record.state === "EVIDENCE_INVALID" ? "VERIFICATION STOPPED" : "MINT PENDING";
  return <section className={styles.readinessPanel} aria-label="Recovered mint execution" data-mint-recovery-state={record.state}>
    <header><span>RECOVERED EXECUTION</span><strong>{heading}</strong></header>
    <p>{record.state === "PENDING" ? "RMT recovered this wallet broadcast and is waiting for canonical receipt evidence." : "RMT recovered this execution from local metadata and re-established its onchain result."}</p>
    <dl>
      <div><dt>Collection</dt><dd>{record.collection.slice(0, 6)}…{record.collection.slice(-4)}</dd></div>
      <div><dt>Quantity</dt><dd>{record.quantity}</dd></div>
      <div><dt>ETH paid</dt><dd>{eth(record.value)}</dd></div>
      <div><dt>Minted token IDs</dt><dd>{record.mintedTokenIds.length ? record.mintedTokenIds.join(", ") : "Pending"}</dd></div>
    </dl>
    <ExplorerLink kind="transaction" value={record.txHash} accessibleName="View recovered mint transaction on Robinhood Chain explorer">View transaction ↗</ExplorerLink>
  </section>;
}
