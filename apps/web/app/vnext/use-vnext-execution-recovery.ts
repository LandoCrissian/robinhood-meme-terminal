"use client";

import { useEffect, useState } from "react";
import { useAccount, useWaitForTransactionReceipt } from "wagmi";
import {
  findUnresolvedVNextExecution,
  readVNextExecutionJournal,
  resolveVNextExecution,
  VNEXT_EXECUTION_EVENT,
  VNEXT_EXECUTION_STORAGE_KEY,
  type VNextExecutionRecord
} from "../../lib/vnext/execution-recovery";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";

export function useVNextExecutionRecovery() {
  const { address } = useAccount();
  const [record, setRecord] = useState<VNextExecutionRecord | null>(null);
  const receipt = useWaitForTransactionReceipt({
    hash: record?.state === "submitted" ? record.txHash : undefined,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    confirmations: 1
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
    if (
      !record || record.state !== "submitted" || !receipt.isSuccess || !receipt.data
      || receipt.data.transactionHash.toLowerCase() !== record.txHash.toLowerCase()
    ) return;
    const state = receipt.data.status === "success" ? "confirmed" : "reverted";
    const resolved = resolveVNextExecution(record.txHash, state) ?? { ...record, state, updatedAtMs: Date.now() };
    setRecord(address ? findUnresolvedVNextExecution(address) ?? resolved : resolved);
  }, [address, receipt.data, receipt.isSuccess, record]);

  const status = record?.state === "submitted"
    ? receipt.isError ? "confirmation_unavailable" : "confirming"
    : record?.state ?? "idle";
  return { record, status } as const;
}
