"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import {
  useAccount,
  useBalance,
  useReadContract,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract
} from "wagmi";
import type { ExternalMarket } from "../lib/external-market";
import {
  publicSushiDeadlineGuardAddress,
  type SushiExecutableQuote,
  type SushiIndicativeQuote
} from "../lib/sushi";
import {
  PRICE_IMPACT_CAUTION,
  conservativeNetworkFeeReserve,
  saferTradeAmount,
  spendableTradeBalance
} from "../lib/trade-ticket";
import { useTradeFeeEstimate } from "../lib/use-trade-fee-estimate";
import { classifyTradeExecutionError } from "../lib/trade-execution-reliability";
import { useTradeExecutionRecovery } from "../lib/use-trade-execution-recovery";
import { useTradeQuoteFreshness } from "../lib/use-trade-quote-freshness";
import { useTokenRiskEvidence } from "../lib/use-token-risk-evidence";
import { tokenRiskDecision } from "../lib/token-risk-policy";
import { useTradingTermsAcceptance } from "../lib/use-trading-terms";
import { useTradePreferences } from "../lib/use-trade-preferences";
import {
  TradeConfidence,
  tradeRequiresAcknowledgement
} from "./trade-confidence";
import {
  FinalOrderReview,
  QuoteProtection,
  SmartOrderGuard,
  TradeCostSummary,
  TradeAmountPresets,
  TradeExecutionPath,
  TradeOrderDetails,
  TradePreSignReadiness,
  type TradeQuoteState
} from "./trade-ticket-ui";
import { WalletButton } from "./wallet-button";
import { recordExperienceStage } from "../lib/experience-funnel";
import { requestTradeQuote } from "../lib/trade-quote-client";
import { quoteDebounceMs, quoteRefreshMs } from "../lib/trade-speed";
import { isTradePreflightReady } from "../lib/trade-preflight";
import { useRmtIdentity } from "./rmt-identity";
import {
  confirmedBuyProtectionSnapshot,
  type ConfirmedBuyProtectionSnapshot
} from "../lib/confirmed-buy-protection";
import { PostTradeProtection, TradeProtectionIntent } from "./post-trade-protection";
import { useAfterBuyProtection } from "../lib/use-after-buy-protection";
import type { AfterBuyProtectionSettings } from "../lib/after-buy-protection";
import { TradeExecutionStatus, TradePreflightFailure } from "./trade-execution-status";

const ROBINHOOD_CHAIN_ID = 4663;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const NETWORK_FEE_RESERVE = parseEther("0.00002");
const SUSHI_DEADLINE_GUARD = publicSushiDeadlineGuardAddress();

type ExternalSushiQuote = (SushiExecutableQuote | SushiIndicativeQuote) & {
  marketPair: Address;
  marketVerified: true;
  approvalRequired: boolean;
  approvalSpender: Address;
  quoteExpiresAt: string;
  authorization: {
    status: "identity-wallet-bound";
    wallet: Address;
  };
};

function cleanDecimal(value: string, maximumDecimals = 18) {
  const normalized = value.replace(/[^\d.]/g, "");
  const [rawWhole = "", ...fractionParts] = normalized.split(".");
  const hasDecimal = fractionParts.length > 0;
  const whole = rawWhole.replace(/^0+(?=\d)/, "").slice(0, 78) || (hasDecimal ? "0" : "");
  if (!hasDecimal) return whole;
  return `${whole}.${fractionParts.join("").slice(0, maximumDecimals)}`;
}

function displayUnits(value: string, decimals: number, maximumFractionDigits = 6) {
  const formatted = formatUnits(BigInt(value), decimals);
  const numeric = Number(formatted);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits })
    : formatted;
}

function verifiedPreparedSushiQuote(value: unknown, expected: {
  token: Address;
  pair: Address;
  recipient: Address;
  side: "buy" | "sell";
  amountIn: bigint;
}) {
  if (!value || typeof value !== "object") throw new Error("RMT rejected an incomplete Sushi response.");
  const payload = value as ExternalSushiQuote;
  const executionReady = payload.executable === true
    && "router" in payload
    && SUSHI_DEADLINE_GUARD !== undefined
    && payload.router.toLowerCase() === SUSHI_DEADLINE_GUARD.toLowerCase()
    && payload.onchainDeadline === true
    && "calldata" in payload
    && payload.calldata.startsWith("0x");
  const approvalReady = payload.executable === false
    && payload.approvalRequired === true
    && payload.side === "sell";
  if (
    payload.marketVerified !== true
    || payload.verifiedInput !== true
    || (!executionReady && !approvalReady)
    || payload.venue !== "sushi-aggregator"
    || payload.chainId !== ROBINHOOD_CHAIN_ID
    || payload.token?.toLowerCase() !== expected.token.toLowerCase()
    || payload.recipient?.toLowerCase() !== expected.recipient.toLowerCase()
    || payload.authorization?.status !== "identity-wallet-bound"
    || payload.authorization.wallet.toLowerCase() !== expected.recipient.toLowerCase()
    || payload.marketPair?.toLowerCase() !== expected.pair.toLowerCase()
    || payload.side !== expected.side
    || payload.amountIn !== expected.amountIn.toString()
    || SUSHI_DEADLINE_GUARD === undefined
    || payload.approvalSpender?.toLowerCase() !== SUSHI_DEADLINE_GUARD.toLowerCase()
    || !/^\d+$/.test(payload.quoteExpiresAt ?? "")
    || BigInt(payload.quoteExpiresAt) <= BigInt(Math.floor(Date.now() / 1000) + 15)
    || !payload.inputToken
    || !payload.outputToken
  ) throw new Error("RMT rejected an inconsistent Sushi quote.");
  return payload;
}

export function ExternalSushiQuotePanel({
  market,
  side,
  amount: controlledAmount,
  onAmountChange,
  onSwapConfirmed,
  preparedQuote
}: {
  market: ExternalMarket;
  side: "buy" | "sell";
  amount?: string;
  onAmountChange?: (value: string) => void;
  onSwapConfirmed?: () => void;
  preparedQuote?: unknown;
}) {
  const { preferences } = useTradePreferences();
  const identity = useRmtIdentity();
  const afterBuyProtection = useAfterBuyProtection();
  const maxPriceImpact = preferences.maxPriceImpactBps / 10_000;
  const { address, chainId, isConnected } = useAccount();
  const tokenRisk = useTokenRiskEvidence(market);
  const tradingTerms = useTradingTermsAcceptance();
  const [internalAmount, setInternalAmount] = useState(side === "buy" ? "0.0001" : "");
  const [quote, setQuote] = useState<ExternalSushiQuote>();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [saferOrderOriginal, setSaferOrderOriginal] = useState<bigint>();
  const [confirmedBuy, setConfirmedBuy] = useState<ConfirmedBuyProtectionSnapshot>();
  const [confirmedBuyProtectionSettings, setConfirmedBuyProtectionSettings] = useState<AfterBuyProtectionSettings>();
  const quoteRequestKey = useRef("");
  const pendingBuy = useRef<{ beforeBalance?: bigint; amountInWei: bigint; ethUsd?: number; protectionSettings: AfterBuyProtectionSettings } | undefined>(undefined);
  const handledSwap = useRef<string | undefined>(undefined);
  const token = market.address as Address;
  const pair = market.pairAddress as Address;
  const tokenDecimals = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_ID,
    query: { retry: false }
  });
  const tokenBalance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_ID,
    query: { enabled: Boolean(address), retry: false, refetchInterval: 15_000 }
  });
  const nativeBalance = useBalance({
    address,
    chainId: ROBINHOOD_CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 10_000 }
  });
  const allowance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && SUSHI_DEADLINE_GUARD ? [address, SUSHI_DEADLINE_GUARD] : undefined,
    chainId: ROBINHOOD_CHAIN_ID,
    query: { enabled: Boolean(address && SUSHI_DEADLINE_GUARD && side === "sell"), retry: false, refetchInterval: 10_000 }
  });
  const approval = useWriteContract();
  const approvalReceipt = useWaitForTransactionReceipt({ hash: approval.data, chainId: ROBINHOOD_CHAIN_ID, confirmations: 1 });
  const swap = useSendTransaction();
  const decimals = tokenDecimals.data;
  const amount = controlledAmount ?? internalAmount;
  const setAmount = (value: string, preserveSaferOrder = false) => {
    if (!preserveSaferOrder) setSaferOrderOriginal(undefined);
    if (controlledAmount === undefined) setInternalAmount(value);
    onAmountChange?.(value);
  };

  const amountIn = useMemo(() => {
    if (!amount || !address) return 0n;
    try {
      if (side === "buy") return parseEther(amount);
      if (decimals === undefined) return 0n;
      return parseUnits(amount, decimals);
    } catch {
      return 0n;
    }
  }, [address, amount, decimals, side]);
  const execution = useTradeExecutionRecovery({
    wallet: address,
    token,
    pair,
    venue: "sushi",
    side,
    amountIn,
    submittedHash: swap.data
  });
  const swapReceipt = useWaitForTransactionReceipt({
    hash: execution.trackedHash,
    chainId: ROBINHOOD_CHAIN_ID,
    confirmations: 1
  });
  const approvalConfirmed = approvalReceipt.isSuccess && approvalReceipt.data?.status === "success";
  const approvalReverted = approvalReceipt.isSuccess && approvalReceipt.data?.status === "reverted";
  const swapConfirmed = swapReceipt.isSuccess && swapReceipt.data?.status === "success";
  const swapReverted = swapReceipt.isSuccess && swapReceipt.data?.status === "reverted";

  useEffect(() => {
    if (controlledAmount === undefined) setInternalAmount(side === "buy" ? "0.0001" : "");
    setQuote(undefined);
    setError("");
    setMessage("");
    setStatus("idle");
    setSaferOrderOriginal(undefined);
    setConfirmedBuy(undefined);
    setConfirmedBuyProtectionSettings(undefined);
    pendingBuy.current = undefined;
    handledSwap.current = undefined;
    approval.reset();
    swap.reset();
  }, [market.address, side]);

  useEffect(() => {
    const interval = window.setInterval(
      () => setRefresh((value) => value + 1),
      quoteRefreshMs(preferences.preparationMode)
    );
    return () => window.clearInterval(interval);
  }, [preferences.preparationMode]);

  useEffect(() => {
    const nextRequestKey = `${identity.userId}:${address ?? ""}:${amountIn}:${side}:${token}:${pair}:${preferences.maxPriceImpactBps}`;
    const requestChanged = quoteRequestKey.current !== nextRequestKey;
    quoteRequestKey.current = nextRequestKey;
    if (requestChanged) setQuote(undefined);
    setError("");
    if (!identity.ready || !identity.authenticated || !identity.identityToken || !identity.userId || !address || amountIn <= 0n || (side === "sell" && decimals === undefined)) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    if (preparedQuote) {
      try {
        setQuote(verifiedPreparedSushiQuote(preparedQuote, {
          token,
          pair,
          recipient: address,
          side,
          amountIn
        }));
        setStatus("idle");
        return;
      } catch (cause) {
        setQuote(undefined);
        setStatus("loading");
        setError(cause instanceof Error ? cause.message : "Refreshing the selected Sushi route.");
      }
    }
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void requestTradeQuote("/api/trade/external-sushi-quote", {
        token,
        pair,
        recipient: address,
        side,
        amountIn: amountIn.toString(),
        maxPriceImpactBps: 10_000
      }, {
        identityScope: identity.userId,
        identityToken: identity.identityToken
      }).then((response) => {
        const payload = response.payload as ExternalSushiQuote | { error?: string };
        if (!response.ok) throw new Error("error" in payload ? payload.error : "Sushi quote is unavailable.");
        const verified = verifiedPreparedSushiQuote(payload, {
          token,
          pair,
          recipient: address,
          side,
          amountIn
        });
        if (!cancelled) {
          setQuote(verified);
          setStatus("idle");
        }
      }).catch((cause) => {
        if (cancelled) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Sushi quote is unavailable.");
      });
    }, quoteDebounceMs(preferences.preparationMode));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [address, amountIn, decimals, identity.authenticated, identity.identityToken, identity.ready, identity.userId, pair, preferences.preparationMode, preparedQuote, refresh, side, token]);

  useEffect(() => {
    if (approvalConfirmed) {
      setMessage("Exact sell approval confirmed. Review and submit the swap next.");
      void allowance.refetch();
      setRefresh((value) => value + 1);
      return;
    }
    if (approvalReverted) execution.fail("Exact sell approval transaction reverted onchain.");
  }, [approvalConfirmed, approvalReverted]);

  useEffect(() => {
    if (swapReverted) {
      execution.fail("Sushi swap receipt status reverted onchain.");
      setQuote(undefined);
      setRefresh((value) => value + 1);
      return;
    }
    if (!swapConfirmed || !execution.trackedHash) return;
    execution.confirm();
    setMessage("Sushi swap confirmed on Robinhood Chain.");
    if (handledSwap.current === execution.trackedHash) return;
    handledSwap.current = execution.trackedHash;
    onSwapConfirmed?.();
    void Promise.all([tokenBalance.refetch(), nativeBalance.refetch(), allowance.refetch()])
      .then(([refreshedToken]) => {
        const pending = pendingBuy.current;
        if (side !== "buy" || !pending || pending.beforeBalance === undefined || refreshedToken.data === undefined || decimals === undefined) return;
        const snapshot = confirmedBuyProtectionSnapshot({
          beforeBalance: pending.beforeBalance,
          afterBalance: refreshedToken.data,
          tokenDecimals: decimals,
          amountInWei: pending.amountInWei,
          ethUsd: pending.ethUsd,
          marketPriceUsd: market.priceUsd
        });
        if (snapshot) {
          setConfirmedBuy(snapshot);
          setConfirmedBuyProtectionSettings(pending.protectionSettings);
        }
      });
  }, [swapConfirmed, swapReverted, execution.trackedHash]);

  useEffect(() => {
    if (approval.error) execution.fail(approval.error);
  }, [approval.error]);

  useEffect(() => {
    if (swap.error) execution.fail(swap.error);
  }, [swap.error]);

  useEffect(() => {
    if (swapReceipt.error && execution.trackedHash) execution.holdForReconciliation(swapReceipt.error);
  }, [swapReceipt.error, execution.trackedHash]);

  const outputDecimals = quote?.outputToken?.decimals;
  const outputSymbol = quote?.outputToken?.symbol ?? (side === "buy" ? market.symbol : "ETH");
  const quoteFreshness = useTradeQuoteFreshness({
    deadline: quote?.quoteExpiresAt,
    bufferSeconds: 15,
    enabled: Boolean(quote && quote.amountIn === amountIn.toString()),
    onRefreshNeeded: () => {
      setQuote(undefined);
      setStatus("loading");
      setRefresh((value) => value + 1);
    }
  });
  const quoteIsFresh = Boolean(
    quote
    && quote.amountIn === amountIn.toString()
    && quoteFreshness.isFresh
  );
  useEffect(() => {
    if (quoteIsFresh) recordExperienceStage("quote_ready");
  }, [quoteIsFresh]);
  const needsApproval = Boolean(
    SUSHI_DEADLINE_GUARD
    && side === "sell"
    && amountIn > 0n
    && (allowance.data ?? 0n) < amountIn
  );
  const approvalCalldata = useMemo(() => {
    if (!needsApproval || !SUSHI_DEADLINE_GUARD) return undefined;
    return encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [SUSHI_DEADLINE_GUARD, amountIn]
      });
  }, [amountIn, needsApproval]);
  const executableRouter = quote?.executable === true ? quote.router : undefined;
  const executableCalldata = quote?.executable === true ? quote.calldata : undefined;
  const executableValue = quote?.executable === true ? BigInt(quote.value) : 0n;
  const feeEstimate = useTradeFeeEstimate({
    account: address,
    to: needsApproval ? token : executableRouter,
    data: needsApproval ? approvalCalldata : executableCalldata,
    value: needsApproval ? 0n : executableValue,
    enabled: Boolean(
      address
      && chainId === ROBINHOOD_CHAIN_ID
      && amountIn > 0n
      && (needsApproval || quoteIsFresh)
    )
  });
  const networkFeeReserve = conservativeNetworkFeeReserve(feeEstimate.feeWei, NETWORK_FEE_RESERVE);
  const insufficient = side === "buy"
    ? amountIn > 0n && amountIn + networkFeeReserve > (nativeBalance.data?.value ?? 0n)
    : amountIn > 0n && amountIn > (tokenBalance.data ?? 0n);
  const approvalConfirmationUnavailable = Boolean(approval.data && approvalReceipt.error);
  const busy = approval.isPending || approvalReceipt.isLoading || swap.isPending || swapReceipt.isLoading
    || execution.unresolved || approvalConfirmationUnavailable;
  const preflightReady = isTradePreflightReady(feeEstimate);
  const preflightFailure = feeEstimate.status === "unavailable" ? feeEstimate.failure : undefined;
  const requiresAcknowledgement = tradeRequiresAcknowledgement(market, side);
  const evidenceDecision = tokenRiskDecision(tokenRisk, side);
  const confidenceEvidenceReady = side === "sell" || tokenRisk.status !== "loading";
  const confidenceReady = !requiresAcknowledgement || tradingTerms.accepted;
  const accountReady = identity.ready && identity.authenticated && Boolean(identity.identityToken && identity.userId);
  const impactBlocked = Boolean(quote && quote.priceImpact > maxPriceImpact);
  const sizingBalance = side === "buy"
    ? nativeBalance.data ? spendableTradeBalance(nativeBalance.data.value, networkFeeReserve) : undefined
    : tokenBalance.data;
  const sizingDecimals = side === "buy" ? 18 : decimals;
  const maximumInputDecimals = sizingDecimals ?? 18;
  const saferAmountIn = saferTradeAmount(amountIn, quote?.priceImpact, PRICE_IMPACT_CAUTION);
  const canReduceImpact = saferAmountIn > 0n && saferAmountIn < amountIn && sizingDecimals !== undefined;
  const chooseSaferAmount = () => {
    if (!canReduceImpact || sizingDecimals === undefined) return;
    setSaferOrderOriginal(amountIn);
    setAmount(cleanDecimal(formatUnits(saferAmountIn, sizingDecimals), sizingDecimals), true);
  };

  const submit = () => {
    setMessage("");
    execution.clearFailure();
    if (execution.unresolved || approvalConfirmationUnavailable) return;
    if (!quoteIsFresh) {
      setMessage("The protected Sushi quote expired before wallet review. RMT is requesting a fresh route.");
      setQuote(undefined);
      setStatus("loading");
      setRefresh((value) => value + 1);
      return;
    }
    if (!accountReady || !address || !SUSHI_DEADLINE_GUARD || chainId !== ROBINHOOD_CHAIN_ID || !quote || insufficient || busy || !confidenceReady || !preflightReady) return;
    recordExperienceStage("wallet_review_started");
    if (needsApproval) {
      approval.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [SUSHI_DEADLINE_GUARD, amountIn],
        chainId: ROBINHOOD_CHAIN_ID
      });
      return;
    }
    if (quote.executable !== true || !("router" in quote) || !("calldata" in quote)) return;
    if (side === "buy") {
      pendingBuy.current = {
        beforeBalance: tokenBalance.data,
        amountInWei: amountIn,
        ethUsd: feeEstimate.ethUsd,
        protectionSettings: { ...afterBuyProtection.settings }
      };
    }
    swap.sendTransaction({
      account: address,
      chainId: ROBINHOOD_CHAIN_ID,
      to: quote.router,
      data: quote.calldata,
      value: BigInt(quote.value)
    });
  };

  const quoteState: TradeQuoteState = amountIn <= 0n
    ? "enter"
    : status === "error" && !quote
      ? "error"
      : status === "loading" && quoteIsFresh
        ? "refreshing"
        : status === "loading" || !quoteIsFresh
          ? "checking"
          : "ready";
  const buttonLabel = execution.unresolved
    ? "Sushi transaction pending — do not resubmit"
    : approvalConfirmationUnavailable
      ? "Approval status unknown — check chain"
      : busy
        ? approval.isPending || approvalReceipt.isLoading ? "Confirming exact approval…" : "Confirming Sushi swap…"
        : amountIn <= 0n ? "Enter an amount"
          : !accountReady ? "Sign in to protect this trade"
          : status === "error" && !quote ? "Quote unavailable"
          : !quoteIsFresh ? "Verifying route…"
          : insufficient ? "Insufficient balance"
          : !confidenceReady ? "Accept RMT trading terms"
            : feeEstimate.status === "unavailable" ? "Preflight failed — trade blocked"
                : !preflightReady ? "Simulating exact transaction…"
              : needsApproval ? `Approve exact ${market.symbol} amount`
                : side === "buy" ? `Buy ${market.symbol} with Sushi` : `Sell ${market.symbol} with Sushi`;

  return (
    <section className="externalSushiQuote" aria-labelledby="external-sushi-quote-heading">
      <header>
        <div>
          <small>UNIVERSAL ROUTER · SUSHI SELECTED</small>
          <strong id="external-sushi-quote-heading">Review one RMT order</strong>
        </div>
        <span>1% · simulated</span>
      </header>

      {!address ? (
        <div className="externalSushiConnect">
          <p>Connect a wallet to calculate a route for your exact trade. RMT never takes custody.</p>
          <WalletButton target="mainnet" showFunding={false} />
        </div>
      ) : !accountReady ? (
        <div className="externalSushiConnect">
          <p>Sign in once so RMT can bind quotes to your account and selected wallet. Your wallet still signs every approval and swap.</p>
          <button className="tradeIdentitySignIn" type="button" onClick={identity.login}>Sign in to protect trading</button>
        </div>
      ) : (
        <>
          <label className="externalSushiAmount">
            <span>
              <small>You {side === "buy" ? "pay" : "sell"}</small>
              <em>
                Balance {side === "buy"
                  ? nativeBalance.data ? Number(formatEther(nativeBalance.data.value)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"
                  : tokenBalance.data !== undefined && decimals !== undefined
                    ? displayUnits(tokenBalance.data.toString(), decimals, 4)
                    : "—"} {side === "buy" ? "ETH" : market.symbol}
              </em>
            </span>
            <div>
              <input
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                spellCheck={false}
                value={amount}
                placeholder="0.0"
                aria-label={`${side === "buy" ? "ETH" : market.symbol} amount`}
                onFocus={() => recordExperienceStage("trade_preparation_opened")}
                onChange={(event) => setAmount(cleanDecimal(event.target.value, maximumInputDecimals))}
              />
              <strong>{side === "buy" ? "ETH" : market.symbol}</strong>
            </div>
          </label>
          <TradeAmountPresets side={side} balance={sizingBalance} decimals={sizingDecimals} onAmount={setAmount} />

          {chainId !== ROBINHOOD_CHAIN_ID && (
            <div className="externalSushiNetwork">
              <WalletButton target="mainnet" showFunding={false} />
            </div>
          )}

          <div className="externalSushiResult" aria-live="polite">
            <div>
              <span>Estimated receive</span>
              <strong>
                {quote && outputDecimals !== undefined
                    ? `${displayUnits(quote.quoteOut, outputDecimals)} ${outputSymbol}`
                    : status === "loading" ? "Checking route…" : "Enter an amount"}
              </strong>
            </div>
            {status === "error" && <p role="alert">{error}</p>}
          </div>
          <SmartOrderGuard
            priceImpact={quote?.priceImpact}
            maxPriceImpact={maxPriceImpact}
            disabled={busy || !canReduceImpact}
            onReduce={chooseSaferAmount}
          />
          {side === "buy" && (
            <TradeProtectionIntent settings={afterBuyProtection.settings} onChange={afterBuyProtection.setSettings} />
          )}
        </>
      )}

      <TradeConfidence
        market={market}
        side={side}
        priceImpact={quote?.priceImpact}
        maxPriceImpact={maxPriceImpact}
        evidenceState={tokenRisk}
      />

      {isConnected && accountReady && chainId === ROBINHOOD_CHAIN_ID && (
        <>
          <TradePreSignReadiness
            quoteState={quoteState}
            estimate={feeEstimate}
            needsApproval={needsApproval}
            routeLabel="Sushi · RedSnwapper"
            minimumReceive={quote && outputDecimals !== undefined ? `${displayUnits(quote.minimumOut, outputDecimals)} ${outputSymbol}` : undefined}
            priceImpact={quote?.priceImpact}
            liquidityUsd={market.liquidityUsd}
            slippageLabel="1% max"
            evidenceState={
              impactBlocked
                ? "review"
                : !confidenceEvidenceReady
                  ? "checking"
                  : evidenceDecision.state === "review" || evidenceDecision.state === "blocked"
                    ? "review"
                    : "clear"
            }
          />
          <TradePreflightFailure failure={preflightFailure} />
          <button
            className={`externalUniswapSubmit ${side}`}
            type="button"
            aria-busy={busy || status === "loading"}
            disabled={!quoteIsFresh || insufficient || busy || !confidenceReady || !preflightReady}
            onClick={submit}
          >
            {buttonLabel}
          </button>
        </>
      )}
      {approvalConfirmationUnavailable && approval.data && (
        <TradeExecutionStatus
          status="confirmation-unavailable"
          hash={approval.data}
          failure={classifyTradeExecutionError(approvalReceipt.error)}
          rawError={approvalReceipt.error?.message}
          onRecheck={() => void approvalReceipt.refetch()}
        />
      )}
      {execution.status !== "idle" && (
        <TradeExecutionStatus
          status={execution.status}
          hash={execution.trackedHash ?? (approvalReverted ? approval.data : undefined)}
          record={execution.record}
          recovered={execution.recovered}
          failure={execution.failure}
          rawError={execution.rawError}
          onRecheck={execution.trackedHash ? () => void swapReceipt.refetch() : undefined}
        />
      )}
      {message && (
        <p className="externalUniswapMessage" role="status">
          {message}
          {swapConfirmed && execution.trackedHash && (
            <> <a href={`${EXPLORER}/tx/${execution.trackedHash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a></>
          )}
        </p>
      )}
      {side === "buy" && swapConfirmed && execution.trackedHash && address && confirmedBuy && (
        <PostTradeProtection
          wallet={address}
          token={market.address}
          symbol={market.symbol}
          transactionHash={execution.trackedHash}
          snapshot={confirmedBuy}
          protectionSettings={confirmedBuyProtectionSettings}
        />
      )}

      {address && (
        <TradeOrderDetails priceImpact={quote?.priceImpact} routeLabel="Sushi">
          <QuoteProtection
            deadline={quote?.quoteExpiresAt}
            priceImpact={quote?.priceImpact}
            slippageLabel="1% maximum"
          />
          <FinalOrderReview
            originalAmount={saferOrderOriginal}
            saferAmount={amountIn}
            inputDecimals={sizingDecimals}
            inputSymbol={side === "buy" ? "ETH" : market.symbol}
            expectedReceive={quote && outputDecimals !== undefined ? `${displayUnits(quote.quoteOut, outputDecimals)} ${outputSymbol}` : undefined}
            minimumReceive={quote && outputDecimals !== undefined ? `${displayUnits(quote.minimumOut, outputDecimals)} ${outputSymbol}` : undefined}
            priceImpact={quote?.priceImpact}
            estimate={feeEstimate}
            venueFee="Included in quote"
            routeLabel="Sushi · RedSnwapper"
          />
          <TradeCostSummary
            side={side}
            amountIn={amountIn}
            estimate={feeEstimate}
            venueLabel="Costs reflected in quote"
          />
          <p className="externalSushiSafety">
            RMT verifies the displayed pool, sender, recipient, tokens, exact amount, minimum received, Sushi router and executor bytecode,
            then requires Sushi&apos;s successful simulation before enabling the wallet. Sell approval is exact, not unlimited.
            Sushi&apos;s current RedSnwapper has no onchain deadline; RMT therefore expires its quote after 90 seconds, but a submitted pending transaction remains subject to that disclosed router limitation.
          </p>
        </TradeOrderDetails>
      )}

      <TradeExecutionPath
        authenticated={accountReady}
        connected={Boolean(address && chainId === ROBINHOOD_CHAIN_ID)}
        quoteReady={quoteIsFresh}
        evidenceReady={confidenceReady}
        busy={busy}
        success={swapConfirmed}
        needsApproval={needsApproval}
      />
    </section>
  );
}
