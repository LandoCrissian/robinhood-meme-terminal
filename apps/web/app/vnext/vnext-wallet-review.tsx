"use client";

import React, { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useSendTransaction } from "wagmi";
import { FundWalletButton } from "../fund-wallet-button";
import type { VNextAuthorizationPlan } from "../../lib/vnext/authorization-plan";
import {
  findBlockingVNextWalletRequest,
  findUnresolvedVNextExecution,
  promoteVNextWalletRequestToSubmitted,
  recordPreparedVNextWalletRequest,
  transitionVNextWalletRequest
} from "../../lib/vnext/execution-recovery";
import type { VNextPreSignEvidence } from "../../lib/vnext/pre-sign-evidence";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";
import { assessVNextWalletGasReadiness, prepareVNextWalletTransaction } from "../../lib/vnext/wallet-submission";
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
  outputDecimals = 18
}: {
  plan: VNextAuthorizationPlan;
  evidence: VNextPreSignEvidence;
  onRefresh?: () => void;
  inputSymbol?: string;
  outputSymbol?: string;
  inputDecimals?: number;
  outputDecimals?: number;
}) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const submission = useSendTransaction();
  const [localError, setLocalError] = useState("");
  const [gasShortfall, setGasShortfall] = useState("");
  const [preflightPending, setPreflightPending] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const submissionEnabled = process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED === "true";
  const busy = preflightPending || submission.isPending || Boolean(submission.data);
  const expired = nowMs >= plan.expiresAtMs;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const requestWalletReview = async () => {
    setLocalError("");
    setGasShortfall("");
    setRequiresRefresh(false);
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
    const unresolved = findUnresolvedVNextExecution(address);
    if (unresolved) {
      setLocalError(`An RMT transaction is still unresolved (${unresolved.txHash.slice(0, 10)}…). Do not resubmit.`);
      return;
    }
    const unresolvedRequest = findBlockingVNextWalletRequest(address);
    if (unresolvedRequest) {
      setLocalError("A wallet request is still unresolved. Check the wallet and do not retry.");
      return;
    }
    setPreflightPending(true);
    let requestId: string | null = null;
    try {
      const [nativeBalanceWei, currentGasPriceWei, walletNonceBeforeRequest] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.getGasPrice(),
        publicClient.getTransactionCount({ address, blockTag: "pending" })
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
        setLocalError(`Add at least ${shortfall} ETH on Robinhood Chain for this transaction. RMT did not open the wallet.`);
        return;
      }
      const transaction = prepareVNextWalletTransaction({
        plan,
        evidence,
        connectedAddress: address,
        connectedChainId: chainId,
        nowMs: Date.now()
      });
      requestId = crypto.randomUUID();
      if (!recordPreparedVNextWalletRequest({ requestId, wallet: address, plan, walletNonceBeforeRequest: BigInt(walletNonceBeforeRequest) })) {
        setLocalError("RMT could not durably record the wallet request. The wallet was not opened.");
        return;
      }
      if (!transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED")) {
        setLocalError("RMT could not mark the wallet request as requested. The wallet was not opened.");
        return;
      }
      const pendingHash = submission.sendTransactionAsync(transaction);
      transitionVNextWalletRequest(requestId, "PROVIDER_PENDING");
      const txHash = await pendingHash;
      if (!promoteVNextWalletRequestToSubmitted({ requestId, wallet: address, plan, txHash })) {
        setLocalError("Transaction submitted, but local recovery storage is unavailable. Use the transaction link and do not resubmit.");
      }
    } catch (cause) {
      const rejected = cause instanceof Error && /rejected|denied|cancelled|canceled/i.test(cause.message);
      if (requestId) transitionVNextWalletRequest(requestId, rejected ? "USER_REJECTED" : "UNRESOLVED");
      setRequiresRefresh(rejected);
      setLocalError(rejected
        ? "Wallet request was rejected by the owner. Nothing was broadcast."
        : requestId
          ? "Wallet request is still unresolved. Check the wallet and do not retry."
          : "The exact transaction request was not accepted. Verify the route again.");
    } finally {
      setPreflightPending(false);
    }
  };

  return <div className="vnWalletSubmission">
    <button
      type="button"
      disabled={!submissionEnabled || busy}
      onClick={() => expired || requiresRefresh ? onRefresh?.() : void requestWalletReview()}
    >{!submissionEnabled
      ? "Wallet submission disabled"
      : expired || requiresRefresh
        ? "Refresh verified request"
      : preflightPending
        ? "Checking Robinhood ETH reserve…"
        : submission.isPending
          ? "Review exact request in wallet…"
          : submission.data
            ? "Submitted · recovery active"
            : plan.kind === "erc20_approval"
              ? "Review exact approval in wallet"
              : "Review verified swap in wallet"}</button>
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
    {submission.data ? <ExplorerLink kind="transaction" value={submission.data} accessibleName="Open submitted transaction in Robinhood Chain explorer">View transaction ↗</ExplorerLink> : null}
  </div>;
}
