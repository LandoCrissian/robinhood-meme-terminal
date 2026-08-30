"use client";

import type { VNextExecutionRecord, VNextWalletRequestRecord } from "../../lib/vnext/execution-recovery";
import { ExplorerLink } from "./terminal-links";

export function VNextExecutionRecoveryBanner({ record, walletRequest, status, onRecheckWalletRequest, walletRequestRecheckPending = false }: {
  record: VNextExecutionRecord | null;
  walletRequest?: VNextWalletRequestRecord | null;
  status: "idle" | "confirming" | "confirmation_unavailable" | "reconciliation_failed" | "confirmed" | "reverted";
  onRecheckWalletRequest?: () => void;
  walletRequestRecheckPending?: boolean;
}) {
  if (!record && walletRequest) return <section className="vnRecoveryBanner isconfirming" role="status">
    <span><strong>{walletRequest.state === "HASH_RECEIVED" ? "Transaction hash received · recovery active" : "Wallet request is still unresolved"}</strong><small>{walletRequest.state === "HASH_RECEIVED"
      ? "RMT recorded the returned hash and blocks duplicate submission while receipt recovery continues."
      : "Check the wallet and do not retry. A deployment or page change cannot prove that this request was never broadcast."}</small></span>
    {walletRequest.txHash ? <ExplorerLink kind="transaction" value={walletRequest.txHash} accessibleName="Open recovered transaction in Robinhood Chain explorer">View transaction ↗</ExplorerLink> : null}
    {walletRequest.state === "UNRESOLVED" && onRecheckWalletRequest ? <button type="button" onClick={onRecheckWalletRequest} disabled={walletRequestRecheckPending}>
      {walletRequestRecheckPending ? "Rechecking wallet request…" : "Recheck unresolved wallet request"}
    </button> : null}
  </section>;
  if (!record || status === "idle") return null;
  const title = status === "confirming"
    ? "Transaction submitted · confirmation pending"
    : status === "confirmation_unavailable"
      ? "Confirmation temporarily unavailable"
      : status === "reconciliation_failed"
        ? record.kind === "erc20_approval" ? "Approval evidence requires review" : "Settlement evidence requires review"
      : status === "confirmed"
        ? record.kind === "erc20_approval" ? "Exact approval confirmed" : "Swap confirmed"
        : record.failureClassification === "EXPIRED_ONCHAIN_DEADLINE" ? "Verified swap expired onchain" : "Transaction reverted";
  const detail = status === "confirming"
    ? "RMT recovered this transaction and blocks duplicate submission until its receipt is resolved."
    : status === "confirmation_unavailable"
      ? "Do not resubmit. Check Blockscout while RMT retains the unresolved transaction."
      : status === "reconciliation_failed"
        ? record.kind === "erc20_approval"
          ? "The approval was mined, but its receipt could not be reconciled. Do not resubmit."
          : "The transaction was mined, but its exact RMT fee settlement event did not reconcile. Do not resubmit or credit proceeds."
      : status === "confirmed" && record.kind === "erc20_approval"
        ? "The exact allowance is confirmed. RMT will verify a fresh route before preparing the swap."
      : status === "confirmed"
          ? record.outputAmountAtomic
            ? "Onchain settlement and the exact received amount are confirmed."
            : "Onchain settlement is confirmed. Open the transaction for exact receipt details."
          : record.failureClassification === "EXPIRED_ONCHAIN_DEADLINE"
            ? "The swap expired before it reached the chain. No swap value moved. Network gas was spent. Get a fresh verified request before trying again."
            : "No proceeds are credited. Verify fresh route and wallet state before retrying.";
  return <section className={`vnRecoveryBanner is${status}`} role="status">
    <span><strong>{title}</strong><small>{detail}</small></span>
    <ExplorerLink kind="transaction" value={record.txHash} accessibleName="Open unresolved transaction in Robinhood Chain explorer">View transaction ↗</ExplorerLink>
  </section>;
}
