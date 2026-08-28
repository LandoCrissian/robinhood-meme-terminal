"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, type Hex } from "viem";
import { useAccount, useSendTransaction } from "wagmi";
import { useRmtIdentity } from "../../rmt-identity";
import { ExplorerLink } from "../../vnext/terminal-links";
import {
  isRmtWalletUserRejection,
  prepareRmtNftMintWalletTransaction,
  resolveRmtNftMintExecutionRecord,
  rmtNftMintReceiptRequestBody,
  submittedRmtNftMintExecutionRecord,
  writeRmtNftMintExecutionRecord,
  type RmtNftMintExecutionRecord,
} from "../../../lib/nft-mint-execution";
import type { RmtNftMintPreflightReport, RmtNftVerifiedMintPlan } from "../../../lib/server/nft-mint-preflight";
import type { RmtNftMintReceiptReport } from "../../../lib/server/nft-mint-receipt";
import styles from "../nft-terminal.module.css";

const executionEnabled = process.env.NEXT_PUBLIC_RMT_NFT_MINT_EXECUTION_ENABLED === "true";

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
  const walletSubmission = useSendTransaction();
  const [quantity, setQuantity] = useState(1);
  const [report, setReport] = useState<RmtNftMintPreflightReport | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [executionBusy, setExecutionBusy] = useState(false);
  const [executionRecord, setExecutionRecord] = useState<RmtNftMintExecutionRecord | null>(null);
  const executionInFlight = useRef(false);
  const accountRef = useRef(address);
  const chainRef = useRef(chainId);
  const quantityRef = useRef(quantity);
  accountRef.current = address;
  chainRef.current = chainId;
  quantityRef.current = quantity;

  const verifyReceipt = useCallback(async (record: RmtNftMintExecutionRecord) => {
    if (!identity.identityToken) return record;
    const response = await fetch("/api/nft/mint-receipt", {
      method: "POST",
      headers: { "content-type": "application/json", "privy-id-token": identity.identityToken },
      body: JSON.stringify(rmtNftMintReceiptRequestBody(record)),
    });
    const report = await response.json() as RmtNftMintReceiptReport | { error?: unknown };
    if (!response.ok || !("status" in report)) return record;
    if (report.status === "MINT_PENDING" || report.status === "EVIDENCE_UNAVAILABLE") return record;
    const resolved = resolveRmtNftMintExecutionRecord(record, report);
    setExecutionRecord(resolved);
    try { writeRmtNftMintExecutionRecord(window.localStorage, resolved); } catch { /* Chain evidence remains visible even when local recovery storage is unavailable. */ }
    return resolved;
  }, [identity.identityToken]);

  useEffect(() => {
    if (!executionEnabled || executionRecord?.state !== "PENDING") return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled || attempts >= 15) return;
      attempts += 1;
      try {
        const next = await verifyReceipt(executionRecord);
        if (!cancelled && next.state === "PENDING") timer = setTimeout(poll, 4_000);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 4_000);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [executionRecord, verifyReceipt]);

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

  async function executeMint() {
    if (executionInFlight.current || executionRecord?.state === "PENDING") return;
    if (!isConnected || !address || chainId !== 4_663) {
      setMessage("Connect the intended wallet on Robinhood Chain before minting.");
      return;
    }
    if (!identity.authenticated || !identity.identityToken || identity.activeWalletKind !== "external") {
      setMessage("Sign in with this linked external wallet before preparing mint execution.");
      return;
    }
    executionInFlight.current = true;
    setExecutionBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/nft/mint-execution-plan", {
        method: "POST",
        headers: { "content-type": "application/json", "privy-id-token": identity.identityToken },
        body: JSON.stringify({ candidateId, wallet: address, quantity }),
      });
      const body = await response.json() as unknown;
      const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      if (!response.ok || payload.status !== "EXECUTION_PLAN_READY") {
        setMessage(typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : "A fresh verified execution plan could not be established.");
        return;
      }
      const plan = body as RmtNftVerifiedMintPlan;
      const transaction = prepareRmtNftMintWalletTransaction({
        plan,
        connectedAddress: accountRef.current,
        connectedChainId: chainRef.current,
        selectedCandidateId: candidateId,
        selectedQuantity: quantityRef.current,
      });
      const hash = await walletSubmission.sendTransactionAsync(transaction);
      const record = submittedRmtNftMintExecutionRecord(plan, hash as Hex);
      setExecutionRecord(record);
      try {
        writeRmtNftMintExecutionRecord(window.localStorage, record);
        setMessage("Mint submitted by your wallet. RMT is waiting for canonical receipt evidence.");
      } catch {
        setMessage(`Mint submitted as ${hash}. Local recovery storage is unavailable; keep this transaction hash.`);
      }
    } catch (cause) {
      if (isRmtWalletUserRejection(cause)) setMessage("Wallet confirmation was rejected. No transaction was submitted.");
      else if (cause instanceof Error && cause.message === "PLAN_CONTEXT_CHANGED") setMessage("Wallet account, chain, or quantity changed. Request a new execution plan.");
      else if (cause instanceof Error && cause.message === "EXECUTION_PLAN_EXPIRED") setMessage("The verified plan expired before wallet confirmation. Request a fresh plan.");
      else setMessage("Mint execution stopped before RMT could establish a recoverable wallet broadcast.");
    } finally {
      executionInFlight.current = false;
      setExecutionBusy(false);
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
      {executionEnabled ? <button type="button" onClick={executeMint} disabled={executionBusy || executionRecord?.state === "PENDING"} data-nft-mint-execution-action>
        {executionRecord?.state === "PENDING" ? "MINT PENDING" : executionBusy ? "REVERIFYING…" : "MINT IN RMT"}
      </button> : null}
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
    {executionEnabled && executionRecord ? <section className={styles.readinessPanel} aria-label="Mint execution status" data-mint-execution-status={executionRecord.state}>
      <header><span>MINT EXECUTION</span><strong>{executionRecord.state === "CONFIRMED" ? "MINT CONFIRMED" : executionRecord.state === "FAILED" ? "MINT FAILED" : executionRecord.state === "EVIDENCE_INVALID" ? "VERIFICATION STOPPED" : "MINT PENDING"}</strong></header>
      <p>{executionRecord.state === "CONFIRMED" ? "RMT independently verified the onchain receipt and canonical mint transfers." : executionRecord.state === "FAILED" ? "The mint transaction reverted onchain." : executionRecord.state === "EVIDENCE_INVALID" ? "Receipt evidence did not match the verified execution record. RMT did not claim mint success or transaction failure." : "Your wallet broadcast the transaction. RMT has not claimed success yet."}</p>
      <dl>
        <div><dt>Collection</dt><dd>{short(executionRecord.collection)}</dd></div>
        <div><dt>Quantity</dt><dd>{executionRecord.quantity}</dd></div>
        <div><dt>ETH paid</dt><dd>{eth(executionRecord.value)}</dd></div>
        <div><dt>Method</dt><dd>{executionRecord.method.replace("MINT_", "")}</dd></div>
        <div><dt>Block</dt><dd>{executionRecord.blockNumber ?? "Pending"}</dd></div>
        <div><dt>Minted token IDs</dt><dd>{executionRecord.mintedTokenIds.length ? executionRecord.mintedTokenIds.join(", ") : "Pending"}</dd></div>
      </dl>
      <ExplorerLink kind="transaction" value={executionRecord.txHash} accessibleName="View mint transaction on Robinhood Chain explorer">View transaction ↗</ExplorerLink>
      <small>{executionRecord.state === "CONFIRMED" ? "Mint confirmed onchain. Collection not currently admitted to RMT unless separately listed in Active Collections." : "The transaction hash is stored locally for recovery; RMT verifies chain evidence before claiming success."}</small>
    </section> : null}
  </div>;
}
