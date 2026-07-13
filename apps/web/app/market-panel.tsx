"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { memeLaunchFactoryAbi } from "../lib/contracts";
import { useFactoryAddress } from "../lib/use-factory-address";

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
  { type: "event", name: "Trade", anonymous: false, inputs: [{ name: "trader", type: "address", indexed: true }, { name: "recipient", type: "address", indexed: true }, { name: "isBuy", type: "bool", indexed: true }, { name: "tokenAmount", type: "uint256", indexed: false }, { name: "ethAmount", type: "uint256", indexed: false }, { name: "feeAmount", type: "uint256", indexed: false }, { name: "virtualEthReserve", type: "uint256", indexed: false }, { name: "virtualTokenReserve", type: "uint256", indexed: false }, { name: "realEthReserve", type: "uint256", indexed: false }] }
] as const;

const tokenTradeAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type RecentTrade = {
  transactionHash: `0x${string}`;
  trader: Address;
  isBuy: boolean;
  tokenAmount: bigint;
  ethAmount: bigint;
  feeAmount: bigint;
  blockNumber: bigint;
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

export function MarketPanel({ tokenAddress, symbol, totalSupply }: { tokenAddress: Address; symbol: string; totalSupply: bigint }) {
  const factoryAddress = useFactoryAddress();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { address: account, isConnected } = useAccount();
  const [market, setMarket] = useState<Address | null>(null);
  const [launchBlock, setLaunchBlock] = useState<bigint>(0n);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [tradeHistoryError, setTradeHistoryError] = useState<string>();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [buyAmount, setBuyAmount] = useState("0.0001");
  const [sellAmount, setSellAmount] = useState("1000000");
  const [lookupError, setLookupError] = useState<string>();
  const [lastAction, setLastAction] = useState<"buy" | "approve" | "sell" | null>(null);
  const [tradeMessage, setTradeMessage] = useState<string>();
  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: robinhoodChainTestnet.id });

  useEffect(() => {
    if (!factoryAddress || !publicClient) return;
    let cancelled = false;
    void (async () => {
      try {
        const latest = await publicClient.getBlockNumber();
        const logs = await publicClient.getContractEvents({ address: factoryAddress, abi: memeLaunchFactoryAbi, eventName: "TokenLaunched", args: { token: tokenAddress }, fromBlock: latest > 20_000n ? latest - 20_000n : 0n, toBlock: "latest", strict: true });
        if (!cancelled) {
          setMarket(logs[0]?.args.market ?? null);
          setLaunchBlock(logs[0]?.blockNumber ?? 0n);
          setLookupError(logs[0] ? undefined : "Market record not found.");
        }
      } catch (cause) {
        if (!cancelled) setLookupError(cause instanceof Error ? cause.message : "Unable to read market.");
      }
    })();
    return () => { cancelled = true; };
  }, [factoryAddress, publicClient, tokenAddress]);

  useEffect(() => {
    if (!market || !publicClient) return;
    const marketAddress = market;
    const client = publicClient;
    let cancelled = false;
    async function loadTrades() {
      try {
        const logs = await client.getContractEvents({ address: marketAddress, abi: marketAbi, eventName: "Trade", fromBlock: launchBlock, toBlock: "latest", strict: true });
        if (cancelled) return;
        setRecentTrades(logs.slice(-12).reverse().flatMap((log) => log.transactionHash ? [{ transactionHash: log.transactionHash, trader: log.args.trader, isBuy: log.args.isBuy, tokenAmount: log.args.tokenAmount, ethAmount: log.args.ethAmount, feeAmount: log.args.feeAmount, blockNumber: log.blockNumber }] : []));
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
  const buyQuote = useReadContract({ address: target, abi: marketAbi, functionName: "quoteBuy", args: [ethIn], chainId: robinhoodChainTestnet.id, query: { enabled: enabled && ethIn > 0n, refetchInterval: 5_000 } });
  const sellQuote = useReadContract({ address: target, abi: marketAbi, functionName: "quoteSell", args: [tokensIn], chainId: robinhoodChainTestnet.id, query: { enabled: enabled && tokensIn > 0n, refetchInterval: 5_000 } });
  const reserve = useReadContract({ address: target, abi: marketAbi, functionName: "realEthReserve", chainId: robinhoodChainTestnet.id, query: { enabled, refetchInterval: 5_000 } });
  const virtualEth = useReadContract({ address: target, abi: marketAbi, functionName: "virtualEthReserve", chainId: robinhoodChainTestnet.id, query: { enabled, refetchInterval: 5_000 } });
  const virtualTokens = useReadContract({ address: target, abi: marketAbi, functionName: "virtualTokenReserve", chainId: robinhoodChainTestnet.id, query: { enabled, refetchInterval: 5_000 } });
  const graduationTarget = useReadContract({ address: target, abi: marketAbi, functionName: "graduationTarget", chainId: robinhoodChainTestnet.id, query: { enabled, refetchInterval: 5_000 } });
  const progress = useReadContract({ address: target, abi: marketAbi, functionName: "progressBps", chainId: robinhoodChainTestnet.id, query: { enabled, refetchInterval: 5_000 } });
  const graduated = useReadContract({ address: target, abi: marketAbi, functionName: "graduated", chainId: robinhoodChainTestnet.id, query: { enabled, refetchInterval: 5_000 } });
  const balance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "balanceOf", args: [account ?? ZERO], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(account), refetchInterval: 5_000 } });
  const allowance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "allowance", args: [account ?? ZERO, target], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(account && market), refetchInterval: 5_000 } });
  const buyOut = buyQuote.data?.[0] ?? 0n;
  const sellOut = sellQuote.data?.[0] ?? 0n;
  const needsApproval = tokensIn > 0n && (allowance.data ?? 0n) < tokensIn;
  const busy = isPending || receipt.isLoading;
  const priceWei = virtualTokens.data && virtualTokens.data > 0n ? (virtualEth.data ?? 0n) * 10n ** 18n / virtualTokens.data : 0n;
  const marketCapWei = virtualTokens.data && virtualTokens.data > 0n ? (virtualEth.data ?? 0n) * totalSupply / virtualTokens.data : 0n;
  const progressPercent = Number(progress.data ?? 0n) / 100;

  useEffect(() => {
    if (!receipt.isSuccess) return;
    void Promise.all([buyQuote.refetch(), sellQuote.refetch(), reserve.refetch(), virtualEth.refetch(), virtualTokens.refetch(), graduationTarget.refetch(), progress.refetch(), graduated.refetch(), balance.refetch(), allowance.refetch()]);
  }, [receipt.isSuccess]);

  useEffect(() => {
    if (!receipt.isSuccess || lastAction !== "approve" || !market || !account) return;
    setLastAction("sell");
    setTradeMessage("Approval confirmed. Confirm the sell in your wallet.");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    writeContract({ address: market, abi: marketAbi, functionName: "sell", args: [tokensIn, sellOut * 99n / 100n, account, deadline], chainId: robinhoodChainTestnet.id });
  }, [receipt.isSuccess, lastAction, market, account, tokensIn, sellOut, writeContract]);

  function trade() {
    if (!market || !account) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    setTradeMessage(undefined);
    if (mode === "buy") {
      setLastAction("buy");
      writeContract({ address: market, abi: marketAbi, functionName: "buy", args: [account, buyOut * 99n / 100n, deadline], value: ethIn, chainId: robinhoodChainTestnet.id });
    } else if (needsApproval) {
      setLastAction("approve");
      setTradeMessage("First signature: approve this exact sell amount.");
      writeContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "approve", args: [market, tokensIn], chainId: robinhoodChainTestnet.id });
    } else {
      setLastAction("sell");
      writeContract({ address: market, abi: marketAbi, functionName: "sell", args: [tokensIn, sellOut * 99n / 100n, account, deadline], chainId: robinhoodChainTestnet.id });
    }
  }

  if (lookupError) return <section className="panel marketPanel"><p className="eyebrow">LIVE MARKET</p><h2>Market unavailable</h2><p>{lookupError}</p></section>;
  if (!market) return <section className="panel marketPanel"><p className="eyebrow">LIVE MARKET</p><h2>Reading bonding curve…</h2></section>;

  return (
    <section className="panel marketPanel">
      <div className="sectionTitle"><div><p className="eyebrow">LIVE BONDING CURVE</p><h2>Trade ${symbol}</h2></div><span className="badge liveBadge">TESTNET</span></div>
      <div className="marketStats intelligenceStats"><div><small>Token price</small><strong>{formatPrice(priceWei)} test ETH</strong></div><div><small>Market cap</small><strong>{formatEth(marketCapWei, 6)} test ETH</strong></div><div><small>Curve reserve</small><strong>{formatEth(reserve.data ?? 0n, 7)} ETH</strong></div><div><small>Your balance</small><strong>{Number(formatUnits(balance.data ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong></div></div>
      <div className="graduationCard">
        <div><span>{graduated.data ? "Graduated" : "Graduation progress"}</span><strong>{progressPercent.toFixed(2)}%</strong></div>
        <div className="progressTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><span style={{ width: `${Math.min(progressPercent, 100)}%` }} /></div>
        <small>{formatEth(reserve.data ?? 0n, 7)} of {formatEth(graduationTarget.data ?? 0n, 7)} test ETH reserved for graduation</small>
      </div>
      <div className="tradeTabs"><button className={mode === "buy" ? "active" : ""} onClick={() => setMode("buy")}>Buy</button><button className={mode === "sell" ? "active" : ""} onClick={() => setMode("sell")}>Sell</button></div>
      {mode === "buy" ? <label>Pay with test ETH<input inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} /><small>You receive approximately {Number(formatUnits(buyOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</small></label> : <label>Sell {symbol}<input inputMode="decimal" value={sellAmount} onChange={(event) => setSellAmount(event.target.value)} /><small>You receive approximately {Number(formatEther(sellOut)).toLocaleString(undefined, { maximumFractionDigits: 8 })} test ETH</small></label>}
      <div className="tradeDisclosure"><span>1% platform fee</span><span>1% slippage protection</span><span>10-minute deadline</span></div>
      {(writeError || receipt.error) && <div className="errors"><span>{writeError?.message || receipt.error?.message}</span></div>}
      {tradeMessage && <div className="callout"><strong>{tradeMessage}</strong></div>}
      {receipt.isSuccess && lastAction !== "approve" && <div className="callout"><strong>{lastAction === "sell" ? "Sell confirmed" : "Buy confirmed"}</strong><a href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      <button className="launch" disabled={!isConnected || busy || (mode === "buy" ? buyOut === 0n : sellOut === 0n)} onClick={trade}>{!isConnected ? "Connect wallet to trade" : busy ? lastAction === "approve" ? "Approving…" : lastAction === "sell" ? "Confirm sell in wallet…" : "Confirming…" : mode === "buy" ? `Buy ${symbol}` : needsApproval ? `Approve and sell ${symbol}` : `Sell ${symbol}`}</button>
      <a className="explorerLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${market}`} target="_blank" rel="noreferrer">Open market in explorer ↗</a>
      <div className="tradeHistory">
        <div className="historyHeader"><div><p className="eyebrow">ONCHAIN ACTIVITY</p><h3>Recent trades</h3></div><span>{recentTrades.length} shown</span></div>
        {recentTrades.length > 0 ? <div className="tradeList">{recentTrades.map((item) => {
          const effectiveEth = item.isBuy ? item.ethAmount : item.ethAmount - item.feeAmount;
          return <a key={`${item.transactionHash}-${item.blockNumber}`} href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer" className="tradeRow"><span className={item.isBuy ? "tradeSide buy" : "tradeSide sell"}>{item.isBuy ? "BUY" : "SELL"}</span><span><strong>{Number(formatUnits(item.tokenAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong><small>{compactAddress(item.trader)}</small></span><span><strong>{formatEth(effectiveEth)} ETH</strong><small>Block {item.blockNumber.toString()}</small></span></a>;
        })}</div> : <div className="emptyTrades"><strong>No trades yet</strong><span>The first confirmed buy or sell will appear here automatically.</span></div>}
        {tradeHistoryError && <small className="historyError">Trade history will retry automatically.</small>}
      </div>
    </section>
  );
}
