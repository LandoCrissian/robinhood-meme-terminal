"use client";
import { boundVNextNativeSettlementEnvelope, hasVerifiedVNextSwapSettlement, verifyVNextErc20OutputSettlement, verifyVNextNativeOutputSettlement, type VNextOutputSettlement } from "../../lib/vnext/output-settlement";


import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import {
  classifyVNextRevertedExecution,
  findBlockingVNextWalletRequest,
  findUnresolvedVNextExecution,
  isVNextWalletProviderRequestActive,
  promoteDiscoveredVNextWalletRequestToSubmitted,
  readVNextExecutionJournal,
  recoveryValueForWallet,
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
import { selectedVNextWalletReadAddress } from "../../lib/vnext/selected-wallet-read-authority";

const WALLET_REQUEST_RECOVERY_DELAYS_MS = [0, 10_000, 30_000, 60_000] as const;
const EXPLICIT_RECHECK_COOLDOWN_MS = 5_000;

export function useVNextExecutionRecovery() {
  const account = useAccount();
  const identity = useRmtIdentity();
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const [record, setRecord] = useState<VNextExecutionRecord | null>(null);
  const [walletRequest, setWalletRequest] = useState<VNextWalletRequestRecord | null>(null);
  const [reconciliationFailureTxHash, setReconciliationFailureTxHash] = useState<string | null>(null);
  const [walletRequestRecheck, setWalletRequestRecheck] = useState<{ requestId: string; scope: string } | null>(null);
  const lastExplicitRecheckAt = useRef(0);
  const recoveryWallet = selectedVNextWalletReadAddress({
    selectedWalletKey: identity.activeWalletKey,
    selectedWalletKind: identity.activeWalletKind,
    selectedSignerAuthority: identity.activeSignerAuthority,
    connectedAddress: account.address,
    connectedChainId: account.chainId,
    connectorId: account.connector?.id,
    connectorType: account.connector?.type,
    connectorUid: account.connector?.uid,
    requiredChainId: ROBINHOOD_MAINNET_CHAIN_ID
  });
  const recoveryScope = recoveryWallet && identity.activeWalletKey
    ? `${identity.userId}:${identity.activeWalletKey}:${recoveryWallet.toLowerCase()}`
    : null;
  const recoveryContext = useRef({ generation: 0, scope: null as string | null, wallet: null as string | null });
  useLayoutEffect(() => {
    if (recoveryContext.current.scope === recoveryScope) return;
    recoveryContext.current = {
      generation: recoveryContext.current.generation + 1,
      scope: recoveryScope,
      wallet: recoveryWallet?.toLowerCase() ?? null
    };
    lastExplicitRecheckAt.current = 0;
  }, [recoveryScope, recoveryWallet]);
  const visibleRecord = recoveryValueForWallet(record, recoveryWallet);
  const visibleWalletRequest = recoveryValueForWallet(walletRequest, recoveryWallet);
  const walletRequestRecheckPending = Boolean(walletRequestRecheck
    && recoveryScope
    && walletRequestRecheck.scope === recoveryScope
    && visibleWalletRequest?.requestId === walletRequestRecheck.requestId);
  const receiptRequired = visibleRecord?.state === "submitted"
    || (visibleRecord?.state === "confirmed" && visibleRecord.kind === "swap" && !hasVerifiedVNextSwapSettlement(visibleRecord));
  const confirmations = visibleRecord?.feeSettlement || visibleRecord?.feeV2Settlement ? 2 : 1;
  // Wagmi's wrapper throws after a reverted receipt and discards its status.
  // Recovery must retain the canonical receipt, including a mined failure.
  const receipt = useQuery({
    queryKey: ["vnext-exact-execution-receipt", ROBINHOOD_MAINNET_CHAIN_ID, visibleRecord?.txHash, confirmations],
    enabled: Boolean(receiptRequired && visibleRecord?.txHash && publicClient),
    queryFn: () => {
      if (!publicClient || !visibleRecord?.txHash) throw new Error("Receipt client unavailable");
      return publicClient.waitForTransactionReceipt({ hash: visibleRecord.txHash, confirmations, timeout: 60_000 });
    },
    retry: 2
  });

  useEffect(() => {
    // A reload after an approval receipt must also recover the latest confirmed approval.
    setRecord(recoveryWallet ? findUnresolvedVNextExecution(recoveryWallet)
      ?? readVNextExecutionJournal().find((candidate) => candidate.wallet.toLowerCase() === recoveryWallet.toLowerCase()) ?? null : null);
    setWalletRequest(recoveryWallet ? findBlockingVNextWalletRequest(recoveryWallet) : null);
    if (!recoveryWallet) return;
    const wallet = recoveryWallet.toLowerCase();
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
        setWalletRequest(findBlockingVNextWalletRequest(recoveryWallet));
      }
    };
    const onWalletRequestChange = () => {
      setWalletRequest(findBlockingVNextWalletRequest(recoveryWallet));
    };
    window.addEventListener(VNEXT_EXECUTION_EVENT, onJournalChange);
    window.addEventListener(VNEXT_WALLET_REQUEST_EVENT, onWalletRequestChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VNEXT_EXECUTION_EVENT, onJournalChange);
      window.removeEventListener(VNEXT_WALLET_REQUEST_EVENT, onWalletRequestChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [recoveryWallet]);

  const reconcileWalletRequest = useCallback(async (request: VNextWalletRequestRecord) => {
    if (!publicClient || isVNextWalletProviderRequestActive(request.requestId)) return;
    const attempt = { ...recoveryContext.current };
    const isCurrentRecovery = () => Boolean(
      attempt.scope
      && attempt.scope === recoveryContext.current.scope
      && attempt.generation === recoveryContext.current.generation
      && attempt.wallet === request.wallet.toLowerCase()
    );
    if (!isCurrentRecovery()) return;
    const activeRequest = findBlockingVNextWalletRequest(request.wallet);
    if (!activeRequest || activeRequest.requestId !== request.requestId) {
      if (isCurrentRecovery()) setWalletRequest(activeRequest);
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
            if (isCurrentRecovery()) {
              setRecord(promoted);
              setWalletRequest(findBlockingVNextWalletRequest(activeRequest.wallet));
            }
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
      if (isCurrentRecovery()) setWalletRequest(findBlockingVNextWalletRequest(unresolved.wallet) ?? unresolved);
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
    if (isCurrentRecovery()) setWalletRequest(findBlockingVNextWalletRequest(unresolved.wallet));
  }, [identity.identityToken, publicClient]);

  useEffect(() => {
    if (!visibleWalletRequest || !["PROMPT_REQUESTED", "PROVIDER_PENDING", "UNRESOLVED"].includes(visibleWalletRequest.state)) return;
    let cancelled = false;
    const timers = WALLET_REQUEST_RECOVERY_DELAYS_MS.map((delay) => window.setTimeout(() => {
      if (!cancelled) void reconcileWalletRequest(visibleWalletRequest);
    }, delay));
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [reconcileWalletRequest, visibleWalletRequest?.requestId, visibleWalletRequest?.state]);

  const recheckWalletRequest = useCallback(async () => {
    if (!visibleWalletRequest || !recoveryScope || walletRequestRecheckPending
      || Date.now() - lastExplicitRecheckAt.current < EXPLICIT_RECHECK_COOLDOWN_MS) return;
    const attempt = { ...recoveryContext.current };
    lastExplicitRecheckAt.current = Date.now();
    setWalletRequestRecheck({ requestId: visibleWalletRequest.requestId, scope: recoveryScope });
    try {
      await reconcileWalletRequest(visibleWalletRequest);
    } finally {
      if (attempt.scope === recoveryContext.current.scope && attempt.generation === recoveryContext.current.generation) {
        setWalletRequestRecheck((current) => current?.requestId === visibleWalletRequest.requestId ? null : current);
      }
    }
  }, [reconcileWalletRequest, recoveryScope, visibleWalletRequest, walletRequestRecheckPending]);

  useEffect(() => {
    if (
      !visibleRecord || !receiptRequired || !receipt.isSuccess || !receipt.data
      || receipt.data.transactionHash.toLowerCase() !== visibleRecord.txHash.toLowerCase()
    ) return;
    const activeRecord = visibleRecord;
    const attempt = { ...recoveryContext.current };
    const isCurrentRecovery = () => attempt.scope === recoveryContext.current.scope
      && attempt.generation === recoveryContext.current.generation;
    let cancelled = false;
    void (async () => {
      const state = receipt.data.status === "success" ? "confirmed" : "reverted";
      const feeV2Settlement = state === "confirmed" && activeRecord.kind === "swap" && activeRecord.feeV2Settlement
        ? settledVNextFeeExecutionV2(activeRecord, receipt.data.logs)
        : null;
      const feeSettlement = state === "confirmed" && activeRecord.kind === "swap" && activeRecord.feeSettlement
        ? settledVNextFeeExecution(activeRecord, receipt.data.logs)
        : null;
      let outputSettlement: VNextOutputSettlement | null = null;
      if (activeRecord.provider === "zero-x-swap" && state === "confirmed" && publicClient) {
        try {
          const transaction = await publicClient.getTransaction({ hash: activeRecord.txHash });
          outputSettlement = verifyVNextErc20OutputSettlement(activeRecord, receipt.data, transaction);
          if (identity.identityToken && boundVNextNativeSettlementEnvelope(activeRecord, receipt.data, transaction)) {
            const response = await fetch("/api/vnext/native-settlement-trace", { method: "POST", cache: "no-store", credentials: "same-origin",
              headers: { "Content-Type": "application/json", "privy-id-token": identity.identityToken },
              body: JSON.stringify({ txHash: activeRecord.txHash, wallet: activeRecord.wallet }), signal: AbortSignal.timeout(25000) });
            const result = response.ok ? await response.json() : null;
            if (result?.status === "available" && result.txHash?.toLowerCase() === activeRecord.txHash.toLowerCase()
              && result.blockHash?.toLowerCase() === receipt.data.blockHash.toLowerCase()) {
              outputSettlement = verifyVNextNativeOutputSettlement(activeRecord, receipt.data, transaction, result.trace);
            }
          }
        } catch { /* Receipt confirmation does not prove output delivery. */ }
      }
      const outputAmountAtomic = activeRecord.provider === "zero-x-swap" ? outputSettlement?.amountAtomic ?? null : (state === "confirmed"
        ? feeV2Settlement?.outputAmountAtomic
          ?? feeSettlement?.outputAmountAtomic
          ?? (activeRecord.kind === "swap" && (activeRecord.feeSettlement || activeRecord.feeV2Settlement)
            ? null
            : settledVNextOutputAtomic(activeRecord, receipt.data.logs))
        : null);
      if (state === "confirmed" && activeRecord.kind === "swap" && (
        activeRecord.feeV2Settlement && !feeV2Settlement
        || activeRecord.feeSettlement && !feeSettlement
      )) {
        if (!cancelled && isCurrentRecovery()) setReconciliationFailureTxHash(activeRecord.txHash);
        return;
      }
      if (activeRecord.state === "confirmed" && !outputAmountAtomic) return;
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
          transactionDeadline: activeRecord.deadline,
          receiptBlockTimestamp
        });
        failure = {
          ...(classification ? { classification } : {}),
          networkGasSpentWei: (receipt.data.gasUsed * receipt.data.effectiveGasPrice).toString()
        };
      }
      const resolved = resolveVNextExecution(
        activeRecord.txHash,
        state,
        undefined,
        Date.now(),
        outputAmountAtomic ? {
          outputAmountAtomic,
          ...(outputSettlement ? { outputSettlement } : {}),
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
      if (!resolved && state === "confirmed" && activeRecord.kind === "swap" && (activeRecord.feeSettlement || activeRecord.feeV2Settlement)) {
        if (!cancelled && isCurrentRecovery()) setReconciliationFailureTxHash(activeRecord.txHash);
        return;
      }
      const reconciledRecord = resolved ?? {
        ...activeRecord,
        state,
        ...(outputAmountAtomic ? { outputAmountAtomic } : {}),
        ...(failure?.classification ? { failureClassification: failure.classification } : {}),
        ...(failure?.networkGasSpentWei ? { networkGasSpentWei: failure.networkGasSpentWei } : {}),
        updatedAtMs: Date.now()
      };
      if (!cancelled && isCurrentRecovery()) {
        setReconciliationFailureTxHash((current) => current === activeRecord.txHash ? null : current);
        setRecord(recoveryWallet ? findUnresolvedVNextExecution(recoveryWallet) ?? reconciledRecord : reconciledRecord);
      }
    })();
    return () => { cancelled = true; };
  }, [identity.identityToken, publicClient, receipt.data, receipt.isSuccess, receiptRequired, recoveryWallet, visibleRecord]);

  const reconciliationFailed = Boolean(visibleRecord && reconciliationFailureTxHash === visibleRecord.txHash);
  const status = visibleRecord?.state === "submitted"
    ? reconciliationFailed ? "reconciliation_failed" : receipt.isError ? "confirmation_unavailable" : "confirming"
    : visibleRecord?.state ?? "idle";
  useEffect(() => {
    if (!visibleRecord || visibleRecord.state !== "confirmed" || visibleRecord.kind !== "swap" || hasVerifiedVNextSwapSettlement(visibleRecord)) return;
    const timers = [3000, 10000, 30000].map((delay) => window.setTimeout(() => void receipt.refetch(), delay));
    return () => timers.forEach(window.clearTimeout);
  }, [visibleRecord?.txHash, visibleRecord?.state]);

  return { record: visibleRecord, walletRequest: visibleWalletRequest, status, recheckWalletRequest, walletRequestRecheckPending } as const;
}
