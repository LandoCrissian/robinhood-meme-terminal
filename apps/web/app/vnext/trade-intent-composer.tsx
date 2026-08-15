"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount } from "wagmi";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import { assetKey } from "../../lib/vnext/execution-domain";
import type { VNextExecutionRecord } from "../../lib/vnext/execution-recovery";
import { affordableDefaultAmount, createExactInputIntent, percentageOfAtomic, type TradeSide } from "../../lib/vnext/intent-draft";
import { parseVNextQuoteResponse, selectVNextRoute, type VNextQuoteResponse } from "../../lib/vnext/quote-observation";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "../../lib/vnext/pre-sign-evidence";
import { postApprovalVerificationOutcome, resolvedVNextExecutionOutcome } from "../../lib/vnext/post-approval";
import { parseVNextAuthorizationBundle, type VNextAuthorizationPlan } from "../../lib/vnext/authorization-plan";
import { cachedVNextQuoteForRequest, isVNextQuoteReusableForTrade, VNEXT_BACKGROUND_QUOTE_DEBOUNCE_MS, VNEXT_BACKGROUND_QUOTE_REFRESH_MS, type VNextCachedQuote } from "../../lib/vnext/background-quote";
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
import { useRmtIdentity } from "../rmt-identity";
import { FundWalletButton } from "../fund-wallet-button";
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
const NATIVE_GAS_RESERVE_ATOMIC = 100_000_000_000_000n;

export function TradeIntentComposer({ marketName, marketSymbol, marketAsset, walletAssets, nativeBalance, executionRecord, onContinueTrading, sideRequest }: {
  marketName: string;
  marketSymbol: string;
  marketAsset?: AssetMetadata;
  walletAssets: VNextDetectedWalletAsset[];
  nativeBalance?: bigint;
  executionRecord?: VNextExecutionRecord | null;
  onContinueTrading: () => void;
  sideRequest?: { side: TradeSide; nonce: number };
}) {
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState(DEFAULT_BUY_AMOUNT);
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
  const [costValuationClockMs, setCostValuationClockMs] = useState(() => Date.now());
  const handledExecution = useRef<string | undefined>(undefined);
  const pendingTradeAfterLogin = useRef(false);
  const continuedApproval = useRef<string | undefined>(undefined);
  const autoFitBuyAmount = useRef(true);
  const backgroundQuoteEpoch = useRef(0);
  const backgroundQuoteImmediate = useRef(false);
  const backgroundQuoteAttempted = useRef(false);
  const lastReadyQuote = useRef<VNextCachedQuote | undefined>(undefined);
  const lastReadyVerification = useRef<VNextPreSignEvidence | undefined>(undefined);
  const receiptAction = useRef<HTMLButtonElement>(null);
  const { address, chainId, isConnected } = useAccount();
  const identity = useRmtIdentity();
  const onRobinhood = chainId === ROBINHOOD_MAINNET_CHAIN_ID;
  const authorizationEnabled = process.env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED === "true";
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
  const requestKey = `${address ?? ""}:${side}:${amount}:${inputAddress ?? ""}:${outputAddress ?? ""}`;
  const cachedQuote = cachedVNextQuoteForRequest(lastReadyQuote.current, requestKey);
  useEffect(() => {
    backgroundQuoteEpoch.current += 1;
    backgroundQuoteAttempted.current = false;
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
  const visibleQuote = cachedQuote;
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
  const routeSelection = visibleQuote
    ? selectVNextRoute(visibleQuote.attempts)
    : { bestObserved: undefined, verificationCandidate: undefined, usesVerifiedBackup: false, selectionBasis: "none" as const, netOutcomeReady: false as const };
  const bestQuote = routeSelection.bestObserved;
  const verificationQuote = routeSelection.verificationCandidate;
  const freshVerifiedNetworkCostUsdgAtomic = visibleVerification?.estimatedNetworkCostUsdgAtomic
    && visibleVerification.networkCostValuationExpiresAtMs
    && visibleVerification.networkCostValuationExpiresAtMs > costValuationClockMs
      ? visibleVerification.estimatedNetworkCostUsdgAtomic
      : null;
  const verifiedUsdgOutcome = visibleVerification
    ? deriveVNextVerifiedUsdgOutcome(visibleVerification, costValuationClockMs)
    : null;
  const expectedOutput = bestQuote?.expectedOutputAtomic && bestQuote.outputDecimals !== null
    ? formatAtomicDisplay(bestQuote.expectedOutputAtomic, bestQuote.outputDecimals)
    : null;
  const protectedOutput = bestQuote && bestQuote.outputDecimals !== null
    ? formatAtomicDisplay(bestQuote.protectedOutputAtomic!, bestQuote.outputDecimals)
    : null;
  const bestRmtFee = bestQuote?.netEconomics?.rmtFee.state === "planned" ? bestQuote.netEconomics.rmtFee : null;
  const bestRmtFeeLabel = bestRmtFee && pair
    ? `${formatAtomicDisplay(
        bestRmtFee.expectedFeeAtomic,
        bestRmtFee.feeSide === "input" ? pair.inputAsset.decimals ?? 18 : pair.outputAsset.decimals ?? 18
      )} ${bestRmtFee.feeSide === "input" ? inputSymbol : outputSymbol} · ${bestRmtFee.feeBps / 100}%`
    : "Not enabled";
  const verifiedRmtFee = visibleVerification?.netEconomics?.rmtFee.state === "planned"
    ? visibleVerification.netEconomics.rmtFee
    : null;
  const verifiedRmtFeeLabel = verifiedRmtFee && pair
    ? `${formatAtomicDisplay(
        verifiedRmtFee.expectedFeeAtomic,
        verifiedRmtFee.feeSide === "input" ? pair.inputAsset.decimals ?? 18 : pair.outputAsset.decimals ?? 18
      )} ${verifiedRmtFee.feeSide === "input" ? inputSymbol : outputSymbol} · maximum ${formatAtomicDisplay(
        verifiedRmtFee.maximumFeeAtomic,
        verifiedRmtFee.feeSide === "input" ? pair.inputAsset.decimals ?? 18 : pair.outputAsset.decimals ?? 18
      )}`
    : "Not enabled";
  const availableDisplay = inputBalanceAtomic && pairInputDecimals !== null
    ? formatAtomicDisplay(inputBalanceAtomic, pairInputDecimals)
    : null;
  const amountExceedsBalance = Boolean(
    draft.intent
    && inputBalanceAtomic
    && BigInt(draft.intent.amountAtomic) > BigInt(inputBalanceAtomic)
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

  const useBalancePercentage = (basisPoints: number) => {
    if (!inputBalanceAtomic || pair?.inputAsset.decimals === null || pair?.inputAsset.decimals === undefined) return;
    try {
      const balance = pair.inputAsset.id.locator.kind === "native"
        ? BigInt(inputBalanceAtomic) - NATIVE_GAS_RESERVE_ATOMIC
        : BigInt(inputBalanceAtomic);
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
            message: cause instanceof Error ? cause.message : "Live routes are temporarily unavailable."
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
    draft.intent,
    executionRecord?.state,
    identity.authenticated,
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
      || (winningQuote.provider !== "uniswap-v3" && winningQuote.provider !== "up-v2" && winningQuote.provider !== "up-cl")
      || !winningQuote.protectedOutputAtomic
    ) throw new Error("No observed route is supported by a strict verifier yet.");
    const expected = {
      quoteRequestId: quoteResponse.requestId,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      provider: winningQuote.provider,
      protectedOutputFloorAtomic: winningQuote.protectedOutputAtomic,
      recipient: address
    };
    const response = await requestTradeQuote("/api/vnext/verify", {
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      quoteRequestId: quoteResponse.requestId,
      provider: winningQuote.provider,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic: draft.intent.amountAtomic,
      protectedOutputFloorAtomic: winningQuote.protectedOutputAtomic,
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
      indicativeProtectedOutputFloorAtomic: evidence.indicativeProtectedOutputFloorAtomic,
      expectedProtectedOutputAtomic: evidence.protectedOutputAtomic,
      ...(evidence.feeExecution ? { executionId: evidence.feeExecution.executionId } : {})
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
    backgroundQuoteEpoch.current += 1;
    const cachedQuoteForTrade = cachedVNextQuoteForRequest(lastReadyQuote.current, requestKey);
    const reusableQuote = isVNextQuoteReusableForTrade(cachedQuoteForTrade, Date.now())
      ? cachedQuoteForTrade
      : undefined;
    let stage: "quote" | "verification" | "authorization" = "quote";
    setPostExecutionState({ state: "idle" });
    setQuoteState(reusableQuote ? { state: "ready", response: reusableQuote } : { state: "loading" });
    setVerificationState({ state: "loading" });
    setAuthorizationState({ state: authorizationEnabled ? "loading" : "idle" });
    try {
      if (!reusableQuote) clearTradeQuoteCache();
      const freshQuote = reusableQuote ?? await requestLiveRoutes();
      lastReadyQuote.current = { requestKey, response: freshQuote };
      setQuoteState({ state: "ready", response: freshQuote });
      stage = "verification";
      const freshEvidence = await requestStrictVerification(freshQuote);
      lastReadyVerification.current = freshEvidence;
      setVerificationState({ state: "ready", evidence: freshEvidence });
      if (!["verified", "approval_required"].includes(freshEvidence.status)) {
        setAuthorizationState({
          state: "error",
          message: freshEvidence.status === "insufficient_balance"
          ? "Your confirmed balance is insufficient for this trade."
          : freshEvidence.status === "insufficient_gas"
            ? "Add ETH for network gas before trading."
            : "The exact route did not pass final execution checks."
        });
        return;
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
    backgroundQuoteEpoch.current += 1;
    setPostExecutionState({ state: "refreshing", message: "Approval confirmed. RMT is refreshing and verifying the swap automatically…" });
    setQuoteState({ state: "loading" });
    setVerificationState({ state: "loading" });
    setAuthorizationState({ state: "loading" });
    clearTradeQuoteCache();
    try {
      const freshQuote = await requestLiveRoutes();
      lastReadyQuote.current = { requestKey, response: freshQuote };
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
    if (!identity.authenticated || !address || identity.activeWalletKind !== "external" || !draft.intent || !pendingTradeAfterLogin.current) return;
    pendingTradeAfterLogin.current = false;
    void startTrade();
  }, [address, draft.intent, identity.activeWalletKind, identity.authenticated]);

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
  const expectedOutputLabel = expectedOutput
    ? `${expectedOutput} ${outputSymbol}`
    : !draft.intent
      ? "Enter trade amount"
      : quoteState.state === "error"
        ? "Route temporarily unavailable"
        : "Finding best route…";
  const routeStatusLabel = visibleVerification
    ? verificationLabel
    : visibleQuote
      ? "Routes compared"
      : quoteState.state === "error"
        ? "Route unavailable"
        : draft.intent
          ? "Finding route"
          : "Not ready";
  const flowBusy = verificationState.state === "loading"
    || authorizationState.state === "loading"
    || postExecutionState.state === "refreshing";
  const walletPlanActive = authorizationState.state === "ready";
  const transactionPending = executionRecord?.state === "submitted";
  const triggerPrimaryAction = () => {
    if (!identity.enabled) return;
    if (!identity.authenticated || !address || identity.activeWalletKind !== "external") {
      pendingTradeAfterLogin.current = true;
      identity.connectTradingWallet();
      return;
    }
    void startTrade();
  };
  const continueTrading = () => {
    backgroundQuoteEpoch.current += 1;
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
    <aside className="vnTradePanel" id="vnext-trade-ticket" aria-labelledby="vn-trade-heading">
      <div className="vnTradeHeader">
        <div><span className="vnEyebrow">Trade</span><h2 id="vn-trade-heading">{marketSymbol === "—" ? "Select an asset" : `Trade ${marketSymbol}`}</h2><small>{marketName}</small></div>
        <span className="vnFixtureBadge">{authorizationEnabled ? "Live trading" : "Preview mode"}</span>
      </div>
      <div className="vnSideTabs" role="tablist" aria-label="Trade side">
        <button className={side === "buy" ? "isActive" : ""} onClick={() => chooseSide("buy")} type="button" role="tab" aria-selected={side === "buy"}>Buy</button>
        <button className={side === "sell" ? "isActive" : ""} onClick={() => chooseSide("sell")} type="button" role="tab" aria-selected={side === "sell"}>Sell</button>
      </div>
      <div className="vnAvailableLine"><span>{side === "buy" ? "Pay with" : "Receive"}</span><strong>{pair ? `${inputSymbol} → ${outputSymbol}` : "Verified pair required"}</strong></div>
      <label className="vnAmountField">
        <span>{side === "buy" ? "You pay" : "You sell"}</span>
        <div><input inputMode="decimal" value={amount} onChange={(event) => {
          autoFitBuyAmount.current = false;
          setAmount(event.target.value);
        }} aria-label="Exact input amount" placeholder="0" />
          {side === "buy" ? <select
            aria-label="Pay with asset"
            value={selectedBuyInput ? assetKey(selectedBuyInput.id) : ""}
            disabled={displayedBuyInputs.length < 2}
            onChange={(event) => {
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
        <span><small>Available</small><strong>{availableDisplay ? `${availableDisplay} ${inputSymbol}` : isConnected ? "Not detected" : "Wallet required"}</strong></span>
        <div aria-label="Confirmed balance percentages">
          {[2_500, 5_000, 7_500, 10_000].map((basisPoints) => <button
            type="button"
            key={basisPoints}
            disabled={!inputBalanceAtomic}
            onClick={() => useBalancePercentage(basisPoints)}
          >{basisPoints === 10_000 ? "Max" : `${basisPoints / 100}%`}</button>)}
        </div>
      </div>
      {side === "buy" && inputSymbol === "USDG" ? (
        <div className="vnQuickAmounts">
          {["25", "50", "100", "250"].map((preset) => {
            const exceedsBalance = Boolean(
              inputBalanceAtomic
              && pairInputDecimals !== null
              && parseUnits(preset, pairInputDecimals) > BigInt(inputBalanceAtomic)
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
            onChange={(event) => setSellOutputKey(event.target.value)}
          >
            {sellOutputs.map((asset) => <option value={assetKey(asset.id)} key={assetKey(asset.id)}>{asset.id.locator.kind === "native" ? "ETH (native)" : asset.symbol ?? "Asset"}</option>)}
          </select> : <button type="button" disabled>{outputSymbol}</button>}
        </div>
        <div className="vnOutputProtection"><span>Protected minimum</span><strong>{protectedOutput ? `${protectedOutput} ${outputSymbol}` : "Set when you trade"}</strong></div>
        <small>{protectedOutput ? `Best observed: ${bestQuote?.providerLabel}. Quotes update quietly; RMT verifies the executable route when you trade.` : "RMT sets and verifies the protected minimum during the one-tap execution check."}</small>
      </div>
      <button
        className="vnReviewButton"
        type="button"
        disabled={flowBusy || walletPlanActive || transactionPending || amountExceedsBalance || !identity.enabled || !identity.ready || Boolean(identity.authenticated && address && identity.activeWalletKind === "external" && !draft.intent)}
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
            : !address || identity.activeWalletKind !== "external"
              ? `${side === "buy" ? "Connect & buy" : "Connect & sell"} ${marketSymbol}`
            : !identity.authenticated
              ? `${side === "buy" ? "Connect & buy" : "Connect & sell"} ${marketSymbol}`
              : `${authorizationEnabled ? "" : "Preview "}${side === "buy" ? "Buy" : "Sell"} ${marketSymbol}`}</button>
      <p className="vnTradeSafety">{identity.enabled
        ? "One tap checks the best route and opens the final wallet confirmation."
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
        <summary className="vnRouteTop"><span><i aria-hidden="true" /> Advanced details</span><strong>{routeStatusLabel}</strong></summary>
        <div className="vnRouteDetails">
        <dl className="vnIntentSummary">
          <div><dt>Input</dt><dd>{inputSymbol}</dd></div>
          <div><dt>Output</dt><dd>{outputSymbol}</dd></div>
          <div><dt>Recipient</dt><dd>{address ? shortAddress(address) : "Wallet required"}</dd></div>
          <div><dt>Trade type</dt><dd>Exact input</dd></div>
        </dl>
        <p className="vnIntentStatus">{quoteState.state === "error" ? quoteState.message : draft.message}</p>
        {address && pair ? <p className={`vnBalanceEvidence${amountExceedsBalance ? " isBlocking" : ""}`}>{amountExceedsBalance
          ? `Amount exceeds the confirmed ${inputSymbol} balance. Authorization must remain blocked.`
          : inputBalanceAtomic
            ? `Confirmed ${inputSymbol} balance is the source for percentage and Max controls.`
            : `Confirmed ${inputSymbol} balance is not detected. Percentage controls remain disabled.`}</p> : null}
        {visibleQuote ? <div className="vnQuoteAttempts">
          {visibleQuote.attempts.map((attempt) => (
            <div className={attempt.status === "indicative" ? "isReady" : ""} key={attempt.provider}>
              <span><strong>{attempt.providerLabel}</strong><small>{attempt.executionKind === "rfq_intent" ? "Intent" : attempt.executionKind === "gasless" ? "Gasless" : attempt.executionKind === "aggregator" ? "Aggregator" : "Direct AMM"} · {attempt.userPaysGas === null ? "gas unknown" : attempt.userPaysGas ? "wallet gas" : "filler pays gas"} · {attempt.latencyMs}ms</small></span>
              <span><strong>{attempt.status === "indicative" && attempt.outputDecimals !== null ? `${formatAtomicDisplay(attempt.protectedOutputAtomic!, attempt.outputDecimals)} ${outputSymbol}` : attempt.status === "no_route" ? "No route" : attempt.status === "invalid_response" ? "Rejected" : "Unavailable"}</strong><small>{attempt.status === "indicative"
                ? attempt.provider === bestQuote?.provider
                  ? "Highest before network fee · indicative floor"
                  : routeSelection.usesVerifiedBackup && attempt.provider === verificationQuote?.provider
                    ? "Strict-verification backup · indicative floor"
                    : "Indicative floor"
                : attempt.detail}</small></span>
            </div>
          ))}
        </div> : <dl>
          <div><dt>Providers</dt><dd>Not requested</dd></div>
          <div><dt>Trader gas</dt><dd>Unknown until executable route</dd></div>
          <div><dt>RMT fee</dt><dd>{bestRmtFeeLabel}</dd></div>
        </dl>}
        {visibleQuote ? <dl>
          <div><dt>Ranking basis</dt><dd>Protected output before network fee</dd></div>
          <div><dt>Trader gas</dt><dd>{visibleQuote.attempts.some((attempt) => attempt.userPaysGas === false) ? "Route-specific · sponsored option observed" : "Estimated during strict verification"}</dd></div>
          <div><dt>Provider fee</dt><dd>{visibleQuote.attempts.some((attempt) => attempt.providerFeeAtomic !== null) ? "Disclosed by provider and reflected in output" : "Not separately reported"}</dd></div>
          <div><dt>RMT fee</dt><dd>{bestRmtFeeLabel}</dd></div>
        </dl> : null}
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
              <div><dt>Quote continuity</dt><dd>{describeProtectedOutputContinuity(visibleVerification.protectedOutputAtomic, visibleVerification.indicativeProtectedOutputFloorAtomic)}</dd></div>
              <div><dt>Simulation</dt><dd>{visibleVerification.exactSimulationPassed ? "Passed" : "Not passed"}</dd></div>
              <div><dt>Next action</dt><dd>{visibleVerification.nextAction === "approval" ? "Exact approval" : visibleVerification.nextAction === "swap" ? "Verified swap" : "Blocked"}</dd></div>
              <div><dt>Gas</dt><dd>{visibleVerification.gasState}</dd></div>
              <div><dt>Gas reserve</dt><dd>{visibleVerification.estimatedNetworkCostWei ? `${formatAtomicDisplay(visibleVerification.estimatedNetworkCostWei, 18)} ETH` : "Unavailable"}</dd></div>
              <div><dt>Gas reserve value</dt><dd>{freshVerifiedNetworkCostUsdgAtomic ? `${formatAtomicDisplay(freshVerifiedNetworkCostUsdgAtomic, 6)} USDG equivalent` : "Unavailable"}</dd></div>
              {verifiedUsdgOutcome?.kind === "buy_cost_ceiling" ? <div><dt>Trade + gas ceiling</dt><dd>{formatAtomicDisplay(verifiedUsdgOutcome.totalCostUsdgAtomic, 6)} USDG equivalent</dd></div> : null}
              {verifiedUsdgOutcome?.kind === "sell_proceeds_after_gas" ? <div><dt>Protected after gas</dt><dd>{verifiedUsdgOutcome.gasExceedsProtectedProceeds ? "Gas exceeds protected proceeds" : `${formatAtomicDisplay(verifiedUsdgOutcome.proceedsAfterGasUsdgAtomic, 6)} USDG equivalent`}</dd></div> : null}
              <div><dt>RMT fee</dt><dd>{verifiedRmtFeeLabel}</dd></div>
              {visibleVerification.feeExecution ? <div><dt>Fee treasury</dt><dd>{shortAddress(visibleVerification.feeExecution.treasury)}</dd></div> : null}
              {visibleVerification.feeExecution ? <div><dt>Settlement</dt><dd>Atomic with swap · policy v{visibleVerification.feeExecution.policyVersion}</dd></div> : null}
              <div><dt>Calldata</dt><dd>{shortAddress(visibleVerification.calldataHash)}</dd></div>
            </dl>
            {visibleVerification.status === "insufficient_gas" ? <div className="vnGasRecovery" role="status">
              <span><strong>Robinhood ETH is required only for network gas</strong><small>Add it to the exact active wallet, then press Buy or Sell once. RMT will quietly recheck the route, balance, and gas reserve.</small></span>
              <FundWalletButton directReceive variant="inline" label="Add Robinhood ETH" />
            </div> : null}
            {authorizationState.state === "error" ? <p className="vnAuthorizationError" role="status">{authorizationState.message}</p> : null}
            {authorizationState.state === "ready" ? <div className="vnAuthorizationPlan" role="status">
              <span><strong>{authorizationState.plan.kind === "erc20_approval" ? "Exact token approval prepared" : "Verified swap prepared"}</strong><small>RMT is opening the exact request in your wallet automatically.</small></span>
              <dl>
                <div><dt>Target</dt><dd>{shortAddress(authorizationState.plan.target)}</dd></div>
                <div><dt>Gas limit</dt><dd>{BigInt(authorizationState.plan.gasLimit).toLocaleString()}</dd></div>
                <div><dt>Payload</dt><dd>{shortAddress(authorizationState.plan.payloadHash)}</dd></div>
                <div><dt>Expires</dt><dd>{new Date(authorizationState.plan.expiresAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</dd></div>
              </dl>
              <VNextWalletReview
                autoRequest
                key={authorizationState.plan.planId}
                plan={authorizationState.plan}
                evidence={visibleVerification}
                inputSymbol={inputSymbol}
                outputSymbol={outputSymbol}
                inputDecimals={pair?.inputAsset.decimals ?? 18}
                outputDecimals={pair?.outputAsset.decimals ?? 18}
              />
            </div> : null}
          </div> : null}
        </div> : null}
        </div>
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
              <div><dt>{side === "buy" ? "Asset received" : "Proceeds"}</dt><dd>{confirmedOutputDisplay ? `${confirmedOutputDisplay} ${outputSymbol}` : `${outputSymbol} · confirmed onchain`}</dd></div>
              {executionRecord.feeSettlement?.actualFeeAtomic !== undefined ? <div><dt>RMT fee settled</dt><dd>{formatAtomicDisplay(
                executionRecord.feeSettlement.actualFeeAtomic,
                executionRecord.feeSettlement.feeSide === "input" ? pair?.inputAsset.decimals ?? 18 : pair?.outputAsset.decimals ?? 18
              )} {executionRecord.feeSettlement.feeSide === "input" ? inputSymbol : outputSymbol}</dd></div> : null}
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
