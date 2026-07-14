"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, maxUint256, parseEther, parseUnits, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { activeChain, isMainnetRelease } from "../lib/network";
import { useLaunchRecord } from "../lib/use-launch-record";
import { PriceHistoryChart, type PricePoint } from "./price-history-chart";

const marketAbi = [
  { type: "function", name: "quoteBuy", stateMutability: "view", inputs: [{ name: "ethIn", type: "uint256" }], outputs: [{ name: "tokensOut", type: "uint256" }, { name: "fee", type: "uint256" }] },
  { type: "function", name: "quoteSell", stateMutability: "view", inputs: [{ name: "tokensIn", type: "uint256" }], outputs: [{ name: "ethOut", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "grossEth", type: "uint256" }] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "recipient", type: "address" }, { name: "minimumTokensOut", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ name: "tokensIn", type: "uint256" }, { name: "minimumEthOut", type: "uint256" }, { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "realEthReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "virtualEthReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "virtualTokenReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduationTarget", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "progressBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "fairStartActive", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "fairStartPurchased", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "error", name: "TradingNotOpen", inputs: [] },
  { type: "error", name: "FairStartRecipientMismatch", inputs: [] },
  { type: "error", name: "FairStartTransactionLimit", inputs: [] },
  { type: "error", name: "FairStartWalletLimit", inputs: [] },
  { type: "error", name: "FairStartBlockLimit", inputs: [] },
  { type: "error", name: "MarketGraduated", inputs: [] },
  { type: "error", name: "SlippageExceeded", inputs: [] },
  { type: "error", name: "InsufficientInventory", inputs: [] },
  { type: "event", name: "Trade", anonymous: false, inputs: [{ name: "trader", type: "address", indexed: true }, { name: "recipient", type: "address", indexed: true }, { name: "isBuy", type: "bool", indexed: true }, { name: "tokenAmount", type: "uint256", indexed: false }, { name: "ethAmount", type: "uint256", indexed: false }, { name: "feeAmount", type: "uint256", indexed: false }, { name: "virtualEthReserve", type: "uint256", indexed: false }, { name: "virtualTokenReserve", type: "uint256", indexed: false }, { name: "realEthReserve", type: "uint256", indexed: false }] }
] as const;

const tokenTradeAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type EthPriceResponse = {
  usd: number;
  source: string;
  updatedAt: string;
};

type RecentTrade = {
  transactionHash: `0x${string}`;
  trader: Address;
  isBuy: boolean;
  tokenAmount: bigint;
  ethAmount: bigint;
  feeAmount: bigint;
  virtualEthReserve: bigint;
  virtualTokenReserve: bigint;
  blockNumber: bigint;
};

type TradePreflight = {
  status: "idle" | "checking" | "ready" | "error";
  gas?: bigint;
  gasPrice?: bigint;
  message?: string;
};

function compactAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatEth(value: bigint, maximumFractionDigits = 8) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits });
}

function formatPrice(value: bigint) {
  const numeric = Number(formatEther(value));
  if (numeric === 0) return "0";
  if (numeric < 0.000001) return numeric.toExponential(4);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 9 });
}

function formatUsd(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "Unavailable";
  if (value > 0 && value < 0.01) return `$${value.toExponential(2)}`;
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function cleanDecimal(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

export function MarketPanel({ tokenAddress, symbol, totalSupply }: { tokenAddress: Address; symbol: string; totalSupply: bigint }) {
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { address: account, isConnected } = useAccount();
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [tradeHistoryError, setTradeHistoryError] = useState<string>();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [buyAmount, setBuyAmount] = useState("0.0001");
  const [sellAmount, setSellAmount] = useState("1000000");
  const [lastAction, setLastAction] = useState<"buy" | "approve" | "sell" | null>(null);
  const [tradeMessage, setTradeMessage] = useState<string>();
  const [ethUsd, setEthUsd] = useState<number>();
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<string>();
  const [preflight, setPreflight] = useState<TradePreflight>({ status: "idle" });
  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: activeChain.id });
  const launchRecord = useLaunchRecord(tokenAddress);
  const market = launchRecord.data?.market ?? null;
  const launchBlock = launchRecord.data?.blockNumber ?? 0n;
  const lookupError = launchRecord.error ? (launchRecord.error instanceof Error ? launchRecord.error.message : "Unable to read market.") : launchRecord.isSuccess && !launchRecord.data ? "Market record not found." : undefined;

  useEffect(() => {
    let active = true;
    async function loadEthPrice() {
      try {
        const response = await fetch("/api/prices/eth", { cache: "no-store" });
        const payload = await response.json() as EthPriceResponse | { error?: string };
        if (!response.ok || !("usd" in payload)) throw new Error("Price unavailable.");
        if (active) {
          setEthUsd(payload.usd);
          setPriceUpdatedAt(payload.updatedAt);
        }
      } catch {
        if (active) setEthUsd(undefined);
      }
    }
    void loadEthPrice();
    const timer = window.setInterval(() => void loadEthPrice(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!market || !publicClient) return;
    const marketAddress = market;
    const client = publicClient;
    let cancelled = false;
    async function loadTrades() {
      try {
        let cursor = await client.getBlockNumber();
        const newestFirst: RecentTrade[] = [];
        while (cursor >= launchBlock && newestFirst.length < 12) {
          const candidate = cursor > 19_999n ? cursor - 19_999n : 0n;
          const fromBlock = candidate < launchBlock ? launchBlock : candidate;
          const logs = await client.getContractEvents({ address: marketAddress, abi: marketAbi, eventName: "Trade", fromBlock, toBlock: cursor, strict: true });
          newestFirst.push(...logs.reverse().flatMap((log) => log.transactionHash ? [{ transactionHash: log.transactionHash, trader: log.args.trader, isBuy: log.args.isBuy, tokenAmount: log.args.tokenAmount, ethAmount: log.args.ethAmount, feeAmount: log.args.feeAmount, virtualEthReserve: log.args.virtualEthReserve, virtualTokenReserve: log.args.virtualTokenReserve, blockNumber: log.blockNumber }] : []));
          if (fromBlock === launchBlock) break;
          cursor = fromBlock - 1n;
        }
        if (cancelled) return;
        setRecentTrades(newestFirst.slice(0, 12));
        setTradeHistoryError(undefined);
      } catch (cause) {
        if (!cancelled) setTradeHistoryError(cause instanceof Error ? cause.message : "Trade history is temporarily unavailable.");
      }
    }
    void loadTrades();
    const timer = window.setInterval(() => void loadTrades(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [launchBlock, market, publicClient, receipt.isSuccess]);

  const ethIn = useMemo(() => { try { return parseEther(buyAmount || "0"); } catch { return 0n; } }, [buyAmount]);
  const tokensIn = useMemo(() => { try { return parseUnits(sellAmount || "0", 18); } catch { return 0n; } }, [sellAmount]);
  const target = market ?? ZERO;
  const enabled = Boolean(market);
  const buyQuote = useReadContract({ address: target, abi: marketAbi, functionName: "quoteBuy", args: [ethIn], chainId: activeChain.id, query: { enabled: enabled && ethIn > 0n, refetchInterval: 5_000 } });
  const sellQuote = useReadContract({ address: target, abi: marketAbi, functionName: "quoteSell", args: [tokensIn], chainId: activeChain.id, query: { enabled: enabled && tokensIn > 0n, refetchInterval: 5_000 } });
  const reserve = useReadContract({ address: target, abi: marketAbi, functionName: "realEthReserve", chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const virtualEth = useReadContract({ address: target, abi: marketAbi, functionName: "virtualEthReserve", chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const virtualTokens = useReadContract({ address: target, abi: marketAbi, functionName: "virtualTokenReserve", chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const graduationTarget = useReadContract({ address: target, abi: marketAbi, functionName: "graduationTarget", chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const progress = useReadContract({ address: target, abi: marketAbi, functionName: "progressBps", chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const graduated = useReadContract({ address: target, abi: marketAbi, functionName: "graduated", chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const fairStartActive = useReadContract({ address: target, abi: marketAbi, functionName: "fairStartActive", chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const fairStartPurchased = useReadContract({ address: target, abi: marketAbi, functionName: "fairStartPurchased", args: [account ?? ZERO], chainId: activeChain.id, query: { enabled: Boolean(account && market), refetchInterval: 5_000 } });
  const balance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "balanceOf", args: [account ?? ZERO], chainId: activeChain.id, query: { enabled: Boolean(account), refetchInterval: 5_000 } });
  const walletBalance = useBalance({ address: account, chainId: activeChain.id, query: { enabled: Boolean(account), refetchInterval: 5_000 } });
  const allowance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "allowance", args: [account ?? ZERO, target], chainId: activeChain.id, query: { enabled: Boolean(account && market), refetchInterval: 5_000 } });
  const buyOut = buyQuote.data?.[0] ?? 0n;
  const sellOut = sellQuote.data?.[0] ?? 0n;
  const needsApproval = tokensIn > 0n && (allowance.data ?? 0n) < tokensIn;
  const busy = isPending || receipt.isLoading;
  const priceWei = virtualTokens.data && virtualTokens.data > 0n ? (virtualEth.data ?? 0n) * 10n ** 18n / virtualTokens.data : 0n;
  const marketCapWei = virtualTokens.data && virtualTokens.data > 0n ? (virtualEth.data ?? 0n) * totalSupply / virtualTokens.data : 0n;
  const positionValueWei = (balance.data ?? 0n) * priceWei / 10n ** 18n;
  const walletValueUsd = ethUsd === undefined ? undefined : Number(formatEther(walletBalance.data?.value ?? 0n)) * ethUsd;
  const positionValueUsd = ethUsd === undefined ? undefined : Number(formatEther(positionValueWei)) * ethUsd;
  const tokenPriceUsd = ethUsd === undefined ? undefined : Number(formatEther(priceWei)) * ethUsd;
  const marketCapUsd = ethUsd === undefined ? undefined : Number(formatEther(marketCapWei)) * ethUsd;
  const buyValueUsd = ethUsd === undefined ? undefined : Number(buyAmount || "0") * ethUsd;
  const sellValueUsd = ethUsd === undefined ? undefined : Number(formatEther(sellOut)) * ethUsd;
  const buyFee = buyQuote.data?.[1] ?? 0n;
  const sellFee = sellQuote.data?.[1] ?? 0n;
  const fairStartMaxTx = totalSupply * 50n / 10_000n;
  const fairStartMaxWallet = totalSupply * 150n / 10_000n;
  const fairStartTxExceeded = Boolean(fairStartActive.data && mode === "buy" && buyOut > fairStartMaxTx);
  const fairStartWalletExceeded = Boolean(fairStartActive.data && mode === "buy" && (fairStartPurchased.data ?? 0n) + buyOut > fairStartMaxWallet);
  const fairStartMessage = fairStartTxExceeded
    ? `Fair Start limits each buy to ${Number(formatUnits(fairStartMaxTx, 18)).toLocaleString()} ${symbol}. Choose a smaller amount.`
    : fairStartWalletExceeded
      ? `This wallet has reached the temporary ${Number(formatUnits(fairStartMaxWallet, 18)).toLocaleString()} ${symbol} Fair Start limit.`
      : undefined;
  const estimatedNetworkFeeWei = preflight.status === "ready" && preflight.gas && preflight.gasPrice ? preflight.gas * preflight.gasPrice : undefined;
  const estimatedNetworkFeeUsd = estimatedNetworkFeeWei !== undefined && ethUsd !== undefined ? Number(formatEther(estimatedNetworkFeeWei)) * ethUsd : undefined;
  const chartPoints = useMemo<PricePoint[]>(() => [...recentTrades].reverse().flatMap((trade) => trade.virtualTokenReserve > 0n ? [{ blockNumber: trade.blockNumber, priceWei: trade.virtualEthReserve * 10n ** 18n / trade.virtualTokenReserve, side: trade.isBuy ? "buy" : "sell" }] : []), [recentTrades]);

  useEffect(() => {
    if (!publicClient || !market || !account || graduated.data) {
      setPreflight({ status: "idle" });
      return;
    }
    const hasOrder = mode === "buy" ? ethIn > 0n && buyOut > 0n : tokensIn > 0n && sellOut > 0n;
    if (!hasOrder) {
      setPreflight({ status: "idle" });
      return;
    }
    if (fairStartMessage) {
      setPreflight({ status: "error", message: fairStartMessage });
      return;
    }
    let cancelled = false;
    setPreflight({ status: "checking" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
          let gas: bigint;
          if (mode === "buy") {
            gas = await publicClient.estimateContractGas({ account, address: market, abi: marketAbi, functionName: "buy", args: [account, buyOut * 99n / 100n, deadline], value: ethIn });
          } else if (needsApproval) {
            gas = await publicClient.estimateContractGas({ account, address: tokenAddress, abi: tokenTradeAbi, functionName: "approve", args: [market, maxUint256] });
          } else {
            gas = await publicClient.estimateContractGas({ account, address: market, abi: marketAbi, functionName: "sell", args: [tokensIn, sellOut * 99n / 100n, account, deadline] });
          }
          const gasPrice = await publicClient.getGasPrice();
          if (!cancelled) setPreflight({ status: "ready", gas, gasPrice });
        } catch (cause) {
          if (cancelled) return;
          const detail = cause instanceof Error ? cause.message : "";
          const message = /FairStartTransactionLimit/i.test(detail)
            ? `Fair Start limits each buy to ${Number(formatUnits(fairStartMaxTx, 18)).toLocaleString()} ${symbol}. Choose a smaller amount.`
            : /FairStartWalletLimit/i.test(detail)
              ? `This wallet has reached the temporary ${Number(formatUnits(fairStartMaxWallet, 18)).toLocaleString()} ${symbol} Fair Start limit.`
              : /FairStartBlockLimit/i.test(detail)
                ? "Fair Start allows one buy per block. Wait about 15 seconds, then try again."
                : /TradingNotOpen/i.test(detail)
                  ? "Trading opens automatically after the short Fair Start delay."
                  : /MarketGraduated/i.test(detail)
                    ? "This curve has graduated. Trading continues on the DEX."
                    : /insufficient funds/i.test(detail)
                      ? "This wallet needs enough ETH for the order and its network fee."
                      : "This order could not be simulated. Refresh the quote, then try a smaller amount.";
          setPreflight({ status: "error", message });
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [account, buyOut, ethIn, fairStartMaxTx, fairStartMaxWallet, fairStartMessage, graduated.data, market, mode, needsApproval, publicClient, sellOut, symbol, tokenAddress, tokensIn]);

  useEffect(() => {
    if (!receipt.isSuccess) return;
    if (lastAction !== "approve") setTradeMessage(undefined);
    void Promise.all([buyQuote.refetch(), sellQuote.refetch(), reserve.refetch(), virtualEth.refetch(), virtualTokens.refetch(), graduationTarget.refetch(), progress.refetch(), graduated.refetch(), fairStartActive.refetch(), fairStartPurchased.refetch(), balance.refetch(), walletBalance.refetch(), allowance.refetch()]);
  }, [receipt.isSuccess]);

  useEffect(() => {
    if (!receipt.isSuccess || lastAction !== "approve" || !market || !account) return;
    setLastAction("sell");
    setTradeMessage("Approval confirmed. Confirm the sell in your wallet.");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    writeContract({ address: market, abi: marketAbi, functionName: "sell", args: [tokensIn, sellOut * 99n / 100n, account, deadline], chainId: activeChain.id });
  }, [receipt.isSuccess, lastAction, market, account, tokensIn, sellOut, writeContract]);

  function chooseBuyUsd(usdAmount: number) {
    if (!ethUsd) return;
    setBuyAmount(cleanDecimal((usdAmount / ethUsd).toFixed(6)));
  }

  function chooseSellPercent(percent: number) {
    const available = balance.data ?? 0n;
    const amount = percent === 100 ? available : available * BigInt(percent) / 100n;
    setSellAmount(cleanDecimal(formatUnits(amount, 18)));
  }

  function trade() {
    if (!market || !account || preflight.status !== "ready") return;
    resetWrite();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    if (mode === "buy") {
      setLastAction("buy");
      setTradeMessage("Review the ETH amount and network fee in your wallet.");
      writeContract({ address: market, abi: marketAbi, functionName: "buy", args: [account, buyOut * 99n / 100n, deadline], value: ethIn, chainId: activeChain.id });
    } else if (needsApproval) {
      setLastAction("approve");
      setTradeMessage("One-time market approval. Your sell confirmation follows automatically.");
      writeContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "approve", args: [market, maxUint256], chainId: activeChain.id });
    } else {
      setLastAction("sell");
      setTradeMessage("Review the token amount and minimum ETH received in your wallet.");
      writeContract({ address: market, abi: marketAbi, functionName: "sell", args: [tokensIn, sellOut * 99n / 100n, account, deadline], chainId: activeChain.id });
    }
  }

  if (lookupError) return <section className="panel marketPanel"><p className="eyebrow">LIVE MARKET</p><h2>Market unavailable</h2><p>{lookupError}</p></section>;
  if (!market) return <section className="panel marketPanel"><p className="eyebrow">LIVE MARKET</p><h2>Reading bonding curve…</h2></section>;

  return (
    <section className="panel marketPanel">
      <div className="sectionTitle"><div><p className="eyebrow">LIVE BONDING CURVE</p><h2>Trade ${symbol}</h2></div><span className="badge liveBadge">{isMainnetRelease ? "MAINNET" : "TESTNET"}</span></div>
      <div className="marketStats intelligenceStats"><div><small>Token price</small><strong>{formatUsd(tokenPriceUsd)}</strong><span className="usdSub">{formatPrice(priceWei)} ETH</span></div><div><small>Market cap</small><strong>{formatUsd(marketCapUsd)}</strong><span className="usdSub">{formatEth(marketCapWei, 6)} ETH fully diluted</span></div><div><small>Curve reserve</small><strong>{ethUsd ? formatUsd(Number(formatEther(reserve.data ?? 0n)) * ethUsd) : "USD unavailable"}</strong><span className="usdSub">{formatEth(reserve.data ?? 0n, 7)} ETH</span></div><div><small>Your position</small><strong>{Number(formatUnits(balance.data ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong><span className="usdSub">≈ {formatUsd(positionValueUsd)} · {formatEth(positionValueWei, 7)} ETH</span></div></div>
      {isConnected && <div className="buyingPowerBar"><div><small>Robinhood Chain buying power</small><strong>{walletBalance.isLoading ? "Reading wallet…" : `${formatEth(walletBalance.data?.value ?? 0n, 7)} ETH`}</strong><span>≈ {formatUsd(walletValueUsd)} available before network fees</span></div><a href="https://docs.robinhood.com/chain/bridging/" target="_blank" rel="noreferrer">Add ETH ↗</a></div>}
      <div className="graduationCard">
        <div><span>Market reserve</span><strong>{formatEth(reserve.data ?? 0n, 7)} ETH</strong></div>
        <small>{isMainnetRelease ? graduated.data ? "Graduated to Uniswap V4. Curve trading is closed; DEX routing is next." : `${Number(progress.data ?? 0n) / 100}% toward automatic Uniswap V4 graduation (${formatEth(graduationTarget.data ?? 0n, 4)} ETH target).` : "DEX migration is disabled in this testnet alpha. Launching, curve trading, and fee accounting remain live."}</small>
      </div>
      {fairStartActive.data && <div className="callout"><strong>Fair Start anti-sniper protection is active</strong><span>Maximum {Number(formatUnits(fairStartMaxTx, 18)).toLocaleString()} {symbol} per buy and {Number(formatUnits(fairStartMaxWallet, 18)).toLocaleString()} {symbol} per wallet. Only one buy per block; smaller orders may be required temporarily.</span></div>}
      <PriceHistoryChart points={chartPoints} symbol={symbol} ethUsd={ethUsd} marketCapUsd={marketCapUsd} />
      {!isConnected && <details className="starterGuide" open>
        <summary><span>New to Robinhood Chain?</span><small>3 simple steps</small></summary>
        <div className="starterSteps">
          <div><b>1</b><span><strong>Connect a wallet</strong><small>Use Robinhood Wallet, MetaMask, Phantom, or another EVM wallet.</small></span></div>
          <div><b>2</b><span><strong>Fund it with Chain ETH</strong><small>Gas and purchases use ETH on Robinhood Chain—not ETH sitting on another network or in a brokerage account.</small></span></div>
          <div><b>3</b><span><strong>Choose dollars and review</strong><small>RMT converts your dollar choice to ETH, simulates the order, then your wallet asks for approval.</small></span></div>
        </div>
        <div className="starterLinks"><a href="https://docs.robinhood.com/chain/add-network-to-wallet/" target="_blank" rel="noreferrer">Official wallet setup ↗</a><a href="https://docs.robinhood.com/chain/bridging/" target="_blank" rel="noreferrer">Official funding options ↗</a></div>
      </details>}
      <div className="tradeTabs"><button className={mode === "buy" ? "active" : ""} onClick={() => setMode("buy")}>Buy</button><button className={mode === "sell" ? "active" : ""} onClick={() => setMode("sell")}>Sell</button></div>
      {mode === "buy" ? <div className="tradeAmountCard">
        <div className="tradeAmountTop"><span>You pay</span><small>{ethUsd ? `1 ETH ≈ ${formatUsd(ethUsd)}` : "Loading ETH/USD…"}</small></div>
        <div className="tradeInputRow"><input aria-label="ETH amount to buy" inputMode="decimal" value={buyAmount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setBuyAmount(event.target.value)} /><span>ETH</span></div>
        <div className="usdEstimate">≈ {formatUsd(buyValueUsd)} <span>reference value</span></div>
        <div className="quickAmounts" aria-label="Quick dollar amounts">{[1, 5, 10, 25].map((amount) => <button type="button" key={amount} disabled={!ethUsd} onClick={() => chooseBuyUsd(amount)}>${amount}</button>)}</div>
        <div className="orderPreview"><div><span>Estimated receive</span><strong>{Number(formatUnits(buyOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong></div><div><span>Platform fee</span><strong>{formatEth(buyFee)} ETH</strong></div></div>
      </div> : <div className="tradeAmountCard">
        <div className="tradeAmountTop"><span>You sell</span><small>Balance {Number(formatUnits(balance.data ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</small></div>
        <div className="tradeInputRow"><input aria-label={`${symbol} amount to sell`} inputMode="decimal" value={sellAmount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setSellAmount(event.target.value)} /><span>{symbol}</span></div>
        <div className="usdEstimate">≈ {formatUsd(sellValueUsd)} <span>estimated proceeds</span></div>
        <div className="quickAmounts" aria-label="Quick sell percentages">{[25, 50, 75, 100].map((percent) => <button type="button" key={percent} disabled={(balance.data ?? 0n) === 0n} onClick={() => chooseSellPercent(percent)}>{percent === 100 ? "Max" : `${percent}%`}</button>)}</div>
        <div className="orderPreview"><div><span>Estimated receive</span><strong>{Number(formatEther(sellOut)).toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH</strong></div><div><span>Platform fee</span><strong>{formatEth(sellFee)} ETH</strong></div></div>
        {needsApproval && isConnected && <p className="approvalNote">Your first sell creates a reusable allowance for this token’s immutable market. You can revoke it from your wallet at any time.</p>}
      </div>}
      <div className="tradeDisclosure"><span>Live curve quote</span><span>1% slippage protection</span><span>10-minute deadline</span><span>USD is an estimate</span></div>
      <div className={`preflightCard ${preflight.status}`} role="status">
        <span className="preflightIcon">{preflight.status === "ready" ? "✓" : preflight.status === "error" ? "!" : "•"}</span>
        <div>
          <strong>{!isConnected ? "Connect to review this order" : preflight.status === "checking" ? "Checking this order onchain…" : preflight.status === "ready" ? "Order check passed" : preflight.status === "error" ? "Order needs attention" : "Enter an amount to continue"}</strong>
          <small>{!isConnected ? "RMT will simulate the transaction and estimate the network fee before your wallet opens." : preflight.status === "ready" && estimatedNetworkFeeWei !== undefined ? `Estimated network fee ${formatEth(estimatedNetworkFeeWei, 7)} ETH · ≈ ${formatUsd(estimatedNetworkFeeUsd)}` : preflight.message ?? "Quotes and network fees refresh automatically."}</small>
        </div>
      </div>
      {(isPending || receipt.isLoading) && <div className="tradeStage" role="status"><span className="tradeStageDot" /><div><strong>{isPending ? "Review in your wallet" : "Order submitted"}</strong><small>{isPending ? "Your wallet should open now. On a phone, switch to the wallet app if needed, approve, then return to RMT." : "Waiting for Robinhood Chain confirmation."}</small>{receipt.isLoading && hash && <a href={`${activeChain.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">Track transaction ↗</a>}</div></div>}
      {(writeError || receipt.error) && <div className="errors"><span>{writeError?.message || receipt.error?.message}</span></div>}
      {tradeMessage && <div className="callout"><strong>{tradeMessage}</strong></div>}
      {receipt.isSuccess && lastAction !== "approve" && <div className="callout"><strong>{lastAction === "sell" ? "Sell confirmed" : "Buy confirmed"}</strong><a href={`${activeChain.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      <button className="launch" disabled={!isConnected || busy || Boolean(graduated.data) || preflight.status !== "ready" || (mode === "buy" ? buyOut === 0n : sellOut === 0n)} onClick={trade}>{graduated.data ? "Graduated — trade on DEX" : !isConnected ? "Connect wallet to trade" : busy ? lastAction === "approve" ? "Approving…" : lastAction === "sell" ? "Confirm sell in wallet…" : "Confirming…" : preflight.status === "checking" ? "Checking order…" : preflight.status === "error" ? "Review order details" : preflight.status === "idle" ? "Preparing quote…" : mode === "buy" ? `Buy ${symbol}` : needsApproval ? `Enable and sell ${symbol}` : `Sell ${symbol}`}</button>
      <a className="explorerLink" href={`${activeChain.blockExplorers.default.url}/address/${market}`} target="_blank" rel="noreferrer">Open market in explorer ↗</a>
      <div className="tradeHistory">
        <div className="historyHeader"><div><p className="eyebrow">ONCHAIN ACTIVITY</p><h3>Recent trades</h3></div><span>{recentTrades.length} shown</span></div>
        {recentTrades.length > 0 ? <div className="tradeList">{recentTrades.map((item) => {
          const effectiveEth = item.isBuy ? item.ethAmount : item.ethAmount - item.feeAmount;
          return <a key={`${item.transactionHash}-${item.blockNumber}`} href={`${activeChain.blockExplorers.default.url}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer" className="tradeRow"><span className={item.isBuy ? "tradeSide buy" : "tradeSide sell"}>{item.isBuy ? "BUY" : "SELL"}</span><span><strong>{Number(formatUnits(item.tokenAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong><small>{compactAddress(item.trader)}</small></span><span><strong>{formatEth(effectiveEth)} ETH</strong><small>Block {item.blockNumber.toString()}</small></span></a>;
        })}</div> : <div className="emptyTrades"><strong>No trades yet</strong><span>The first confirmed buy or sell will appear here automatically.</span></div>}
        {tradeHistoryError && <small className="historyError">Trade history will retry automatically.</small>}
      </div>
    </section>
  );
}
