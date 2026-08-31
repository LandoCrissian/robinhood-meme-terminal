"use client";

import React, { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { FundWalletButton } from "../fund-wallet-button";
import type { VNextAuthorizationPlan } from "../../lib/vnext/authorization-plan";
import {
  clearVNextWalletProviderRequestActive,
  findBlockingVNextWalletRequest,
  findUnresolvedVNextExecution,
  markVNextWalletProviderRequestActive,
  promoteVNextWalletRequestToSubmitted,
  readVNextWalletRequestJournal,
  recordPreparedVNextWalletRequest,
  transitionVNextWalletRequest
} from "../../lib/vnext/execution-recovery";
import type { VNextPreSignEvidence } from "../../lib/vnext/pre-sign-evidence";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";
import {
  assessVNextWalletGasReadiness,
  prepareVNextWalletTransaction,
  vNextWalletRpcTransaction,
  type VNextWalletRpcTransaction,
  type VNextWalletTransaction
} from "../../lib/vnext/wallet-submission";
import {
  bindVNextExternalWallet,
  emitVNextWalletHandoffDiagnostic,
  inspectVNextWalletTransport,
  isVNextMobileBrowser,
  invokeVNextExternalWalletRequest,
  openVNextSelectedWallet,
  vNextMobileHandoffLabel,
  type VNextMobileHandoffState,
  type VNextWalletHandoffBinding,
  type VNextWalletTransport
} from "../../lib/vnext/wallet-handoff";
import { isVNextUserRejectedRequest } from "../../lib/vnext/wallet-request-error";
import {
  acquireVNextWalletRequestLease,
  type VNextWalletRequestLease
} from "../../lib/vnext/wallet-request-lock";
import { ExplorerLink } from "./terminal-links";

type PreparedVNextWalletHandoff = {
  requestId: string;
  binding: VNextWalletHandoffBinding;
  transaction: VNextWalletTransaction;
  rpcTransaction: VNextWalletRpcTransaction;
  transport: VNextWalletTransport;
  mobileWalletConnect: boolean;
  lease: VNextWalletRequestLease;
};

export function VNextWalletFeeDisclosure({
  planKind,
  evidence,
  inputSymbol,
  outputSymbol,
  inputDecimals,
  outputDecimals
}: {
  planKind: VNextAuthorizationPlan["kind"];
  evidence: VNextPreSignEvidence;
  inputSymbol: string;
  outputSymbol: string;
  inputDecimals: number;
  outputDecimals: number;
}) {
  const feeV2 = evidence.feeV2Economics;
  if (feeV2 && evidence.feeV2Settlement) return <div className="vnWalletFeeDisclosure" role="note">
    <strong>{planKind === "erc20_approval" ? "RMT execution fee on this approval: 0" : `RMT execution fee: ${formatUnits(BigInt(feeV2.expectedFeeAtomic), inputDecimals)} ${inputSymbol} (${feeV2.feeBps / 100}%)`}</strong>
    {planKind === "erc20_approval" ? <small>Planned trade fee: {feeV2.feeBps / 100}% of gross trade input · {formatUnits(BigInt(feeV2.expectedFeeAtomic), inputDecimals)} {inputSymbol}. It is not collected during approval.</small> : null}
    <dl>
      <div><dt>Gross input</dt><dd>{formatUnits(BigInt(feeV2.userGrossInputAtomic), inputDecimals)} {inputSymbol}</dd></div>
      <div><dt>Exact fee / asset</dt><dd>{formatUnits(BigInt(feeV2.expectedFeeAtomic), inputDecimals)} {inputSymbol} · paid in the sold/input asset</dd></div>
      <div><dt>Provider input</dt><dd>{formatUnits(BigInt(feeV2.providerInputAtomic), inputDecimals)} {inputSymbol}</dd></div>
      <div><dt>Expected receive</dt><dd>{formatUnits(BigInt(feeV2.expectedUserNetOutputAtomic), outputDecimals)} {outputSymbol}</dd></div>
      <div><dt>Protected minimum</dt><dd>{formatUnits(BigInt(feeV2.protectedUserNetOutputAtomic), outputDecimals)} {outputSymbol}</dd></div>
      <div><dt>Provider</dt><dd>Uniswap V3 · RMT atomic settlement V2</dd></div>
      <div><dt>Settlement</dt><dd>Atomic with swap</dd></div>
      <div><dt>Treasury</dt><dd><ExplorerLink kind="address" value={feeV2.treasury} accessibleName="Open RMT V2 fee treasury in Robinhood Chain explorer">{feeV2.treasury.slice(0, 6)}…{feeV2.treasury.slice(-4)} ↗</ExplorerLink></dd></div>
      <div><dt>Execution target</dt><dd><ExplorerLink kind="address" value={evidence.feeV2Settlement.executionTarget} accessibleName="Open RMT V2 executor in Robinhood Chain explorer">RMT V2 executor · {evidence.feeV2Settlement.executionTarget.slice(0, 6)}…{evidence.feeV2Settlement.executionTarget.slice(-4)} ↗</ExplorerLink></dd></div>
    </dl>
    <small>Gas and DEX/provider fees are separate. The protected receive amount is bound independently.</small>
  </div>;

  if (evidence.settlementMode === "DIRECT_NO_RMT_FEE" && evidence.directNoRmtFee) return <div className="vnWalletFeeDisclosure" role="note">
    <strong>RMT platform fee: 0</strong>
    <dl>
      <div><dt>Gross input</dt><dd>{formatUnits(BigInt(evidence.directNoRmtFee.userGrossInputAtomic), inputDecimals)} {inputSymbol}</dd></div>
      <div><dt>Provider input</dt><dd>{formatUnits(BigInt(evidence.directNoRmtFee.providerInputAtomic), inputDecimals)} {inputSymbol}</dd></div>
      <div><dt>Protected minimum</dt><dd>{formatUnits(BigInt(evidence.protectedOutputAtomic), outputDecimals)} {outputSymbol}</dd></div>
      <div><dt>Settlement</dt><dd>Direct · no RMT platform fee</dd></div>
    </dl>
    <small>Gas and DEX/provider fees remain separate. RMT receives no treasury transfer from this trade.</small>
  </div>;

  const legacyFee = evidence.netEconomics?.rmtFee.state === "planned" ? evidence.netEconomics.rmtFee : null;
  if (!legacyFee || !evidence.feeExecution) return null;
  const feeSymbol = legacyFee.feeSide === "input" ? inputSymbol : outputSymbol;
  const feeDecimals = legacyFee.feeSide === "input" ? inputDecimals : outputDecimals;
  return <div className="vnWalletFeeDisclosure" role="note">
    <strong>RMT execution fee: {formatUnits(BigInt(legacyFee.expectedFeeAtomic), feeDecimals)} {feeSymbol} ({legacyFee.feeBps / 100}%)</strong>
    <small>Maximum: {formatUnits(BigInt(legacyFee.maximumFeeAtomic), feeDecimals)} {feeSymbol}. It settles atomically to {evidence.feeExecution.treasury.slice(0, 6)}…{evidence.feeExecution.treasury.slice(-4)} only if the swap succeeds.</small>
    <small>Positive slippage cannot raise the fee above this maximum. Your protected amount is net of the fee.</small>
  </div>;
}

export function VNextWalletReview({
  plan,
  evidence,
  onRefresh,
  inputSymbol = "input asset",
  outputSymbol = "output asset",
  inputDecimals = 18,
  outputDecimals = 18,
  selectedWalletKey,
  selectedWalletKind,
  selectedWalletName
}: {
  plan: VNextAuthorizationPlan;
  evidence: VNextPreSignEvidence;
  onRefresh?: () => void;
  inputSymbol?: string;
  outputSymbol?: string;
  inputDecimals?: number;
  outputDecimals?: number;
  selectedWalletKey?: string | null;
  selectedWalletKind?: "embedded" | "external" | null;
  selectedWalletName?: string | null;
}) {
  const { address, chainId, connector, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const { data: walletClient } = useWalletClient({ connector });
  const [localError, setLocalError] = useState("");
  const [localStatus, setLocalStatus] = useState("");
  const [gasShortfall, setGasShortfall] = useState("");
  const [preflightPending, setPreflightPending] = useState(false);
  const [handoffState, setHandoffState] = useState<VNextMobileHandoffState>("idle");
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const preparedRef = useRef<PreparedVNextWalletHandoff | null>(null);
  const submissionEnabled = process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED === "true";
  const busy = preflightPending || ["opening", "provider_pending", "unresolved", "hash_received"].includes(handoffState);
  const expired = nowMs >= plan.expiresAtMs;
  const walletName = selectedWalletName ?? "selected wallet";

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    preparedRef.current?.lease.release();
  }, []);

  useEffect(() => {
    const prepared = preparedRef.current;
    if (!expired || handoffState !== "ready_to_open" || !prepared) return;
    transitionVNextWalletRequest(prepared.requestId, "EXPIRED_UNSUBMITTED");
    prepared.lease.release();
    preparedRef.current = null;
    setRequiresRefresh(true);
    setHandoffState("idle");
    setLocalStatus("");
    setLocalError("Verified request expired before wallet handoff. No transaction request was sent.");
  }, [expired, handoffState]);

  useEffect(() => {
    if (!["provider_pending", "unresolved"].includes(handoffState)) return;
    const report = (event: string) => emitVNextWalletHandoffDiagnostic({
      event,
      connectorId: connector?.id,
      connectorType: connector?.type,
      selectedWalletName: walletName,
      chainId,
      lifecycleState: handoffState,
      requestId: preparedRef.current?.requestId
    });
    const onVisibility = () => report(document.visibilityState === "hidden" ? "page_hidden" : "page_visible");
    const onPageHide = () => report("pagehide");
    const onPageShow = () => report("pageshow");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [chainId, connector?.id, connector?.type, handoffState, walletName]);

  function completeProviderRequest(prepared: PreparedVNextWalletHandoff, pendingHash: Promise<`0x${string}`>) {
    void pendingHash.then((txHash) => {
      emitVNextWalletHandoffDiagnostic({
        event: "provider_returned_hash",
        connectorId: prepared.binding.connectorId,
        connectorType: prepared.binding.connectorType,
        walletClientType: prepared.binding.walletClientType,
        selectedWalletName: prepared.binding.walletName,
        chainId: prepared.binding.chainId,
        lifecycleState: "hash_received",
        requestId: prepared.requestId
      });
      setTransactionHash(txHash);
      setHandoffState("hash_received");
      setLocalStatus("Transaction hash received. Recovery is active.");
      if (!promoteVNextWalletRequestToSubmitted({ requestId: prepared.requestId, wallet: prepared.binding.wallet, plan, txHash })) {
        setLocalError("Transaction submitted, but local recovery storage is unavailable. Use the transaction link and do not resubmit.");
      }
    }).catch((cause: unknown) => {
      const rejected = isVNextUserRejectedRequest(cause);
      transitionVNextWalletRequest(prepared.requestId, rejected ? "USER_REJECTED" : "UNRESOLVED");
      emitVNextWalletHandoffDiagnostic({
        event: rejected ? "provider_rejected_4001" : "provider_error_unresolved",
        connectorId: prepared.binding.connectorId,
        connectorType: prepared.binding.connectorType,
        walletClientType: prepared.binding.walletClientType,
        selectedWalletName: prepared.binding.walletName,
        chainId: prepared.binding.chainId,
        lifecycleState: rejected ? "USER_REJECTED" : "unresolved",
        requestId: prepared.requestId
      });
      setRequiresRefresh(rejected);
      setHandoffState(rejected ? "idle" : "unresolved");
      setLocalStatus("");
      setLocalError(rejected
        ? "Wallet request was rejected by the owner. Nothing was broadcast."
        : "Wallet request is still unresolved. Check the selected wallet and do not retry.");
    }).finally(() => {
      clearVNextWalletProviderRequestActive(prepared.requestId);
      prepared.lease.release();
      if (preparedRef.current?.requestId === prepared.requestId) preparedRef.current = null;
    });
  }

  /** This function deliberately performs no awaited work before provider invocation. */
  function openPreparedWalletRequest() {
    const prepared = preparedRef.current;
    setLocalError("");
    setLocalStatus("");
    if (!prepared || !walletClient || !connector || !address) {
      setLocalError("Wallet handoff did not start. No transaction request was sent. Prepare a fresh verified request.");
      return;
    }
    try {
      const now = Date.now();
      const binding = bindVNextExternalWallet({
        selectedWalletKey,
        selectedWalletKind,
        selectedWalletName,
        connectedAddress: address,
        connectedChainId: chainId,
        connectorId: connector.id,
        connectorType: connector.type,
        walletClientAddress: walletClient.account?.address,
        walletClientChainId: walletClient.chain?.id,
        recipient: plan.recipient
      });
      if (binding.connectorId !== prepared.binding.connectorId || binding.wallet !== prepared.binding.wallet) {
        throw new Error("The selected wallet changed after preparation. RMT did not send the request.");
      }
      if (findUnresolvedVNextExecution(address)) throw new Error("An RMT transaction is still unresolved. Do not resubmit.");
      const durable = readVNextWalletRequestJournal().find((record) => record.requestId === prepared.requestId);
      if (!durable || durable.state !== "PREPARED") throw new Error("The durable prepared request is no longer available. RMT did not send another request.");
      const blocking = findBlockingVNextWalletRequest(address);
      if (blocking && blocking.requestId !== prepared.requestId) throw new Error("A wallet request is already active.");
      const exactTransaction = prepareVNextWalletTransaction({
        plan,
        evidence,
        connectedAddress: address,
        connectedChainId: chainId ?? 0,
        nowMs: now
      });
      const exactRpcTransaction = vNextWalletRpcTransaction(exactTransaction);
      if (JSON.stringify(exactRpcTransaction) !== JSON.stringify(prepared.rpcTransaction)) {
        throw new Error("The prepared transaction no longer matches the verified request. RMT did not open the wallet.");
      }
      if (!transitionVNextWalletRequest(prepared.requestId, "PROMPT_REQUESTED")) {
        throw new Error("RMT could not durably mark the wallet request before provider invocation.");
      }
      markVNextWalletProviderRequestActive(prepared.requestId);
      setHandoffState("opening");
      emitVNextWalletHandoffDiagnostic({
        event: "provider_request_invoked",
        connectorId: binding.connectorId,
        connectorType: binding.connectorType,
        walletClientType: binding.walletClientType,
        selectedWalletName: binding.walletName,
        chainId: binding.chainId,
        redirectCapable: Boolean(prepared.transport.safeMobileOpenUri),
        lifecycleState: "PROMPT_REQUESTED",
        requestId: prepared.requestId
      });
      const pendingHash = invokeVNextExternalWalletRequest(() => walletClient.request({
        method: "eth_sendTransaction",
        params: [prepared.rpcTransaction]
      }) as Promise<`0x${string}`>);
      completeProviderRequest(prepared, pendingHash);
      if (!transitionVNextWalletRequest(prepared.requestId, "PROVIDER_PENDING")) {
        throw new Error("The connector request began but its durable state could not be updated. Do not retry.");
      }
      setHandoffState("provider_pending");
      setLocalStatus(`Transaction request sent to ${binding.walletName}. Review the exact transaction there. RMT cannot approve or sign it.`);
      if (prepared.mobileWalletConnect && prepared.transport.safeMobileOpenUri) {
        emitVNextWalletHandoffDiagnostic({
          event: "native_wallet_activation_attempted",
          connectorId: binding.connectorId,
          connectorType: binding.connectorType,
          walletClientType: binding.walletClientType,
          selectedWalletName: binding.walletName,
          chainId: binding.chainId,
          redirectCapable: true,
          lifecycleState: "provider_pending",
          requestId: prepared.requestId
        });
        openVNextSelectedWallet(prepared.transport.safeMobileOpenUri, (target) => window.location.assign(target));
      }
    } catch (cause) {
      const record = readVNextWalletRequestJournal().find((candidate) => candidate.requestId === prepared.requestId);
      if (record && ["PROMPT_REQUESTED", "PROVIDER_PENDING"].includes(record.state)) {
        transitionVNextWalletRequest(prepared.requestId, "UNRESOLVED");
        setHandoffState("unresolved");
        setLocalError("Wallet request is still unresolved. Check the selected wallet and do not retry.");
      } else {
        setRequiresRefresh(true);
        setHandoffState("idle");
        setLocalError(cause instanceof Error ? cause.message : "Wallet handoff did not start. No transaction request was sent.");
        prepared.lease.release();
        preparedRef.current = null;
      }
    }
  }

  const prepareWalletReview = async () => {
    setLocalError("");
    setLocalStatus("");
    setGasShortfall("");
    setRequiresRefresh(false);
    setTransactionHash(null);
    if (!submissionEnabled) return;
    if (Date.now() >= plan.expiresAtMs) {
      setRequiresRefresh(true);
      setLocalError("The verified request expired before wallet review. Refresh it before opening the wallet.");
      return;
    }
    if (!isConnected || !address || chainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
      setLocalError("Connect your external trading wallet on Robinhood Chain before continuing.");
      return;
    }
    if (!publicClient) {
      setLocalError("Live Robinhood gas readiness is unavailable. RMT did not open the wallet.");
      return;
    }
    if (!walletClient || !connector) {
      setLocalError("Wallet handoff did not start. No transaction request was sent. Select the external wallet again.");
      return;
    }
    setPreflightPending(true);
    setHandoffState("preparing");
    let lease: VNextWalletRequestLease | null = null;
    try {
      const locked = await acquireVNextWalletRequestLease(address);
      if (!locked.acquired) {
        setHandoffState("idle");
        setLocalError(locked.reason === "contended"
          ? "A wallet request is already active."
          : "Secure cross-tab wallet serialization is unavailable. RMT did not open the wallet.");
        return;
      }
      lease = locked.lease;
        const binding = bindVNextExternalWallet({
          selectedWalletKey,
          selectedWalletKind,
          selectedWalletName,
          connectedAddress: address,
          connectedChainId: chainId,
          connectorId: connector.id,
          connectorType: connector.type,
          walletClientAddress: walletClient.account?.address,
          walletClientChainId: walletClient.chain?.id,
          recipient: plan.recipient
        });
        const unresolved = findUnresolvedVNextExecution(address);
        if (unresolved) throw new Error(`An RMT transaction is still unresolved (${unresolved.txHash.slice(0, 10)}…). Do not resubmit.`);
        if (findBlockingVNextWalletRequest(address)) throw new Error("A wallet request is already active.");
        const [nativeBalanceWei, currentGasPriceWei, walletNonceBeforeRequest, requestBlock, provider] = await Promise.all([
          publicClient.getBalance({ address }),
          publicClient.getGasPrice(),
          publicClient.getTransactionCount({ address, blockTag: "pending" }),
          publicClient.getBlock({ blockTag: "latest" }),
          connector.getProvider()
        ]);
        const gasReadiness = assessVNextWalletGasReadiness({
          nativeBalanceWei,
          currentGasPriceWei,
          evidenceFeeCeilingWei: evidence.feeCeilingWei,
          gasLimitUnits: plan.gasLimit,
          transactionValueAtomic: plan.value
        });
        if (!gasReadiness.ready) {
          const shortfall = formatUnits(gasReadiness.shortfallWei, 18);
          setGasShortfall(shortfall);
          throw new Error(`Add at least ${shortfall} ETH on Robinhood Chain for this transaction. RMT did not open the wallet.`);
        }
        const transaction = prepareVNextWalletTransaction({
          plan,
          evidence,
          connectedAddress: address,
          connectedChainId: chainId,
          nowMs: Date.now()
        });
        const requestId = crypto.randomUUID();
        if (!recordPreparedVNextWalletRequest({
          requestId,
          wallet: address,
          plan,
          walletNonceBeforeRequest: BigInt(walletNonceBeforeRequest),
          requestBlockNumber: requestBlock.number,
          ...(requestBlock.hash ? { requestBlockHash: requestBlock.hash } : {}),
          connectorId: binding.connectorId,
          connectorType: binding.connectorType,
          walletClientType: binding.walletClientType,
          walletName: binding.walletName
        })) throw new Error("RMT could not durably record the wallet request. The wallet was not opened.");
        const transport = inspectVNextWalletTransport(provider, binding.selectedConnectorType);
        const prepared: PreparedVNextWalletHandoff = {
          requestId,
          binding,
          transaction,
          rpcTransaction: vNextWalletRpcTransaction(transaction),
          transport,
          mobileWalletConnect: isVNextMobileBrowser(navigator.userAgent) && transport.kind === "walletconnect",
          lease
        };
        preparedRef.current = prepared;
        emitVNextWalletHandoffDiagnostic({
          event: "verified_request_prepared",
          connectorId: binding.connectorId,
          connectorType: binding.connectorType,
          walletClientType: binding.walletClientType,
          selectedWalletName: binding.walletName,
          chainId: binding.chainId,
          redirectCapable: Boolean(transport.safeMobileOpenUri),
          lifecycleState: "ready_to_open",
          requestId
        });
        if (prepared.mobileWalletConnect) {
          setHandoffState("ready_to_open");
          setLocalStatus("Verified request prepared. Open the selected wallet only when you are ready to review it.");
        } else {
          openPreparedWalletRequest();
        }
        lease = null;
    } catch (cause) {
      setHandoffState("idle");
      setLocalError(cause instanceof Error ? cause.message : "The exact transaction request could not be prepared.");
    } finally {
      lease?.release();
      setPreflightPending(false);
    }
  };

  const reopenSelectedWallet = () => {
    const prepared = preparedRef.current;
    if (!prepared?.transport.safeMobileOpenUri || preparedRef.current?.requestId !== prepared.requestId) return;
    emitVNextWalletHandoffDiagnostic({
      event: "native_wallet_reopened",
      connectorId: prepared.binding.connectorId,
      connectorType: prepared.binding.connectorType,
      walletClientType: prepared.binding.walletClientType,
      selectedWalletName: prepared.binding.walletName,
      chainId: prepared.binding.chainId,
      redirectCapable: true,
      lifecycleState: "provider_pending",
      requestId: prepared.requestId
    });
    openVNextSelectedWallet(prepared.transport.safeMobileOpenUri, (target) => window.location.assign(target));
  };

  return <div className="vnWalletSubmission">
    <div className="vnWalletHandoffIdentity" aria-label="Selected external wallet handoff">
      <span><small>External signer</small><strong>{walletName}</strong></span>
      <span><small>Wallet</small><strong>{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Unavailable"}</strong></span>
      <span><small>Network</small><strong>Robinhood Chain · 4663</strong></span>
      <span><small>Connector</small><strong>{connector ? `${connector.name} · ${connector.id}` : "Unavailable"}</strong></span>
    </div>
    <button
      type="button"
      aria-label={plan.kind === "erc20_approval" ? "Review exact approval in wallet" : "Review verified swap in wallet"}
      disabled={!submissionEnabled || busy}
      onClick={() => expired || requiresRefresh
        ? onRefresh?.()
        : handoffState === "ready_to_open" ? openPreparedWalletRequest() : void prepareWalletReview()}
    >{!submissionEnabled
      ? "Wallet submission disabled"
      : expired || requiresRefresh
        ? "Refresh verified request"
      : handoffState !== "idle"
        ? vNextMobileHandoffLabel(handoffState, walletName)
        : plan.kind === "erc20_approval"
          ? `Review exact approval in ${walletName}`
          : `Review verified swap in ${walletName}`}</button>
    {handoffState === "provider_pending" && preparedRef.current?.transport.safeMobileOpenUri
      ? <button type="button" className="vnWalletReopen" onClick={reopenSelectedWallet}>Open {walletName}</button>
      : null}
    <small>{submissionEnabled
      ? "Your wallet displays and authorizes this exact request. RMT cannot sign or submit it for you."
      : "The final wallet-submission gate remains off in production."}</small>
    <VNextWalletFeeDisclosure
      planKind={plan.kind}
      evidence={evidence}
      inputSymbol={inputSymbol}
      outputSymbol={outputSymbol}
      inputDecimals={inputDecimals}
      outputDecimals={outputDecimals}
    />
    {plan.kind === "erc20_approval" ? <small>Standard ERC-20 approvals have no onchain expiry. This request is limited to the exact input amount, and RMT requires fresh verification before the swap.</small> : <small>The verified swap calldata enforces its onchain deadline and protected output.</small>}
    <small>{expired ? "Verified request expired. Prepare a fresh server-verified request." : `Wallet review window · ${Math.max(0, Math.ceil((plan.expiresAtMs - nowMs) / 1_000))}s remaining`}</small>
    {localStatus ? <p className="vnAuthorizationStatus" role="status">{localStatus}</p> : null}
    {localError ? <p className="vnAuthorizationError" role="status">{localError}</p> : null}
    {gasShortfall ? <FundWalletButton directReceive variant="inline" label="Add Robinhood ETH" /> : null}
    {transactionHash ? <ExplorerLink kind="transaction" value={transactionHash} accessibleName="Open submitted transaction in Robinhood Chain explorer">View transaction ↗</ExplorerLink> : null}
  </div>;
}
