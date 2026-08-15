"use client";

import { useEffect, useState } from "react";
import { useAccount, useWaitForTransactionReceipt } from "wagmi";
import {
  findUnresolvedVNextExecution,
  readVNextExecutionJournal,
  resolveVNextExecution,
  settledVNextFeeExecution,
  settledVNextOutputAtomic,
  VNEXT_EXECUTION_EVENT,
  VNEXT_EXECUTION_STORAGE_KEY,
  type VNextExecutionRecord
} from "../../lib/vnext/execution-recovery";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";

export function useVNextExecutionRecovery() {
  const { address } = useAccount();
  const [record, setRecord] = useState<VNextExecutionRecord | null>(null);
  const [reconciliationFailed, setReconciliationFailed] = useState(false);
  const receiptRequired = record?.state === "submitted"
    || (record?.state === "confirmed" && record.kind === "swap" && !record.outputAmountAtomic);
  const receipt = useWaitForTransactionReceipt({
    hash: receiptRequired ? record?.txHash : undefined,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    confirmations: record?.feeSettlement ? 2 : 1
  });

  useEffect(() => {
    setRecord(address ? findUnresolvedVNextExecution(address) : null);
    if (!address) return;
    const wallet = address.toLowerCase();
    const updateFromRecords = (records: VNextExecutionRecord[]) => {
      const walletRecords = records.filter((candidate) => candidate.wallet.toLowerCase() === wallet);
      const latest = walletRecords.find((candidate) => candidate.state === "submitted") ?? walletRecords[0];
      setRecord(latest ?? null);
    };
    const onJournalChange = (event: Event) => {
      const records = (event as CustomEvent<unknown>).detail;
      updateFromRecords(Array.isArray(records) ? records as VNextExecutionRecord[] : readVNextExecutionJournal());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === VNEXT_EXECUTION_STORAGE_KEY) updateFromRecords(readVNextExecutionJournal());
    };
    window.addEventListener(VNEXT_EXECUTION_EVENT, onJournalChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VNEXT_EXECUTION_EVENT, onJournalChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [address]);

  useEffect(() => {
    setReconciliationFailed(false);
  }, [record?.txHash]);

  useEffect(() => {
    if (
      !record || !receiptRequired || !receipt.isSuccess || !receipt.data
      || receipt.data.transactionHash.toLowerCase() !== record.txHash.toLowerCase()
    ) return;
    const state = receipt.data.status === "success" ? "confirmed" : "reverted";
    const feeSettlement = state === "confirmed" && record.kind === "swap" && record.feeSettlement
      ? settledVNextFeeExecution(record, receipt.data.logs)
      : null;
    const outputAmountAtomic = state === "confirmed"
      ? feeSettlement?.outputAmountAtomic ?? (record.kind === "swap" && record.feeSettlement ? null : settledVNextOutputAtomic(record, receipt.data.logs))
      : null;
    if (state === "confirmed" && record.kind === "swap" && record.feeSettlement && !feeSettlement) {
      setReconciliationFailed(true);
      return;
    }
    if (record.state === "confirmed" && !outputAmountAtomic) return;
    const resolved = resolveVNextExecution(
      record.txHash,
      state,
      undefined,
      Date.now(),
      outputAmountAtomic ? {
        outputAmountAtomic,
        ...(feeSettlement ? {
          actualFeeAtomic: feeSettlement.actualFeeAtomic,
          grossActualOutputAtomic: feeSettlement.grossActualOutputAtomic
        } : {})
      } : undefined
    ) ?? { ...record, state, ...(outputAmountAtomic ? { outputAmountAtomic } : {}), updatedAtMs: Date.now() };
    setRecord(address ? findUnresolvedVNextExecution(address) ?? resolved : resolved);
  }, [address, receipt.data, receipt.isSuccess, receiptRequired, record]);

  const status = record?.state === "submitted"
    ? reconciliationFailed ? "reconciliation_failed" : receipt.isError ? "confirmation_unavailable" : "confirming"
    : record?.state ?? "idle";
  return { record, status } as const;
}
