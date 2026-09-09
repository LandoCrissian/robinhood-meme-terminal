"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VerifiedRequestRefresh, verifiedRequestRefreshDelay, isVerifiedRequestFresh, waitForVerifiedRequestRetry } from "../../lib/vnext/verified-request-refresh";
import { formatUnits, getAddress, parseUnits, type Address } from "viem";
import { useAccount } from "wagmi";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import { assetKey } from "../../lib/vnext/execution-domain";
import type { VNextExecutionRecord } from "../../lib/vnext/execution-recovery";
import { vNextProviderLabel, vNextProviderRoutePresentation } from "../../lib/vnext/provider-presentation";
import { NATIVE_GAS_RESERVE_ATOMIC, affordableDefaultAmount, createExactInputIntent, percentageOfAtomic, spendableNativeAtomic, type TradeSide } from "../../lib/vnext/intent-draft";
import { parseVNextQuoteResponse, selectVNextRoute, type VNextQuoteResponse } from "../../lib/vnext/quote-observation";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "../../lib/vnext/pre-sign-evidence";
import { vNextAuthorizationAuthorityRequest } from "../../lib/vnext/authorization-request";
import {
  postApprovalVerificationOutcome,
  repeatsConfirmedVNextApproval,
  resolvedVNextExecutionOutcome,
  type VNextApprovalAuthority
} from "../../lib/vnext/post-approval";
import { parseVNextAuthorizationBundle, type VNextAuthorizationPlan } from "../../lib/vnext/authorization-plan";
import { cachedVNextQuoteForRequest, isVNextQuoteReusableForTrade, VNEXT_BACKGROUND_QUOTE_DEBOUNCE_MS, VNEXT_BACKGROUND_QUOTE_REFRESH_MS, type VNextCachedQuote } from "../../lib/vnext/background-quote";
import type { VNextExecutionUiState, VNextSelectedMarketExecutionState } from "../../lib/vnext/market-directory";
import { confirmedVNextFeePresentation } from "../../lib/vnext/confirmed-fee-receipt";
import {
  formatVNextFeeAtomic,
  vNextQuoteFeePresentation,
  type VNextIndicativeFeePresentation
} from "../../lib/vnext/executable-quote-fee-presentation";
import type { VNextUniversalMarketSearchPool } from "../../lib/vnext/universal-market-search-contract";
import {
  ROBINHOOD_ETH,
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_NATIVE_ASSET_ADDRESS,
  ROBINHOOD_USDG,
  ROBINHOOD_USDG_ADDRESS,
  robinhoodWalletAccount
} from "../../lib/vnext/robinhood-assets";
import { deriveVNextVerifiedUsdgOutcome } from "../../lib/vnext/verified-cost-outcome";
import { trustedPaymentMetadataFromDetectedWalletAsset, type VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { clearTradeQuoteCache, requestTradeQuote, tradeQuoteFailureFromResponse } from "../../lib/trade-quote-client";
import {
  isCurrentTradeAuthorizationAttempt,
  requestTradeAuthorization,
  tradeAuthorizationFailureFromResponse
} from "../../lib/vnext/trade-authorization-client";
import { useRmtIdentity } from "../rmt-identity";
import { pendingTradeEntryMatches, type PendingTradeEntry } from "../../lib/vnext/pending-trade-entry";
import { FundWalletButton } from "../fund-wallet-button";
import { VNextWalletReview } from "./vnext-wallet-review";
import { ExplorerLink } from "./terminal-links";
import {
  clearPendingApprovalJourney, emitTradeJourney, failureJourneyPhase, observedZeroXPhase,
  pendingApprovalRecordMatches, pendingApprovalWalletMatches, readPendingApprovalJourney,
  revalidateAfterApproval, savePendingApprovalJourney, TradeJourneyError, tradeJourneyLabels,
  tradeJourneyPhase, type TradeJourneyPhase
} from "../../lib/vnext/trade-journey";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatAtomicDisplay(value: string, decimals: number) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const grouped = BigInt(whole).toLocaleString();
  const firstNonzero = fraction.search(/[1-9]/);
  const visibleDigits = firstNonzero < 0 ? 0 : Math.max(6, firstNonzero + 3);
  const visibleFraction = fraction.slice(0, visibleDigits).replace(/0+$/, "");
  return visibleFraction ? `${grouped}.${visibleFraction}` : grouped;
}

function describeProtectedOutputContinuity(verifiedAtomic: string, indicativeFloorAtomic: string) {
  const verified = BigInt(verifiedAtomic);
  const floor = BigInt(indicativeFloorAtomic);
  if (verified < floor) return "Continuity check failed";
  if (verified === floor) return "Indicative floor held";
  const improvementBps = (verified - floor) * 10_000n / floor;
  if (improvementBps <= 0n) return "Improved by less than 0.01%";
  if (improvementBps > 1_000_000n) return "Improved materially";
  const percent = Number(improvementBps) / 100;
  return `Improved +${percent.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function uniqueAssets(assets: AssetMetadata[]) {
  return [...new Map(assets.map((asset) => [assetKey(asset.id), asset])).values()];
}

const DEFAULT_BUY_AMOUNT = "25";
const DEFAULT_NATIVE_BUY_AMOUNT = "0.0005";

export function TradeIntentComposer({ marketName, marketSymbol, marketAddress, marketAsset, walletAssets, nativeBalance, walletReadStatus, executionRecord, dismissedExecutionHash, onContinueTrading, sideRequest, executionState, executionUiState, canonicalMarket }: {
  marketName: string;
  marketSymbol: string;
  marketAddress?: string;
  marketAsset?: AssetMetadata;
  walletAssets: VNextDetectedWalletAsset[];
  nativeBalance?: bigint;
  walletReadStatus: "idle" | "loading" | "ready" | "stale" | "error";
  executionRecord?: VNextExecutionRecord | null;
  dismissedExecutionHash?: string;
  onContinueTrading: () => void;
  sideRequest?: { side: TradeSide; nonce: number };
  executionState: VNextSelectedMarketExecutionState;
  executionUiState: VNextExecutionUiState;
  canonicalMarket?: VNextUniversalMarketSearchPool;
}) {
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState(DEFAULT_BUY_AMOUNT);
  const [buyInputKey, setBuyInputKey] = useState<string>();
  const [sellOutputKey, setSellOutputKey] = useState(assetKey(ROBINHOOD_USDG.id));
  const [quoteState, setQuoteState] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "ready"; response: VNextQuoteResponse }
    | { state: "error"; message: string; phase?: TradeJourneyPhase }
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
    | { state: "next_approval_ready"; message: string }
    | { state: "swap_ready"; message: string }
    | { state: "blocked"; message: string }
    | { state: "confirmed_unsettled"; message: string }
    | { state: "swap_confirmed"; message: string }
    | { state: "reverted"; message: string }
  >({ state: "idle" });
  const [costValuationClockMs, setCostValuationClockMs] = useState(() => Date.now());
  useEffect(() => {
    if (verificationState.state === "ready" && ["verified", "approval_required"].includes(verificationState.evidence.status)) {
      emitTradeJourney({ phase: verificationState.evidence.status === "approval_required" ? "APPROVAL_REQUIRED"
        : verificationState.evidence.status === "verified" ? "SWAP_READY" : "FIRM_VERIFY_FAILED",
        approvalRequired: verificationState.evidence.status === "approval_required" });
    } else if (verificationState.state === "ready" && verificationState.evidence.status.endsWith("simulation_failed")) {
      emitTradeJourney({ phase: "SIMULATION_FAILED" });
    } else if (verificationState.state === "error") emitTradeJourney({ phase: "FIRM_VERIFY_FAILED" });
  }, [verificationState]);
  useEffect(() => {
    const phase = postExecutionState.state === "approval_confirmed" ? "APPROVAL_CONFIRMED"
      : postExecutionState.state === "refreshing" ? "QUOTE_REQUESTING"
      : postExecutionState.state === "next_approval_ready" ? "APPROVAL_REQUIRED"
      : postExecutionState.state === "swap_ready" ? "SWAP_READY"
      : postExecutionState.state === "confirmed_unsettled" ? "SETTLEMENT_PENDING"
      : postExecutionState.state === "swap_confirmed" ? "SWAP_SETTLED" : null;
    if (phase) emitTradeJourney({ phase });
  }, [postExecutionState.state]);
  const [walletActionId, setWalletActionId] = useState(0);
  const walletActionCounter = useRef(0);
  const intentionalTradeContext = useRef<string | null>(null);
  const restoredApprovalIntent = useRef(false);
  const handledExecution = useRef<string | undefined>(dismissedExecutionHash);
  const pendingTradeAfterLogin = useRef<PendingTradeEntry | undefined>(undefined);
  const refreshCoordinator = useRef(new VerifiedRequestRefresh<{ evidence: VNextPreSignEvidence; plan: VNextAuthorizationPlan }>());
  const [walletBusy, setWalletBusy] = useState(false);
  const walletBusyRef = useRef(false);
  const [refreshingPrice, setRefreshingPrice] = useState(false);
  const [walletDetailsTarget, setWalletDetailsTarget] = useState<HTMLDivElement | null>(null);
  const tradePanelRef = useRef<HTMLElement | null>(null);
  const automaticPreparationKey = useRef("");
  const selectedMarketAddress = marketAddress ?? (marketAsset?.id.locator.kind === "contract" ? marketAsset.id.locator.address : "");
  const continuedApproval = useRef<string | undefined>(undefined);
  const preparedApprovalAuthority = useRef<VNextApprovalAuthority | undefined>(undefined);
  const autoFitBuyAmount = useRef(true);
  const backgroundQuoteEpoch = useRef(0);
  const authorizationAttemptEpoch = useRef(0);
  const backgroundQuoteImmediate = useRef(false);
  const backgroundQuoteAttempted = useRef(false);
  const lastReadyQuote = useRef<VNextCachedQuote | undefined>(undefined);
  const lastReadyVerification = useRef<VNextPreSignEvidence | undefined>(undefined);
  const receiptAction = useRef<HTMLButtonElement>(null);
  const receiptDialog = useRef<HTMLElement>(null);
  const { address, chainId, isConnected } = useAccount();
  const identity = useRmtIdentity();
  const onRobinhood = chainId === ROBINHOOD_MAINNET_CHAIN_ID;
  const authorizationEnabled = executionUiState === "live-execution";
  const previewOnly = executionUiState === "preview-only";
  const stockTokenViewOnly = executionState === "stock-token-view-only";
  const confirmedUsdgBalance = walletAssets.find((asset) => (
    asset.address.toLowerCase() === ROBINHOOD_USDG_ADDRESS.toLowerCase()
    && asset.identityState === "verified"
    && asset.decimals === ROBINHOOD_USDG.decimals
    && /^(?:0|[1-9][0-9]*)$/.test(asset.balanceAtomic)
  ));
  const defaultBuyAmount = confirmedUsdgBalance && ROBINHOOD_USDG.decimals !== null
    ? affordableDefaultAmount(confirmedUsdgBalance.balanceAtomic, ROBINHOOD_USDG.decimals, DEFAULT_BUY_AMOUNT)
    : DEFAULT_BUY_AMOUNT;
  const defaultNativeBuyAmount = nativeBalance && nativeBalance > NATIVE_GAS_RESERVE_ATOMIC && ROBINHOOD_ETH.decimals !== null
    ? affordableDefaultAmount(
        (nativeBalance - NATIVE_GAS_RESERVE_ATOMIC).toString(),
        ROBINHOOD_ETH.decimals,
        DEFAULT_NATIVE_BUY_AMOUNT
      )
    : "";
  const trustedPaymentAssets = useMemo(
    () => uniqueAssets(walletAssets.flatMap((asset) => {
      const metadata = trustedPaymentMetadataFromDetectedWalletAsset(asset);
      return metadata ? [metadata] : [];
    })),
    [walletAssets]
  );
  const buyInputs = useMemo(() => {
    const eligibleContracts = marketAsset
      ? trustedPaymentAssets.filter((asset) => assetKey(asset.id) !== assetKey(marketAsset.id))
      : trustedPaymentAssets;
    const usdg = eligibleContracts.filter((asset) => assetKey(asset.id) === assetKey(ROBINHOOD_USDG.id));
    const others = eligibleContracts.filter((asset) => assetKey(asset.id) !== assetKey(ROBINHOOD_USDG.id));
    const native = nativeBalance && nativeBalance > NATIVE_GAS_RESERVE_ATOMIC ? [ROBINHOOD_ETH] : [];
    return uniqueAssets([...usdg, ...native, ...others]);
  }, [marketAsset, nativeBalance, trustedPaymentAssets]);
  const defaultBuyInput = buyInputs.find((asset) => assetKey(asset.id) === assetKey(ROBINHOOD_USDG.id))
    ?? buyInputs.find((asset) => assetKey(asset.id) === assetKey(ROBINHOOD_ETH.id))
    ?? buyInputs[0];
  const selectedBuyInput = buyInputs.find((asset) => assetKey(asset.id) === buyInputKey)
    ?? defaultBuyInput
    ?? (!isConnected ? ROBINHOOD_USDG : undefined);
  const displayedBuyInputs = buyInputs.length > 0 ? buyInputs : selectedBuyInput ? [selectedBuyInput] : [];
  const sellOutputs = useMemo(() => marketAsset
    ? [ROBINHOOD_USDG, ROBINHOOD_ETH].filter((asset) => assetKey(asset.id) !== assetKey(marketAsset.id))
    : [ROBINHOOD_USDG, ROBINHOOD_ETH],
  [marketAsset]);
  const selectedSellOutput = sellOutputs.find((asset) => assetKey(asset.id) === sellOutputKey) ?? sellOutputs[0];
  const pair = useMemo(() => {
    if (!marketAsset) return null;
    if (side === "buy") return selectedBuyInput ? { inputAsset: selectedBuyInput, outputAsset: marketAsset } : null;
    return selectedSellOutput ? { inputAsset: marketAsset, outputAsset: selectedSellOutput } : null;
  }, [marketAsset, selectedBuyInput, selectedSellOutput, side]);
  const pairInputDecimals = pair?.inputAsset.decimals ?? null;
  const inputBalanceAtomic = useMemo(() => {
    if (pair?.inputAsset.id.locator.kind === "native") return nativeBalance?.toString();
    const contractAddress = pair?.inputAsset.id.locator.kind === "contract" ? pair.inputAsset.id.locator.address.toLowerCase() : null;
    if (!contractAddress || pairInputDecimals === null) return undefined;
    return walletAssets.find((asset) => (
      asset.address.toLowerCase() === contractAddress
      && asset.identityState === "verified"
      && asset.decimals === pairInputDecimals
      && /^(0|[1-9][0-9]*)$/.test(asset.balanceAtomic)
    ))?.balanceAtomic;
  }, [nativeBalance, pair, pairInputDecimals, walletAssets]);
  const spendableInputAtomic = inputBalanceAtomic === undefined
    ? undefined
    : pair?.inputAsset.id.locator.kind === "native"
      ? spendableNativeAtomic(BigInt(inputBalanceAtomic))?.toString()
      : inputBalanceAtomic;
  const buyUsesUsdg = side === "buy"
    && pair?.inputAsset.id.locator.kind === "contract"
    && pair.inputAsset.id.locator.address.toLowerCase() === ROBINHOOD_USDG_ADDRESS.toLowerCase();
  const buyUsesNative = side === "buy" && pair?.inputAsset.id.locator.kind === "native";
  const selectedDefaultBuyAmount = buyUsesUsdg ? defaultBuyAmount : buyUsesNative ? defaultNativeBuyAmount : "";

  useEffect(() => {
    if (!autoFitBuyAmount.current || !selectedDefaultBuyAmount) return;
    setAmount((current) => current === selectedDefaultBuyAmount ? current : selectedDefaultBuyAmount);
  }, [selectedDefaultBuyAmount]);

  const draft = useMemo(() => {
    if (!marketAsset) return { intent: null, message: "This preview asset has no verified chain-qualified contract identity." };
    if (!address || !isConnected || identity.activeWalletKind !== "external") return { intent: null, message: "Connect an external trading wallet to bind the source account and recipient." };
    if (!onRobinhood) return { intent: null, message: "Switch to Robinhood Chain before creating an intent." };
    if (!pair) return { intent: null, message: side === "buy" ? "No different trusted payment asset is available in this wallet." : "No supported settlement asset is available." };
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
  }, [address, amount, identity.activeWalletKind, isConnected, marketAsset, onRobinhood, pair, side]);

  const chooseSide = (next: TradeSide) => {
    autoFitBuyAmount.current = next === "buy";
    setSide(next);
    setAmount(next === "buy" ? selectedDefaultBuyAmount : "");
  };
  useEffect(() => {
    if (!sideRequest) return;
    chooseSide(sideRequest.side);
  }, [sideRequest?.nonce]);
  const inputSymbol = pair?.inputAsset.symbol ?? (side === "buy" ? "—" : marketSymbol);
  const outputSymbol = pair?.outputAsset.symbol ?? (side === "buy" ? marketSymbol : "USDG");
  const inputAddress = pair?.inputAsset.id.locator.kind === "contract"
    ? pair.inputAsset.id.locator.address
    : pair?.inputAsset.id.locator.kind === "native"
      ? ROBINHOOD_NATIVE_ASSET_ADDRESS
      : null;
  const outputAddress = pair?.outputAsset.id.locator.kind === "contract"
    ? pair.outputAsset.id.locator.address
    : pair?.outputAsset.id.locator.kind === "native"
      ? ROBINHOOD_NATIVE_ASSET_ADDRESS
      : null;
  const requestKey = `${chainId ?? ""}:${selectedMarketAddress}:${address ?? ""}:${side}:${amount}:${inputAddress ?? ""}:${outputAddress ?? ""}:${canonicalMarket?.poolKey ?? "auto"}`;
  const preparationContext = `${identity.userId}:${identity.activeWalletKey}:${requestKey}`;
  const currentPreparationContext = useRef(preparationContext);
  currentPreparationContext.current = preparationContext;

  useEffect(() => () => { authorizationAttemptEpoch.current += 1;
    refreshCoordinator.current.invalidate(); }, []);
  useEffect(() => {
    const pending = readPendingApprovalJourney();
    if (!pending) return;
    if ((address && pending.wallet.toLowerCase() !== address.toLowerCase()) || (chainId !== undefined && chainId !== 4663)
      || (identity.authenticated && identity.userId && pending.userId !== identity.userId)) {
      clearPendingApprovalJourney();
      return;
    }
    if (restoredApprovalIntent.current || !identity.authenticated || !pendingApprovalWalletMatches(pending,
      { userId: identity.userId, wallet: address, walletKey: identity.activeWalletKey, chainId })
      || pending.marketAddress.toLowerCase() !== selectedMarketAddress.toLowerCase()) return;
    restoredApprovalIntent.current = true;
    autoFitBuyAmount.current = false;
    setSide(pending.side); setAmount(pending.amount);
    setBuyInputKey(pending.buyInputKey); setSellOutputKey(pending.sellOutputKey);
  }, [address, chainId, identity.authenticated, identity.userId, identity.activeWalletKey, selectedMarketAddress]);
  const cachedQuote = cachedVNextQuoteForRequest(lastReadyQuote.current, requestKey);
  useEffect(() => {
    backgroundQuoteEpoch.current += 1;
    authorizationAttemptEpoch.current += 1;
    refreshCoordinator.current.invalidate();
    intentionalTradeContext.current = null;
    walletBusyRef.current = false; setWalletBusy(false); setRefreshingPrice(false);
    setWalletActionId(0);
    backgroundQuoteAttempted.current = false;
    setQuoteState({ state: "idle" });
    setVerificationState({ state: "idle" });
    setAuthorizationState({ state: "idle" });
    setPostExecutionState({ state: "idle" });
    lastReadyQuote.current = undefined;
    lastReadyVerification.current = undefined;
    continuedApproval.current = undefined;
    preparedApprovalAuthority.current = undefined;
  }, [requestKey, identity.userId, identity.activeWalletKey]);
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
    if (outcome.state !== "confirmed_unsettled") handledExecution.current = executionRecord.txHash;
    setQuoteState({ state: "idle" });
    setVerificationState({ state: "idle" });
    setAuthorizationState({ state: "idle" });
    lastReadyQuote.current = undefined;
    lastReadyVerification.current = undefined;
    if (outcome.state !== "approval_confirmed") preparedApprovalAuthority.current = undefined;
    setPostExecutionState(outcome);
  }, [address, draft.intent, executionRecord, inputAddress, outputAddress]);
  useEffect(() => {
    if (quoteState.state !== "ready") return;
    const expiries = quoteState.response.attempts.flatMap((attempt) => attempt.expiresAtMs === null ? [] : [attempt.expiresAtMs]);
    if (expiries.length === 0) return;
    const delay = Math.max(0, Math.min(...expiries) - Date.now());
    const timeout = window.setTimeout(() => setQuoteState({ state: "error", message: "Refreshing price...", phase: "QUOTE_EXPIRED" }), delay);
    return () => window.clearTimeout(timeout);
  }, [quoteState]);
  useEffect(() => {
    if (postExecutionState.state !== "swap_confirmed") return;
    const previousOverflow = document.body.style.overflow;
    const handleReceiptKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPostExecutionState({ state: "idle" });
        return;
      }
      if (event.key !== "Tab" || !receiptDialog.current) return;
      const focusable = [...receiptDialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleReceiptKeyboard, true);
    window.requestAnimationFrame(() => receiptAction.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleReceiptKeyboard, true);
    };
  }, [postExecutionState.state]);
  const visibleQuote = cachedQuote;
  const indicativeQuoteFresh = isVNextQuoteReusableForTrade(cachedQuote, Date.now());
  const visibleVerification = verificationState.state === "ready"
    ? verificationState.evidence
    : verificationState.state === "loading"
      ? lastReadyVerification.current
      : undefined;
  useEffect(() => {
    const expiry = visibleVerification?.networkCostValuationExpiresAtMs;
    if (!expiry) return;
    const timeout = window.setTimeout(
      () => setCostValuationClockMs(Date.now()),
      Math.max(0, expiry - Date.now() + 1)
    );
    return () => window.clearTimeout(timeout);
  }, [visibleVerification?.networkCostValuationExpiresAtMs, visibleVerification?.verificationId]);
  const observedRouteSelection = visibleQuote
    ? selectVNextRoute(visibleQuote.attempts, { publicExecutionOnly: true })
    : { bestObserved: undefined, verificationCandidate: undefined, usesVerifiedBackup: false, selectionBasis: "none" as const, netOutcomeReady: false as const };
  const routeSelection = stockTokenViewOnly
    ? { ...observedRouteSelection, verificationCandidate: undefined, usesVerifiedBackup: false }
    : observedRouteSelection;
  const bestQuote = routeSelection.bestObserved;
  const verificationQuote = routeSelection.verificationCandidate;
  const zeroXNoRoute = !verificationQuote && visibleQuote?.attempts.some(
    (attempt) => attempt.provider === "zero-x-swap" && attempt.status === "no_route"
  );
  const freshVerifiedNetworkCostUsdgAtomic = visibleVerification?.estimatedNetworkCostUsdgAtomic
    && visibleVerification.networkCostValuationExpiresAtMs
    && visibleVerification.networkCostValuationExpiresAtMs > costValuationClockMs
      ? visibleVerification.estimatedNetworkCostUsdgAtomic
      : null;
  const verifiedUsdgOutcome = visibleVerification
    ? deriveVNextVerifiedUsdgOutcome(visibleVerification, costValuationClockMs)
    : null;
  const visibleRoutePresentation = visibleVerification
    ? vNextProviderRoutePresentation({ provider: visibleVerification.provider, route: visibleVerification.route })
    : null;
  const expectedOutput = visibleVerification && pair?.outputAsset.decimals != null
    ? formatAtomicDisplay(visibleVerification.expectedOutputAtomic, pair.outputAsset.decimals)
    : bestQuote?.expectedOutputAtomic && bestQuote.outputDecimals !== null
    ? formatAtomicDisplay(bestQuote.expectedOutputAtomic, bestQuote.outputDecimals)
    : null;
  const protectedOutput = visibleVerification && pair?.outputAsset.decimals != null
    ? formatAtomicDisplay(visibleVerification.protectedOutputAtomic, pair.outputAsset.decimals)
    : bestQuote && bestQuote.outputDecimals !== null
    ? formatAtomicDisplay(bestQuote.protectedOutputAtomic!, bestQuote.outputDecimals)
    : null;
  const indicativeFeePresentation = vNextQuoteFeePresentation({
    bestObserved: bestQuote,
    bestExecutable: verificationQuote
  });
  const indicativeFeeLabel = (
    fee: VNextIndicativeFeePresentation | null,
    context: "observed" | "executable"
  ) => {
    if (!fee) return context === "observed" ? "No observed route" : "No executable route";
    if (fee.state === "unavailable") return "Fee economics unavailable · verification required";
    if (fee.state === "no_rmt_fee") {
      return context === "observed" && bestQuote?.publicWalletExecutionEligible !== true
        ? "No RMT fee · quote-only"
        : "No RMT fee";
    }
    if (!pair) return "Fee economics unavailable · asset metadata required";
    return `${formatVNextFeeAtomic(
      fee.expectedFeeAtomic,
      fee.feeSide === "input" ? pair.inputAsset.decimals ?? 18 : pair.outputAsset.decimals ?? 18
    )} ${fee.feeSide === "input" ? inputSymbol : outputSymbol} · ${fee.feeBps / 100}%`;
  };
  const observedRmtFeeLabel = indicativeFeeLabel(indicativeFeePresentation.bestObserved, "observed");
  const executableRmtFeeLabel = indicativeFeeLabel(indicativeFeePresentation.bestExecutable, "executable");
  const executableRmtFee = indicativeFeePresentation.bestExecutable?.state === "planned"
    ? indicativeFeePresentation.bestExecutable
    : null;
  const showExecutableFeeSummary = Boolean(
    pair
    && verificationQuote
    && indicativeFeePresentation.bestExecutable?.state !== "no_rmt_fee"
  );
  const verifiedRmtFee = visibleVerification?.providerNativeFee
    ? {
        expectedFeeAtomic: visibleVerification.providerNativeFee.feeAmountAtomic,
        maximumFeeAtomic: visibleVerification.providerNativeFee.feeAmountAtomic,
        feeBps: visibleVerification.providerNativeFee.feeBps,
        feeSide: "input" as const
      }
    : visibleVerification?.feeV2Economics
    ?? (visibleVerification?.netEconomics?.rmtFee.state === "planned"
      ? visibleVerification.netEconomics.rmtFee
      : null);
  const verifiedRmtFeeLabel = verifiedRmtFee && pair
    ? `${formatAtomicDisplay(
        verifiedRmtFee.expectedFeeAtomic,
        verifiedRmtFee.feeSide === "input" ? pair.inputAsset.decimals ?? 18 : pair.outputAsset.decimals ?? 18
      )} ${verifiedRmtFee.feeSide === "input" ? inputSymbol : outputSymbol} · maximum ${formatAtomicDisplay(
        verifiedRmtFee.maximumFeeAtomic,
        verifiedRmtFee.feeSide === "input" ? pair.inputAsset.decimals ?? 18 : pair.outputAsset.decimals ?? 18
      )} · ${verifiedRmtFee.feeBps / 100}%`
    : "Not enabled";
  const availableDisplay = spendableInputAtomic !== undefined && pairInputDecimals !== null
    ? formatAtomicDisplay(spendableInputAtomic, pairInputDecimals)
    : null;
  const amountExceedsBalance = Boolean(
    draft.intent
    && spendableInputAtomic !== undefined
    && BigInt(draft.intent.amountAtomic) > BigInt(spendableInputAtomic)
  );
  const confirmedInputDisplay = postExecutionState.state === "swap_confirmed"
    && executionRecord?.kind === "swap"
    && executionRecord.state === "confirmed"
    && pairInputDecimals !== null
      ? formatAtomicDisplay(executionRecord.inputAmountAtomic, pairInputDecimals)
      : null;
  const confirmedOutputDisplay = postExecutionState.state === "swap_confirmed"
    && executionRecord?.kind === "swap"
    && executionRecord.state === "confirmed"
    && executionRecord.outputAmountAtomic
    && pair?.outputAsset.decimals !== null
    && pair?.outputAsset.decimals !== undefined
      ? formatAtomicDisplay(executionRecord.outputAmountAtomic, pair.outputAsset.decimals)
      : null;
  const confirmedFee = confirmedVNextFeePresentation({
    record: executionRecord,
    inputDecimals: pair?.inputAsset.decimals ?? 18,
    outputDecimals: pair?.outputAsset.decimals ?? 18,
    inputSymbol,
    outputSymbol
  });
  const confirmedProvider = executionRecord
    ? vNextProviderLabel(executionRecord.provider ?? (executionRecord.feeSettlement ? "uniswap-v3" : undefined))
    : null;

  const useBalancePercentage = (basisPoints: number) => {
    if (spendableInputAtomic === undefined || pair?.inputAsset.decimals === null || pair?.inputAsset.decimals === undefined) return;
    try {
      const balance = BigInt(spendableInputAtomic);
      if (balance <= 0n) return;
      const atomic = percentageOfAtomic(balance.toString(), basisPoints);
      autoFitBuyAmount.current = false;
      setAmount(formatUnits(BigInt(atomic), pair.inputAsset.decimals));
    } catch {
      return;
    }
  };

  const requestLiveRoutes = async () => {
    if (!draft.intent || !address || !inputAddress || !outputAddress || !identity.identityToken || !identity.userId) throw new Error("Trade intent is not ready for route comparison.");
    const expected = { inputAsset: inputAddress, outputAsset: outputAddress, inputAmountAtomic: draft.intent.amountAtomic };
    emitTradeJourney({ phase: "QUOTE_REQUESTING", quoteRequestAttempted: true });
    const response = await requestTradeQuote("/api/vnext/quotes", {
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      recipient: address,
      ...(canonicalMarket?.sourceId === "uniswap-v4"
        && canonicalMarket.version === 4
        && ((canonicalMarket.token0 === inputAddress.toLowerCase() && canonicalMarket.token1 === outputAddress.toLowerCase())
          || (canonicalMarket.token0 === outputAddress.toLowerCase() && canonicalMarket.token1 === inputAddress.toLowerCase()))
        ? { canonicalMarket: { sourceId: "uniswap-v4", poolId: canonicalMarket.poolKey } }
        : {})
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

  useEffect(() => {
    const canRefresh = Boolean(
      identity.enabled
      && identity.authenticated
      && identity.activeWalletKind === "external"
      && identity.identityToken
      && identity.userId
      && draft.intent
      && address
      && inputAddress
      && outputAddress
      && (verificationState.state === "idle" || verificationState.state === "error")
      && authorizationState.state === "idle"
      && postExecutionState.state === "idle"
      && executionRecord?.state !== "submitted"
    );
    if (!canRefresh) return;

    const epoch = ++backgroundQuoteEpoch.current;
    let timeout: number | undefined;
    let cancelled = false;
    const schedule = (delayMs: number) => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = undefined;
      if (cancelled || document.visibilityState === "hidden") return;
      timeout = window.setTimeout(() => void refresh(), delayMs);
    };
    const refresh = async () => {
      if (cancelled || backgroundQuoteEpoch.current !== epoch || document.visibilityState === "hidden") return;
      const hadVisibleQuote = Boolean(cachedVNextQuoteForRequest(lastReadyQuote.current, requestKey));
      if (!hadVisibleQuote && !backgroundQuoteAttempted.current) setQuoteState({ state: "loading" });
      backgroundQuoteAttempted.current = true;
      try {
        const freshQuote = await requestLiveRoutes();
        if (cancelled || backgroundQuoteEpoch.current !== epoch) return;
        lastReadyQuote.current = { requestKey, response: freshQuote };
        setQuoteState({ state: "ready", response: freshQuote });
      } catch (cause) {
        if (cancelled || backgroundQuoteEpoch.current !== epoch) return;
        if (!cachedVNextQuoteForRequest(lastReadyQuote.current, requestKey)) {
          setQuoteState({
            state: "error",
            message: cause instanceof Error ? cause.message : "Quote service temporarily unavailable.",
            phase: failureJourneyPhase(cause, "QUOTE_SERVICE_UNAVAILABLE")
          });
        }
      }
      if (!cancelled && backgroundQuoteEpoch.current === epoch) schedule(VNEXT_BACKGROUND_QUOTE_REFRESH_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (timeout !== undefined) window.clearTimeout(timeout);
        timeout = undefined;
        return;
      }
      schedule(VNEXT_BACKGROUND_QUOTE_DEBOUNCE_MS);
    };
    const initialDelay = backgroundQuoteImmediate.current || !cachedVNextQuoteForRequest(lastReadyQuote.current, requestKey)
      ? VNEXT_BACKGROUND_QUOTE_DEBOUNCE_MS
      : VNEXT_BACKGROUND_QUOTE_REFRESH_MS;
    backgroundQuoteImmediate.current = false;
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(initialDelay);
    return () => {
      cancelled = true;
      backgroundQuoteEpoch.current += 1;
      if (timeout !== undefined) window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    address,
    authorizationState.state,
    canonicalMarket?.sourceId,
    canonicalMarket?.version,
    canonicalMarket?.poolKey,
    canonicalMarket?.token0,
    canonicalMarket?.token1,
    draft.intent?.amountAtomic,
    executionRecord?.state,
    identity.authenticated,
    identity.activeWalletKey,
    identity.activeWalletKind,
    identity.enabled,
    identity.identityToken,
    identity.userId,
    inputAddress,
    outputAddress,
    postExecutionState.state,
    requestKey,
    verificationState.state
  ]);

  const requestStrictVerification = async (quoteResponse: VNextQuoteResponse) => {
    if (!authorizationEnabled) throw new Error("Wallet execution remains disabled in this build.");
    if (stockTokenViewOnly) throw new Error("Official Robinhood Stock Tokens are view-only in RMT until jurisdiction controls are available.");
    const selectedRoute = selectVNextRoute(quoteResponse.attempts, { publicExecutionOnly: true });
    const winningQuote = selectedRoute.verificationCandidate;
    const observedPhase = observedZeroXPhase(quoteResponse.attempts);
    if (!winningQuote) throw new TradeJourneyError(observedPhase, tradeJourneyLabels[observedPhase]);
    if (
      !draft.intent
      || !address
      || !inputAddress
      || !outputAddress
      || !identity.identityToken
      || !identity.userId
      || !winningQuote
      || !winningQuote.protectedOutputAtomic
    ) throw new Error("No observed route is currently admitted to public wallet execution.");
    const expected = {
      quoteRequestId: quoteResponse.requestId,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      provider: winningQuote.provider as VNextPreSignEvidence["provider"],
      protectedOutputFloorAtomic: winningQuote.protectedOutputAtomic,
      recipient: address,
      ...(winningQuote.provider === "uniswap-v4" && winningQuote.v4Evidence && winningQuote.quotedAtMs && winningQuote.expiresAtMs
        ? {
            canonicalMarket: { sourceId: "uniswap-v4", poolId: winningQuote.v4Evidence.poolId },
            v4QuoteEvidence: {
              ...winningQuote.v4Evidence,
              quotedAtMs: winningQuote.quotedAtMs,
              expiresAtMs: winningQuote.expiresAtMs
            }
          }
        : {})
    };
    const response = await requestTradeQuote("/api/vnext/verify", {
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      quoteRequestId: quoteResponse.requestId,
      provider: winningQuote.provider,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      protectedOutputFloorAtomic: winningQuote.protectedOutputAtomic,
      recipient: address,
      ...(winningQuote.provider === "uniswap-v4" && winningQuote.v4Evidence && winningQuote.quotedAtMs && winningQuote.expiresAtMs
        ? {
            canonicalMarket: { sourceId: "uniswap-v4", poolId: winningQuote.v4Evidence.poolId },
            v4QuoteEvidence: {
              ...winningQuote.v4Evidence,
              quotedAtMs: winningQuote.quotedAtMs,
              expiresAtMs: winningQuote.expiresAtMs
            }
          }
        : {})
    }, {
      identityScope: identity.userId,
      identityToken: identity.identityToken,
      timeoutMs: 15_000,
      maxAttempts: 1
    });
    if (response.payload && typeof response.payload === "object" && "error" in response.payload && response.payload.error === "ZERO_X_REPRICE_REQUIRED") { throw new TradeJourneyError("QUOTE_EXPIRED", "Refreshing price..."); }
    const failure = tradeQuoteFailureFromResponse(response);
    if (failure) throw failure;
    return parseVNextPreSignEvidence(response.payload, expected, Date.now());
  };

  const requestAuthorizationPlan = async (evidence: VNextPreSignEvidence) => {
    if (stockTokenViewOnly) throw new Error("Official Robinhood Stock Tokens are view-only in RMT until jurisdiction controls are available.");
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
    const response = await requestTradeAuthorization("/api/vnext/authorize", {
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      quoteRequestId: evidence.sourceQuoteRequestId,
      verificationId: evidence.verificationId,
      provider: evidence.provider,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      recipient: address,
      expectedStatus: evidence.status,
      indicativeProtectedOutputFloorAtomic: evidence.indicativeProtectedOutputFloorAtomic,
      expectedProtectedOutputAtomic: evidence.protectedOutputAtomic,
      ...(evidence.provider === "uniswap-v4" && evidence.v4Execution
        ? {
            canonicalMarket: { sourceId: "uniswap-v4", poolId: evidence.v4Execution.poolId },
            v4QuoteEvidence: {
              poolId: evidence.v4Execution.poolId,
              ...evidence.v4Execution.poolKey,
              recipient: evidence.recipient,
              observedBlock: evidence.v4Execution.quoteObservedBlock,
              observedBlockHash: evidence.v4Execution.quoteObservedBlockHash,
              observedAtMs: evidence.v4Execution.quoteObservedAtMs,
              quotedAtMs: evidence.v4Execution.quotedAtMs,
              expiresAtMs: evidence.v4Execution.quoteExpiresAtMs
            }
          }
        : {}),
      ...vNextAuthorizationAuthorityRequest(evidence)
    }, {
      identityToken: identity.identityToken
    });
    const failure = tradeAuthorizationFailureFromResponse(response);
    if (failure) throw new TradeJourneyError(tradeJourneyPhase(response.payload.phase)
      ?? (response.status === 409 ? "QUOTE_EXPIRED" : response.status >= 500 || response.status === 429 ? "QUOTE_SERVICE_UNAVAILABLE" : "AUTHORIZATION_FAILED"), failure.message);
    return parseVNextAuthorizationBundle(response.payload, evidence, {
      quoteRequestId: evidence.sourceQuoteRequestId,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      recipient: address
    }, Date.now());
  };

  function rememberApprovalIntent(plan: VNextAuthorizationPlan) {
    if (plan.provider !== "zero-x-swap" || plan.kind !== "erc20_approval" || !identity.activeWalletKey || !address) return;
    const now = Date.now();
    savePendingApprovalJourney({ version: 1, chainId: 4663, userId: identity.userId, wallet: address,
      walletKey: identity.activeWalletKey, marketAddress: selectedMarketAddress, side, amount,
      buyInputKey: selectedBuyInput ? assetKey(selectedBuyInput.id) : undefined,
      sellOutputKey: selectedSellOutput ? assetKey(selectedSellOutput.id) : sellOutputKey,
      inputAsset: plan.inputAsset, outputAsset: plan.outputAsset, inputAmountAtomic: plan.inputAmountAtomic,
      approvalPlanId: plan.planId, approvalPayloadHash: plan.payloadHash, createdAtMs: now, expiresAtMs: now + 10 * 60_000 });
  }
  const startTrade = async (openWallet = false) => {
    if (!authorizationEnabled || stockTokenViewOnly || !draft.intent || amountExceedsBalance || !onRobinhood) return;
    const key = preparationContext;
    automaticPreparationKey.current = key;
    if (openWallet) intentionalTradeContext.current = key;
    let stage: "quote" | "verification" | "authorization" = "quote";
    return refreshCoordinator.current.run({
      key, handoff: openWallet,
      prepare: async ({ current, signal }) => {
        backgroundQuoteEpoch.current += 1;
        const authorizationAttempt = ++authorizationAttemptEpoch.current;
        const bound = () => current() && currentPreparationContext.current === key
          && isCurrentTradeAuthorizationAttempt(authorizationAttempt, authorizationAttemptEpoch.current);
        setRefreshingPrice(Boolean(lastReadyVerification.current));
        setPostExecutionState({ state: "idle" });
        setVerificationState({ state: "loading" });
        setAuthorizationState({ state: "loading" });
        return revalidateAfterApproval({
          current: bound,
          wait: (ms) => waitForVerifiedRequestRetry(ms, signal),
          onRetry: () => { if (bound()) setRefreshingPrice(true); },
          attempt: async () => {
            stage = "quote";
            clearTradeQuoteCache();
            setQuoteState({ state: "loading" });
            const freshQuote = await requestLiveRoutes();
            if (!bound()) throw new TradeJourneyError("UNRESOLVED", "Trade intent changed.");
            lastReadyQuote.current = { requestKey, response: freshQuote };
            setQuoteState({ state: "ready", response: freshQuote });
            stage = "verification";
            const freshEvidence = await requestStrictVerification(freshQuote);
            if (!bound()) throw new TradeJourneyError("UNRESOLVED", "Trade intent changed.");
            if (!["verified", "approval_required"].includes(freshEvidence.status)) {
              throw new TradeJourneyError("SIMULATION_FAILED", freshEvidence.status === "insufficient_balance"
                ? "Your confirmed balance is insufficient for this trade."
                : freshEvidence.status === "insufficient_gas" ? "Add ETH for network gas before trading."
                : "The exact route did not pass final execution checks.");
            }
            stage = "authorization";
            const authorization = await requestAuthorizationPlan(freshEvidence);
            if (!bound()) throw new TradeJourneyError("UNRESOLVED", "Trade intent changed.");
            if (!isVerifiedRequestFresh(authorization.plan.expiresAtMs, Date.now())) throw new TradeJourneyError("QUOTE_EXPIRED", "Refreshing price...");
            return authorization;
          }
        });
      },
      ready: (authorization, handoff) => {
        if (currentPreparationContext.current !== key) return;
        setRefreshingPrice(false);
        lastReadyVerification.current = authorization.evidence;
        setVerificationState({ state: "ready", evidence: authorization.evidence });
        setAuthorizationState({ state: "ready", plan: authorization.plan });
        // A fresh quote cannot create wallet intent. Only a retained explicit click may hand off.
        if (handoff && intentionalTradeContext.current === key && authorization.plan.provider === "zero-x-swap") {
          walletBusyRef.current = true; setWalletBusy(true);
          rememberApprovalIntent(authorization.plan);
          setWalletActionId(++walletActionCounter.current);
        } else setWalletActionId(0);
        preparedApprovalAuthority.current = authorization.plan.kind === "erc20_approval"
          ? { approvalKind: authorization.evidence.approvalKind!, target: authorization.evidence.nextActionTarget!,
              spender: authorization.evidence.approvalSpender!, amountAtomic: authorization.evidence.inputAmountAtomic }
          : undefined;
      },
      failed: (cause) => {
        if (currentPreparationContext.current !== key) return;
        setRefreshingPrice(false);
        const message = cause instanceof Error ? cause.message : "RMT could not prepare this trade.";
        setQuoteState({ state: "error", message, phase: failureJourneyPhase(cause,
          stage === "quote" ? "QUOTE_SERVICE_UNAVAILABLE" : stage === "verification" ? "FIRM_VERIFY_FAILED" : "AUTHORIZATION_FAILED") });
        setVerificationState({ state: "error", message });
        setAuthorizationState({ state: "error", message });
      }
    });
  };

  const preparedExpiresAtMs = authorizationState.state === "ready" ? authorizationState.plan.expiresAtMs : undefined;
  useEffect(() => {
    // One owned timeout, paused during hidden-page and wallet interaction lifecycles.
    if (pendingTradeAfterLogin.current || !authorizationEnabled || stockTokenViewOnly || !onRobinhood
      || !draft.intent || amountExceedsBalance || !identity.authenticated || !identity.identityToken
      || !identity.userId || !address || identity.activeWalletKind !== "external" || !identity.activeWalletKey
      || walletReadStatus !== "ready" || walletBusy || executionRecord?.state === "submitted"
      || postExecutionState.state !== "idle") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden" || walletBusyRef.current || refreshCoordinator.current.running) return;
      if (preparedExpiresAtMs === undefined && (automaticPreparationKey.current === preparationContext
        || verificationQuote?.provider !== "zero-x-swap" || quoteState.state !== "ready")) return;
      timer = setTimeout(() => {
        if (!walletBusyRef.current && currentPreparationContext.current === preparationContext) void startTrade();
      }, preparedExpiresAtMs === undefined ? VNEXT_BACKGROUND_QUOTE_DEBOUNCE_MS : verifiedRequestRefreshDelay(preparedExpiresAtMs, Date.now()));
    };
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [preparationContext, preparedExpiresAtMs, identity.activeWalletKind, identity.authenticated, identity.identityToken,
    identity.userId, identity.activeWalletKey, address, authorizationEnabled, stockTokenViewOnly, onRobinhood,
    draft.intent?.amountAtomic, amountExceedsBalance, walletReadStatus, walletBusy, verificationQuote?.provider,
    quoteState.state, executionRecord?.state, postExecutionState.state]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const layer = tradePanelRef.current?.closest<HTMLElement>(".rmtMobileSheetLayer");
    if (!viewport || !layer) return;
    const resize = () => {
      layer.style.setProperty("--trade-viewport-height", viewport.height + "px");
      layer.style.setProperty("--trade-viewport-top", viewport.offsetTop + "px");
    };
    viewport.addEventListener("resize", resize); viewport.addEventListener("scroll", resize); resize();
    return () => {
      viewport.removeEventListener("resize", resize); viewport.removeEventListener("scroll", resize);
      layer.style.removeProperty("--trade-viewport-height"); layer.style.removeProperty("--trade-viewport-top");
    };
  }, []);

  const continueAfterApproval = async () => {
    if (!authorizationEnabled || stockTokenViewOnly) return;
    const pending = readPendingApprovalJourney();
    const resume = pendingApprovalRecordMatches(pending, executionRecord) && pending
      && pendingApprovalWalletMatches(pending, { userId: identity.userId, wallet: address, walletKey: identity.activeWalletKey, chainId });
    if (resume && pending && executionRecord) {
      intentionalTradeContext.current = `${identity.userId}:${identity.activeWalletKey}:${requestKey}`;
      savePendingApprovalJourney({ ...pending, approvalTxHash: executionRecord.txHash });
    }
    const confirmedApprovalAuthority = preparedApprovalAuthority.current ?? (resume && pending ? {
      approvalKind: "erc20_to_allowance_holder" as const, target: pending.inputAsset,
      spender: "0x0000000000001fF3684f28c67538d4D072C22734", amountAtomic: pending.inputAmountAtomic
    } : undefined);
    preparedApprovalAuthority.current = undefined;
    backgroundQuoteEpoch.current += 1;
    const authorizationAttempt = ++authorizationAttemptEpoch.current;
    setPostExecutionState({ state: "refreshing", message: "Approval confirmed. RMT discarded the prior payload and is refreshing the exact next action…" });
    setQuoteState({ state: "loading" });
    setVerificationState({ state: "loading" });
    setAuthorizationState({ state: "loading" });
    lastReadyQuote.current = undefined;
    lastReadyVerification.current = undefined;
    clearTradeQuoteCache();
    try {
      const refreshed = await revalidateAfterApproval({
        current: () => isCurrentTradeAuthorizationAttempt(authorizationAttempt, authorizationAttemptEpoch.current),
        onRetry: (phase, retry) => {
          emitTradeJourney({ phase, retry, approvalHashAvailable: Boolean(executionRecord?.txHash) });
          setPostExecutionState({ state: "refreshing", message: `Approval confirmed. ${tradeJourneyLabels[phase]}. Retrying fresh verification...` });
        },
        attempt: async () => {
      clearTradeQuoteCache();
      const freshQuote = await requestLiveRoutes();
      if (!isCurrentTradeAuthorizationAttempt(authorizationAttempt, authorizationAttemptEpoch.current)) return;
      lastReadyQuote.current = { requestKey, response: freshQuote };
      setQuoteState({ state: "ready", response: freshQuote });
      const freshEvidence = await requestStrictVerification(freshQuote);
      if (!isCurrentTradeAuthorizationAttempt(authorizationAttempt, authorizationAttemptEpoch.current)) return;
      lastReadyVerification.current = freshEvidence;
      setVerificationState({ state: "ready", evidence: freshEvidence });
      if (repeatsConfirmedVNextApproval(confirmedApprovalAuthority, freshEvidence)) {
        throw new Error("The confirmed approval did not update the expected allowance. RMT stopped before repeating the same wallet request.");
      }
      const outcome = postApprovalVerificationOutcome(freshEvidence);
      if (outcome.state === "blocked") throw new Error(outcome.message);
      const authorization = await requestAuthorizationPlan(freshEvidence);
      if (!isCurrentTradeAuthorizationAttempt(authorizationAttempt, authorizationAttemptEpoch.current)) return;
      if (
        (outcome.state === "next_approval_ready" && authorization.plan.kind !== "erc20_approval")
        || (outcome.state === "swap_ready" && authorization.plan.kind !== "swap")
      ) throw new Error("Fresh verification and wallet authorization disagreed about the next action.");
      return { authorization, outcome };
        }
      });
      if (!refreshed || !isCurrentTradeAuthorizationAttempt(authorizationAttempt, authorizationAttemptEpoch.current)) return;
      const { authorization, outcome } = refreshed;
      lastReadyVerification.current = authorization.evidence;
      setVerificationState({ state: "ready", evidence: authorization.evidence });
      setAuthorizationState({ state: "ready", plan: authorization.plan });
      preparedApprovalAuthority.current = authorization.plan.kind === "erc20_approval"
        ? {
            approvalKind: authorization.evidence.approvalKind!,
            target: authorization.evidence.nextActionTarget!,
            spender: authorization.evidence.approvalSpender!,
            amountAtomic: authorization.evidence.inputAmountAtomic
          }
        : undefined;
      setPostExecutionState(outcome);
      emitTradeJourney({ phase: outcome.state === "swap_ready" ? "SWAP_READY" : "APPROVAL_REQUIRED", quoteRefreshedAfterApproval: true, approvalHashAvailable: true });
      if (authorization.plan.provider === "zero-x-swap" && intentionalTradeContext.current === `${identity.userId}:${identity.activeWalletKey}:${requestKey}`) setWalletActionId(++walletActionCounter.current);
    } catch (cause) {
      if (!isCurrentTradeAuthorizationAttempt(authorizationAttempt, authorizationAttemptEpoch.current)) return;
      const message = cause instanceof Error ? cause.message : "Fresh post-approval verification failed.";
      setVerificationState({ state: "error", message });
      setAuthorizationState({ state: "error", message });
      setPostExecutionState({ state: "blocked", message });
    }
  };

  useEffect(() => {
    const pending = pendingTradeAfterLogin.current;
    if (!pending) return;
    if (!pendingTradeEntryMatches(pending, selectedMarketAddress, side, address)) {
      pendingTradeAfterLogin.current = undefined;
      return;
    }
    if (!authorizationEnabled || stockTokenViewOnly || !identity.authenticated || !identity.identityToken || !identity.userId || !address || identity.activeWalletKind !== "external" || !draft.intent || amountExceedsBalance || walletReadStatus !== "ready") return;
    pendingTradeAfterLogin.current = undefined;
    void startTrade();
  }, [address, authorizationEnabled, draft.intent, identity.activeWalletKind, identity.authenticated, identity.identityToken, identity.userId, stockTokenViewOnly, selectedMarketAddress, side, amountExceedsBalance, walletReadStatus]);

  useEffect(() => {
    if (
      !authorizationEnabled
      || stockTokenViewOnly
      ||
      (postExecutionState.state !== "approval_confirmed" && !pendingApprovalRecordMatches(readPendingApprovalJourney(), executionRecord))
      || !executionRecord
      || executionRecord.kind !== "erc20_approval"
      || !draft.intent || !identity.authenticated || !identity.identityToken || !identity.activeWalletKey || !onRobinhood
      || executionRecord.inputAmountAtomic !== draft.intent.amountAtomic
      || executionRecord.inputAsset.toLowerCase() !== inputAddress?.toLowerCase()
      || executionRecord.outputAsset.toLowerCase() !== outputAddress?.toLowerCase()
      || continuedApproval.current === executionRecord.txHash
    ) return;
    continuedApproval.current = executionRecord.txHash;
    void continueAfterApproval();
  }, [authorizationEnabled, executionRecord, postExecutionState.state, stockTokenViewOnly, draft.intent,
    identity.authenticated, identity.identityToken, identity.activeWalletKey, onRobinhood, inputAddress, outputAddress]);

  const verificationLabel = visibleVerification
    ? visibleVerification.status === "verified"
      ? "Exact simulation passed"
      : visibleVerification.status === "approval_required"
        ? "Approval required"
        : visibleVerification.status === "approval_simulation_failed"
          ? "Approval simulation failed"
        : visibleVerification.status === "insufficient_balance"
          ? "Insufficient balance"
          : visibleVerification.status === "insufficient_gas"
            ? "Insufficient ETH for gas"
            : visibleVerification.status === "gas_unavailable"
              ? "Gas estimate unavailable"
          : "Simulation failed"
    : null;
  const noObservedRoute = Boolean(visibleQuote && !bestQuote);
  const quotePhase: TradeJourneyPhase = quoteState.state === "error" ? quoteState.phase ?? "QUOTE_SERVICE_UNAVAILABLE"
    : !marketAsset || !pair || pair.inputAsset.decimals === null || pair.outputAsset.decimals === null ? "IDENTITY_PENDING"
    : visibleQuote ? observedZeroXPhase(visibleQuote.attempts)
    : quoteState.state === "loading" ? "QUOTE_REQUESTING" : "QUOTE_NOT_REQUESTED";
  const quoteStatusText = quotePhase === "QUOTE_EXPIRED" && !refreshingPrice
    ? "Price changed. Retry quote."
    : tradeJourneyLabels[quotePhase];
  const expectedOutputLabel = quoteState.state === "error" ? quoteStatusText : expectedOutput
    ? `${expectedOutput} ${outputSymbol}`
    : !draft.intent
      ? "Enter trade amount"
      : noObservedRoute
        ? tradeJourneyLabels[quotePhase]
        : "Finding best route…";
  const routeStatusLabel = quoteState.state === "error" ? quoteStatusText : visibleVerification
    ? verificationLabel
    : noObservedRoute
      ? tradeJourneyLabels[quotePhase]
    : visibleQuote
      ? "Routes compared"
      : draft.intent
        ? "Finding route"
        : "Not ready";
  const flowBusy = verificationState.state === "loading"
    || authorizationState.state === "loading"
    || postExecutionState.state === "refreshing";
  const walletPlanActive = authorizationState.state === "ready";
  const transactionPending = executionRecord?.state === "submitted";
  const triggerPrimaryAction = () => {
    if (!authorizationEnabled || stockTokenViewOnly) return;
    if (!identity.enabled) return;
    if (!identity.authenticated || !address || identity.activeWalletKind !== "external") {
      pendingTradeAfterLogin.current = { marketAddress: selectedMarketAddress, side, wallet: address };
      identity.connectTradingWallet();
      return;
    }
    void startTrade(true);
  };
  const continueTrading = () => {
    // A completed trade is a new preparation lifecycle even when its inputs are unchanged.
    walletBusyRef.current = false;
    setWalletBusy(false);
    automaticPreparationKey.current = "";
    setRefreshingPrice(false);
    backgroundQuoteEpoch.current += 1;
    authorizationAttemptEpoch.current += 1;
    refreshCoordinator.current.invalidate();
    backgroundQuoteImmediate.current = true;
    clearTradeQuoteCache();
    setQuoteState({ state: "loading" });
    setVerificationState({ state: "idle" });
    setAuthorizationState({ state: "idle" });
    lastReadyVerification.current = undefined;
    autoFitBuyAmount.current = true;
    setPostExecutionState({ state: "idle" });
    setSide("buy");
    setAmount(defaultBuyInput?.id.locator.kind === "native" ? defaultNativeBuyAmount : defaultBuyAmount);
    setBuyInputKey(defaultBuyInput ? assetKey(defaultBuyInput.id) : undefined);
    setSellOutputKey(assetKey(ROBINHOOD_USDG.id));
    onContinueTrading();
  };

  return (
    <aside ref={tradePanelRef} className={`vnTradePanel is-${side}`} id="vnext-trade-ticket" aria-labelledby="vn-trade-heading">
<div className="vnTradeScroll">
<div className="vnTradeHeader">
        <div><span className="vnEyebrow">{stockTokenViewOnly ? "Market context" : previewOnly ? "Route preview" : "Trade"}</span><h2 id="vn-trade-heading">{marketSymbol === "—" ? "Select an asset" : stockTokenViewOnly ? `View ${marketSymbol}` : previewOnly ? `Preview ${marketSymbol}` : `Trade ${marketSymbol}`}</h2><small>{marketName}</small></div>
        <span className={`vnFixtureBadge${stockTokenViewOnly ? " isViewOnly" : ""}`}>{stockTokenViewOnly ? "View only" : authorizationEnabled ? "Live trading" : "Preview mode"}</span>
      </div>
<div className="vnSideTabs" role="tablist" aria-label="Trade side">
        <button className={side === "buy" ? "isActive" : ""} onClick={() => chooseSide("buy")} type="button" role="tab" aria-selected={side === "buy"}>{stockTokenViewOnly || previewOnly ? "Buy quote" : "Buy"}</button>
        <button className={side === "sell" ? "isActive" : ""} onClick={() => chooseSide("sell")} type="button" role="tab" aria-selected={side === "sell"}>{stockTokenViewOnly || previewOnly ? "Sell quote" : "Sell"}</button>
      </div>
<div className="vnAvailableLine"><span>{side === "buy" ? "Pay with" : "Receive"}</span><strong>{pair ? `${inputSymbol} → ${outputSymbol}` : "Verified pair required"}</strong></div>
<label className="vnAmountField">
        <span>{side === "buy" ? "You pay" : "You sell"}</span>
        <div><input inputMode="decimal" value={amount} onChange={(event) => {
          clearPendingApprovalJourney();
          autoFitBuyAmount.current = false;
          setAmount(event.target.value);
        }} aria-label="Exact input amount" placeholder="0" />
          {side === "buy" ? <select
            aria-label="Pay with asset"
            value={selectedBuyInput ? assetKey(selectedBuyInput.id) : ""}
            disabled={displayedBuyInputs.length < 2}
            onChange={(event) => {
              clearPendingApprovalJourney();
              const nextKey = event.target.value;
              const nextUsesUsdg = nextKey === assetKey(ROBINHOOD_USDG.id);
              const nextUsesNative = nextKey === assetKey(ROBINHOOD_ETH.id);
              autoFitBuyAmount.current = nextUsesUsdg || nextUsesNative;
              setAmount(nextUsesUsdg ? defaultBuyAmount : nextUsesNative ? defaultNativeBuyAmount : "");
              setBuyInputKey(nextKey);
            }}
          >
            {displayedBuyInputs.length === 0 ? <option value="">No trusted payment asset</option> : displayedBuyInputs.map((asset) => <option value={assetKey(asset.id)} key={assetKey(asset.id)}>{asset.id.locator.kind === "native" ? "ETH · Native" : `${asset.symbol ?? "Asset"} · Canonical`}</option>)}
          </select> : <button type="button" disabled>{inputSymbol}</button>}
        </div>
      </label>
<div className="vnConfirmedBalance">
        <span><small>Available</small><strong>{!isConnected ? "Wallet required" : walletReadStatus === "idle" || walletReadStatus === "loading" ? "Reading wallet…" : walletReadStatus === "error" ? "Balance read delayed" : spendableInputAtomic === "0" ? `No ${inputSymbol} balance found` : availableDisplay ? `${availableDisplay} ${inputSymbol}` : `${inputSymbol} balance unavailable`}</strong></span>
        <div aria-label="Confirmed balance percentages">
          {[2_500, 5_000, 7_500, 10_000].map((basisPoints) => <button
            type="button"
            key={basisPoints}
            disabled={!spendableInputAtomic || spendableInputAtomic === "0"}
            onClick={() => useBalancePercentage(basisPoints)}
          >{basisPoints === 10_000 ? "Max" : `${basisPoints / 100}%`}</button>)}
        </div>
      </div>
{side === "buy" && inputSymbol === "USDG" ? (
        <div className="vnQuickAmounts">
          {["25", "50", "100", "250"].map((preset) => {
            const exceedsBalance = Boolean(
              spendableInputAtomic
              && pairInputDecimals !== null
              && parseUnits(preset, pairInputDecimals) > BigInt(spendableInputAtomic)
            );
            return <button
              className={preset === amount ? "isActive" : ""}
              type="button"
              key={preset}
              disabled={exceedsBalance}
              aria-label={`Use $${preset}${exceedsBalance ? " (exceeds confirmed balance)" : ""}`}
              onClick={() => {
                autoFitBuyAmount.current = false;
                setAmount(preset);
              }}
            >${preset}</button>;
          })}
        </div>
      ) : <p className="vnIntentHint">Enter the exact {inputSymbol === "—" ? "input asset" : inputSymbol} amount. RMT does not estimate or inflate wallet balances.</p>}
<div className="vnSwapDivider"><span aria-hidden="true">↓</span></div>
<div className="vnReceiveField">
        <span>Expected receive</span>
        <div><strong>{expectedOutputLabel}</strong>
          {side === "sell" ? <select
            aria-label="Receive asset"
            value={selectedSellOutput ? assetKey(selectedSellOutput.id) : ""}
            disabled={sellOutputs.length < 2}
            onChange={(event) => { clearPendingApprovalJourney(); setSellOutputKey(event.target.value); }}
          >
            {sellOutputs.map((asset) => <option value={assetKey(asset.id)} key={assetKey(asset.id)}>{asset.id.locator.kind === "native" ? "ETH (native)" : asset.symbol ?? "Asset"}</option>)}
          </select> : <button type="button" disabled>{outputSymbol}</button>}
        </div>
        <div className="vnOutputProtection"><span>Protected minimum</span><strong>{protectedOutput ? `${protectedOutput} ${outputSymbol}` : "Set when you trade"}</strong></div>
        <small>{protectedOutput
          ? routeSelection.usesVerifiedBackup
            ? `Best observed: ${bestQuote?.providerLabel} (quote-only). Best currently executable: ${verificationQuote?.providerLabel}.`
            : verificationQuote
              ? `Best observed: ${bestQuote?.providerLabel}. Quotes update quietly; RMT verifies the executable route when you trade.`
              : `Best observed: ${bestQuote?.providerLabel} (quote-only). No public wallet route is currently admitted.`
          : "RMT verifies the protected minimum before the explicit wallet-review action."}</small>
      </div>
{showExecutableFeeSummary && pair ? <div className="vnFeeV2Summary" role="note" aria-label="RMT execution fee summary">
        <span><small>{indicativeFeePresentation.separateContexts ? "Executable RMT fee" : "RMT execution fee"}</small><strong>{executableRmtFee
          ? `${executableRmtFee.feeBps / 100}% · ${formatVNextFeeAtomic(executableRmtFee.expectedFeeAtomic, executableRmtFee.feeSide === "input" ? pair.inputAsset.decimals ?? 18 : pair.outputAsset.decimals ?? 18)} ${executableRmtFee.feeSide === "input" ? inputSymbol : outputSymbol}`
          : executableRmtFeeLabel}</strong></span>
        <span><small>Executable provider input</small><strong>{executableRmtFee
          ? `${formatVNextFeeAtomic(executableRmtFee.providerInputAtomic, pair.inputAsset.decimals ?? 18)} ${inputSymbol}`
          : "Unavailable until fee economics verify"}</strong></span>
      </div> : null}
{postExecutionState.state !== "idle" ? <div className={`vnPostExecution is${postExecutionState.state}`} role="status">
        <strong>{postExecutionState.state === "approval_confirmed"
          ? "Approval confirmed · fresh execution required"
          : postExecutionState.state === "refreshing"
            ? "Revalidating after approval"
            : postExecutionState.state === "swap_ready"
              ? "Fresh swap verification passed"
              : postExecutionState.state === "next_approval_ready"
                ? "Next exact approval ready"
              : postExecutionState.state === "swap_confirmed"
                ? "Settlement confirmed"
                : postExecutionState.state === "confirmed_unsettled"
                  ? "Transaction confirmed; swap settlement unverified"
                : postExecutionState.state === "reverted"
                  ? "Transaction reverted"
                  : "Fresh verification blocked"}</strong>
        <small>{postExecutionState.message}</small>
      </div> : null}
<dl className="vnTradePriceSummary" aria-label="Trade costs">
  <div><dt>Provider</dt><dd>0x</dd></div>
  <div><dt>Network fee estimate</dt><dd>{visibleVerification?.estimatedNetworkCostWei
    ? formatUnits(BigInt(visibleVerification.estimatedNetworkCostWei), 18) + " ETH" : "Not available yet"}</dd></div>
</dl>
<details className="vnRouteCard">
        <summary className="vnRouteTop"><span><i aria-hidden="true" /> Advanced details</span><strong>{routeStatusLabel}</strong></summary>
        <div className="vnRouteDetails">
{authorizationState.state === "ready" && visibleVerification ? <section className="vnWalletPrimaryReview">
<span><strong>Verified request ready</strong><small>Nothing opens automatically. Use the explicit action below when the selected external wallet is unlocked.</small></span>

<dl>
          <div><dt>Exact input</dt><dd>{formatAtomicDisplay(authorizationState.plan.inputAmountAtomic, pair?.inputAsset.decimals ?? 18)} {inputSymbol}</dd></div>
          <div><dt>Expected output</dt><dd>{formatAtomicDisplay(visibleVerification.expectedOutputAtomic, pair?.outputAsset.decimals ?? 18)} {outputSymbol}</dd></div>
          <div><dt>Protected minimum</dt><dd>{formatAtomicDisplay(authorizationState.plan.protectedOutputAtomic, pair?.outputAsset.decimals ?? 18)} {outputSymbol}</dd></div>
          <div><dt>Route</dt><dd>{visibleRoutePresentation?.routeLabel}</dd></div>
          <div><dt>Target</dt><dd style={{ overflowWrap: "anywhere" }}>{authorizationState.plan.target}</dd></div>
                <div><dt>Native value (wei)</dt><dd>{authorizationState.plan.value}</dd></div>
                {authorizationState.plan.gasPrice !== undefined ? <div><dt>Gas price (wei)</dt><dd>{authorizationState.plan.gasPrice}</dd></div> : null}
          <div><dt>{verifiedRmtFee ? "RMT execution fee" : "RMT platform fee"}</dt><dd>{verifiedRmtFee ? `${verifiedRmtFee.feeBps / 100}%` : "0"}</dd></div>
        </dl>

</section> : null}
<div ref={setWalletDetailsTarget} />
<p className="vnTradeSafety" id={stockTokenViewOnly ? "vn-stock-token-execution-policy" : previewOnly ? "vn-preview-execution-policy" : undefined}>{stockTokenViewOnly
        ? "Official Robinhood Stock Tokens are view-only in RMT until jurisdiction controls are available. Indicative market and route information remains available."
        : previewOnly
          ? "Preview mode shows informational routes only. RMT will not connect your wallet or prepare a transaction until verified execution is activated."
         : zeroXNoRoute
           ? "No 0x route currently available for this trade. Other informational quotes do not authorize wallet execution."
         : visibleQuote && bestQuote && !verificationQuote
           ? "The best observed route is not admitted to public wallet execution. Its quote remains visible and unchanged."
         : walletPlanActive
          ? "The verified request is ready. Only your explicit wallet-review action can send it to the selected external wallet."
        : identity.enabled
          ? "RMT prepares the verified 0x request. One explicit review action opens your wallet; nothing signs automatically."
        : "Trading identity is not configured in this environment. RMT will not request a quote or prepare a wallet transaction."}</p>
        <dl className="vnIntentSummary">
          <div><dt>Input</dt><dd>{inputSymbol}</dd></div>
          <div><dt>Output</dt><dd>{outputSymbol}</dd></div>
          <div><dt>Recipient</dt><dd>{address ? shortAddress(address) : "Wallet required"}</dd></div>
          <div><dt>Trade type</dt><dd>Exact input</dd></div>
        </dl>
        <p className="vnIntentStatus">{quoteState.state === "error" ? quoteState.message : draft.message}</p>
        {address && pair ? <p className={`vnBalanceEvidence${amountExceedsBalance ? " isBlocking" : ""}`}>{amountExceedsBalance
          ? `Amount exceeds the confirmed ${inputSymbol} balance. Authorization must remain blocked.`
          : spendableInputAtomic !== undefined
            ? `Confirmed ${inputSymbol} balance is the source for percentage and Max controls.`
            : `Confirmed ${inputSymbol} balance is delayed. Percentage controls remain disabled.`}</p> : null}
        {visibleQuote ? <div className="vnQuoteAttempts">
          {visibleQuote.attempts.map((attempt) => (
            <div className={attempt.status === "indicative" ? "isReady" : ""} key={attempt.provider}>
              <span><strong>{attempt.providerLabel}</strong><small>{attempt.executionKind === "rfq_intent" ? "Intent" : attempt.executionKind === "gasless" ? "Gasless" : attempt.executionKind === "aggregator" ? "Aggregator" : "Direct AMM"} · {attempt.userPaysGas === null ? "gas unknown" : attempt.userPaysGas ? "wallet gas" : "filler pays gas"} · {attempt.latencyMs}ms</small></span>
              <span><strong>{attempt.status === "indicative" && attempt.outputDecimals !== null ? `${formatAtomicDisplay(attempt.protectedOutputAtomic!, attempt.outputDecimals)} ${outputSymbol}` : attempt.status === "no_route" ? "No route" : attempt.status === "invalid_response" ? "Rejected" : "Unavailable"}</strong><small>{attempt.status === "indicative"
                ? attempt.provider === bestQuote?.provider
                  ? attempt.publicWalletExecutionEligible
                    ? "Highest protected user output before network fee · indicative floor"
                    : "Highest protected user output before network fee · quote-only"
                  : routeSelection.usesVerifiedBackup && attempt.provider === verificationQuote?.provider
                    ? "Best currently executable quote · indicative floor"
                    : "Indicative floor"
                : attempt.detail}</small></span>
            </div>
          ))}
        </div> : <dl>
          <div><dt>Providers</dt><dd>Not requested</dd></div>
          <div><dt>Trader gas</dt><dd>Unknown until executable route</dd></div>
          <div><dt>RMT fee</dt><dd>No route selected</dd></div>
        </dl>}
        {visibleQuote ? <dl>
          <div><dt>Ranking basis</dt><dd>Protected user output after RMT fee, before network fee</dd></div>
          <div><dt>Trader gas</dt><dd>{visibleQuote.attempts.some((attempt) => attempt.userPaysGas === false) ? "Route-specific · sponsored option observed" : "Estimated during strict verification"}</dd></div>
          <div><dt>Provider fee</dt><dd>{visibleQuote.attempts.some((attempt) => attempt.providerFeeAtomic !== null) ? "Disclosed by provider and reflected in output" : "Not separately reported"}</dd></div>
          {indicativeFeePresentation.separateContexts ? <>
            <div><dt>Best observed RMT fee</dt><dd>{observedRmtFeeLabel}</dd></div>
            <div><dt>Executable RMT fee</dt><dd>{executableRmtFeeLabel}</dd></div>
            <div><dt>Executable provider input</dt><dd>{executableRmtFee && pair
              ? `${formatVNextFeeAtomic(executableRmtFee.providerInputAtomic, pair.inputAsset.decimals ?? 18)} ${inputSymbol}`
              : "Unavailable until fee economics verify"}</dd></div>
          </> : <div><dt>RMT fee</dt><dd>{verificationQuote ? executableRmtFeeLabel : observedRmtFeeLabel}</dd></div>}
        </dl> : null}
        {visibleQuote ? <div className="vnVerificationGate">
          <div>
            <span><strong>Strict pre-sign evidence</strong><small>{verificationQuote
              ? routeSelection.usesVerifiedBackup
                ? `${bestQuote?.providerLabel} leads indicatively but is quote-only; ${verificationQuote.providerLabel} is the best currently executable quote`
                : "Fresh provider-specific contracts + exact wallet state"
              : stockTokenViewOnly
                ? "Indicative routes are informational; stock-token execution verification is not admitted."
                : "No observed route is currently admitted to public wallet execution"}</small></span>
          </div>
          {verificationState.state === "error" ? <p className="isError" role="status">{verificationState.message}</p> : null}
          {visibleVerification ? <div className={`vnVerificationEvidence is${visibleVerification.status}`} aria-busy={verificationState.state === "loading"}>
            <span><strong>{verificationLabel}</strong><small>{verificationState.state === "loading"
              ? "Last verified evidence remains stable while its replacement is checked"
              : authorizationEnabled ? "RMT completed the internal checks from your single trade action" : "Authorization remains disabled in this preview"}</small></span>
            <dl>
              <div><dt>Provider</dt><dd>{visibleRoutePresentation?.providerLabel}</dd></div>
              <div><dt>Route</dt><dd>{visibleRoutePresentation?.routeLabel}</dd></div>
              <div><dt>Protected</dt><dd>{formatAtomicDisplay(visibleVerification.protectedOutputAtomic, verificationQuote?.outputDecimals ?? 18)} {outputSymbol}</dd></div>
              <div><dt>{visibleVerification.provider === "zero-x-swap" ? "Fresh firm quote" : "Quote continuity"}</dt><dd>{visibleVerification.provider === "zero-x-swap" ? "Updated executable minimum" : describeProtectedOutputContinuity(visibleVerification.protectedOutputAtomic, visibleVerification.indicativeProtectedOutputFloorAtomic)}</dd></div>
              <div><dt>Simulation</dt><dd>{visibleVerification.exactSimulationPassed ? "Passed" : "Not passed"}</dd></div>
              <div><dt>Next action</dt><dd>{visibleVerification.nextAction === "approval" ? "Exact approval" : visibleVerification.nextAction === "swap" ? "Verified swap" : "Blocked"}</dd></div>
              <div><dt>Gas</dt><dd>{visibleVerification.gasState}</dd></div>
              <div><dt>Gas reserve</dt><dd>{visibleVerification.estimatedNetworkCostWei ? `${formatAtomicDisplay(visibleVerification.estimatedNetworkCostWei, 18)} ETH` : "Unavailable"}</dd></div>
              <div><dt>Gas reserve value</dt><dd>{freshVerifiedNetworkCostUsdgAtomic ? `${formatAtomicDisplay(freshVerifiedNetworkCostUsdgAtomic, 6)} USDG equivalent` : "Unavailable"}</dd></div>
              {verifiedUsdgOutcome?.kind === "buy_cost_ceiling" ? <div><dt>Trade + gas ceiling</dt><dd>{formatAtomicDisplay(verifiedUsdgOutcome.totalCostUsdgAtomic, 6)} USDG equivalent</dd></div> : null}
              {verifiedUsdgOutcome?.kind === "sell_proceeds_after_gas" ? <div><dt>Protected after gas</dt><dd>{verifiedUsdgOutcome.gasExceedsProtectedProceeds ? "Gas exceeds protected proceeds" : `${formatAtomicDisplay(verifiedUsdgOutcome.proceedsAfterGasUsdgAtomic, 6)} USDG equivalent`}</dd></div> : null}
              <div><dt>RMT fee</dt><dd>{verifiedRmtFeeLabel}</dd></div>
              {visibleVerification.providerNativeFee ? <div><dt>RMT fee settlement</dt><dd>0.25% · provider-native · sell token · no RMT executor</dd></div> : null}
              {visibleVerification.providerNativeFee?.providerFeeAtomic && visibleVerification.providerNativeFee.providerFeeAsset ? <div><dt>0x/provider fee</dt><dd>{formatAtomicDisplay(visibleVerification.providerNativeFee.providerFeeAtomic, getAddress(visibleVerification.providerNativeFee.providerFeeAsset) === getAddress(visibleVerification.inputAsset) ? pair?.inputAsset.decimals ?? 18 : pair?.outputAsset.decimals ?? 18)} · separate from RMT fee and network gas</dd></div> : null}
              {visibleVerification.feeExecution ? <div><dt>Fee treasury</dt><dd>{shortAddress(visibleVerification.feeExecution.treasury)}</dd></div> : null}
              {visibleVerification.feeExecution ? <div><dt>Settlement</dt><dd>Atomic with swap · policy v{visibleVerification.feeExecution.policyVersion}</dd></div> : null}
              {visibleVerification.feeV2Economics ? <div><dt>Gross input</dt><dd>{formatAtomicDisplay(visibleVerification.feeV2Economics.userGrossInputAtomic, pair?.inputAsset.decimals ?? 18)} {inputSymbol}</dd></div> : null}
              {visibleVerification.feeV2Economics ? <div><dt>Fee asset</dt><dd>{inputSymbol} · paid in the sold/input asset</dd></div> : null}
              {visibleVerification.feeV2Economics ? <div><dt>Provider input</dt><dd>{formatVNextFeeAtomic(visibleVerification.feeV2Economics.providerInputAtomic, pair?.inputAsset.decimals ?? 18)} {inputSymbol}</dd></div> : null}
              {visibleVerification.feeV2Economics ? <div><dt>Fee treasury</dt><dd>{shortAddress(visibleVerification.feeV2Economics.treasury)}</dd></div> : null}
              {visibleVerification.feeV2Settlement ? <div><dt>Settlement</dt><dd>Atomic with swap · RMT V2 executor {shortAddress(visibleVerification.feeV2Settlement.executionTarget)}</dd></div> : null}
              <div><dt>Calldata</dt><dd>{shortAddress(visibleVerification.calldataHash)}</dd></div>
            </dl>
            {visibleVerification.status === "insufficient_gas" ? <div className="vnGasRecovery" role="status">
              <span><strong>Robinhood ETH is required only for network gas</strong><small>Add it to the exact active wallet, then press Buy or Sell once. RMT will quietly recheck the route, balance, and gas reserve.</small></span>
              <FundWalletButton directReceive variant="inline" label="Add Robinhood ETH" />
            </div> : null}
            {authorizationState.state === "error" ? <p className="vnAuthorizationError" role="status">{authorizationState.message}</p> : null}
            {authorizationState.state === "ready" ? <div className="vnAuthorizationPlan" role="status">
              <span><strong>{authorizationState.plan.kind === "erc20_approval" ? "Exact token approval prepared" : "Verified swap prepared"}</strong><small>Review the verified request, then explicitly choose when to open your wallet.</small></span>
              <dl>
                <div><dt>{authorizationState.plan.kind === "erc20_approval" ? "Approval amount" : "Exact input"}</dt><dd>{formatAtomicDisplay(authorizationState.plan.inputAmountAtomic, pair?.inputAsset.decimals ?? 18)} {inputSymbol}</dd></div>
                <div><dt>Expected output</dt><dd>{formatAtomicDisplay(visibleVerification.expectedOutputAtomic, pair?.outputAsset.decimals ?? 18)} {outputSymbol}</dd></div>
                <div><dt>Protected minimum</dt><dd>{formatAtomicDisplay(authorizationState.plan.protectedOutputAtomic, pair?.outputAsset.decimals ?? 18)} {outputSymbol}</dd></div>
                <div><dt>Route</dt><dd>{visibleRoutePresentation?.routeLabel}</dd></div>
                <div><dt>Network</dt><dd>Robinhood Chain · 4663</dd></div>
                <div><dt>Target</dt><dd>{shortAddress(authorizationState.plan.target)}</dd></div>
                <div><dt>Gas limit</dt><dd>{BigInt(authorizationState.plan.gasLimit).toLocaleString()}</dd></div>
                <div><dt>Payload</dt><dd>{shortAddress(authorizationState.plan.payloadHash)}</dd></div>
                <div><dt>Expires</dt><dd>{new Date(authorizationState.plan.expiresAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</dd></div>
              </dl>
            </div> : null}
          </div> : null}
        </div> : null}
        </div>
      </details>
</div>
<footer className="vnTradeActionDock" data-indicative-fresh={indicativeQuoteFresh}>
{authorizationState.state === "ready" && visibleVerification ? <VNextWalletReview
          key={authorizationState.plan.planId}
          plan={authorizationState.plan}
          evidence={visibleVerification}
          onRefresh={() => { walletBusyRef.current = false; setWalletBusy(false); void startTrade(true); }}
          detailsTarget={walletDetailsTarget}
          onActivityChange={(active) => { walletBusyRef.current = active; setWalletBusy(active); }}
          actionId={walletActionId}
          tradeActionLabel={authorizationState.plan.provider === "zero-x-swap" ? `${side === "buy" ? "Buy" : "Sell"} ${marketSymbol}` : undefined}
          onTradeAction={() => { walletBusyRef.current = true; setWalletBusy(true); if (authorizationState.plan.provider === "zero-x-swap") {
            intentionalTradeContext.current = `${identity.userId}:${identity.activeWalletKey}:${requestKey}`;
            rememberApprovalIntent(authorizationState.plan);
          } }}
          onDispatched={(dispatched) => { setWalletActionId(0); if (dispatched.kind === "swap") { intentionalTradeContext.current = null; clearPendingApprovalJourney(); } }}
          inputSymbol={inputSymbol}
          outputSymbol={outputSymbol}
          inputDecimals={pair?.inputAsset.decimals ?? 18}
          outputDecimals={pair?.outputAsset.decimals ?? 18}
          selectedWalletKey={identity.activeWalletKey}
          selectedWalletKind={identity.activeWalletKind}
          selectedWalletName={identity.activeWalletName}
        /> : <button
          className="vnReviewButton"
          type="button"
          disabled={!authorizationEnabled || stockTokenViewOnly || flowBusy || transactionPending || amountExceedsBalance || !identity.enabled || !identity.ready || Boolean(visibleQuote && bestQuote && !verificationQuote) || Boolean(identity.authenticated && address && identity.activeWalletKind === "external" && !draft.intent)}
          aria-describedby={stockTokenViewOnly ? "vn-stock-token-execution-policy" : previewOnly ? "vn-preview-execution-policy" : undefined}
          onClick={triggerPrimaryAction}
        >{stockTokenViewOnly
          ? "View only"
          : previewOnly
            ? "Trading activation pending"
          : visibleQuote && bestQuote && !verificationQuote
            ? "Best route is quote only"
          : postExecutionState.state === "refreshing"
          ? "Preparing verified swap…"
          : transactionPending
            ? "Transaction confirming…"
            : flowBusy
              ? (refreshingPrice ? "Refreshing price..." : "Finding best route...")
              : !identity.enabled
                ? "Trading identity unavailable"
              : !address || identity.activeWalletKind !== "external"
                ? `${side === "buy" ? "Connect & buy" : "Connect & sell"} ${marketSymbol}`
              : !identity.authenticated
                ? `${side === "buy" ? "Connect & buy" : "Connect & sell"} ${marketSymbol}`
                : quotePhase === "IDENTITY_PENDING" ? "Verifying token..."
                : quotePhase === "IDENTITY_UNAVAILABLE" ? "Retry token verification"
                : quoteState.state === "loading" ? "Finding route..."
                : authorizationState.state === "error" || verificationState.state === "error" || quoteState.state === "error" || zeroXNoRoute || noObservedRoute ? "Retry quote"
                : `${side === "buy" ? "Buy" : "Sell"} ${marketSymbol}`}</button>}
</footer>
{postExecutionState.state === "swap_confirmed" && executionRecord?.kind === "swap" && executionRecord.state === "confirmed" && confirmedOutputDisplay ? (
        <div className="vnTradeReceiptBackdrop" role="presentation">
          <section
            ref={receiptDialog}
            className="vnTradeReceipt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vn-trade-receipt-heading"
            aria-describedby="vn-trade-receipt-detail"
          >
            <button className="vnTradeReceiptClose" type="button" aria-label="Close trade confirmation" onClick={() => setPostExecutionState({ state: "idle" })}>×</button>
            <span className="vnTradeReceiptMark" aria-hidden="true">✓</span>
            <span className="vnEyebrow">Robinhood Chain · confirmed</span>
            <h3 id="vn-trade-receipt-heading">{side === "buy" ? "Buy confirmed" : "Sell confirmed"}</h3>
            <p id="vn-trade-receipt-detail">{side === "buy"
              ? `You bought ${outputSymbol} with ${inputSymbol}.`
              : `You sold ${inputSymbol} for ${outputSymbol}.`}</p>
            <dl>
              <div><dt>{executionRecord.feeV2Settlement || executionRecord.providerNativeFee ? "Gross input" : side === "buy" ? "Paid" : "Sold"}</dt><dd>{confirmedInputDisplay ? `${confirmedInputDisplay} ${inputSymbol}` : `${inputSymbol} confirmed`}</dd></div>
              <div><dt>{side === "buy" ? "Asset received" : "Proceeds"}</dt><dd>{confirmedOutputDisplay ? `${confirmedOutputDisplay} ${outputSymbol}` : executionRecord.provider === "zero-x-swap" ? "Transaction confirmed; amount not reconciled" : `${outputSymbol} · confirmed onchain`}</dd></div>
              {confirmedFee.state !== "not_applicable" ? <div><dt>{confirmedFee.state === "quoted" ? "RMT fee quoted" : "RMT fee settled"}</dt><dd>{confirmedFee.display}</dd></div> : null}
              {executionRecord.providerNativeFee ? <>
                <div><dt>0x/provider fee quoted</dt><dd>{executionRecord.providerNativeFee.providerFeeAtomic ? `${executionRecord.providerNativeFee.providerFeeAtomic} atomic · ${executionRecord.providerNativeFee.providerFeeAsset}` : "None reported"}</dd></div>
                <div><dt>Expected receive quoted</dt><dd>{formatAtomicDisplay(executionRecord.providerNativeFee.expectedOutputAtomic, pair?.outputAsset.decimals ?? 18)} {outputSymbol}</dd></div>
                <div><dt>Minimum receive quoted</dt><dd>{formatAtomicDisplay(executionRecord.providerNativeFee.protectedOutputAtomic, pair?.outputAsset.decimals ?? 18)} {outputSymbol}</dd></div>
                <div><dt>Transaction target</dt><dd>{shortAddress(executionRecord.providerNativeFee.transactionTarget)}</dd></div>
              </> : null}
              {confirmedProvider ? <div><dt>Provider</dt><dd>{confirmedProvider}{executionRecord.feeV2Settlement ? " · RMT atomic fee settlement · policy v2" : executionRecord.feeSettlement ? " · RMT atomic settlement" : ""}</dd></div> : null}
              <div><dt>Transaction</dt><dd>{shortAddress(executionRecord.txHash)}</dd></div>
            </dl>
            <button ref={receiptAction} className="vnTradeReceiptContinue" type="button" onClick={continueTrading}>Continue trading</button>
            <ExplorerLink kind="transaction" value={executionRecord.txHash} accessibleName="Open confirmed trade transaction in Robinhood Chain explorer">View confirmed transaction ↗</ExplorerLink>
          </section>
        </div>
      ) : null}
</aside>
  );
}
