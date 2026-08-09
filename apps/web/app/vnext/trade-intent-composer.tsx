"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount } from "wagmi";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import { assetKey } from "../../lib/vnext/execution-domain";
import type { VNextExecutionRecord } from "../../lib/vnext/execution-recovery";
import { createExactInputIntent, percentageOfAtomic, type TradeSide } from "../../lib/vnext/intent-draft";
import { parseVNextQuoteResponse, selectVNextRoute, type VNextQuoteResponse } from "../../lib/vnext/quote-observation";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "../../lib/vnext/pre-sign-evidence";
import { postApprovalVerificationOutcome, resolvedVNextExecutionOutcome } from "../../lib/vnext/post-approval";
import { parseVNextAuthorizationBundle, type VNextAuthorizationPlan } from "../../lib/vnext/authorization-plan";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_USDG, ROBINHOOD_WETH, robinhoodWalletAccount } from "../../lib/vnext/robinhood-assets";
import { metadataFromDetectedWalletAsset, type VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { clearTradeQuoteCache, requestTradeQuote, tradeQuoteFailureFromResponse } from "../../lib/trade-quote-client";
import { useRmtIdentity } from "../rmt-identity";
import { VNextWalletReview } from "./vnext-wallet-review";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatAtomicDisplay(value: string, decimals: number) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const grouped = BigInt(whole).toLocaleString();
  const visibleFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return visibleFraction ? `${grouped}.${visibleFraction}` : grouped;
}

function uniqueAssets(assets: AssetMetadata[]) {
  return [...new Map(assets.map((asset) => [assetKey(asset.id), asset])).values()];
}

export function TradeIntentComposer({ marketName, marketSymbol, marketAsset, walletAssets, executionRecord, onContinueTrading }: {
  marketName: string;
  marketSymbol: string;
  marketAsset?: AssetMetadata;
  walletAssets: VNextDetectedWalletAsset[];
  executionRecord?: VNextExecutionRecord | null;
  onContinueTrading: () => void;
}) {
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("100");
  const [buyInputKey, setBuyInputKey] = useState<string>();
  const [sellOutputKey, setSellOutputKey] = useState(assetKey(ROBINHOOD_USDG.id));
  const [quoteState, setQuoteState] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "ready"; response: VNextQuoteResponse }
    | { state: "error"; message: string }
  >({ state: "idle" });
  const [verificationState, setVerificationState] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "ready"; evidence: VNextPreSignEvidence }
    | { state: "error"; message: string }
  >({ state: "idle" });
  const [authorizationState, setAuthorizationState] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "ready"; plan: VNextAuthorizationPlan }
    | { state: "error"; message: string }
  >({ state: "idle" });
  const [postExecutionState, setPostExecutionState] = useState<
    | { state: "idle" }
    | { state: "approval_confirmed"; message: string }
    | { state: "refreshing"; message: string }
    | { state: "swap_ready"; message: string }
    | { state: "blocked"; message: string }
    | { state: "swap_confirmed"; message: string }
    | { state: "reverted"; message: string }
  >({ state: "idle" });
  const handledExecution = useRef<string | undefined>(undefined);
  const pendingTradeAfterLogin = useRef(false);
  const continuedApproval = useRef<string | undefined>(undefined);
  const lastReadyQuote = useRef<VNextQuoteResponse | undefined>(undefined);
  const lastReadyVerification = useRef<VNextPreSignEvidence | undefined>(undefined);
  const receiptAction = useRef<HTMLButtonElement>(null);
  const { address, chainId, isConnected } = useAccount();
  const identity = useRmtIdentity();
  const onRobinhood = chainId === ROBINHOOD_MAINNET_CHAIN_ID;
  const authorizationEnabled = process.env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED === "true";
  const verifiedWalletAssets = useMemo(
    () => uniqueAssets(walletAssets.flatMap((asset) => {
      const metadata = metadataFromDetectedWalletAsset(asset);
      return metadata ? [metadata] : [];
    })),
    [walletAssets]
  );
  const buyInputs = useMemo(() => marketAsset
    ? verifiedWalletAssets.filter((asset) => assetKey(asset.id) !== assetKey(marketAsset.id))
    : verifiedWalletAssets,
  [marketAsset, verifiedWalletAssets]);
  const selectedBuyInput = buyInputs.find((asset) => assetKey(asset.id) === buyInputKey)
    ?? buyInputs.find((asset) => assetKey(asset.id) === assetKey(ROBINHOOD_USDG.id))
    ?? buyInputs[0]
    ?? (!isConnected ? ROBINHOOD_USDG : undefined);
  const displayedBuyInputs = buyInputs.length > 0 ? buyInputs : selectedBuyInput ? [selectedBuyInput] : [];
  const sellOutputs = useMemo(() => marketAsset
    ? [ROBINHOOD_USDG, ROBINHOOD_WETH].filter((asset) => assetKey(asset.id) !== assetKey(marketAsset.id))
    : [ROBINHOOD_USDG, ROBINHOOD_WETH],
  [marketAsset]);
  const selectedSellOutput = sellOutputs.find((asset) => assetKey(asset.id) === sellOutputKey) ?? sellOutputs[0];
  const pair = useMemo(() => {
    if (!marketAsset) return null;
    if (side === "buy") return selectedBuyInput ? { inputAsset: selectedBuyInput, outputAsset: marketAsset } : null;
    return selectedSellOutput ? { inputAsset: marketAsset, outputAsset: selectedSellOutput } : null;
  }, [marketAsset, selectedBuyInput, selectedSellOutput, side]);
  const pairInputDecimals = pair?.inputAsset.decimals ?? null;
  const inputBalance = useMemo(() => {
    const inputAddress = pair?.inputAsset.id.locator.kind === "contract" ? pair.inputAsset.id.locator.address.toLowerCase() : null;
    if (!inputAddress || pairInputDecimals === null) return undefined;
    return walletAssets.find((asset) => (
      asset.address.toLowerCase() === inputAddress
      && asset.identityState === "verified"
      && asset.decimals === pairInputDecimals
      && /^(0|[1-9][0-9]*)$/.test(asset.balanceAtomic)
    ));
  }, [pair, pairInputDecimals, walletAssets]);

  const draft = useMemo(() => {
    if (!marketAsset) return { intent: null, message: "This preview asset has no verified chain-qualified contract identity." };
    if (!address || !isConnected) return { intent: null, message: "Connect a wallet to bind the source account and recipient." };
    if (!onRobinhood) return { intent: null, message: "Switch to Robinhood Chain before creating an intent." };
    if (!pair) return { intent: null, message: side === "buy" ? "No different verified wallet-held input asset is detected." : "No supported settlement asset is available." };
    try {
      const account = robinhoodWalletAccount(address as Address);
      return {
        intent: createExactInputIntent({
          intentId: `preview:${account.accountId}:${side}:${assetKey(pair.inputAsset.id)}:${assetKey(pair.outputAsset.id)}`,
          sourceAccount: account,
          recipient: account,
          inputAsset: pair.inputAsset,
          outputAsset: pair.outputAsset,
          amount,
          requestedAtMs: Date.now()
        }),
        message: "Intent structure is valid. Live indicative quoting is available."
      };
    } catch (error) {
      return { intent: null, message: error instanceof Error ? error.message : "Intent is incomplete." };
    }
  }, [address, amount, isConnected, marketAsset, onRobinhood, pair, side]);

  const chooseSide = (next: TradeSide) => {
    setSide(next);
    setAmount(next === "buy" ? "100" : "");
  };
  const inputSymbol = pair?.inputAsset.symbol ?? (side === "buy" ? "—" : marketSymbol);
  const outputSymbol = pair?.outputAsset.symbol ?? (side === "buy" ? marketSymbol : "USDG");
  const inputAddress = pair?.inputAsset.id.locator.kind === "contract" ? pair.inputAsset.id.locator.address : null;
  const outputAddress = pair?.outputAsset.id.locator.kind === "contract" ? pair.outputAsset.id.locator.address : null;
  const requestKey = `${address ?? ""}:${side}:${amount}:${inputAddress ?? ""}:${outputAddress ?? ""}`;
  useEffect(() => {
    setQuoteState({ state: "idle" });
    setVerificationState({ state: "idle" });
    setAuthorizationState({ state: "idle" });
    setPostExecutionState({ state: "idle" });
    lastReadyQuote.current = undefined;
    lastReadyVerification.current = undefined;
    pendingTradeAfterLogin.current = false;
    continuedApproval.current = undefined;
  }, [requestKey]);
  useEffect(() => {
    const outcome = resolvedVNextExecutionOutcome({
      record: executionRecord,
      handledTxHash: handledExecution.current,
      wallet: address,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent?.amountAtomic
    });
    if (!executionRecord || !outcome) return;
    handledExecution.current = executionRecord.txHash;
    setQuoteState({ state: "idle" });
    setVerificationState({ state: "idle" });
    setAuthorizationState({ state: "idle" });
    setPostExecutionState(outcome);
  }, [address, draft.intent, executionRecord, inputAddress, outputAddress]);
  useEffect(() => {
    if (quoteState.state !== "ready") return;
    const expiries = quoteState.response.attempts.flatMap((attempt) => attempt.expiresAtMs === null ? [] : [attempt.expiresAtMs]);
    if (expiries.length === 0) return;
    const delay = Math.max(0, Math.min(...expiries) - Date.now());
    const timeout = window.setTimeout(() => setQuoteState({ state: "error", message: "Live quote expired. Check routes again." }), delay);
    return () => window.clearTimeout(timeout);
  }, [quoteState]);
  useEffect(() => {
    if (authorizationState.state !== "ready") return;
    const delay = Math.max(0, authorizationState.plan.expiresAtMs - Date.now());
    const timeout = window.setTimeout(() => setAuthorizationState({ state: "error", message: "Wallet-review plan expired. Verify the route again." }), delay);
    return () => window.clearTimeout(timeout);
  }, [authorizationState]);
  useEffect(() => {
    if (postExecutionState.state !== "swap_confirmed") return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPostExecutionState({ state: "idle" });
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => receiptAction.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [postExecutionState.state]);
  const visibleQuote = quoteState.state === "ready"
    ? quoteState.response
    : quoteState.state === "loading"
      ? lastReadyQuote.current
      : undefined;
  const visibleVerification = verificationState.state === "ready"
    ? verificationState.evidence
    : verificationState.state === "loading"
      ? lastReadyVerification.current
      : undefined;
  const routeSelection = visibleQuote
    ? selectVNextRoute(visibleQuote.attempts)
    : { bestObserved: undefined, verificationCandidate: undefined, usesVerifiedBackup: false };
  const bestQuote = routeSelection.bestObserved;
  const verificationQuote = routeSelection.verificationCandidate;
  const displayOutput = bestQuote && bestQuote.outputDecimals !== null
    ? formatAtomicDisplay(bestQuote.protectedOutputAtomic!, bestQuote.outputDecimals)
    : null;
  const availableDisplay = inputBalance && pairInputDecimals !== null
    ? formatAtomicDisplay(inputBalance.balanceAtomic, pairInputDecimals)
    : null;
  const amountExceedsBalance = Boolean(
    draft.intent
    && inputBalance
    && BigInt(draft.intent.amountAtomic) > BigInt(inputBalance.balanceAtomic)
  );
  const confirmedInputDisplay = postExecutionState.state === "swap_confirmed"
    && executionRecord?.kind === "swap"
    && executionRecord.state === "confirmed"
    && pairInputDecimals !== null
      ? formatAtomicDisplay(executionRecord.inputAmountAtomic, pairInputDecimals)
      : null;

  const useBalancePercentage = (basisPoints: number) => {
    if (!inputBalance || pair?.inputAsset.decimals === null || pair?.inputAsset.decimals === undefined) return;
    try {
      const atomic = percentageOfAtomic(inputBalance.balanceAtomic, basisPoints);
      setAmount(formatUnits(BigInt(atomic), pair.inputAsset.decimals));
    } catch {
      return;
    }
  };

  const requestLiveRoutes = async () => {
    if (!draft.intent || !address || !inputAddress || !outputAddress || !identity.identityToken || !identity.userId) throw new Error("Trade intent is not ready for route comparison.");
    const expected = { inputAsset: inputAddress, outputAsset: outputAddress, inputAmountAtomic: draft.intent.amountAtomic };
    const response = await requestTradeQuote("/api/vnext/quotes", {
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      recipient: address
    }, {
      identityScope: identity.userId,
      identityToken: identity.identityToken,
      timeoutMs: 12_000,
      maxAttempts: 1
    });
    const failure = tradeQuoteFailureFromResponse(response);
    if (failure) throw failure;
    return parseVNextQuoteResponse(response.payload, expected, Date.now());
  };

  const requestStrictVerification = async (quoteResponse: VNextQuoteResponse) => {
    const selectedRoute = selectVNextRoute(quoteResponse.attempts);
    const winningQuote = selectedRoute.verificationCandidate;
    if (
      !draft.intent
      || !address
      || !inputAddress
      || !outputAddress
      || !identity.identityToken
      || !identity.userId
      || !winningQuote
    ) throw new Error("No observed route is supported by a strict verifier yet.");
    const expected = {
      quoteRequestId: quoteResponse.requestId,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      recipient: address
    };
    const response = await requestTradeQuote("/api/vnext/verify", {
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      quoteRequestId: quoteResponse.requestId,
      provider: winningQuote.provider,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      recipient: address
    }, {
      identityScope: identity.userId,
      identityToken: identity.identityToken,
      timeoutMs: 15_000,
      maxAttempts: 1
    });
    const failure = tradeQuoteFailureFromResponse(response);
    if (failure) throw failure;
    return parseVNextPreSignEvidence(response.payload, expected, Date.now());
  };

  const requestAuthorizationPlan = async (evidence: VNextPreSignEvidence) => {
    if (
      !authorizationEnabled
      || !draft.intent
      || !address
      || !inputAddress
      || !outputAddress
      || !identity.identityToken
      || !identity.userId
      || !["verified", "approval_required"].includes(evidence.status)
      || !evidence.nextActionCalldataHash
      || !evidence.gasLimitUnits
    ) throw new Error("This route is not ready for exact wallet authorization.");
    const response = await requestTradeQuote("/api/vnext/authorize", {
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      quoteRequestId: evidence.sourceQuoteRequestId,
      verificationId: evidence.verificationId,
      provider: evidence.provider,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      recipient: address,
      deadline: evidence.deadline,
      expectedStatus: evidence.status,
      expectedProtectedOutputAtomic: evidence.protectedOutputAtomic
    }, {
      identityScope: identity.userId,
      identityToken: identity.identityToken,
      timeoutMs: 15_000,
      maxAttempts: 1
    });
    const failure = tradeQuoteFailureFromResponse(response);
    if (failure) throw failure;
    return parseVNextAuthorizationBundle(response.payload, evidence, {
      quoteRequestId: evidence.sourceQuoteRequestId,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      recipient: address
    }, Date.now());
  };

  const startTrade = async () => {
    if (!draft.intent || amountExceedsBalance) return;
    let stage: "quote" | "verification" | "authorization" = "quote";
    setPostExecutionState({ state: "idle" });
    setQuoteState({ state: "loading" });
    setVerificationState({ state: "loading" });
    setAuthorizationState({ state: authorizationEnabled ? "loading" : "idle" });
    clearTradeQuoteCache();
    try {
      const freshQuote = await requestLiveRoutes();
      lastReadyQuote.current = freshQuote;
      setQuoteState({ state: "ready", response: freshQuote });
      stage = "verification";
      const freshEvidence = await requestStrictVerification(freshQuote);
      lastReadyVerification.current = freshEvidence;
      setVerificationState({ state: "ready", evidence: freshEvidence });
      if (!["verified", "approval_required"].includes(freshEvidence.status)) {
        throw new Error(freshEvidence.status === "insufficient_balance"
          ? "Your confirmed balance is insufficient for this trade."
          : freshEvidence.status === "insufficient_gas"
            ? "Add ETH for network gas before trading."
            : "The exact route did not pass final execution checks.");
      }
      if (!authorizationEnabled) {
        setAuthorizationState({ state: "error", message: "Wallet execution remains disabled in this build." });
        return;
      }
      stage = "authorization";
      const authorization = await requestAuthorizationPlan(freshEvidence);
      lastReadyVerification.current = authorization.evidence;
      setVerificationState({ state: "ready", evidence: authorization.evidence });
      setAuthorizationState({ state: "ready", plan: authorization.plan });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "RMT could not prepare this trade.";
      if (stage === "quote") {
        setQuoteState({ state: "error", message });
        setVerificationState({ state: "idle" });
        setAuthorizationState({ state: "idle" });
      }
      if (stage === "verification") {
        setVerificationState({ state: "error", message });
        setAuthorizationState({ state: "idle" });
      }
      if (stage === "authorization") setAuthorizationState({ state: "error", message });
    }
  };

  const continueAfterApproval = async () => {
    setPostExecutionState({ state: "refreshing", message: "Approval confirmed. RMT is refreshing and verifying the swap automatically…" });
    setQuoteState({ state: "loading" });
    setVerificationState({ state: "loading" });
    setAuthorizationState({ state: "loading" });
    clearTradeQuoteCache();
    try {
      const freshQuote = await requestLiveRoutes();
      lastReadyQuote.current = freshQuote;
      setQuoteState({ state: "ready", response: freshQuote });
      const freshEvidence = await requestStrictVerification(freshQuote);
      lastReadyVerification.current = freshEvidence;
      setVerificationState({ state: "ready", evidence: freshEvidence });
      const outcome = postApprovalVerificationOutcome(freshEvidence);
      setPostExecutionState(outcome);
      if (outcome.state !== "swap_ready") throw new Error(outcome.message);
      const authorization = await requestAuthorizationPlan(freshEvidence);
      lastReadyVerification.current = authorization.evidence;
      setVerificationState({ state: "ready", evidence: authorization.evidence });
      setAuthorizationState({ state: "ready", plan: authorization.plan });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Fresh post-approval verification failed.";
      setVerificationState({ state: "error", message });
      setAuthorizationState({ state: "error", message });
      setPostExecutionState({ state: "blocked", message });
    }
  };

  useEffect(() => {
    if (!identity.authenticated || !address || !draft.intent || !pendingTradeAfterLogin.current) return;
    pendingTradeAfterLogin.current = false;
    void startTrade();
  }, [address, draft.intent, identity.authenticated]);

  useEffect(() => {
    if (
      postExecutionState.state !== "approval_confirmed"
      || !executionRecord
      || executionRecord.kind !== "erc20_approval"
      || continuedApproval.current === executionRecord.txHash
    ) return;
    continuedApproval.current = executionRecord.txHash;
    void continueAfterApproval();
  }, [executionRecord, postExecutionState.state]);

  const verificationLabel = visibleVerification
    ? visibleVerification.status === "verified"
      ? "Exact simulation passed"
      : visibleVerification.status === "approval_required"
        ? "Approval required"
        : visibleVerification.status === "insufficient_balance"
          ? "Insufficient balance"
          : visibleVerification.status === "insufficient_gas"
            ? "Insufficient ETH for gas"
            : visibleVerification.status === "gas_unavailable"
              ? "Gas estimate unavailable"
          : "Simulation failed"
    : null;
  const flowBusy = quoteState.state === "loading"
    || verificationState.state === "loading"
    || authorizationState.state === "loading"
    || postExecutionState.state === "refreshing";
  const walletPlanActive = authorizationState.state === "ready";
  const transactionPending = executionRecord?.state === "submitted";
  const triggerPrimaryAction = () => {
    if (!identity.enabled) return;
    if (!identity.authenticated || !address) {
      pendingTradeAfterLogin.current = true;
      identity.login();
      return;
    }
    void startTrade();
  };
  const continueTrading = () => {
    setPostExecutionState({ state: "idle" });
    onContinueTrading();
  };

  return (
    <aside className="vnTradePanel" aria-labelledby="vn-trade-heading">
      <div className="vnTradeHeader">
        <div><span className="vnEyebrow">Asset-to-asset intent</span><h2 id="vn-trade-heading">{marketSymbol}</h2><small>{marketName}</small></div>
        <span className="vnFixtureBadge">{authorizationEnabled ? "Guarded execution" : "Execution preview"}</span>
      </div>
      <div className="vnSideTabs" role="tablist" aria-label="Trade side">
        <button className={side === "buy" ? "isActive" : ""} onClick={() => chooseSide("buy")} type="button" role="tab" aria-selected={side === "buy"}>Buy</button>
        <button className={side === "sell" ? "isActive" : ""} onClick={() => chooseSide("sell")} type="button" role="tab" aria-selected={side === "sell"}>Sell</button>
      </div>
      <div className="vnAvailableLine"><span>{side === "buy" ? "Pay with wallet asset" : "Settlement asset"}</span><strong>{pair ? `${inputSymbol} → ${outputSymbol}` : "Verified pair required"}</strong></div>
      <label className="vnAmountField">
        <span>Exact input amount</span>
        <div><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Exact input amount" placeholder="0" />
          {side === "buy" ? <select
            aria-label="Pay with asset"
            value={selectedBuyInput ? assetKey(selectedBuyInput.id) : ""}
            disabled={displayedBuyInputs.length < 2}
            onChange={(event) => setBuyInputKey(event.target.value)}
          >
            {displayedBuyInputs.length === 0 ? <option value="">No held asset</option> : displayedBuyInputs.map((asset) => <option value={assetKey(asset.id)} key={assetKey(asset.id)}>{asset.symbol ?? "Asset"}</option>)}
          </select> : <button type="button" disabled>{inputSymbol}</button>}
        </div>
      </label>
      <div className="vnConfirmedBalance">
        <span><small>Available</small><strong>{availableDisplay ? `${availableDisplay} ${inputSymbol}` : isConnected ? "Not detected" : "Wallet required"}</strong></span>
        <div aria-label="Confirmed balance percentages">
          {[2_500, 5_000, 7_500, 10_000].map((basisPoints) => <button
            type="button"
            key={basisPoints}
            disabled={!inputBalance}
            onClick={() => useBalancePercentage(basisPoints)}
          >{basisPoints === 10_000 ? "Max" : `${basisPoints / 100}%`}</button>)}
        </div>
      </div>
      {side === "buy" && inputSymbol === "USDG" ? (
        <div className="vnQuickAmounts">
          {["25", "50", "100", "250"].map((preset) => (
            <button className={preset === amount ? "isActive" : ""} type="button" key={preset} onClick={() => setAmount(preset)}>${preset}</button>
          ))}
        </div>
      ) : <p className="vnIntentHint">Enter the exact {inputSymbol === "—" ? "input asset" : inputSymbol} amount. RMT does not estimate or inflate wallet balances.</p>}
      <div className="vnSwapDivider"><span aria-hidden="true">↓</span></div>
      <div className="vnReceiveField">
        <span>Output asset</span>
        <div><strong>{displayOutput ? `${displayOutput} ${outputSymbol}` : quoteState.state === "loading" ? "Checking live routes…" : "Fresh quote required"}</strong>
          {side === "sell" ? <select
            aria-label="Receive asset"
            value={selectedSellOutput ? assetKey(selectedSellOutput.id) : ""}
            disabled={sellOutputs.length < 2}
            onChange={(event) => setSellOutputKey(event.target.value)}
          >
            {sellOutputs.map((asset) => <option value={assetKey(asset.id)} key={assetKey(asset.id)}>{asset.symbol ?? "Asset"}</option>)}
          </select> : <button type="button" disabled>{outputSymbol}</button>}
        </div>
        <small>{displayOutput ? `Best live indicative floor from ${bestQuote?.providerLabel}. RMT verifies the executable route automatically when you trade.` : "Protected executable output is set during the one-tap execution check."}</small>
      </div>
      <button
        className="vnReviewButton"
        type="button"
        disabled={flowBusy || walletPlanActive || transactionPending || amountExceedsBalance || !identity.enabled || !identity.ready || Boolean(identity.authenticated && address && !draft.intent)}
        onClick={triggerPrimaryAction}
      >{postExecutionState.state === "refreshing"
        ? "Preparing verified swap…"
        : transactionPending
          ? "Transaction confirming…"
          : walletPlanActive
            ? "Complete review in wallet…"
          : flowBusy
            ? "Finding best execution…"
            : !identity.enabled
              ? "Trading identity unavailable"
            : !address
              ? `${side === "buy" ? "Connect & buy" : "Connect & sell"} ${marketSymbol}`
            : !identity.authenticated
              ? `${side === "buy" ? "Sign in & buy" : "Sign in & sell"} ${marketSymbol}`
              : `${authorizationEnabled ? "" : "Preview "}${side === "buy" ? "Buy" : "Sell"} ${marketSymbol}`}</button>
      <p className="vnTradeSafety">{identity.enabled
        ? "One action handles routing, verification, simulation, and exact payload preparation. Your wallet always shows the final authorization."
        : "Trading identity is not configured in this environment. RMT will not request a quote or prepare a wallet transaction."}</p>
      {postExecutionState.state !== "idle" ? <div className={`vnPostExecution is${postExecutionState.state}`} role="status">
        <strong>{postExecutionState.state === "approval_confirmed"
          ? "Approval confirmed · fresh execution required"
          : postExecutionState.state === "refreshing"
            ? "Revalidating after approval"
            : postExecutionState.state === "swap_ready"
              ? "Fresh swap verification passed"
              : postExecutionState.state === "swap_confirmed"
                ? "Settlement confirmed"
                : postExecutionState.state === "reverted"
                  ? "Transaction reverted"
                  : "Fresh verification blocked"}</strong>
        <small>{postExecutionState.message}</small>
      </div> : null}
      <details className="vnRouteCard">
        <summary className="vnRouteTop"><span><i aria-hidden="true" /> Advanced execution details</span><strong>{visibleVerification ? verificationLabel : visibleQuote ? "Routes compared" : draft.intent ? "Ready" : "Not ready"}</strong></summary>
        <dl className="vnIntentSummary">
          <div><dt>Input</dt><dd>{inputSymbol}</dd></div>
          <div><dt>Output</dt><dd>{outputSymbol}</dd></div>
          <div><dt>Recipient</dt><dd>{address ? shortAddress(address) : "Wallet required"}</dd></div>
          <div><dt>Trade type</dt><dd>Exact input</dd></div>
        </dl>
        <p className="vnIntentStatus">{quoteState.state === "error" ? quoteState.message : draft.message}</p>
        {address && pair ? <p className={`vnBalanceEvidence${amountExceedsBalance ? " isBlocking" : ""}`}>{amountExceedsBalance
          ? `Amount exceeds the confirmed ${inputSymbol} balance. Authorization must remain blocked.`
          : inputBalance
            ? `Confirmed ${inputSymbol} balance is the source for percentage and Max controls.`
            : `Confirmed ${inputSymbol} balance is not detected. Percentage controls remain disabled.`}</p> : null}
        {visibleQuote ? <div className="vnQuoteAttempts">
          {visibleQuote.attempts.map((attempt) => (
            <div className={attempt.status === "indicative" ? "isReady" : ""} key={attempt.provider}>
              <span><strong>{attempt.providerLabel}</strong><small>{attempt.executionKind === "aggregator" ? "Aggregator" : "Direct AMM"} · {attempt.latencyMs}ms</small></span>
              <span><strong>{attempt.status === "indicative" && attempt.outputDecimals !== null ? `${formatAtomicDisplay(attempt.protectedOutputAtomic!, attempt.outputDecimals)} ${outputSymbol}` : attempt.status === "no_route" ? "No route" : attempt.status === "invalid_response" ? "Rejected" : "Unavailable"}</strong><small>{attempt.status === "indicative"
                ? attempt.provider === bestQuote?.provider
                  ? "Best observed · indicative floor"
                  : routeSelection.usesVerifiedBackup && attempt.provider === verificationQuote?.provider
                    ? "Strict-verification backup · indicative floor"
                    : "Indicative floor"
                : attempt.detail}</small></span>
            </div>
          ))}
        </div> : <dl>
          <div><dt>Providers</dt><dd>Not requested</dd></div>
          <div><dt>Trader gas</dt><dd>Unknown until executable route</dd></div>
          <div><dt>RMT fee</dt><dd>Not enabled</dd></div>
        </dl>}
        {visibleQuote ? <div className="vnVerificationGate">
          <div>
            <span><strong>Strict pre-sign evidence</strong><small>{verificationQuote
              ? routeSelection.usesVerifiedBackup
                ? `${bestQuote?.providerLabel} leads indicatively; ${verificationQuote.providerLabel} is the best strict-verification candidate`
                : "Fresh provider-specific contracts + exact wallet state"
              : "No observed route has a strict verifier available yet"}</small></span>
          </div>
          {verificationState.state === "error" ? <p className="isError" role="status">{verificationState.message}</p> : null}
          {visibleVerification ? <div className={`vnVerificationEvidence is${visibleVerification.status}`} aria-busy={verificationState.state === "loading"}>
            <span><strong>{verificationLabel}</strong><small>{verificationState.state === "loading"
              ? "Last verified evidence remains stable while its replacement is checked"
              : authorizationEnabled ? "RMT completed the internal checks from your single trade action" : "Authorization remains disabled in this preview"}</small></span>
            <dl>
              <div><dt>Route</dt><dd>{visibleVerification.route === "direct" ? "Direct V3" : "V3 via WETH"}</dd></div>
              <div><dt>Protected</dt><dd>{formatAtomicDisplay(visibleVerification.protectedOutputAtomic, verificationQuote?.outputDecimals ?? 18)} {outputSymbol}</dd></div>
              <div><dt>Simulation</dt><dd>{visibleVerification.exactSimulationPassed ? "Passed" : "Not passed"}</dd></div>
              <div><dt>Next action</dt><dd>{visibleVerification.nextAction === "approval" ? "Exact approval" : visibleVerification.nextAction === "swap" ? "Verified swap" : "Blocked"}</dd></div>
              <div><dt>Gas</dt><dd>{visibleVerification.gasState}</dd></div>
              <div><dt>Gas reserve</dt><dd>{visibleVerification.estimatedNetworkCostWei ? `${formatAtomicDisplay(visibleVerification.estimatedNetworkCostWei, 18)} ETH` : "Unavailable"}</dd></div>
              <div><dt>Calldata</dt><dd>{shortAddress(visibleVerification.calldataHash)}</dd></div>
            </dl>
            {authorizationState.state === "error" ? <p className="vnAuthorizationError" role="status">{authorizationState.message}</p> : null}
            {authorizationState.state === "ready" ? <div className="vnAuthorizationPlan" role="status">
              <span><strong>{authorizationState.plan.kind === "erc20_approval" ? "Exact token approval prepared" : "Verified swap prepared"}</strong><small>RMT is opening the exact request in your wallet automatically.</small></span>
              <dl>
                <div><dt>Target</dt><dd>{shortAddress(authorizationState.plan.target)}</dd></div>
                <div><dt>Gas limit</dt><dd>{BigInt(authorizationState.plan.gasLimit).toLocaleString()}</dd></div>
                <div><dt>Payload</dt><dd>{shortAddress(authorizationState.plan.payloadHash)}</dd></div>
                <div><dt>Expires</dt><dd>{new Date(authorizationState.plan.expiresAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</dd></div>
              </dl>
              <VNextWalletReview autoRequest key={authorizationState.plan.planId} plan={authorizationState.plan} evidence={visibleVerification} />
            </div> : null}
          </div> : null}
        </div> : null}
      </details>
      {postExecutionState.state === "swap_confirmed" && executionRecord?.kind === "swap" && executionRecord.state === "confirmed" ? (
        <div className="vnTradeReceiptBackdrop" role="presentation">
          <section
            className="vnTradeReceipt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vn-trade-receipt-heading"
            aria-describedby="vn-trade-receipt-detail"
          >
            <button className="vnTradeReceiptClose" type="button" aria-label="Close trade confirmation" onClick={() => setPostExecutionState({ state: "idle" })}>×</button>
            <span className="vnTradeReceiptMark" aria-hidden="true">✓</span>
            <span className="vnEyebrow">Robinhood Chain · confirmed</span>
            <h3 id="vn-trade-receipt-heading">{side === "buy" ? "Purchase confirmed" : "Sale confirmed"}</h3>
            <p id="vn-trade-receipt-detail">{side === "buy"
              ? `You bought ${outputSymbol} with ${inputSymbol}.`
              : `You sold ${inputSymbol} for ${outputSymbol}.`}</p>
            <dl>
              <div><dt>{side === "buy" ? "Paid" : "Sold"}</dt><dd>{confirmedInputDisplay ? `${confirmedInputDisplay} ${inputSymbol}` : `${inputSymbol} confirmed`}</dd></div>
              <div><dt>{side === "buy" ? "Asset received" : "Proceeds"}</dt><dd>{outputSymbol} · balance refreshing</dd></div>
              <div><dt>Transaction</dt><dd>{shortAddress(executionRecord.txHash)}</dd></div>
            </dl>
            <button ref={receiptAction} className="vnTradeReceiptContinue" type="button" onClick={continueTrading}>Continue trading</button>
            <a href={`https://robinhoodchain.blockscout.com/tx/${executionRecord.txHash}`} target="_blank" rel="noreferrer">View confirmed transaction ↗</a>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
