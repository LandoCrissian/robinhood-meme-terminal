"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hash } from "viem";
import { recordExperienceStage } from "./experience-funnel";
import {
  classifyTradeExecutionError,
  findRecoverableTrade,
  markTradeExecutionConfirmed,
  markTradeExecutionFailed,
  recordSubmittedTrade,
  type TradeExecutionFailure,
  type TradeExecutionRecord,
  type TradeExecutionSide,
  type TradeExecutionVenue
} from "./trade-execution-reliability";

export type RecoveredTradeExecutionStatus =
  | "idle"
  | "confirming"
  | "confirmed"
  | "failed"
  | "confirmation-unavailable";

export function useTradeExecutionRecovery({
  wallet,
  token,
  pair,
  venue,
  side,
  amountIn,
  submittedHash
}: {
  wallet: Address | undefined;
  token: Address;
  pair: string;
  venue: TradeExecutionVenue;
  side: TradeExecutionSide;
  amountIn: bigint;
  submittedHash: Hash | undefined;
}) {
  const [trackedHash, setTrackedHash] = useState<Hash>();
  const [record, setRecord] = useState<TradeExecutionRecord | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [failure, setFailure] = useState<TradeExecutionFailure>();
  const [rawError, setRawError] = useState("");
  const [confirmationUnavailable, setConfirmationUnavailable] = useState(false);
  const [resolvedStatus, setResolvedStatus] = useState<"confirmed" | "failed">();
  const recordedSubmission = useRef<Hash>();

  const identityKey = `${wallet?.toLowerCase() ?? ""}:${token.toLowerCase()}:${venue}:${side}`;

  useEffect(() => {
    setTrackedHash(undefined);
    setRecord(null);
    setRecovered(false);
    setFailure(undefined);
    setRawError("");
    setConfirmationUnavailable(false);
    setResolvedStatus(undefined);
    recordedSubmission.current = undefined;
    if (!wallet) return;
    const pending = findRecoverableTrade({ wallet, token, venue, side });
    if (!pending) return;
    setTrackedHash(pending.txHash);
    setRecord(pending);
    setRecovered(true);
    recordExperienceStage("transaction_recovered");
  }, [identityKey, side, token, venue, wallet]);

  useEffect(() => {
    if (!submittedHash || !wallet || recordedSubmission.current === submittedHash) return;
    recordedSubmission.current = submittedHash;
    const submitted = recordSubmittedTrade({
      wallet,
      token,
      pair,
      venue,
      side,
      amountIn: amountIn.toString(),
      txHash: submittedHash
    });
    setTrackedHash(submittedHash);
    setRecord(submitted);
    setRecovered(false);
    setFailure(undefined);
    setRawError("");
    setConfirmationUnavailable(false);
    setResolvedStatus(undefined);
    recordExperienceStage("transaction_submitted");
  }, [amountIn, pair, side, submittedHash, token, venue, wallet]);

  const confirm = useCallback(() => {
    setFailure(undefined);
    setRawError("");
    setConfirmationUnavailable(false);
    setResolvedStatus("confirmed");
    setRecord((current) => current ? markTradeExecutionConfirmed(current.id) ?? { ...current, state: "confirmed" } : current);
    recordExperienceStage("transaction_confirmed");
  }, []);

  const fail = useCallback((cause: unknown, explicit?: TradeExecutionFailure) => {
    const nextFailure = explicit ?? classifyTradeExecutionError(cause);
    const detail = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : String(cause ?? "");
    setFailure(nextFailure);
    setRawError(detail);
    setConfirmationUnavailable(false);
    setResolvedStatus("failed");
    setRecord((current) => current
      ? markTradeExecutionFailed(current.id, nextFailure.code) ?? { ...current, state: "failed", failureCode: nextFailure.code }
      : current);
    recordExperienceStage(nextFailure.code === "user-rejected" ? "wallet_rejected" : "transaction_failed");
    return nextFailure;
  }, []);

  const holdForReconciliation = useCallback((cause: unknown) => {
    const nextFailure = classifyTradeExecutionError(cause);
    const detail = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : String(cause ?? "");
    setFailure(nextFailure);
    setRawError(detail);
    setConfirmationUnavailable(true);
    setResolvedStatus(undefined);
    return nextFailure;
  }, []);

  const clearFailure = useCallback(() => {
    if (record?.state === "submitted") return;
    setTrackedHash(undefined);
    setRecord(null);
    setRecovered(false);
    setFailure(undefined);
    setRawError("");
    setConfirmationUnavailable(false);
    setResolvedStatus(undefined);
    recordedSubmission.current = undefined;
  }, [record?.state]);

  const status = useMemo<RecoveredTradeExecutionStatus>(() => {
    if (resolvedStatus === "confirmed" || record?.state === "confirmed") return "confirmed";
    if (resolvedStatus === "failed" || record?.state === "failed" || (failure && !trackedHash)) return "failed";
    if (trackedHash && confirmationUnavailable) return "confirmation-unavailable";
    if (trackedHash) return "confirming";
    return "idle";
  }, [confirmationUnavailable, failure, record?.state, resolvedStatus, trackedHash]);

  return {
    trackedHash,
    record,
    recovered,
    failure,
    rawError,
    status,
    unresolved: status === "confirming" || status === "confirmation-unavailable",
    confirm,
    fail,
    holdForReconciliation,
    clearFailure
  };
}
