"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { useRmtIdentity } from "../../rmt-identity";
import type { RmtNftMintPreflightReport } from "../../../lib/server/nft-mint-preflight";
import styles from "../nft-terminal.module.css";

function short(value: string | null) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not established";
}

function eth(value: string | null) {
  if (value === null) return "Not established";
  const [whole, fraction = ""] = formatEther(BigInt(value)).split(".");
  const bounded = fraction.slice(0, 5).replace(/0+$/, "");
  return `${bounded ? `${whole}.${bounded}` : whole} ETH`;
}

export function NftMintReadiness({ candidateId }: { candidateId: string }) {
  const { address, chainId, isConnected } = useAccount();
  const identity = useRmtIdentity();
  const [quantity, setQuantity] = useState(1);
  const [report, setReport] = useState<RmtNftMintPreflightReport | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function checkReadiness() {
    setReport(null);
    if (!isConnected || !address) {
      setMessage("Connect the wallet whose mint readiness you want RMT to verify.");
      return;
    }
    if (chainId !== 4_663) {
      setMessage("Switch the connected wallet to Robinhood Chain before checking readiness.");
      return;
    }
    if (!identity.authenticated || !identity.identityToken || identity.activeWalletKind !== "external") {
      setMessage("Sign in with this linked external wallet before requesting protected readiness evidence.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/nft/mint-preflight", {
        method: "POST",
        headers: { "content-type": "application/json", "privy-id-token": identity.identityToken },
        body: JSON.stringify({ candidateId, wallet: address, quantity }),
      });
      const body = await response.json() as RmtNftMintPreflightReport | { error?: unknown };
      if (!response.ok || !("status" in body)) {
        setMessage("error" in body && typeof body.error === "string" ? body.error : "Mint readiness could not be established.");
        return;
      }
      setReport(body);
    } catch {
      setMessage("Mint readiness service is unavailable. Mint Radar and Active Collections remain read-only and available.");
    } finally {
      setPending(false);
    }
  }

  return <div className={styles.readiness} data-nft-mint-readiness>
    <div className={styles.readinessControls}>
      <label>Qty
        <select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} aria-label="Mint readiness quantity">
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
      <button type="button" onClick={checkReadiness} disabled={pending} data-nft-readiness-action>
        {pending ? "CHECKING…" : "CHECK READINESS"}
      </button>
    </div>
    {message ? <p className={styles.readinessMessage} role="status">{message}</p> : null}
    {report ? <section className={styles.readinessPanel} aria-label="Mint readiness report" data-preflight-status={report.status}>
      <header><span>MINT READINESS</span><strong>{report.status.replaceAll("_", " ")}</strong></header>
      <p>{report.message}</p>
      <dl>
        <div><dt>Collection</dt><dd>{short(report.collection)}</dd></div>
        <div><dt>Method</dt><dd>{report.method?.replace("MINT_", "") ?? "Not established"}</dd></div>
        <div><dt>Quantity</dt><dd>{report.quantity}</dd></div>
        <div><dt>Recipient</dt><dd>{short(report.recipient)}</dd></div>
        <div><dt>Mint price</dt><dd>{eth(report.mintPriceWei)}</dd></div>
        <div><dt>Total value</dt><dd>{eth(report.totalValueWei)}</dd></div>
        <div><dt>Wallet limit</dt><dd>{report.stage?.maxPerWallet ?? "Not established"}</dd></div>
        <div><dt>Supply</dt><dd>{report.supply ? `${report.supply.currentTotalSupply} / ${report.supply.maxSupply}` : "Not established"}</dd></div>
        <div><dt>CCFF00 access</dt><dd>{report.ccff00Access?.status ?? "Not applicable"}</dd></div>
        <div><dt>Simulation</dt><dd>{report.simulation.status}</dd></div>
        <div><dt>Target</dt><dd>{short(report.target)}</dd></div>
        <div><dt>Evidence</dt><dd>{new Date(report.checkedAt).toLocaleTimeString()}</dd></div>
      </dl>
      <small>No transaction has been submitted. No wallet signature was requested. Conditions may change after this short-lived check.</small>
      {report.digest ? <details><summary>Technical evidence</summary><code>Digest {report.digest}</code><code>Calldata hash {report.calldataHash}</code><code>Simulation block {report.simulation.blockNumber}</code></details> : null}
    </section> : null}
  </div>;
}
