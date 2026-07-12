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
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }
] as const;

const tokenTradeAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function MarketPanel({ tokenAddress, symbol }: { tokenAddress: Address; symbol: string }) {
  const factoryAddress = useFactoryAddress();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { address: account, isConnected } = useAccount();
  const [market, setMarket] = useState<Address | null>(null);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [buyAmount, setBuyAmount] = useState("0.0001");
  const [sellAmount, setSellAmount] = useState("1000000");
  const [lookupError, setLookupError] = useState<string>();
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
          setLookupError(logs[0] ? undefined : "Market record not found.");
        }
      } catch (cause) {
        if (!cancelled) setLookupError(cause instanceof Error ? cause.message : "Unable to read market.");
      }
    })();
    return () => { cancelled = true; };
  }, [factoryAddress, publicClient, tokenAddress]);

  const ethIn = useMemo(() => { try { return parseEther(buyAmount || "0"); } catch { return 0n; } }, [buyAmount]);
  const tokensIn = useMemo(() => { try { return parseUnits(sellAmount || "0", 18); } catch { return 0n; } }, [sellAmount]);
  const target = market ?? ZERO;
  const enabled = Boolean(market);
  const buyQuote = useReadContract({ address: target, abi: marketAbi, functionName: "quoteBuy", args: [ethIn], chainId: robinhoodChainTestnet.id, query: { enabled: enabled && ethIn > 0n, refetchInterval: 5_000 } });
  const sellQuote = useReadContract({ address: target, abi: marketAbi, functionName: "quoteSell", args: [tokensIn], chainId: robinhoodChainTestnet.id, query: { enabled: enabled && tokensIn > 0n, refetchInterval: 5_000 } });
  const reserve = useReadContract({ address: target, abi: marketAbi, functionName: "realEthReserve", chainId: robinhoodChainTestnet.id, query: { enabled, refetchInterval: 5_000 } });
  const balance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "balanceOf", args: [account ?? ZERO], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(account), refetchInterval: 5_000 } });
  const allowance = useReadContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "allowance", args: [account ?? ZERO, target], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(account && market), refetchInterval: 5_000 } });
  const buyOut = buyQuote.data?.[0] ?? 0n;
  const sellOut = sellQuote.data?.[0] ?? 0n;
  const needsApproval = tokensIn > 0n && (allowance.data ?? 0n) < tokensIn;
  const busy = isPending || receipt.isLoading;

  useEffect(() => {
    if (!receipt.isSuccess) return;
    void Promise.all([buyQuote.refetch(), sellQuote.refetch(), reserve.refetch(), balance.refetch(), allowance.refetch()]);
  }, [receipt.isSuccess]);

  function trade() {
    if (!market || !account) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    if (mode === "buy") {
      writeContract({ address: market, abi: marketAbi, functionName: "buy", args: [account, buyOut * 99n / 100n, deadline], value: ethIn, chainId: robinhoodChainTestnet.id });
    } else if (needsApproval) {
      writeContract({ address: tokenAddress, abi: tokenTradeAbi, functionName: "approve", args: [market, tokensIn], chainId: robinhoodChainTestnet.id });
    } else {
      writeContract({ address: market, abi: marketAbi, functionName: "sell", args: [tokensIn, sellOut * 99n / 100n, account, deadline], chainId: robinhoodChainTestnet.id });
    }
  }

  if (lookupError) return <section className="panel marketPanel"><p className="eyebrow">LIVE MARKET</p><h2>Market unavailable</h2><p>{lookupError}</p></section>;
  if (!market) return <section className="panel marketPanel"><p className="eyebrow">LIVE MARKET</p><h2>Reading bonding curve…</h2></section>;

  return (
    <section className="panel marketPanel">
      <div className="sectionTitle"><div><p className="eyebrow">LIVE BONDING CURVE</p><h2>Trade ${symbol}</h2></div><span className="badge liveBadge">TESTNET</span></div>
      <div className="marketStats"><div><small>Curve reserve</small><strong>{Number(formatEther(reserve.data ?? 0n)).toLocaleString(undefined, { maximumFractionDigits: 7 })} ETH</strong></div><div><small>Your balance</small><strong>{Number(formatUnits(balance.data ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</strong></div></div>
      <div className="tradeTabs"><button className={mode === "buy" ? "active" : ""} onClick={() => setMode("buy")}>Buy</button><button className={mode === "sell" ? "active" : ""} onClick={() => setMode("sell")}>Sell</button></div>
      {mode === "buy" ? <label>Pay with test ETH<input inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} /><small>You receive approximately {Number(formatUnits(buyOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}</small></label> : <label>Sell {symbol}<input inputMode="decimal" value={sellAmount} onChange={(event) => setSellAmount(event.target.value)} /><small>You receive approximately {Number(formatEther(sellOut)).toLocaleString(undefined, { maximumFractionDigits: 8 })} test ETH</small></label>}
      <div className="tradeDisclosure"><span>1% platform fee</span><span>1% slippage protection</span><span>10-minute deadline</span></div>
      {(writeError || receipt.error) && <div className="errors"><span>{writeError?.message || receipt.error?.message}</span></div>}
      {receipt.isSuccess && <div className="callout"><strong>Transaction confirmed</strong><a href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      <button className="launch" disabled={!isConnected || busy || (mode === "buy" ? buyOut === 0n : sellOut === 0n)} onClick={trade}>{!isConnected ? "Connect wallet to trade" : busy ? "Confirming…" : mode === "buy" ? `Buy ${symbol}` : needsApproval ? `Approve ${symbol}` : `Sell ${symbol}`}</button>
      <a className="explorerLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${market}`} target="_blank" rel="noreferrer">Open market in explorer ↗</a>
    </section>
  );
}
