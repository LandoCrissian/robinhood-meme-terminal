"use client";

import React, { useEffect, useState } from "react";
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
  recordPreparedVNextWalletRequest,
  transitionVNextWalletRequest
} from "../../lib/vnext/execution-recovery";
import type { VNextPreSignEvidence } from "../../lib/vnext/pre-sign-evidence";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";
import { assessVNextWalletGasReadiness, prepareVNextWalletTransaction } from "../../lib/vnext/wallet-submission";
import {
  bindVNextExternalWallet,
  invokeVNextExternalWalletRequest,
  vNextMobileHandoffLabel,
  type VNextMobileHandoffState
} from "../../lib/vnext/wallet-handoff";
import { isVNextUserRejectedRequest } from "../../lib/vnext/wallet-request-error";
import { withVNextWalletRequestLock } from "../../lib/vnext/wallet-request-lock";
import { ExplorerLink } from "./terminal-links";

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
      <div><dt>Exact fee / asset</dt><dd>{formatUnits(BigInt(feeV2.expectedFeeAtomic), inputDecimals)} {inputSymbol}</dd></div>
      <div><dt>Provider input</dt><dd>{formatUnits(BigInt(feeV2.providerInputAtomic), inputDecimals)} {inputSymbol}</dd></div>
      <div><dt>Expected receive</dt><dd>{formatUnits(BigInt(feeV2.expectedUserNetOutputAtomic), outputDecimals)} {outputSymbol}</dd></div>
      <div><dt>Protected minimum</dt><dd>{formatUnits(BigInt(feeV2.protectedUserNetOutputAtomic), outputDecimals)} {outputSymbol}</dd></div>
      <div><dt>Provider</dt><dd>Uniswap V3</dd></div>
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
  const [gasShortfall, setGasShortfall] = useState("");
  const [preflightPending, setPreflightPending] = useState(false);
  const [handoffState, setHandoffState] = useState<VNextMobileHandoffState>("idle");
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const submissionEnabled = process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED === "true";
  const busy = preflightPending || ["opening", "provider_pending", "unresolved", "hash_received"].includes(handoffState);
  const expired = nowMs >= plan.expiresAtMs;
  const walletName = selectedWalletName ?? "selected wallet";

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const requestWalletReview = async () => {
    setLocalError("");
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
    let requestId: string | null = null;
    try {
      const locked = await withVNextWalletRequestLock(address, async () => {
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
        const [nativeBalanceWei, currentGasPriceWei, walletNonceBeforeRequest, requestBlock] = await Promise.all([
          publicClient.getBalance({ address }),
          publicClient.getGasPrice(),
          publicClient.getTransactionCount({ address, blockTag: "pending" }),
          publicClient.getBlock({ blockTag: "latest" })
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
        requestId = crypto.randomUUID();
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
        if (!transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED")) {
          throw new Error("RMT could not mark the wallet request as requested. The wallet was not opened.");
        }
        markVNextWalletProviderRequestActive(requestId);
        setHandoffState("opening");
        const pendingHash = invokeVNextExternalWalletRequest(() => walletClient.sendTransaction({
          account: transaction.account,
          chain: walletClient.chain,
          to: transaction.to,
          data: transaction.data,
          value: transaction.value,
          gas: transaction.gas
        }));
        transitionVNextWalletRequest(requestId, "PROVIDER_PENDING");
        setHandoffState("provider_pending");
        const txHash = await pendingHash;
        setTransactionHash(txHash);
        setHandoffState("hash_received");
        if (!promoteVNextWalletRequestToSubmitted({ requestId, wallet: address, plan, txHash })) {
          throw new Error("Transaction submitted, but local recovery storage is unavailable. Use the transaction link and do not resubmit.");
        }
      });
      if (!locked.acquired) {
        setHandoffState("idle");
        setLocalError(locked.reason === "contended"
          ? "A wallet request is already active."
          : "Secure cross-tab wallet serialization is unavailable. RMT did not open the wallet.");
      }
    } catch (cause) {
      const rejected = isVNextUserRejectedRequest(cause);
      if (requestId) transitionVNextWalletRequest(requestId, rejected ? "USER_REJECTED" : "UNRESOLVED");
      setRequiresRefresh(rejected);
      setHandoffState(requestId && !rejected ? "unresolved" : "idle");
      setLocalError(rejected
        ? "Wallet request was rejected by the owner. Nothing was broadcast."
        : requestId
          ? "Wallet request is still unresolved. Check the wallet and do not retry."
          : cause instanceof Error ? cause.message : "The exact transaction request was not accepted. Verify the route again.");
    } finally {
      if (requestId) clearVNextWalletProviderRequestActive(requestId);
      setPreflightPending(false);
    }
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
      onClick={() => expired || requiresRefresh ? onRefresh?.() : void requestWalletReview()}
    >{!submissionEnabled
      ? "Wallet submission disabled"
      : expired || requiresRefresh
        ? "Refresh verified request"
      : handoffState !== "idle"
        ? vNextMobileHandoffLabel(handoffState, walletName)
        : plan.kind === "erc20_approval"
          ? `Review exact approval in ${walletName}`
          : `Review verified swap in ${walletName}`}</button>
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
    {localError ? <p className="vnAuthorizationError" role="status">{localError}</p> : null}
    {gasShortfall ? <FundWalletButton directReceive variant="inline" label="Add Robinhood ETH" /> : null}
    {transactionHash ? <ExplorerLink kind="transaction" value={transactionHash} accessibleName="Open submitted transaction in Robinhood Chain explorer">View transaction ↗</ExplorerLink> : null}
  </div>;
}
