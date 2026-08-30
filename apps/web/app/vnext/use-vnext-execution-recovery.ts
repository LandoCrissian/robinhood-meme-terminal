"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWaitForTransactionReceipt } from "wagmi";
import {
  classifyVNextRevertedExecution,
  findBlockingVNextWalletRequest,
  findUnresolvedVNextExecution,
  readVNextExecutionJournal,
  reconcileExpiredVNextWalletRequest,
  resolveVNextExecution,
  settledVNextFeeExecution,
  settledVNextFeeExecutionV2,
  settledVNextOutputAtomic,
  VNEXT_EXECUTION_EVENT,
  VNEXT_EXECUTION_STORAGE_KEY,
  VNEXT_WALLET_REQUEST_EVENT,
  type VNextWalletRequestRecord,
  type VNextExecutionRecord
} from "../../lib/vnext/execution-recovery";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";

export function useVNextExecutionRecovery() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const [record, setRecord] = useState<VNextExecutionRecord | null>(null);
  const [walletRequest, setWalletRequest] = useState<VNextWalletRequestRecord | null>(null);
  const [reconciliationFailed, setReconciliationFailed] = useState(false);
  const receiptRequired = record?.state === "submitted"
    || (record?.state === "confirmed" && record.kind === "swap" && !record.outputAmountAtomic);
  const receipt = useWaitForTransactionReceipt({
    hash: receiptRequired ? record?.txHash : undefined,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    confirmations: record?.feeSettlement || record?.feeV2Settlement ? 2 : 1
  });

  useEffect(() => {
    setRecord(address ? findUnresolvedVNextExecution(address) : null);
    setWalletRequest(address ? findBlockingVNextWalletRequest(address) : null);
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
      if (event.key === VNEXT_EXECUTION_STORAGE_KEY) {
        updateFromRecords(readVNextExecutionJournal());
        setWalletRequest(findBlockingVNextWalletRequest(address));
      }
    };
    const onWalletRequestChange = () => {
      setWalletRequest(findBlockingVNextWalletRequest(address));
    };
    window.addEventListener(VNEXT_EXECUTION_EVENT, onJournalChange);
    window.addEventListener(VNEXT_WALLET_REQUEST_EVENT, onWalletRequestChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VNEXT_EXECUTION_EVENT, onJournalChange);
      window.removeEventListener(VNEXT_WALLET_REQUEST_EVENT, onWalletRequestChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [address]);

  useEffect(() => {
    if (
      !walletRequest || !publicClient || walletRequest.planKind !== "swap"
      || !["PROMPT_REQUESTED", "PROVIDER_PENDING"].includes(walletRequest.state)
    ) return;
    const deadlineMs = Number(BigInt(walletRequest.finalOnchainDeadline) * 1_000n);
    const delay = Math.max(0, deadlineMs - Date.now());
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [latestNonce, pendingNonce] = await Promise.all([
            publicClient.getTransactionCount({ address: walletRequest.wallet, blockTag: "latest" }),
            publicClient.getTransactionCount({ address: walletRequest.wallet, blockTag: "pending" })
          ]);
          reconcileExpiredVNextWalletRequest({ request: walletRequest, latestNonce: BigInt(latestNonce), pendingNonce: BigInt(pendingNonce), nowMs: Date.now() });
          setWalletRequest(findBlockingVNextWalletRequest(walletRequest.wallet));
        } catch {
          const reconciled = reconcileExpiredVNextWalletRequest({ request: walletRequest, latestNonce: null, pendingNonce: null, nowMs: Date.now() });
          setWalletRequest(reconciled);
        }
      })();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [publicClient, walletRequest]);

  useEffect(() => {
    setReconciliationFailed(false);
  }, [record?.txHash]);

  useEffect(() => {
    if (
      !record || !receiptRequired || !receipt.isSuccess || !receipt.data
      || receipt.data.transactionHash.toLowerCase() !== record.txHash.toLowerCase()
    ) return;
    let cancelled = false;
    void (async () => {
      const state = receipt.data.status === "success" ? "confirmed" : "reverted";
      const feeV2Settlement = state === "confirmed" && record.kind === "swap" && record.feeV2Settlement
        ? settledVNextFeeExecutionV2(record, receipt.data.logs)
        : null;
      const feeSettlement = state === "confirmed" && record.kind === "swap" && record.feeSettlement
        ? settledVNextFeeExecution(record, receipt.data.logs)
        : null;
      const outputAmountAtomic = state === "confirmed"
        ? feeV2Settlement?.outputAmountAtomic
          ?? feeSettlement?.outputAmountAtomic
          ?? (record.kind === "swap" && (record.feeSettlement || record.feeV2Settlement)
            ? null
            : settledVNextOutputAtomic(record, receipt.data.logs))
        : null;
      if (state === "confirmed" && record.kind === "swap" && (
        record.feeV2Settlement && !feeV2Settlement
        || record.feeSettlement && !feeSettlement
      )) {
        if (!cancelled) setReconciliationFailed(true);
        return;
      }
      if (record.state === "confirmed" && !outputAmountAtomic) return;
      let failure: { classification?: "EXPIRED_ONCHAIN_DEADLINE"; networkGasSpentWei?: string } | undefined;
      if (state === "reverted") {
        let receiptBlockTimestamp: bigint | null = null;
        try {
          receiptBlockTimestamp = publicClient
            ? (await publicClient.getBlock({ blockNumber: receipt.data.blockNumber })).timestamp
            : null;
        } catch {
          receiptBlockTimestamp = null;
        }
        const classification = classifyVNextRevertedExecution({
          transactionDeadline: record.deadline,
          receiptBlockTimestamp
        });
        failure = {
          ...(classification ? { classification } : {}),
          networkGasSpentWei: (receipt.data.gasUsed * receipt.data.effectiveGasPrice).toString()
        };
      }
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
          } : {}),
          ...(feeV2Settlement ? {
            actualRmtFeeAtomic: feeV2Settlement.actualRmtFeeAtomic,
            actualProviderOutputAtomic: feeV2Settlement.actualProviderOutputAtomic
          } : {})
        } : undefined,
        failure
      ) ?? {
        ...record,
        state,
        ...(outputAmountAtomic ? { outputAmountAtomic } : {}),
        ...(failure?.classification ? { failureClassification: failure.classification } : {}),
        ...(failure?.networkGasSpentWei ? { networkGasSpentWei: failure.networkGasSpentWei } : {}),
        updatedAtMs: Date.now()
      };
      if (!cancelled) setRecord(address ? findUnresolvedVNextExecution(address) ?? resolved : resolved);
    })();
    return () => { cancelled = true; };
  }, [address, publicClient, receipt.data, receipt.isSuccess, receiptRequired, record]);

  const status = record?.state === "submitted"
    ? reconciliationFailed ? "reconciliation_failed" : receipt.isError ? "confirmation_unavailable" : "confirming"
    : record?.state ?? "idle";
  return { record, walletRequest, status } as const;
}
