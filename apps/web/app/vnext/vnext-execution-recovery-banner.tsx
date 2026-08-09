"use client";

import type { VNextExecutionRecord } from "../../lib/vnext/execution-recovery";

const EXPLORER = "https://robinhoodchain.blockscout.com";

export function VNextExecutionRecoveryBanner({ record, status }: {
  record: VNextExecutionRecord | null;
  status: "idle" | "confirming" | "confirmation_unavailable" | "confirmed" | "reverted";
}) {
  if (!record || status === "idle") return null;
  const title = status === "confirming"
    ? "Transaction submitted · confirmation pending"
    : status === "confirmation_unavailable"
      ? "Confirmation temporarily unavailable"
      : status === "confirmed"
        ? record.kind === "erc20_approval" ? "Exact approval confirmed" : "Swap confirmed"
        : "Transaction reverted";
  const detail = status === "confirming"
    ? "RMT recovered this transaction and blocks duplicate submission until its receipt is resolved."
    : status === "confirmation_unavailable"
      ? "Do not resubmit. Check Blockscout while RMT retains the unresolved transaction."
      : status === "confirmed" && record.kind === "erc20_approval"
        ? "The exact allowance is confirmed. RMT will verify a fresh route before preparing the swap."
      : status === "confirmed"
          ? record.outputAmountAtomic
            ? "Onchain settlement and the exact received amount are confirmed."
            : "Onchain settlement is confirmed. Open the transaction for exact receipt details."
          : "No proceeds are credited. Verify fresh route and wallet state before retrying.";
  return <section className={`vnRecoveryBanner is${status}`} role="status">
    <span><strong>{title}</strong><small>{detail}</small></span>
    <a href={`${EXPLORER}/tx/${record.txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>
  </section>;
}
