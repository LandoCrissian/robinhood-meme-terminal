"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useSendTransaction } from "wagmi";
import { FundWalletButton } from "../fund-wallet-button";
import type { VNextAuthorizationPlan } from "../../lib/vnext/authorization-plan";
import { findUnresolvedVNextExecution, recordSubmittedVNextExecution } from "../../lib/vnext/execution-recovery";
import type { VNextPreSignEvidence } from "../../lib/vnext/pre-sign-evidence";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";
import { assessVNextWalletGasReadiness, prepareVNextWalletTransaction } from "../../lib/vnext/wallet-submission";

const EXPLORER = "https://robinhoodchain.blockscout.com";

export function VNextWalletReview({
  plan,
  evidence,
  autoRequest = false,
  inputSymbol = "input asset",
  outputSymbol = "output asset",
  inputDecimals = 18,
  outputDecimals = 18
}: {
  plan: VNextAuthorizationPlan;
  evidence: VNextPreSignEvidence;
  autoRequest?: boolean;
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
  const automaticallyRequestedPlan = useRef<string | undefined>(undefined);
  const submissionEnabled = process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED === "true";
  const busy = preflightPending || submission.isPending || Boolean(submission.data);
  const fee = evidence.netEconomics?.rmtFee.state === "planned" ? evidence.netEconomics.rmtFee : null;
  const feeSymbol = fee?.feeSide === "input" ? inputSymbol : outputSymbol;
  const feeDecimals = fee?.feeSide === "input" ? inputDecimals : outputDecimals;

  const requestWalletReview = async () => {
    setLocalError("");
    setGasShortfall("");
    if (!submissionEnabled) return;
    if (!isConnected || !address || chainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
      setLocalError("Connect the verified wallet on Robinhood Chain before continuing.");
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
    setPreflightPending(true);
    try {
      const [nativeBalanceWei, currentGasPriceWei] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.getGasPrice()
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
      const txHash = await submission.sendTransactionAsync(transaction);
      if (!recordSubmittedVNextExecution({ wallet: address, plan, txHash })) {
        setLocalError("Transaction submitted, but local recovery storage is unavailable. Use the transaction link and do not resubmit.");
      }
    } catch (cause) {
      const rejected = cause instanceof Error && /rejected|denied|cancelled|canceled/i.test(cause.message);
      setLocalError(rejected
        ? "Wallet review was cancelled. Nothing was submitted."
        : "The exact transaction request was not accepted. Verify the route again.");
    } finally {
      setPreflightPending(false);
    }
  };

  useEffect(() => {
    if (!autoRequest || !submissionEnabled || automaticallyRequestedPlan.current === plan.planId) return;
    automaticallyRequestedPlan.current = plan.planId;
    void requestWalletReview();
  }, [autoRequest, plan.planId, submissionEnabled]);

  return <div className="vnWalletSubmission">
    <button
      type="button"
      disabled={!submissionEnabled || busy}
      onClick={() => void requestWalletReview()}
    >{!submissionEnabled
      ? "Wallet submission disabled"
      : preflightPending
        ? "Checking Robinhood ETH reserve…"
        : submission.isPending
          ? "Review exact request in wallet…"
          : submission.data
            ? "Submitted · recovery active"
            : localError
              ? "Retry wallet review"
              : autoRequest
                ? "Opening verified wallet request…"
                : plan.kind === "erc20_approval"
                  ? "Review exact approval in wallet"
                  : "Review verified swap in wallet"}</button>
    <small>{submissionEnabled
      ? "Your wallet displays and authorizes this exact request. RMT cannot sign or submit it for you."
      : "The final wallet-submission gate remains off in production."}</small>
    {fee && evidence.feeExecution ? <div className="vnWalletFeeDisclosure" role="note">
      <strong>RMT execution fee: {formatUnits(BigInt(fee.expectedFeeAtomic), feeDecimals)} {feeSymbol} ({fee.feeBps / 100}%)</strong>
      <small>Maximum: {formatUnits(BigInt(fee.maximumFeeAtomic), feeDecimals)} {feeSymbol}. It settles atomically to {evidence.feeExecution.treasury.slice(0, 6)}…{evidence.feeExecution.treasury.slice(-4)} only if the swap succeeds.</small>
      <small>Positive slippage cannot raise the fee above this maximum. Your protected amount is net of the fee.</small>
    </div> : null}
    {plan.kind === "erc20_approval" ? <small>Standard ERC-20 approvals have no onchain expiry. This request is limited to the exact input amount, and RMT requires fresh verification before the swap.</small> : <small>The verified swap calldata enforces its onchain deadline and protected output.</small>}
    {localError ? <p className="vnAuthorizationError" role="status">{localError}</p> : null}
    {gasShortfall ? <FundWalletButton directReceive variant="inline" label="Add Robinhood ETH" /> : null}
    {submission.data ? <a href={`${EXPLORER}/tx/${submission.data}`} target="_blank" rel="noreferrer">View transaction ↗</a> : null}
  </div>;
}
