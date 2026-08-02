"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, formatEther, formatUnits, parseEther, parseUnits, type Address, type Hex } from "viem";
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
  PRICE_IMPACT_CAUTION,
  conservativeNetworkFeeReserve,
  saferTradeAmount,
  spendableTradeBalance
} from "../lib/trade-ticket";
import {
  MAX_UINT160,
  PERMIT2_ADDRESS,
  permit2Abi,
  ROBINHOOD_SWAP_ROUTER_02,
  ROBINHOOD_UNIVERSAL_ROUTER
} from "../lib/uniswap-v4";
import { useTradeFeeEstimate } from "../lib/use-trade-fee-estimate";
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
import { assertUniswapTransactionIntegrity } from "../lib/uniswap-transaction-integrity";
import { useRmtIdentity } from "./rmt-identity";
import {
  confirmedBuyProtectionSnapshot,
  type ConfirmedBuyProtectionSnapshot
} from "../lib/confirmed-buy-protection";
import { PostTradeProtection, TradeProtectionIntent } from "./post-trade-protection";
import { useAfterBuyProtection } from "../lib/use-after-buy-protection";
import type { AfterBuyProtectionSettings } from "../lib/after-buy-protection";

const ROBINHOOD_CHAIN_ID = 4663;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const NETWORK_FEE_RESERVE = parseEther("0.00002");

type ExternalUniswapQuote = {
  chainId: 4663;
  venue: "uniswap-v3" | "uniswap-v4";
  protocol: "UNISWAP";
  token: Address;
  recipient: Address;
  side: "buy" | "sell";
  router: Address;
  calldata: Hex;
  value: string;
  amountIn: string;
  quoteOut: string;
  grossQuoteOut?: string;
  minimumOut: string;
  grossMinimumOut?: string;
  priceImpact: number;
  deadline: string;
  fee: number;
  marketPair: string;
  marketVerified: true;
  executable: true;
  approvalSpender?: Address;
  inputToken: { address: Address; symbol: string; name: string; decimals: number };
  outputToken: { address: Address; symbol: string; name: string; decimals: number };
  executionFee?: {
    bps: number;
    treasury: Address;
    estimatedAmount: string;
  } | null;
  passport?: {
    state: "eligible";
    checkedAt: string;
    sellTestedAtBlock: string;
    exactTradeTestedAtBlock: string;
    hook: Address;
    reasons: string[];
  };
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

export function ExternalUniswapTradePanel({
  market,
  side,
  amount: controlledAmount,
  onAmountChange,
  onSwapConfirmed,
  version = "v3"
}: {
  market: ExternalMarket;
  side: "buy" | "sell";
  amount?: string;
  onAmountChange?: (value: string) => void;
  onSwapConfirmed?: () => void;
  version?: "v3" | "v4";
}) {
  const { preferences } = useTradePreferences();
  const identity = useRmtIdentity();
  const afterBuyProtection = useAfterBuyProtection();
  const maxPriceImpact = preferences.maxPriceImpactBps / 10_000;
  const { address, chainId, isConnected } = useAccount();
  const tokenRisk = useTokenRiskEvidence(market);
  const tradingTerms = useTradingTermsAcceptance();
  const [internalAmount, setInternalAmount] = useState(side === "buy" ? "0.0001" : "");
  const [quote, setQuote] = useState<ExternalUniswapQuote>();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [criticalEvidenceAcknowledged, setCriticalEvidenceAcknowledged] = useState(false);
  const [approvalStage, setApprovalStage] = useState<"token" | "permit2">();
  const [refresh, setRefresh] = useState(0);
  const [saferOrderOriginal, setSaferOrderOriginal] = useState<bigint>();
  const [confirmedBuy, setConfirmedBuy] = useState<ConfirmedBuyProtectionSnapshot>();
  const [confirmedBuyProtectionSettings, setConfirmedBuyProtectionSettings] = useState<AfterBuyProtectionSettings>();
  const quoteRequestKey = useRef("");
  const pendingBuy = useRef<{ beforeBalance?: bigint; amountInWei: bigint; ethUsd?: number; protectionSettings: AfterBuyProtectionSettings } | undefined>(undefined);
  const handledSwap = useRef<string | undefined>(undefined);
  const token = market.address as Address;
  const pair = market.pairAddress;
  const isV4 = version === "v4";
  const executionRouter = isV4 ? ROBINHOOD_UNIVERSAL_ROUTER : ROBINHOOD_SWAP_ROUTER_02;
  const tokenApprovalSpender = isV4 ? PERMIT2_ADDRESS : ROBINHOOD_SWAP_ROUTER_02;

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
    query: { enabled: Boolean(address), retry: false, refetchInterval: 10_000 }
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
    args: address ? [address, tokenApprovalSpender] : undefined,
    chainId: ROBINHOOD_CHAIN_ID,
    query: { enabled: Boolean(address && side === "sell"), retry: false, refetchInterval: 10_000 }
  });
  const permit2Allowance = useReadContract({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: "allowance",
    args: address && isV4 ? [address, token, ROBINHOOD_UNIVERSAL_ROUTER] : undefined,
    chainId: ROBINHOOD_CHAIN_ID,
    query: {
      enabled: Boolean(address && side === "sell" && isV4),
      retry: false,
      refetchInterval: 10_000
    }
  });
  const approval = useWriteContract();
  const approvalReceipt = useWaitForTransactionReceipt({ hash: approval.data, chainId: ROBINHOOD_CHAIN_ID });
  const swap = useSendTransaction();
  const swapReceipt = useWaitForTransactionReceipt({ hash: swap.data, chainId: ROBINHOOD_CHAIN_ID });
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

  useEffect(() => {
    if (controlledAmount === undefined) setInternalAmount(side === "buy" ? "0.0001" : "");
    setQuote(undefined);
    setError("");
    setMessage("");
    setCriticalEvidenceAcknowledged(false);
    setStatus("idle");
    setSaferOrderOriginal(undefined);
    setApprovalStage(undefined);
    setConfirmedBuy(undefined);
    setConfirmedBuyProtectionSettings(undefined);
    pendingBuy.current = undefined;
    handledSwap.current = undefined;
    approval.reset();
    swap.reset();
  }, [market.address, market.pairAddress, side, version]);

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
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void requestTradeQuote(isV4 ? "/api/trade/external-uniswap-v4" : "/api/trade/external-uniswap", {
        token,
        pair,
        recipient: address,
        side,
        amountIn: amountIn.toString(),
        maxPriceImpactBps: preferences.maxPriceImpactBps
      }, {
        identityScope: identity.userId,
        identityToken: identity.identityToken
      }).then((response) => {
        const payload = response.payload as ExternalUniswapQuote | { error?: string };
        if (!response.ok) throw new Error("error" in payload ? payload.error : "Uniswap quote is unavailable.");
        if (
          !("marketVerified" in payload)
          || payload.marketVerified !== true
          || payload.executable !== true
          || payload.venue !== (isV4 ? "uniswap-v4" : "uniswap-v3")
          || payload.protocol !== "UNISWAP"
          || payload.chainId !== ROBINHOOD_CHAIN_ID
          || payload.token.toLowerCase() !== token.toLowerCase()
          || payload.recipient.toLowerCase() !== address.toLowerCase()
          || payload.authorization?.status !== "identity-wallet-bound"
          || payload.authorization.wallet.toLowerCase() !== address.toLowerCase()
          || payload.marketPair.toLowerCase() !== pair.toLowerCase()
          || payload.router.toLowerCase() !== executionRouter.toLowerCase()
          || payload.side !== side
          || payload.amountIn !== amountIn.toString()
          || !Number.isFinite(payload.priceImpact)
          || payload.priceImpact < 0
          || payload.priceImpact > 1
          || BigInt(payload.deadline) <= BigInt(Math.floor(Date.now() / 1000) + 30)
          || !payload.calldata.startsWith("0x")
          || !payload.inputToken
          || !payload.outputToken
          || (isV4 && (
            payload.passport?.state !== "eligible"
            || typeof payload.passport?.sellTestedAtBlock !== "string"
            || !/^\d+$/.test(payload.passport.sellTestedAtBlock)
            || typeof payload.passport?.exactTradeTestedAtBlock !== "string"
            || !/^\d+$/.test(payload.passport.exactTradeTestedAtBlock)
            || payload.approvalSpender?.toLowerCase() !== PERMIT2_ADDRESS.toLowerCase()
          ))
        ) {
          throw new Error("RMT rejected an inconsistent Uniswap transaction.");
        }
        assertUniswapTransactionIntegrity(payload, {
          version,
          token,
          recipient: address,
          side,
          amountIn,
          nowSeconds: Math.floor(Date.now() / 1_000)
        });
        if (!cancelled) {
          setQuote(payload);
          setStatus("idle");
        }
      }).catch((cause) => {
        if (cancelled) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Uniswap quote is unavailable.");
      });
    }, quoteDebounceMs(preferences.preparationMode));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [address, amountIn, decimals, executionRouter, identity.authenticated, identity.identityToken, identity.ready, identity.userId, isV4, pair, preferences.maxPriceImpactBps, preferences.preparationMode, refresh, side, token]);

  useEffect(() => {
    if (!approvalReceipt.isSuccess) return;
    setMessage(
      approvalStage === "token" && isV4
        ? "Exact token approval confirmed. Continue to the short-lived Permit2 router approval."
        : "Exact sell approval confirmed. Review and submit the swap next."
    );
    void Promise.all([allowance.refetch(), permit2Allowance.refetch()]);
  }, [approvalReceipt.isSuccess, approvalStage, isV4]);

  useEffect(() => {
    if (!swapReceipt.isSuccess || !swap.data) return;
    setMessage("Swap confirmed on Robinhood Chain.");
    if (handledSwap.current === swap.data) return;
    handledSwap.current = swap.data;
    onSwapConfirmed?.();
    void Promise.all([tokenBalance.refetch(), nativeBalance.refetch(), allowance.refetch(), permit2Allowance.refetch()])
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
  }, [swapReceipt.isSuccess]);

  const quoteIsFresh = Boolean(
    quote
    && BigInt(quote.deadline) > BigInt(Math.floor(Date.now() / 1000) + 30)
    && quote.amountIn === amountIn.toString()
  );
  useEffect(() => {
    if (quoteIsFresh) recordExperienceStage("quote_ready");
  }, [quoteIsFresh]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const needsTokenApproval = side === "sell" && amountIn > 0n && (allowance.data ?? 0n) < amountIn;
  const permit2Amount = permit2Allowance.data?.[0] ?? 0n;
  const permit2Expiration = BigInt(permit2Allowance.data?.[1] ?? 0);
  const needsPermit2Approval = isV4
    && side === "sell"
    && amountIn > 0n
    && !needsTokenApproval
    && (permit2Amount < amountIn || permit2Expiration < now + 600n);
  const needsApproval = needsTokenApproval || needsPermit2Approval;
  const approvalTarget = needsPermit2Approval ? PERMIT2_ADDRESS : token;
  const approvalCalldata = useMemo(() => {
    if (needsTokenApproval) {
      return encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [tokenApprovalSpender, amountIn]
      });
    }
    if (needsPermit2Approval) {
      return encodeFunctionData({
        abi: permit2Abi,
        functionName: "approve",
        args: [
          token,
          ROBINHOOD_UNIVERSAL_ROUTER,
          amountIn > MAX_UINT160 ? MAX_UINT160 : amountIn,
          Math.floor(Date.now() / 1000) + 1_200
        ]
      });
    }
    return undefined;
  }, [amountIn, needsPermit2Approval, needsTokenApproval, token, tokenApprovalSpender]);
  const feeEstimate = useTradeFeeEstimate({
    account: address,
    to: needsApproval ? approvalTarget : quote?.router,
    data: needsApproval ? approvalCalldata : quote?.calldata,
    value: needsApproval ? 0n : quote ? BigInt(quote.value) : 0n,
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
  const busy = approval.isPending || approvalReceipt.isLoading || swap.isPending || swapReceipt.isLoading;
  const preflightReady = isTradePreflightReady(feeEstimate);
  const requiresAcknowledgement = tradeRequiresAcknowledgement(market, side);
  const evidenceDecision = tokenRiskDecision(tokenRisk, side);
  const confidenceEvidenceReady = side === "sell" || tokenRisk.status !== "loading";
  const confidenceReady = confidenceEvidenceReady && (!requiresAcknowledgement || tradingTerms.accepted);
  const evidenceBlocked = evidenceDecision.state === "blocked" && !criticalEvidenceAcknowledged;
  const accountReady = identity.ready && identity.authenticated && Boolean(identity.identityToken && identity.userId);
  const criticalEvidenceKey = evidenceDecision.findings
    .filter((finding) => finding.severity === "blocked")
    .map((finding) => finding.code)
    .join(":");
  const impactBlocked = Boolean(quote && quote.priceImpact > maxPriceImpact);

  useEffect(() => {
    setCriticalEvidenceAcknowledged(false);
  }, [criticalEvidenceKey]);
  const outputDecimals = quote?.outputToken.decimals;
  const outputSymbol = quote?.outputToken.symbol ?? (side === "buy" ? market.symbol : "ETH");
  const rmtFeeLabel = quote?.executionFee && outputDecimals !== undefined
    ? `${quote.executionFee.bps / 100}% · ${displayUnits(quote.executionFee.estimatedAmount, outputDecimals)} ${outputSymbol}`
    : "$0";
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
    if (!accountReady || !address || chainId !== ROBINHOOD_CHAIN_ID || !quoteIsFresh || !quote || insufficient || busy || !confidenceReady || evidenceBlocked || impactBlocked || !preflightReady) return;
    recordExperienceStage("wallet_review_started");
    if (needsTokenApproval) {
      setApprovalStage("token");
      approval.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [tokenApprovalSpender, amountIn],
        chainId: ROBINHOOD_CHAIN_ID
      });
      return;
    }
    if (needsPermit2Approval) {
      setApprovalStage("permit2");
      approval.writeContract({
        address: PERMIT2_ADDRESS,
        abi: permit2Abi,
        functionName: "approve",
        args: [
          token,
          ROBINHOOD_UNIVERSAL_ROUTER,
          amountIn > MAX_UINT160 ? MAX_UINT160 : amountIn,
          Math.floor(Date.now() / 1000) + 1_200
        ],
        chainId: ROBINHOOD_CHAIN_ID
      });
      return;
    }
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
  const buttonLabel = busy
    ? approval.isPending || approvalReceipt.isLoading ? "Confirming exact approval…" : "Confirming swap…"
    : amountIn <= 0n ? "Enter an amount"
      : !accountReady ? "Sign in to protect this trade"
      : status === "error" && !quote ? "Quote unavailable"
      : !quoteIsFresh ? "Verifying route…"
      : insufficient ? "Insufficient balance"
      : !confidenceEvidenceReady ? "Checking contract and holders…"
      : evidenceBlocked ? "Review critical evidence to continue"
        : !confidenceReady ? "Accept RMT trading terms"
        : impactBlocked ? `Above your ${preferences.maxPriceImpactBps / 100}% impact limit`
        : feeEstimate.status === "unavailable" ? "Preflight failed — trade blocked"
          : !preflightReady ? "Simulating exact transaction…"
        : needsTokenApproval ? `Approve exact ${market.symbol} amount`
          : needsPermit2Approval ? "Set 20-minute router approval"
          : side === "buy" ? `Buy ${market.symbol} inside RMT` : `Sell ${market.symbol} inside RMT`;

  return (
    <section className="externalSushiQuote externalUniswapTrade" aria-labelledby="external-uniswap-trade-heading">
      <header>
        <div>
          <small>{isV4 ? "PASSPORT-GATED UNISWAP V4 ROUTE" : "VERIFIED UNISWAP V3 ROUTE"}</small>
          <strong id="external-uniswap-trade-heading">Trade without leaving RMT</strong>
        </div>
        <span>1% · 10 min</span>
      </header>

      {!address ? (
        <div className="externalSushiConnect">
          <p>Connect a wallet to receive a fresh quote and submit the swap from RMT. RMT never takes custody.</p>
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
                    : status === "loading" ? "Verifying pool and quote…" : "Enter an amount"}
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
        criticalEvidenceAcknowledged={criticalEvidenceAcknowledged}
        onCriticalEvidenceAcknowledgement={setCriticalEvidenceAcknowledged}
      />

      {isConnected && accountReady && chainId === ROBINHOOD_CHAIN_ID && (
        <>
          <TradePreSignReadiness
            quoteState={quoteState}
            estimate={feeEstimate}
            needsApproval={needsApproval}
            routeLabel={isV4 ? "Uniswap v4 · Universal Router" : "Uniswap v3 · Router02"}
            minimumReceive={quote && outputDecimals !== undefined ? `${displayUnits(quote.minimumOut, outputDecimals)} ${outputSymbol}` : undefined}
            priceImpact={quote?.priceImpact}
            liquidityUsd={market.liquidityUsd}
            slippageLabel="1% max"
            evidenceState={
              evidenceBlocked || impactBlocked
                ? "blocked"
                : !confidenceEvidenceReady
                  ? "checking"
                  : !confidenceReady || evidenceDecision.state === "review"
                    ? "review"
                    : "clear"
            }
          />
          <button
            className={`externalUniswapSubmit ${side}`}
            type="button"
            aria-busy={busy || status === "loading"}
            disabled={!quoteIsFresh || insufficient || busy || !confidenceReady || evidenceBlocked || impactBlocked || !preflightReady}
            onClick={submit}
          >
            {buttonLabel}
          </button>
        </>
      )}
      {(approval.error || approvalReceipt.error || swap.error || swapReceipt.error) && (
        <p className="externalUniswapError" role="alert">
          {approval.error?.message || approvalReceipt.error?.message || swap.error?.message || swapReceipt.error?.message}
        </p>
      )}
      {message && (
        <p className="externalUniswapMessage" role="status">
          {message}
          {swapReceipt.isSuccess && swap.data && (
            <> <a href={`${EXPLORER}/tx/${swap.data}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a></>
          )}
        </p>
      )}
      {side === "buy" && swapReceipt.isSuccess && swap.data && address && confirmedBuy && (
        <PostTradeProtection
          wallet={address}
          token={market.address}
          symbol={market.symbol}
          transactionHash={swap.data}
          snapshot={confirmedBuy}
          protectionSettings={confirmedBuyProtectionSettings}
        />
      )}

      {address && (
        <TradeOrderDetails priceImpact={quote?.priceImpact} routeLabel={isV4 ? "Uniswap v4" : "Uniswap v3"}>
          <QuoteProtection
            deadline={quote?.deadline}
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
            venueFee={quote ? `${(quote.fee / 10_000).toLocaleString()}% pool` : "Checking…"}
            routeLabel={isV4 ? "Uniswap v4 · Universal Router" : "Uniswap v3 · Router02"}
            rmtFeeLabel={rmtFeeLabel}
          />
          <TradeCostSummary
            side={side}
            amountIn={amountIn}
            estimate={feeEstimate}
            venueLabel="Pool fee reflected in quote"
            rmtFeeLabel={rmtFeeLabel}
          />
          <p className="externalSushiSafety">
            {isV4
              ? "RMT enables this ticket only after the canonical PoolManager pool, StateView, hook evidence, complete holder exit and this exact wallet route pass no-broadcast checks. Sell access is exact and the Universal Router allowance expires after 20 minutes."
              : "RMT rechecks the exact token, pool, official V3 factory, WETH pair, QuoterV2 and SwapRouter02 before every trade. Sell approval is limited to the amount entered; every approval and swap remains under your wallet control."}
          </p>
          {isV4 && quote?.passport && (
            <p className="externalSushiSafety">
              Passport eligible at block {Number(quote.passport.sellTestedAtBlock).toLocaleString()} · exact {side} rehearsed at block {Number(quote.passport.exactTradeTestedAtBlock).toLocaleString()}.
            </p>
          )}
        </TradeOrderDetails>
      )}

      <TradeExecutionPath
        authenticated={accountReady}
        connected={Boolean(address && chainId === ROBINHOOD_CHAIN_ID)}
        quoteReady={quoteIsFresh}
        evidenceReady={confidenceReady && !evidenceBlocked && !impactBlocked}
        busy={busy}
        success={swapReceipt.isSuccess}
        needsApproval={needsApproval}
      />
    </section>
  );
}
