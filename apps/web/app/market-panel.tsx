"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, formatEther, formatUnits, maxUint256, parseEther, parseUnits, type Address } from "viem";
import { useAccount, useBalance, useCapabilities, usePublicClient, useReadContract, useSendCalls, useWaitForCallsStatus, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { activeChain, isMainnetRelease } from "../lib/network";
import { useLaunchRecord, type LaunchRecordHint } from "../lib/use-launch-record";
import { PriceHistoryChart, type PricePoint } from "./price-history-chart";
import { WalletButton } from "./wallet-button";

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
  { type: "function", name: "graduationAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fairStartActive", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "tradingOpensAtBlock", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "fairStartEndsAtBlock", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "fairStartMaxTxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "fairStartMaxWalletBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
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

const graduationAdapterStateAbi = [
  { type: "function", name: "isGraduated", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "bool" }] }
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

function formatPercent(bps: bigint) {
  return `${(Number(bps) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

type MarketPanelProps = {
  tokenAddress: Address;
  symbol: string;
  totalSupply: bigint;
  creator: Address;
  compact?: boolean;
  initialMode?: "buy" | "sell";
  launchHint?: LaunchRecordHint;
};

export function MarketPanel({ tokenAddress, symbol, totalSupply, creator, compact = false, initialMode, launchHint }: MarketPanelProps) {
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { address: account, isConnected } = useAccount();
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [tradeHistoryError, setTradeHistoryError] = useState<string>();
  const [mode, setMode] = useState<"buy" | "sell">(initialMode ?? "buy");
  const [buyAmount, setBuyAmount] = useState("0.0001");
  const [sellAmount, setSellAmount] = useState("1000000");
  const [lastAction, setLastAction] = useState<"buy" | "approve" | "sell" | null>(null);
  const [tradeMessage, setTradeMessage] = useState<string>();
  const [ethUsd, setEthUsd] = useState<number>();
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<string>();
  const [preflight, setPreflight] = useState<TradePreflight>({ status: "idle" });
  const [creatorRiskAccepted, setCreatorRiskAccepted] = useState(false);
  const [atomicBatchUnavailable, setAtomicBatchUnavailable] = useState(false);
  const [marketDetail, setMarketDetail] = useState<"activity" | "risk">("activity");
  const tradeRailRef = useRef<HTMLElement>(null);
  const marketDetailRef = useRef<HTMLDivElement>(null);
  const creatorAnalyticsRef = useRef<HTMLElement>(null);
  const seededQuickBuy = useRef(false);
  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: activeChain.id });
  const capabilities = useCapabilities({ chainId: activeChain.id, query: { enabled: Boolean(account) } });
  const { sendCalls, data: calls, isPending: callsPending, error: callsError, reset: resetCalls } = useSendCalls();
  const callsReceipt = useWaitForCallsStatus({ id: calls?.id, query: { enabled: Boolean(calls?.id) } });
  const launchRecord = useLaunchRecord(tokenAddress, launchHint);
  const market = launchRecord.data?.market ?? null;
  const launchBlock = launchRecord.data?.blockNumber ?? 0n;
  const lookupError = launchRecord.error ? (launchRecord.error instanceof Error ? launchRecord.error.message : "Unable to read market.") : launchRecord.isSuccess && !launchRecord.data ? "Market record not found." : undefined;

  useEffect(() => {
    if (initialMode) {
      setMode(initialMode);
      return;
    }
    const requestedSide = new URLSearchParams(window.location.search).get("side");
    if (requestedSide === "buy" || requestedSide === "sell") setMode(requestedSide);
  }, [initialMode]);

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
        const latestBlock = await client.getBlockNumber();
        const recentStart = latestBlock > 19_999n ? latestBlock - 19_999n : 0n;
        const fromBlock = launchBlock > recentStart ? launchBlock : recentStart;
        const logs = await client.getContractEvents({ address: marketAddress, abi: marketAbi, eventName: "Trade", fromBlock, toBlock: latestBlock, strict: true });
        const newestFirst: RecentTrade[] = logs.reverse().flatMap((log) => log.transactionHash ? [{ transactionHash: log.transactionHash, trader: log.args.trader, isBuy: log.args.isBuy, tokenAmount: log.args.tokenAmount, ethAmount: log.args.ethAmount, feeAmount: log.args.feeAmount, virtualEthReserve: log.args.virtualEthReserve, virtualTokenReserve: log.args.virtualTokenReserve, blockNumber: log.blockNumber }] : []);
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
  const graduationAdapter = useReadContract({ address: target, abi: marketAbi, functionName: "graduationAdapter", chainId: activeChain.id, query: { enabled: isMainnetRelease && enabled, retry: false, refetchInterval: 30_000 } });
  const graduationAdapterAddress = graduationAdapter.data ?? ZERO;
  const migrated = useReadContract({ address: graduationAdapterAddress, abi: graduationAdapterStateAbi, functionName: "isGraduated", args: [tokenAddress], chainId: activeChain.id, query: { enabled: isMainnetRelease && graduated.data === true && graduationAdapter.data !== undefined && graduationAdapter.data !== ZERO, retry: false, refetchInterval: 5_000 } });
  const fairStartActive = useReadContract({ address: target, abi: marketAbi, functionName: "fairStartActive", chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const fairStartMaxTxBps = useReadContract({ address: target, abi: marketAbi, functionName: "fairStartMaxTxBps", chainId: activeChain.id, query: { enabled, retry: false } });
  const fairStartMaxWalletBps = useReadContract({ address: target, abi: marketAbi, functionName: "fairStartMaxWalletBps", chainId: activeChain.id, query: { enabled, retry: false } });
  const fairStartPurchased = useReadContract({ address: target, abi: marketAbi, functionName: "fairStartPurchased", args: [account ?? ZERO], chainId: activeChain.id, query: { enabled: Boolean(account && market), refetchInterval: 5_000 } });
  const balance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "balanceOf", args: [account ?? ZERO], chainId: activeChain.id, query: { enabled: Boolean(account), refetchInterval: 5_000 } });
  const creatorBalance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "balanceOf", args: [creator], chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const marketInventory = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "balanceOf", args: [target], chainId: activeChain.id, query: { enabled, refetchInterval: 5_000 } });
  const walletBalance = useBalance({ address: account, chainId: activeChain.id, query: { enabled: Boolean(account), refetchInterval: 5_000 } });
  const allowance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "allowance", args: [account ?? ZERO, target], chainId: activeChain.id, query: { enabled: Boolean(account && market), refetchInterval: 5_000 } });
  const buyOut = buyQuote.data?.[0] ?? 0n;
  const sellOut = sellQuote.data?.[0] ?? 0n;
  const needsApproval = tokensIn > 0n && (allowance.data ?? 0n) < tokensIn;
  const atomicSellAvailable = needsApproval && !atomicBatchUnavailable && capabilities.data?.atomic?.status === "supported";
  const busy = isPending || receipt.isLoading || callsPending || callsReceipt.isLoading;
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
  const fairStartMaxTx = totalSupply * BigInt(fairStartMaxTxBps.data ?? 100) / 10_000n;
  const fairStartMaxWallet = totalSupply * BigInt(fairStartMaxWalletBps.data ?? 300) / 10_000n;
  const fairStartBought = fairStartPurchased.data ?? 0n;
  const fairStartWalletRemaining = fairStartMaxWallet > fairStartBought ? fairStartMaxWallet - fairStartBought : 0n;
  const fairStartNextBuyLimit = fairStartMaxTx < fairStartWalletRemaining ? fairStartMaxTx : fairStartWalletRemaining;
  const fairStartVisible = Boolean(fairStartActive.data);
  const fairStartTxExceeded = Boolean(fairStartActive.data && mode === "buy" && buyOut > fairStartMaxTx);
  const fairStartWalletExceeded = Boolean(fairStartActive.data && mode === "buy" && fairStartBought + buyOut > fairStartMaxWallet);
  const circulatingSupply = totalSupply > (marketInventory.data ?? totalSupply) ? totalSupply - (marketInventory.data ?? totalSupply) : 0n;
  const creatorBalanceValue = creatorBalance.data ?? 0n;
  const creatorSupplyBps = totalSupply > 0n ? creatorBalanceValue * 10_000n / totalSupply : 0n;
  const creatorCirculatingBps = circulatingSupply > 0n ? creatorBalanceValue * 10_000n / circulatingSupply : 0n;
  const creatorConcentrationKnown = creatorBalance.data !== undefined && marketInventory.data !== undefined;
  const highCreatorConcentration = creatorConcentrationKnown && creatorCirculatingBps >= 2_500n;
  const creatorRiskRequired = mode === "buy" && highCreatorConcentration;
  const creatorRecentTrades = recentTrades.filter((trade) => trade.trader.toLowerCase() === creator.toLowerCase());
  const creatorRecentBuys = creatorRecentTrades.filter((trade) => trade.isBuy);
  const creatorRecentSells = creatorRecentTrades.filter((trade) => !trade.isBuy);
  const creatorRecentNet = creatorRecentBuys.reduce((sum, trade) => sum + trade.tokenAmount, 0n) - creatorRecentSells.reduce((sum, trade) => sum + trade.tokenAmount, 0n);
  const migratedToV4 = migrated.data === true;
  const uniswapSwapUrl = mode === "buy"
    ? `https://app.uniswap.org/swap?chain=robinhood&inputCurrency=NATIVE&outputCurrency=${tokenAddress}`
    : `https://app.uniswap.org/swap?chain=robinhood&inputCurrency=${tokenAddress}&outputCurrency=NATIVE`;
  const fairStartMessage = fairStartTxExceeded
    ? "This opening buy is above the temporary protected limit. Use the suggested maximum or enter a smaller amount."
    : fairStartWalletExceeded
      ? "This wallet has reached its temporary protected-launch allowance. Normal buying unlocks automatically when the countdown ends."
      : undefined;
  const estimatedNetworkFeeWei = preflight.status === "ready" && preflight.gas && preflight.gasPrice ? preflight.gas * preflight.gasPrice : undefined;
  const estimatedNetworkFeeUsd = estimatedNetworkFeeWei !== undefined && ethUsd !== undefined ? Number(formatEther(estimatedNetworkFeeWei)) * ethUsd : undefined;
  const gasReserveWei = estimatedNetworkFeeWei !== undefined ? estimatedNetworkFeeWei * 2n : parseEther("0.00002");
  const walletBalanceWei = walletBalance.data?.value ?? 0n;
  const walletSpendableWei = walletBalanceWei > gasReserveWei ? walletBalanceWei - gasReserveWei : 0n;
  const chartPoints = useMemo<PricePoint[]>(() => [...recentTrades].reverse().flatMap((trade) => trade.virtualTokenReserve > 0n ? [{ blockNumber: trade.blockNumber, priceWei: trade.virtualEthReserve * 10n ** 18n / trade.virtualTokenReserve, side: trade.isBuy ? "buy" : "sell" }] : []), [recentTrades]);

  useEffect(() => {
    setCreatorRiskAccepted(false);
    setAtomicBatchUnavailable(false);
    resetCalls();
  }, [tokenAddress]);

  useEffect(() => {
    if (!callsError) return;
    setAtomicBatchUnavailable(true);
    setTradeMessage("This wallet could not combine approval and selling. Tap Sell again for the standard one-time approval flow.");
  }, [callsError]);

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
            ? "This opening buy is above the temporary protected limit. Use the suggested maximum or enter a smaller amount."
            : /FairStartWalletLimit/i.test(detail)
              ? "This wallet has reached its temporary protected-launch allowance. Normal buying unlocks automatically when the countdown ends."
              : /FairStartBlockLimit/i.test(detail)
                ? "Protected launch allows one buy per wallet in each block. Wait for the next block, then try again."
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
    if (lastAction === "buy") setCreatorRiskAccepted(false);
    void Promise.all([buyQuote.refetch(), sellQuote.refetch(), reserve.refetch(), virtualEth.refetch(), virtualTokens.refetch(), graduationTarget.refetch(), progress.refetch(), graduated.refetch(), fairStartActive.refetch(), fairStartPurchased.refetch(), balance.refetch(), walletBalance.refetch(), allowance.refetch()]);
  }, [receipt.isSuccess]);

  useEffect(() => {
    if (!receipt.isSuccess || lastAction !== "approve" || !market || !account) return;
    setLastAction("sell");
    setTradeMessage("Approval confirmed. Confirm the sell in your wallet.");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    writeContract({ address: market, abi: marketAbi, functionName: "sell", args: [tokensIn, sellOut * 99n / 100n, account, deadline], chainId: activeChain.id });
  }, [receipt.isSuccess, lastAction, market, account, tokensIn, sellOut, writeContract]);

  useEffect(() => {
    if (callsReceipt.data?.status !== "success") return;
    setTradeMessage("Sell confirmed in one wallet action.");
    void Promise.all([sellQuote.refetch(), reserve.refetch(), virtualEth.refetch(), virtualTokens.refetch(), graduationTarget.refetch(), progress.refetch(), graduated.refetch(), balance.refetch(), walletBalance.refetch(), allowance.refetch()]);
  }, [callsReceipt.data?.status]);

  useEffect(() => {
    if (!compact || mode !== "buy" || seededQuickBuy.current || !isConnected || !ethUsd || walletSpendableWei <= 0n) return;
    const walletStarter = walletSpendableWei * 5n / 100n;
    const fiveDollarCap = parseEther((5 / ethUsd).toFixed(8));
    const starter = walletStarter < fiveDollarCap ? walletStarter : fiveDollarCap;
    if (starter > 0n) setBuyAmount(cleanDecimal(formatEther(starter)));
    seededQuickBuy.current = true;
  }, [compact, ethUsd, isConnected, mode, walletSpendableWei]);

  function chooseBuyUsd(usdAmount: number) {
    if (!ethUsd) return;
    setBuyAmount(cleanDecimal((usdAmount / ethUsd).toFixed(6)));
  }

  function chooseBuyPercent(percent: number) {
    const amount = percent === 100 ? walletSpendableWei : walletSpendableWei * BigInt(percent) / 100n;
    if (amount > 0n) setBuyAmount(cleanDecimal(formatEther(amount)));
  }

  function chooseSellPercent(percent: number) {
    const available = balance.data ?? 0n;
    const amount = percent === 100 ? available : available * BigInt(percent) / 100n;
    setSellAmount(cleanDecimal(formatUnits(amount, 18)));
  }

  function chooseProtectedMaximum() {
    if (ethIn <= 0n || buyOut <= 0n || fairStartNextBuyLimit <= 0n) return;
    const protectedEthAmount = ethIn * fairStartNextBuyLimit * 99n / (buyOut * 100n);
    if (protectedEthAmount > 0n) setBuyAmount(cleanDecimal(formatEther(protectedEthAmount)));
  }

  function trade() {
    if (!market || !account || preflight.status !== "ready") return;
    resetWrite();
    resetCalls();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    if (mode === "buy") {
      setLastAction("buy");
      setTradeMessage("Review the ETH amount and network fee in your wallet.");
      writeContract({ address: market, abi: marketAbi, functionName: "buy", args: [account, buyOut * 99n / 100n, deadline], value: ethIn, chainId: activeChain.id });
    } else if (atomicSellAvailable) {
      setLastAction("sell");
      setTradeMessage("Review one combined approval-and-sell action in your wallet.");
      sendCalls({
        account,
        chainId: activeChain.id,
        forceAtomic: true,
        calls: [
          { to: tokenAddress, data: encodeFunctionData({ abi: tokenTradeAbi, functionName: "approve", args: [market, maxUint256] }) },
          { to: market, data: encodeFunctionData({ abi: marketAbi, functionName: "sell", args: [tokensIn, sellOut * 99n / 100n, account, deadline] }) }
        ]
      });
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

  function focusTradeMode(nextMode: "buy" | "sell") {
    setMode(nextMode);
    window.requestAnimationFrame(() => tradeRailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function showCreatorAnalytics() {
    setMarketDetail("risk");
    window.requestAnimationFrame(() => (compact ? creatorAnalyticsRef.current : marketDetailRef.current)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  if (lookupError) return <section className={compact ? "quickMarketPanel marketLookupState" : "panel marketPanel marketLookupState"}><p className="eyebrow">LIVE MARKET</p><h2>Market connection delayed</h2><p>{lookupError}</p><button type="button" onClick={() => void launchRecord.refetch()}>Retry market</button></section>;
  if (!market) return <section className={compact ? "quickMarketPanel marketLookupState" : "panel marketPanel marketLookupState"}><p className="eyebrow">LIVE MARKET</p><h2>Opening live market…</h2><p>Verifying this token directly against the active V6 factory.</p><button type="button" disabled={launchRecord.isFetching} onClick={() => void launchRecord.refetch()}>{launchRecord.isFetching ? "Verifying V6…" : "Retry now"}</button></section>;

  return (
    <section className={compact ? "quickMarketPanel" : "panel marketPanel"} id={compact ? undefined : "trade"}>
      {!compact && <div className="sectionTitle marketTitle"><div><p className="eyebrow">LIVE BONDING CURVE</p><h2>Trade ${symbol}</h2></div><span className="badge liveBadge">{isMainnetRelease ? "MAINNET" : "TESTNET"}</span></div>}
      <div className="marketWorkspace">
        <div className="marketOverview">
          {!compact && <PriceHistoryChart points={chartPoints} symbol={symbol} ethUsd={ethUsd} marketCapUsd={marketCapUsd} />}
          {compact ? <div className="quickMarketSnapshot"><div><small>Price</small><strong>{formatUsd(tokenPriceUsd)}</strong></div><div><small>Market cap</small><strong>{formatUsd(marketCapUsd)}</strong></div><div><small>Graduation</small><strong>{Number(progress.data ?? 0n) / 100}%</strong></div></div> : <><div className="marketStats intelligenceStats"><div><small>Token price</small><strong>{formatUsd(tokenPriceUsd)}</strong><span className="usdSub">{formatPrice(priceWei)} ETH</span></div><div><small>Market cap</small><strong>{formatUsd(marketCapUsd)}</strong><span className="usdSub">{formatEth(marketCapWei, 6)} ETH fully diluted</span></div><div><small>Curve reserve</small><strong>{ethUsd ? formatUsd(Number(formatEther(reserve.data ?? 0n)) * ethUsd) : "USD unavailable"}</strong><span className="usdSub">{formatEth(reserve.data ?? 0n, 7)} ETH</span></div><div><small>Your position</small><strong>{Number(formatUnits(balance.data ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong><span className="usdSub">≈ {formatUsd(positionValueUsd)} · {formatEth(positionValueWei, 7)} ETH</span></div></div>
          {isConnected && <div className="buyingPowerBar"><div><small>Robinhood Chain buying power</small><strong>{walletBalance.isLoading ? "Reading wallet…" : `${formatEth(walletBalance.data?.value ?? 0n, 7)} ETH`}</strong><span>≈ {formatUsd(walletValueUsd)} available before network fees</span></div><a href="https://docs.robinhood.com/chain/bridging/" target="_blank" rel="noreferrer">Add ETH ↗</a></div>}
          <div className="graduationCard">
            <div><span>Market reserve</span><strong>{formatEth(reserve.data ?? 0n, 7)} ETH</strong></div>
            <small>{isMainnetRelease ? graduated.data ? migratedToV4 ? "Graduated to the canonical Uniswap V4 pool. Curve trading is permanently closed; choose Buy or Sell to continue in the official Uniswap app." : "The curve target is complete and curve trading is permanently closed. The permissionless V4 finalization transaction is available in Graduation & fees." : `${Number(progress.data ?? 0n) / 100}% toward curve completion and V4 graduation readiness (${formatEth(graduationTarget.data ?? 0n, 4)} ETH target).` : "DEX migration is disabled in this testnet alpha. Launching, curve trading, and fee accounting remain live."}</small>
          </div></>}
          {fairStartVisible && <section className="fairStartCard" aria-labelledby="fair-start-heading">
            <div className="fairStartHeader"><div><p className="eyebrow">FAIR START</p><h3 id="fair-start-heading">Fair Start protection is active</h3></div><strong>ACTIVE</strong></div>
            <p>Large early buys are temporarily limited so more traders get a fair chance. The contract removes these limits automatically when its protected window ends. Selling remains available.</p>
            <div className="fairStartMetrics"><div><small>Per buy</small><strong>Up to {Number(formatUnits(fairStartMaxTx, 18)).toLocaleString()} {symbol}</strong></div><div><small>{account ? "Your remaining allowance" : "Per wallet"}</small><strong>{Number(formatUnits(account ? fairStartWalletRemaining : fairStartMaxWallet, 18)).toLocaleString()} {symbol}</strong></div></div>
            {fairStartActive.data && fairStartNextBuyLimit > 0n && buyOut > fairStartNextBuyLimit && <button type="button" className="fairStartAction" onClick={chooseProtectedMaximum}>Use protected max</button>}
            {fairStartActive.data && account && fairStartWalletRemaining === 0n && <small className="fairStartNotice">You have used this wallet’s opening allowance. The limit disappears automatically when Fair Start ends.</small>}
          </section>}
          {compact && <PriceHistoryChart points={chartPoints} symbol={symbol} ethUsd={ethUsd} marketCapUsd={marketCapUsd} />}
        </div>

        <aside className={`tradeRail ${mode}`} ref={tradeRailRef} aria-label={`Trade ${symbol}`}>
          <div className="tradeRailHeader"><div><p className="eyebrow">PLACE ORDER</p><h3>{mode === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}</h3></div><span>Live quote</span></div>
          <div className="tradeTabs"><button type="button" className={mode === "buy" ? "active" : ""} aria-pressed={mode === "buy"} onClick={() => setMode("buy")}>Buy</button><button type="button" className={mode === "sell" ? "active" : ""} aria-pressed={mode === "sell"} onClick={() => setMode("sell")}>Sell</button></div>
          {graduated.data ? <div className="tradeAmountCard dexHandoffCard">
            <div className="tradeAmountTop"><span>{migratedToV4 ? `${mode === "buy" ? "Buy" : "Sell"} ${symbol} on Uniswap V4` : "V4 pool finalization required"}</span><small>{migratedToV4 ? "Official Uniswap app" : "One permissionless transaction"}</small></div>
            <p>{migratedToV4 ? `RMT has verified the adapter migration onchain. Uniswap will show the live pool quote, price impact, and network fee before your wallet confirms the ${mode}.` : "The curve can no longer accept orders. Finalize V4 graduation in the verified Graduation & fees panel; the caller pays gas but receives no funds, tokens, liquidity, or reward."}</p>
          </div> : mode === "buy" ? <div className="tradeAmountCard">
            <div className="tradeAmountTop"><span>You pay</span><small>{ethUsd ? `1 ETH ≈ ${formatUsd(ethUsd)}` : "Loading ETH/USD…"}</small></div>
            <div className="tradeInputRow"><input aria-label="ETH amount to buy" inputMode="decimal" value={buyAmount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setBuyAmount(event.target.value)} /><span>ETH</span></div>
            <div className="usdEstimate">≈ {formatUsd(buyValueUsd)} <span>reference value</span></div>
            {isConnected && walletBalance.data ? <><div className="quickAmounts walletQuickAmounts" aria-label="Quick wallet balance amounts">{[5, 10, 25, 100].map((percent) => { const amount = percent === 100 ? walletSpendableWei : walletSpendableWei * BigInt(percent) / 100n; return <button type="button" key={percent} disabled={amount === 0n} onClick={() => chooseBuyPercent(percent)}><span>{percent === 100 ? "Max" : `${percent}%`}</span><small>{formatEth(amount, 5)} ETH</small></button>; })}</div><small className="walletPresetNote">Based on your Robinhood Chain ETH. Max leaves room for the estimated network fee.</small></> : <div className="quickAmounts" aria-label="Quick dollar amounts">{[1, 5, 10, 25].map((amount) => <button type="button" key={amount} disabled={!ethUsd} onClick={() => chooseBuyUsd(amount)}>${amount}</button>)}</div>}
            <div className="orderPreview"><div><span>Estimated receive</span><strong>{Number(formatUnits(buyOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong></div><div><span>Platform fee</span><strong>{formatEth(buyFee)} ETH</strong></div></div>
          </div> : <div className="tradeAmountCard">
            <div className="tradeAmountTop"><span>You sell</span><small>Balance {Number(formatUnits(balance.data ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</small></div>
            <div className="tradeInputRow"><input aria-label={`${symbol} amount to sell`} inputMode="decimal" value={sellAmount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setSellAmount(event.target.value)} /><span>{symbol}</span></div>
            <div className="usdEstimate">≈ {formatUsd(sellValueUsd)} <span>estimated proceeds</span></div>
            <div className="quickAmounts" aria-label="Quick sell percentages">{[25, 50, 75, 100].map((percent) => <button type="button" key={percent} disabled={(balance.data ?? 0n) === 0n} onClick={() => chooseSellPercent(percent)}>{percent === 100 ? "Max" : `${percent}%`}</button>)}</div>
            <div className="orderPreview"><div><span>Estimated receive</span><strong>{Number(formatEther(sellOut)).toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH</strong></div><div><span>Platform fee</span><strong>{formatEth(sellFee)} ETH</strong></div></div>
            {needsApproval && isConnected && <p className="approvalNote">{atomicSellAvailable ? "Your wallet supports a one-confirmation approval-and-sell batch." : "Your first sell creates a reusable allowance for this token’s immutable market. Later sells need only the normal transaction confirmation, and you can revoke access at any time."}</p>}
          </div>}
          {!graduated.data && !compact && <div className="tradeDisclosure"><span>Live quote</span><span>1% slippage</span><span>10-minute deadline</span></div>}
          {!creatorRiskRequired && <button type="button" className={`creatorRiskSummary ${highCreatorConcentration ? "highRisk" : ""}`} onClick={showCreatorAnalytics}><span>Creator wallet</span><strong>{creatorBalance.isLoading ? "Reading…" : `${formatPercent(creatorSupplyBps)} of supply`}</strong><small>{highCreatorConcentration ? "High concentration — review required" : "View onchain concentration"} ↓</small></button>}
          {!graduated.data && creatorRiskRequired && <label className="creatorRiskCheck"><input type="checkbox" checked={creatorRiskAccepted} onChange={(event) => setCreatorRiskAccepted(event.target.checked)} /><span><strong>I reviewed the creator concentration</strong><small>Required before buying while the creator holds at least 25% of tokens outside the curve.</small></span></label>}
          {!graduated.data && isConnected && <div className={`preflightCard ${preflight.status}`} role="status"><span className="preflightIcon">{preflight.status === "ready" ? "✓" : preflight.status === "error" ? "!" : "•"}</span><div><strong>{preflight.status === "checking" ? "Checking this order onchain…" : preflight.status === "ready" ? "Order check passed" : preflight.status === "error" ? "Order needs attention" : "Enter an amount to continue"}</strong><small>{preflight.status === "ready" && estimatedNetworkFeeWei !== undefined ? `Network fee ${formatEth(estimatedNetworkFeeWei, 7)} ETH · ≈ ${formatUsd(estimatedNetworkFeeUsd)}` : preflight.message ?? "Quotes and network fees refresh automatically."}</small></div></div>}
          {(isPending || receipt.isLoading || callsPending || callsReceipt.isLoading) && <div className="tradeStage" role="status"><span className="tradeStageDot" /><div><strong>{isPending || callsPending ? "Review in your wallet" : "Order submitted"}</strong><small>{isPending || callsPending ? "On a phone, switch to the wallet app if needed, confirm, then return to RMT." : "Waiting for Robinhood Chain confirmation."}</small>{receipt.isLoading && hash && <a href={`${activeChain.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">Track transaction ↗</a>}</div></div>}
          {(writeError || receipt.error || callsReceipt.error) && <div className="errors"><span>{writeError?.message || receipt.error?.message || callsReceipt.error?.message}</span></div>}
          {tradeMessage && <div className="callout"><strong>{tradeMessage}</strong></div>}
          {receipt.isSuccess && lastAction !== "approve" && <div className="callout"><strong>{lastAction === "sell" ? "Sell confirmed" : "Buy confirmed"}</strong><a href={`${activeChain.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
          {compact && !isConnected ? <div className="quickTradeConnect"><WalletButton target={isMainnetRelease ? "mainnet" : "testnet"} returnTo={`/?quickTrade=${tokenAddress}&side=${mode}#explore`} /><small>Connect once. Your wallet will still confirm every onchain trade.</small></div> : isMainnetRelease && graduated.data && migratedToV4
            ? <a className={`launch dexTradeLink ${mode === "sell" ? "sellAction" : ""}`} href={uniswapSwapUrl} target="_blank" rel="noopener noreferrer">{mode === "buy" ? `Buy ${symbol} on Uniswap ↗` : `Sell ${symbol} on Uniswap ↗`}</a>
            : <button className={`launch ${mode === "sell" ? "sellAction" : ""}`} disabled={!isConnected || busy || Boolean(graduated.data) || preflight.status !== "ready" || (creatorRiskRequired && !creatorRiskAccepted) || (mode === "buy" ? buyOut === 0n : sellOut === 0n)} onClick={trade}>{graduated.data ? "Curve complete — finalize V4 graduation below" : !isConnected ? "Connect wallet to trade" : busy ? lastAction === "approve" ? "Approving…" : lastAction === "sell" ? "Confirm sell in wallet…" : "Confirming…" : creatorRiskRequired && !creatorRiskAccepted ? "Review creator concentration" : preflight.status === "checking" ? "Checking order…" : preflight.status === "error" ? "Review order details" : preflight.status === "idle" ? "Preparing quote…" : mode === "buy" ? `Buy ${symbol}` : atomicSellAvailable ? `Approve + sell ${symbol}` : needsApproval ? `Enable and sell ${symbol}` : `Sell ${symbol}`}</button>}
          {!compact && <a className="explorerLink tradeExplorer" href={`${activeChain.blockExplorers.default.url}/address/${market}`} target="_blank" rel="noreferrer">Verified market contract ↗</a>}
          {!isConnected && <details className="starterGuide"><summary><span>New to Robinhood Chain?</span><small>3 steps</small></summary><div className="starterSteps"><div><b>1</b><span><strong>Connect a wallet</strong><small>Use Robinhood Wallet or another EVM wallet.</small></span></div><div><b>2</b><span><strong>Fund it with Chain ETH</strong><small>Gas and purchases use ETH on Robinhood Chain.</small></span></div><div><b>3</b><span><strong>Review and confirm</strong><small>RMT simulates the order before your wallet asks you to confirm.</small></span></div></div><div className="starterLinks"><a href="https://docs.robinhood.com/chain/add-network-to-wallet/" target="_blank" rel="noreferrer">Wallet setup ↗</a><a href="https://docs.robinhood.com/chain/bridging/" target="_blank" rel="noreferrer">Funding options ↗</a></div></details>}
        </aside>
      </div>

      {!compact && <div className="marketDetailTabs" ref={marketDetailRef} role="tablist" aria-label="Market details"><button type="button" role="tab" aria-selected={marketDetail === "activity"} className={marketDetail === "activity" ? "active" : ""} onClick={() => setMarketDetail("activity")}>Activity</button><button type="button" role="tab" aria-selected={marketDetail === "risk"} className={marketDetail === "risk" ? "active" : ""} onClick={() => setMarketDetail("risk")}>Creator analytics</button></div>}
      {!compact && marketDetail === "activity" ? <div className="tradeHistory">
        <div className="historyHeader"><div><p className="eyebrow">ONCHAIN ACTIVITY</p><h3>Recent trades</h3></div><span>{recentTrades.length} shown</span></div>
        {recentTrades.length > 0 ? <div className="tradeList">{recentTrades.map((item) => { const effectiveEth = item.isBuy ? item.ethAmount : item.ethAmount - item.feeAmount; return <a key={`${item.transactionHash}-${item.blockNumber}`} href={`${activeChain.blockExplorers.default.url}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer" className="tradeRow"><span className={item.isBuy ? "tradeSide buy" : "tradeSide sell"}>{item.isBuy ? "BUY" : "SELL"}</span><span><strong>{Number(formatUnits(item.tokenAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong><small>{compactAddress(item.trader)}</small></span><span><strong>{formatEth(effectiveEth)} ETH</strong><small>Block {item.blockNumber.toString()}</small></span></a>; })}</div> : <div className="emptyTrades"><strong>No trades yet</strong><span>The first confirmed buy or sell will appear here automatically.</span></div>}
        {tradeHistoryError && <small className="historyError">Trade history will retry automatically.</small>}
      </div> : (!compact || marketDetail === "risk") ? <section ref={creatorAnalyticsRef} className={`creatorIntelligence ${highCreatorConcentration ? "highRisk" : ""}`} aria-labelledby="creator-wallet-heading">
        <div className="creatorIntelligenceHeader"><div><p className="eyebrow">ORIGINAL LAUNCH CREATOR</p><h3 id="creator-wallet-heading">Wallet concentration check</h3></div><a href={`${activeChain.blockExplorers.default.url}/address/${creator}`} target="_blank" rel="noreferrer">{compactAddress(creator)} ↗</a></div>
        <div className="creatorStats"><div><small>Current balance</small><strong>{creatorBalance.isLoading ? "Reading…" : `${Number(formatUnits(creatorBalanceValue, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`}</strong><span>{formatPercent(creatorSupplyBps)} of total supply</span></div><div><small>Share outside curve</small><strong>{creatorConcentrationKnown && circulatingSupply > 0n ? formatPercent(creatorCirculatingBps) : "Not available yet"}</strong><span>Creator balance ÷ tokens outside the curve</span></div><div><small>Recent creator activity</small><strong>{creatorRecentBuys.length} buys · {creatorRecentSells.length} sells</strong><span>{creatorRecentTrades.length > 0 ? `${creatorRecentNet >= 0n ? "+" : "−"}${Number(formatUnits(creatorRecentNet >= 0n ? creatorRecentNet : -creatorRecentNet, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol} net` : `Across ${recentTrades.length} shown trades`}</span></div></div>
        {highCreatorConcentration ? <div className="creatorWarning"><strong>High launch-creator concentration</strong><span>The original launch wallet controls at least 25% of tokens currently outside the bonding curve. A large sale can materially move price. This is separate from the current fee recipient and is an onchain heuristic, not a safety rating.</span></div> : <p className="creatorMethod">Balances follow the permanent launch-creator address recorded by the token. “Outside curve” excludes inventory still held by the immutable market and does not identify the current fee recipient.</p>}
      </section> : null}
      {!compact && <div className="mobileTradeBar" aria-label="Quick trade actions"><button type="button" className={mode === "buy" ? "active" : ""} onClick={() => focusTradeMode("buy")}>Buy</button><button type="button" className={mode === "sell" ? "active" : ""} onClick={() => focusTradeMode("sell")}>Sell</button></div>}
    </section>
  );
}
