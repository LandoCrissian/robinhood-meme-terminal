"use client";

import { useState } from "react";
import type { Hash } from "viem";
import { recordExperienceStage } from "../lib/experience-funnel";
import { sanitizeTradeDiagnosticText } from "../lib/trade-diagnostic-sanitize";
import {
  tradeExecutionDiagnostics,
  type TradeExecutionFailure,
  type TradeExecutionRecord
} from "../lib/trade-execution-reliability";

const EXPLORER = "https://robinhoodchain.blockscout.com";

export type TradeExecutionStatusKind =
  | "confirming"
  | "confirmed"
  | "failed"
  | "confirmation-unavailable";

function statusCopy(status: TradeExecutionStatusKind, recovered: boolean) {
  if (status === "confirmed") {
    return {
      eyebrow: "ONCHAIN CONFIRMED",
      title: "Trade confirmed on Robinhood Chain",
      detail: "RMT received a successful EVM receipt and is refreshing wallet balances."
    };
  }
  if (status === "failed") {
    return {
      eyebrow: "EXECUTION FAILED",
      title: "The order did not complete",
      detail: "RMT will not reuse this quote. Review the reason before preparing another transaction."
    };
  }
  if (status === "confirmation-unavailable") {
    return {
      eyebrow: "RECONCILIATION REQUIRED",
      title: "Confirmation is temporarily unavailable",
      detail: "A transaction hash exists, so RMT blocks duplicate submission until the chain result is known."
    };
  }
  return {
    eyebrow: recovered ? "RECOVERED AFTER REFRESH" : "SUBMITTED ONCHAIN",
    title: recovered ? "RMT recovered the pending transaction" : "Waiting for Robinhood Chain confirmation",
    detail: "Do not submit the same order again while this hash is pending."
  };
}

export function TradePreflightFailure({ failure }: { failure?: TradeExecutionFailure }) {
  if (!failure) return null;
  return (
    <section className="tradePreflightFailure" role="alert">
      <span>PRE-SIGN BLOCK</span>
      <div>
        <strong>{failure.title}</strong>
        <p>{failure.detail}</p>
        <small>{failure.action}</small>
      </div>
    </section>
  );
}

export function TradeExecutionStatus({
  status,
  hash,
  record,
  recovered = false,
  failure,
  rawError,
  onRecheck
}: {
  status: TradeExecutionStatusKind;
  hash?: Hash;
  record?: TradeExecutionRecord | null;
  recovered?: boolean;
  failure?: TradeExecutionFailure;
  rawError?: string;
  onRecheck?: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [feedback, setFeedback] = useState<"clear" | "unclear">();
  const copy = statusCopy(status, recovered);
  const safeRawError = sanitizeTradeDiagnosticText(rawError);

  const copyDiagnostics = async () => {
    const diagnostics = tradeExecutionDiagnostics({
      record,
      failure,
      rawError: safeRawError,
      status
    });
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const submitFeedback = (value: "clear" | "unclear") => {
    setFeedback(value);
    recordExperienceStage(value === "clear" ? "execution_status_clear" : "execution_status_unclear");
  };

  return (
    <section className={`tradeExecutionStatus ${status}`} aria-live="polite">
      <header>
        <span>{copy.eyebrow}</span>
        {recovered && <em>Recovered locally</em>}
      </header>
      <div className="tradeExecutionStatusCopy">
        <strong>{failure?.title ?? copy.title}</strong>
        <p>{failure?.detail ?? copy.detail}</p>
        {failure && <small>{failure.action}</small>}
      </div>
      <div className="tradeExecutionStatusActions">
        {hash && <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer">View on Blockscout ↗</a>}
        {onRecheck && status !== "confirmed" && status !== "failed" && (
          <button type="button" onClick={onRecheck}>Recheck status</button>
        )}
        <button type="button" onClick={() => void copyDiagnostics()}>
          {copyState === "copied" ? "Diagnostics copied" : copyState === "failed" ? "Copy unavailable" : "Copy diagnostics"}
        </button>
      </div>
      {safeRawError && (
        <details>
          <summary>Technical response</summary>
          <p>{safeRawError}</p>
        </details>
      )}
      {(status === "confirmed" || status === "failed" || status === "confirmation-unavailable") && (
        <footer>
          <span>Was this execution status clear?</span>
          <button type="button" aria-pressed={feedback === "clear"} onClick={() => submitFeedback("clear")}>Yes</button>
          <button type="button" aria-pressed={feedback === "unclear"} onClick={() => submitFeedback("unclear")}>No</button>
        </footer>
      )}
    </section>
  );
}