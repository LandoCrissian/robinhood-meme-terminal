"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { useAccount, useBalance, useReadContract, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { activeChain } from "../lib/network";
import { MAX_UINT160, PERMIT2_ADDRESS, permit2Abi, ROBINHOOD_UNIVERSAL_ROUTER, type RmtV4Quote } from "../lib/uniswap-v4";
import { WalletButton } from "./wallet-button";

const tokenAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }
] as const;

const FALLBACK_NETWORK_FEE_RESERVE = parseEther("0.00002");

function cleanDecimal(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

function displayToken(value: bigint) {
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function displayEth(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function GraduatedMarketTrade({ tokenAddress, symbol, launchId, mode }: { tokenAddress: Address; symbol: string; launchId: bigint; mode: "buy" | "sell" }) {
  const { address: account, isConnected } = useAccount();
  const [buyAmount, setBuyAmount] = useState("0.001");
  const [sellAmount, setSellAmount] = useState("1000000");
  const [quote, setQuote] = useState<RmtV4Quote>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [approvalStage, setApprovalStage] = useState<"token" | "permit2">();
  const [message, setMessage] = useState<string>();
  const lastRequestKey = useRef("");
  const amountIn = useMemo(() => {
    try { return mode === "buy" ? parseEther(buyAmount || "0") : parseUnits(sellAmount || "0", 18); }
    catch { return 0n; }
  }, [buyAmount, mode, sellAmount]);

  const tokenBalance = useReadContract({ address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [account!], chainId: activeChain.id, query: { enabled: Boolean(account), refetchInterval: 5_000 } });
  const walletBalance = useBalance({ address: account, chainId: activeChain.id, query: { enabled: Boolean(account), refetchInterval: 5_000 } });
  const tokenAllowance = useReadContract({ address: tokenAddress, abi: tokenAbi, functionName: "allowance", args: [account!, PERMIT2_ADDRESS], chainId: activeChain.id, query: { enabled: Boolean(account && mode === "sell"), refetchInterval: 5_000 } });
  const permit2Allowance = useReadContract({ address: PERMIT2_ADDRESS, abi: permit2Abi, functionName: "allowance", args: [account!, tokenAddress, ROBINHOOD_UNIVERSAL_ROUTER], chainId: activeChain.id, query: { enabled: Boolean(account && mode === "sell"), refetchInterval: 5_000 } });
  const approval = useWriteContract();
  const approvalReceipt = useWaitForTransactionReceipt({ hash: approval.data, chainId: activeChain.id });
  const swap = useSendTransaction();
  const swapReceipt = useWaitForTransactionReceipt({ hash: swap.data, chainId: activeChain.id });
  const permit2Amount = permit2Allowance.data?.[0] ?? 0n;
  const permit2Expiration = BigInt(permit2Allowance.data?.[1] ?? 0);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const quoteMatches = Boolean(quote
    && quote.chainId === activeChain.id
    && quote.token.toLowerCase() === tokenAddress.toLowerCase()
    && quote.recipient.toLowerCase() === account?.toLowerCase()
    && quote.side === mode
    && quote.amountIn === amountIn.toString());
  const verifiedQuote = quoteMatches && quote && BigInt(quote.deadline) > now + 30n ? quote : undefined;
  const needsTokenApproval = mode === "sell" && amountIn > 0n && (tokenAllowance.data ?? 0n) < amountIn;
  const needsPermit2Approval = mode === "sell" && amountIn > 0n && !needsTokenApproval && (permit2Amount < amountIn || permit2Expiration < now + 600n);
  const busy = approval.isPending || approvalReceipt.isLoading || swap.isPending || swapReceipt.isLoading;

  useEffect(() => {
    if (!account || amountIn <= 0n) return;
    const timer = window.setInterval(() => setQuoteRefresh((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [account, amountIn, launchId, mode, tokenAddress]);

  useEffect(() => {
    const requestKey = `${account ?? ""}:${activeChain.id}:${launchId}:${tokenAddress}:${mode}:${amountIn}`;
    const requestChanged = lastRequestKey.current !== requestKey;
    lastRequestKey.current = requestKey;
    if (requestChanged) setQuote(undefined);
    setQuoteError(undefined);
    if (requestChanged) setMessage(undefined);
    if (!account || amountIn <= 0n) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setQuoteLoading(true);
      void fetch("/api/trade/rmt-v4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ launchId: launchId.toString(), token: tokenAddress, recipient: account, side: mode, amountIn: amountIn.toString() }),
        signal: controller.signal
      }).then(async (response) => {
        const payload = await response.json() as RmtV4Quote | { error?: string };
        if (!response.ok || !("verified" in payload) || payload.verified !== true || payload.chainId !== activeChain.id || payload.token.toLowerCase() !== tokenAddress.toLowerCase() || payload.recipient.toLowerCase() !== account.toLowerCase() || payload.side !== mode || payload.router.toLowerCase() !== ROBINHOOD_UNIVERSAL_ROUTER.toLowerCase() || payload.amountIn !== amountIn.toString()) {
          throw new Error("error" in payload ? payload.error : "The canonical pool quote failed verification.");
        }
        setQuote(payload);
      }).catch((cause) => {
        if (!controller.signal.aborted) setQuoteError(cause instanceof Error ? cause.message : "The canonical pool quote is unavailable.");
      }).finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      });
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [account, amountIn, launchId, mode, quoteRefresh, tokenAddress]);

  useEffect(() => {
    if (!approvalReceipt.isSuccess) return;
    setMessage(approvalStage === "token" ? "Token approval confirmed. Continue to the short-lived Permit2 approval." : "Permit2 approval confirmed. Review the final swap next.");
    void Promise.all([tokenAllowance.refetch(), permit2Allowance.refetch()]);
  }, [approvalReceipt.isSuccess, approvalStage]);

  useEffect(() => {
    if (!swapReceipt.isSuccess) return;
    setMessage(`${mode === "buy" ? "Buy" : "Sell"} confirmed through the canonical RMT V4 pool.`);
    void Promise.all([tokenBalance.refetch(), walletBalance.refetch(), tokenAllowance.refetch(), permit2Allowance.refetch()]);
  }, [swapReceipt.isSuccess]);

  function chooseSellPercent(percent: number) {
    const available = tokenBalance.data ?? 0n;
    const amount = percent === 100 ? available : available * BigInt(percent) / 100n;
    setSellAmount(cleanDecimal(formatUnits(amount, 18)));
  }

  function submit() {
    if (!account || !verifiedQuote || amountIn <= 0n) return;
    approval.reset();
    swap.reset();
    if (needsTokenApproval) {
      setApprovalStage("token");
      setMessage("Approve only this sell amount for Permit2 in your wallet.");
      approval.writeContract({ address: tokenAddress, abi: tokenAbi, functionName: "approve", args: [PERMIT2_ADDRESS, amountIn], chainId: activeChain.id });
      return;
    }
    if (needsPermit2Approval) {
      setApprovalStage("permit2");
      setMessage("Approve only this sell amount for the official router. It expires in 20 minutes.");
      approval.writeContract({ address: PERMIT2_ADDRESS, abi: permit2Abi, functionName: "approve", args: [tokenAddress, ROBINHOOD_UNIVERSAL_ROUTER, amountIn > MAX_UINT160 ? MAX_UINT160 : amountIn, Math.floor(Date.now() / 1000) + 1_200], chainId: activeChain.id });
      return;
    }
    setMessage("Review the exact amount, official router, and network fee in your wallet.");
    swap.sendTransaction({ account, to: verifiedQuote.router, data: verifiedQuote.calldata, value: BigInt(verifiedQuote.value), chainId: activeChain.id });
  }

  const quoteOut = verifiedQuote ? BigInt(verifiedQuote.quoteOut) : 0n;
  const minimumOut = verifiedQuote ? BigInt(verifiedQuote.minimumOut) : 0n;
  const walletSpendable = (walletBalance.data?.value ?? 0n) > FALLBACK_NETWORK_FEE_RESERVE ? (walletBalance.data?.value ?? 0n) - FALLBACK_NETWORK_FEE_RESERVE : 0n;
  const insufficient = mode === "buy" ? amountIn > walletSpendable : amountIn > (tokenBalance.data ?? 0n);
  const buttonLabel = !isConnected ? "Connect wallet to trade" : quoteLoading && !verifiedQuote ? "Reading canonical V4 pool…" : !verifiedQuote ? "Enter an amount for a verified quote" : insufficient ? `Insufficient ${mode === "buy" ? "ETH" : symbol}` : busy ? approval.isPending || swap.isPending ? "Review in your wallet…" : "Waiting for confirmation…" : needsTokenApproval ? "Approve this sell amount" : needsPermit2Approval ? "Set 20-minute router approval" : `${mode === "buy" ? "Buy" : "Sell"} ${symbol} on RMT`;

  return <div className="graduatedTradePanel">
    <div className="tradeAmountCard">
      <div className="tradeAmountTop"><span>You {mode === "buy" ? "pay" : "sell"}</span><small>Canonical Uniswap V4 pool</small></div>
      {mode === "buy" ? <>
        <div className="tradeInputRow"><input aria-label="ETH amount for graduated-token buy" inputMode="decimal" value={buyAmount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setBuyAmount(event.target.value)} /><span>ETH</span></div>
        <small className="walletPresetNote">Wallet balance {displayEth(walletBalance.data?.value ?? 0n)} ETH before network fees.</small>
      </> : <>
        <div className="tradeInputRow"><input aria-label={`${symbol} amount for graduated-token sell`} inputMode="decimal" value={sellAmount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setSellAmount(event.target.value)} /><span>{symbol}</span></div>
        <div className="quickAmounts">{[25, 50, 75, 100].map((percent) => <button type="button" key={percent} onClick={() => chooseSellPercent(percent)}>{percent === 100 ? "Max" : `${percent}%`}</button>)}</div>
      </>}
      <div className="orderPreview"><div><span>Estimated receive</span><strong>{quoteLoading && !verifiedQuote ? "Reading…" : verifiedQuote ? mode === "buy" ? `${displayToken(quoteOut)} ${symbol}` : `${displayEth(quoteOut)} ETH` : "—"}</strong></div><div><span>Minimum received</span><strong>{verifiedQuote ? mode === "buy" ? `${displayToken(minimumOut)} ${symbol}` : `${displayEth(minimumOut)} ETH` : "1% slippage limit"}</strong></div></div>
      <p className="dexNativeDisclosure">RMT verifies the active V6 launch, immutable graduation adapter, hook, pool settings, official Quoter, and official Universal Router before building the transaction. Your wallet still controls every approval and swap.</p>
      {mode === "sell" && <p className="approvalNote">For safety, RMT approves only this sell amount. The router allowance expires after 20 minutes; RMT does not request unlimited token access.</p>}
      {quoteError && <p className="walletError" role="alert">{quoteError}</p>}
    </div>
    {!isConnected ? <div className="quickTradeConnect"><WalletButton target="mainnet" /><small>Connect once. Your wallet confirms every approval and swap.</small></div> : <button className={`launch ${mode === "sell" ? "sellAction" : ""}`} type="button" disabled={!verifiedQuote || insufficient || busy} onClick={submit}>{buttonLabel}</button>}
    {(approvalReceipt.isLoading || swapReceipt.isLoading) && <div className="tradeStage" role="status"><span className="tradeStageDot" /><div><strong>Transaction submitted</strong><small>Waiting for Robinhood Chain confirmation.</small></div></div>}
    {(approval.error || approvalReceipt.error || swap.error || swapReceipt.error) && <div className="errors"><span>{approval.error?.message || approvalReceipt.error?.message || swap.error?.message || swapReceipt.error?.message}</span></div>}
    {message && <div className="callout"><strong>{message}</strong>{swapReceipt.isSuccess && swap.data && <a href={`${activeChain.blockExplorers.default.url}/tx/${swap.data}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>}
  </div>;
}
