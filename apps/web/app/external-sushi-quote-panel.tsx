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
  SUSHI_RED_SNWAPPER,
  type SushiExecutableQuote,
  type SushiIndicativeQuote
} from "../lib/sushi";
import {
  PRICE_IMPACT_CAUTION,
  PRICE_IMPACT_BLOCK,
  conservativeNetworkFeeReserve,
  saferTradeAmount,
  spendableTradeBalance
} from "../lib/trade-ticket";
import { useTradeFeeEstimate } from "../lib/use-trade-fee-estimate";
import { useTokenRiskEvidence } from "../lib/use-token-risk-evidence";
import { tokenRiskDecision } from "../lib/token-risk-policy";
import { useTradingTermsAcceptance } from "../lib/use-trading-terms";
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

const ROBINHOOD_CHAIN_ID = 4663;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const NETWORK_FEE_RESERVE = parseEther("0.00002");

type ExternalSushiQuote = (SushiExecutableQuote | SushiIndicativeQuote) & {
  marketPair: Address;
  marketVerified: true;
  approvalRequired: boolean;
  approvalSpender: Address;
  quoteExpiresAt: string;
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

export function ExternalSushiQuotePanel({
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
    args: address ? [address, SUSHI_RED_SNWAPPER] : undefined,
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
      void fetch("/api/trade/external-sushi-quote", {
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
        const payload = await response.json() as ExternalSushiQuote | { error?: string };
        if (!response.ok) throw new Error("error" in payload ? payload.error : "Sushi quote is unavailable.");
        if (!("executable" in payload)) throw new Error("RMT rejected an incomplete Sushi response.");
        const executionReady = payload.executable === true
          && "router" in payload
          && payload.router.toLowerCase() === SUSHI_RED_SNWAPPER.toLowerCase()
          && "calldata" in payload
          && payload.calldata.startsWith("0x");
        const approvalReady = payload.executable === false
          && payload.approvalRequired === true
          && payload.side === "sell";
        if (
          !("marketVerified" in payload)
          || payload.marketVerified !== true
          || payload.verifiedInput !== true
          || (!executionReady && !approvalReady)
          || payload.venue !== "sushi-aggregator"
          || payload.chainId !== ROBINHOOD_CHAIN_ID
          || payload.token.toLowerCase() !== token.toLowerCase()
          || payload.recipient.toLowerCase() !== address.toLowerCase()
          || payload.marketPair.toLowerCase() !== pair.toLowerCase()
          || payload.side !== side
          || payload.amountIn !== amountIn.toString()
          || payload.approvalSpender.toLowerCase() !== SUSHI_RED_SNWAPPER.toLowerCase()
          || BigInt(payload.quoteExpiresAt) <= BigInt(Math.floor(Date.now() / 1000) + 15)
          || !payload.inputToken
          || !payload.outputToken
        ) {
          throw new Error("RMT rejected an inconsistent Sushi quote.");
        }
        setQuote(payload);
        setStatus("idle");
      }).catch((cause) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Sushi quote is unavailable.");
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
    setRefresh((value) => value + 1);
  }, [approvalReceipt.isSuccess]);

  useEffect(() => {
    if (!swapReceipt.isSuccess || !swap.data) return;
    setMessage("Sushi swap confirmed on Robinhood Chain.");
    void Promise.all([tokenBalance.refetch(), nativeBalance.refetch(), allowance.refetch()]);
  }, [swapReceipt.isSuccess]);

  const outputDecimals = quote?.outputToken?.decimals;
  const outputSymbol = quote?.outputToken?.symbol ?? (side === "buy" ? market.symbol : "ETH");
  const quoteIsFresh = Boolean(
    quote
    && BigInt(quote.quoteExpiresAt) > BigInt(Math.floor(Date.now() / 1000) + 15)
    && quote.amountIn === amountIn.toString()
  );
  const needsApproval = side === "sell" && amountIn > 0n && (allowance.data ?? 0n) < amountIn;
  const approvalCalldata = useMemo(() => needsApproval
    ? encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [SUSHI_RED_SNWAPPER, amountIn]
      })
    : undefined, [amountIn, needsApproval]);
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
  const busy = approval.isPending || approvalReceipt.isLoading || swap.isPending || swapReceipt.isLoading;
  const requiresAcknowledgement = tradeRequiresAcknowledgement(market, side);
  const evidenceDecision = tokenRiskDecision(tokenRisk, side);
  const confidenceEvidenceReady = side === "sell" || tokenRisk.status !== "loading";
  const confidenceReady = confidenceEvidenceReady && (!requiresAcknowledgement || tradingTerms.accepted);
  const evidenceBlocked = evidenceDecision.state === "blocked";
  const impactBlocked = Boolean(quote && quote.priceImpact > PRICE_IMPACT_BLOCK);
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
    if (needsApproval) {
      approval.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [SUSHI_RED_SNWAPPER, amountIn],
        chainId: ROBINHOOD_CHAIN_ID
      });
      return;
    }
    if (quote.executable !== true || !("router" in quote) || !("calldata" in quote)) return;
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
    ? approval.isPending || approvalReceipt.isLoading ? "Confirming exact approval…" : "Confirming Sushi swap…"
    : amountIn <= 0n ? "Enter an amount"
      : status === "error" && !quote ? "Quote unavailable"
      : !quoteIsFresh ? "Verifying route…"
      : insufficient ? "Insufficient balance"
      : !confidenceEvidenceReady ? "Checking contract and holders…"
      : evidenceBlocked ? `Buy blocked: ${evidenceDecision.primaryFinding?.label ?? "evidence failed"}`
        : !confidenceReady ? "Accept RMT trading terms"
        : impactBlocked ? "Price impact too high"
          : needsApproval ? `Approve exact ${market.symbol} amount`
            : side === "buy" ? `Buy ${market.symbol} with Sushi` : `Sell ${market.symbol} with Sushi`;

  return (
    <section className="externalSushiQuote" aria-labelledby="external-sushi-quote-heading">
      <header>
        <div>
          <small>VERIFIED SUSHI ROUTE</small>
          <strong id="external-sushi-quote-heading">Fresh quote inside RMT</strong>
        </div>
        <span>1% · simulated</span>
      </header>

      {!address ? (
        <div className="externalSushiConnect">
          <p>Connect a wallet to calculate a route for your exact trade. RMT never takes custody.</p>
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
            routeLabel="Sushi · RedSnwapper"
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
