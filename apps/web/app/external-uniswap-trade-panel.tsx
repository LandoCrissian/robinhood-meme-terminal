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
import { ROBINHOOD_SWAP_ROUTER_02 } from "../lib/uniswap-v4";
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

const ROBINHOOD_CHAIN_ID = 4663;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const NETWORK_FEE_RESERVE = parseEther("0.00002");

type ExternalUniswapQuote = {
  chainId: 4663;
  venue: "uniswap-v3";
  protocol: "UNISWAP";
  token: Address;
  recipient: Address;
  side: "buy" | "sell";
  router: Address;
  calldata: Hex;
  value: string;
  amountIn: string;
  quoteOut: string;
  minimumOut: string;
  priceImpact: number;
  deadline: string;
  fee: number;
  marketPair: Address;
  marketVerified: true;
  executable: true;
  inputToken: { address: Address; symbol: string; name: string; decimals: number };
  outputToken: { address: Address; symbol: string; name: string; decimals: number };
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
  onAmountChange
}: {
  market: ExternalMarket;
  side: "buy" | "sell";
  amount?: string;
  onAmountChange?: (value: string) => void;
}) {
  const { preferences } = useTradePreferences();
  const maxPriceImpact = preferences.maxPriceImpactBps / 10_000;
  const { address, chainId, isConnected } = useAccount();
  const tokenRisk = useTokenRiskEvidence(market);
  const tradingTerms = useTradingTermsAcceptance();
  const [internalAmount, setInternalAmount] = useState(side === "buy" ? "0.0001" : "");
  const [quote, setQuote] = useState<ExternalUniswapQuote>();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [saferOrderOriginal, setSaferOrderOriginal] = useState<bigint>();
  const quoteRequestKey = useRef("");
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
    args: address ? [address, ROBINHOOD_SWAP_ROUTER_02] : undefined,
    chainId: ROBINHOOD_CHAIN_ID,
    query: { enabled: Boolean(address && side === "sell"), retry: false, refetchInterval: 10_000 }
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
    setStatus("idle");
    setSaferOrderOriginal(undefined);
    approval.reset();
    swap.reset();
  }, [market.address, side]);

  useEffect(() => {
    const interval = window.setInterval(() => setRefresh((value) => value + 1), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const nextRequestKey = `${address ?? ""}:${amountIn}:${side}:${token}:${pair}`;
    const requestChanged = quoteRequestKey.current !== nextRequestKey;
    quoteRequestKey.current = nextRequestKey;
    if (requestChanged) setQuote(undefined);
    setError("");
    if (!address || amountIn <= 0n || (side === "sell" && decimals === undefined)) {
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void fetch("/api/trade/external-uniswap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          pair,
          recipient: address,
          side,
          amountIn: amountIn.toString()
        }),
        signal: controller.signal
      }).then(async (response) => {
        const payload = await response.json() as ExternalUniswapQuote | { error?: string };
        if (!response.ok) throw new Error("error" in payload ? payload.error : "Uniswap quote is unavailable.");
        if (
          !("marketVerified" in payload)
          || payload.marketVerified !== true
          || payload.executable !== true
          || payload.venue !== "uniswap-v3"
          || payload.protocol !== "UNISWAP"
          || payload.chainId !== ROBINHOOD_CHAIN_ID
          || payload.token.toLowerCase() !== token.toLowerCase()
          || payload.recipient.toLowerCase() !== address.toLowerCase()
          || payload.marketPair.toLowerCase() !== pair.toLowerCase()
          || payload.router.toLowerCase() !== ROBINHOOD_SWAP_ROUTER_02.toLowerCase()
          || payload.side !== side
          || payload.amountIn !== amountIn.toString()
          || !Number.isFinite(payload.priceImpact)
          || payload.priceImpact < 0
          || payload.priceImpact > 1
          || BigInt(payload.deadline) <= BigInt(Math.floor(Date.now() / 1000) + 30)
          || !payload.calldata.startsWith("0x")
          || !payload.inputToken
          || !payload.outputToken
        ) {
          throw new Error("RMT rejected an inconsistent Uniswap transaction.");
        }
        setQuote(payload);
        setStatus("idle");
      }).catch((cause) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Uniswap quote is unavailable.");
      });
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address, amountIn, decimals, pair, refresh, side, token]);

  useEffect(() => {
    if (!approvalReceipt.isSuccess) return;
    setMessage("Exact sell approval confirmed. Review and submit the swap next.");
    void allowance.refetch();
  }, [approvalReceipt.isSuccess]);

  useEffect(() => {
    if (!swapReceipt.isSuccess || !swap.data) return;
    setMessage("Swap confirmed on Robinhood Chain.");
    void Promise.all([tokenBalance.refetch(), nativeBalance.refetch(), allowance.refetch()]);
  }, [swapReceipt.isSuccess]);

  const quoteIsFresh = Boolean(
    quote
    && BigInt(quote.deadline) > BigInt(Math.floor(Date.now() / 1000) + 30)
    && quote.amountIn === amountIn.toString()
  );
  useEffect(() => {
    if (quoteIsFresh) recordExperienceStage("quote_ready");
  }, [quoteIsFresh]);
  const needsApproval = side === "sell" && amountIn > 0n && (allowance.data ?? 0n) < amountIn;
  const approvalCalldata = useMemo(() => needsApproval
    ? encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [ROBINHOOD_SWAP_ROUTER_02, amountIn]
      })
    : undefined, [amountIn, needsApproval]);
  const feeEstimate = useTradeFeeEstimate({
    account: address,
    to: needsApproval ? token : quote?.router,
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
  const requiresAcknowledgement = tradeRequiresAcknowledgement(market, side);
  const evidenceDecision = tokenRiskDecision(tokenRisk, side);
  const confidenceEvidenceReady = side === "sell" || tokenRisk.status !== "loading";
  const confidenceReady = confidenceEvidenceReady && (!requiresAcknowledgement || tradingTerms.accepted);
  const evidenceBlocked = evidenceDecision.state === "blocked";
  const impactBlocked = Boolean(quote && quote.priceImpact > maxPriceImpact);
  const outputDecimals = quote?.outputToken.decimals;
  const outputSymbol = quote?.outputToken.symbol ?? (side === "buy" ? market.symbol : "ETH");
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
    if (!address || chainId !== ROBINHOOD_CHAIN_ID || !quoteIsFresh || !quote || insufficient || busy || !confidenceReady || evidenceBlocked || impactBlocked) return;
    recordExperienceStage("wallet_review_started");
    if (needsApproval) {
      approval.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [ROBINHOOD_SWAP_ROUTER_02, amountIn],
        chainId: ROBINHOOD_CHAIN_ID
      });
      return;
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
      : status === "error" && !quote ? "Quote unavailable"
      : !quoteIsFresh ? "Verifying route…"
      : insufficient ? "Insufficient balance"
      : !confidenceEvidenceReady ? "Checking contract and holders…"
      : evidenceBlocked ? `Buy blocked: ${evidenceDecision.primaryFinding?.label ?? "evidence failed"}`
        : !confidenceReady ? "Accept RMT trading terms"
        : impactBlocked ? `Above your ${preferences.maxPriceImpactBps / 100}% impact limit`
        : needsApproval ? `Approve exact ${market.symbol} amount`
          : side === "buy" ? `Buy ${market.symbol} inside RMT` : `Sell ${market.symbol} inside RMT`;

  return (
    <section className="externalSushiQuote externalUniswapTrade" aria-labelledby="external-uniswap-trade-heading">
      <header>
        <div>
          <small>VERIFIED UNISWAP V3 ROUTE</small>
          <strong id="external-uniswap-trade-heading">Trade without leaving RMT</strong>
        </div>
        <span>1% · 10 min</span>
      </header>

      {!address ? (
        <div className="externalSushiConnect">
          <p>Connect a wallet to receive a fresh quote and submit the swap from RMT. RMT never takes custody.</p>
          <WalletButton target="mainnet" showFunding={false} />
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
        </>
      )}

      <TradeConfidence
        market={market}
        side={side}
        priceImpact={quote?.priceImpact}
        evidenceState={tokenRisk}
      />

      {isConnected && chainId === ROBINHOOD_CHAIN_ID && (
        <>
          <TradePreSignReadiness
            quoteState={quoteState}
            estimate={feeEstimate}
            needsApproval={needsApproval}
            routeLabel="Uniswap V3 · Router02"
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
            disabled={!quoteIsFresh || insufficient || busy || !confidenceReady || evidenceBlocked || impactBlocked}
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

      {address && (
        <TradeOrderDetails priceImpact={quote?.priceImpact} routeLabel="Uniswap V3">
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
            routeLabel="Uniswap V3 · Router02"
          />
          <TradeCostSummary
            side={side}
            amountIn={amountIn}
            estimate={feeEstimate}
            venueLabel="Pool fee reflected in quote"
          />
          <p className="externalSushiSafety">
            RMT rechecks the exact token, pool, official V3 factory, WETH pair, QuoterV2 and SwapRouter02 before every trade.
            Sell approval is limited to the amount entered; every approval and swap remains under your wallet control.
          </p>
        </TradeOrderDetails>
      )}

      <TradeExecutionPath
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
