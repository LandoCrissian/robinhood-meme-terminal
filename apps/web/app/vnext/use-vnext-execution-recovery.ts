"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWaitForTransactionReceipt } from "wagmi";
import {
  classifyVNextRevertedExecution,
  findBlockingVNextWalletRequest,
  findUnresolvedVNextExecution,
  isVNextWalletProviderRequestActive,
  promoteDiscoveredVNextWalletRequestToSubmitted,
  readVNextExecutionJournal,
  reconcileExpiredVNextWalletRequest,
  resolveVNextExecution,
  settledVNextFeeExecution,
  settledVNextFeeExecutionV2,
  settledVNextOutputAtomic,
  transitionVNextWalletRequest,
  VNEXT_EXECUTION_EVENT,
  VNEXT_EXECUTION_STORAGE_KEY,
  VNEXT_WALLET_REQUEST_EVENT,
  type VNextWalletRequestRecord,
  type VNextExecutionRecord
} from "../../lib/vnext/execution-recovery";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";
import { useRmtIdentity } from "../rmt-identity";

const WALLET_REQUEST_RECOVERY_DELAYS_MS = [0, 10_000, 30_000, 60_000] as const;
const EXPLICIT_RECHECK_COOLDOWN_MS = 5_000;

export function useVNextExecutionRecovery() {
  const { address } = useAccount();
  const identity = useRmtIdentity();
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const [record, setRecord] = useState<VNextExecutionRecord | null>(null);
  const [walletRequest, setWalletRequest] = useState<VNextWalletRequestRecord | null>(null);
  const [reconciliationFailed, setReconciliationFailed] = useState(false);
  const [walletRequestRecheckPending, setWalletRequestRecheckPending] = useState(false);
  const lastExplicitRecheckAt = useRef(0);
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

  const reconcileWalletRequest = useCallback(async (request: VNextWalletRequestRecord) => {
    if (!publicClient || isVNextWalletProviderRequestActive(request.requestId)) return;
    const activeRequest = findBlockingVNextWalletRequest(request.wallet);
    if (!activeRequest || activeRequest.requestId !== request.requestId) {
      setWalletRequest(activeRequest);
      return;
    }
    if (!["PROMPT_REQUESTED", "PROVIDER_PENDING", "UNRESOLVED"].includes(activeRequest.state)) return;
    if (activeRequest.requestBlockNumber && identity.identityToken) {
      try {
        const response = await fetch("/api/vnext/wallet-request-recovery", {
          method: "POST",
          headers: { "Content-Type": "application/json", "privy-id-token": identity.identityToken },
          body: JSON.stringify({
            requestId: activeRequest.requestId,
            chainId: activeRequest.chainId,
            wallet: activeRequest.wallet,
            walletNonceBeforeRequest: activeRequest.walletNonceBeforeRequest,
            target: activeRequest.target,
            value: activeRequest.value,
            calldataHash: activeRequest.calldataHash,
            requestBlockNumber: activeRequest.requestBlockNumber,
            ...(activeRequest.requestBlockHash ? { requestBlockHash: activeRequest.requestBlockHash } : {}),
            requestedAtMs: activeRequest.requestedAtMs
          }),
          cache: "no-store",
          credentials: "same-origin"
        });
        const result = response.ok ? await response.json() as { status?: unknown; txHash?: unknown } : null;
        if (result?.status === "found" && typeof result.txHash === "string") {
          const promoted = promoteDiscoveredVNextWalletRequestToSubmitted({ requestId: activeRequest.requestId, txHash: result.txHash });
          if (promoted) {
            setRecord(promoted);
            setWalletRequest(findBlockingVNextWalletRequest(activeRequest.wallet));
            return;
          }
        }
      } catch {
        // Discovery is best-effort; nonce reconciliation below remains fail closed.
      }
    }
    const unresolved = activeRequest.state === "UNRESOLVED"
      ? activeRequest
      : transitionVNextWalletRequest(activeRequest.requestId, "UNRESOLVED") ?? activeRequest;
    if (unresolved.planKind !== "swap" || Date.now() < Number(BigInt(unresolved.finalOnchainDeadline) * 1_000n)) {
      setWalletRequest(findBlockingVNextWalletRequest(unresolved.wallet) ?? unresolved);
      return;
    }
    try {
      const [latestNonce, pendingNonce] = await Promise.all([
        publicClient.getTransactionCount({ address: unresolved.wallet, blockTag: "latest" }),
        publicClient.getTransactionCount({ address: unresolved.wallet, blockTag: "pending" })
      ]);
      reconcileExpiredVNextWalletRequest({ request: unresolved, latestNonce: BigInt(latestNonce), pendingNonce: BigInt(pendingNonce), nowMs: Date.now() });
    } catch {
      reconcileExpiredVNextWalletRequest({ request: unresolved, latestNonce: null, pendingNonce: null, nowMs: Date.now() });
    }
    setWalletRequest(findBlockingVNextWalletRequest(unresolved.wallet));
  }, [identity.identityToken, publicClient]);

  useEffect(() => {
    if (!walletRequest || !["PROMPT_REQUESTED", "PROVIDER_PENDING", "UNRESOLVED"].includes(walletRequest.state)) return;
    let cancelled = false;
    const timers = WALLET_REQUEST_RECOVERY_DELAYS_MS.map((delay) => window.setTimeout(() => {
      if (!cancelled) void reconcileWalletRequest(walletRequest);
    }, delay));
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [reconcileWalletRequest, walletRequest?.requestId, walletRequest?.state]);

  const recheckWalletRequest = useCallback(async () => {
    if (!walletRequest || walletRequestRecheckPending || Date.now() - lastExplicitRecheckAt.current < EXPLICIT_RECHECK_COOLDOWN_MS) return;
    lastExplicitRecheckAt.current = Date.now();
    setWalletRequestRecheckPending(true);
    try {
      await reconcileWalletRequest(walletRequest);
    } finally {
      setWalletRequestRecheckPending(false);
    }
  }, [reconcileWalletRequest, walletRequest, walletRequestRecheckPending]);

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
            grossActualOutputAtomic: feeSettlement.grossActualOutputAtomic,
            actualUserNetOutputAtomic: feeSettlement.actualUserNetOutputAtomic
          } : {}),
          ...(feeV2Settlement ? {
            actualRmtFeeAtomic: feeV2Settlement.actualRmtFeeAtomic,
            actualProviderOutputAtomic: feeV2Settlement.actualProviderOutputAtomic
          } : {})
        } : undefined,
        failure
      );
      if (!resolved && state === "confirmed" && record.kind === "swap" && (record.feeSettlement || record.feeV2Settlement)) {
        if (!cancelled) setReconciliationFailed(true);
        return;
      }
      const visibleRecord = resolved ?? {
        ...record,
        state,
        ...(outputAmountAtomic ? { outputAmountAtomic } : {}),
        ...(failure?.classification ? { failureClassification: failure.classification } : {}),
        ...(failure?.networkGasSpentWei ? { networkGasSpentWei: failure.networkGasSpentWei } : {}),
        updatedAtMs: Date.now()
      };
      if (!cancelled) setRecord(address ? findUnresolvedVNextExecution(address) ?? visibleRecord : visibleRecord);
    })();
    return () => { cancelled = true; };
  }, [address, publicClient, receipt.data, receipt.isSuccess, receiptRequired, record]);

  const status = record?.state === "submitted"
    ? reconciliationFailed ? "reconciliation_failed" : receipt.isError ? "confirmation_unavailable" : "confirming"
    : record?.state ?? "idle";
  return { record, walletRequest, status, recheckWalletRequest, walletRequestRecheckPending } as const;
}
