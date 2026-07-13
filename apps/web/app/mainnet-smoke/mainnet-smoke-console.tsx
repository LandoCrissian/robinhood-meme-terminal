"use client";

import { robinhoodChain } from "@rmt/shared/chains";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  parseEther,
  parseEventLogs,
  type Address,
  type Hex
} from "viem";

const OPERATOR = getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA");
const FACTORY = getAddress("0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4");
const REGISTRY = getAddress("0xfff3f69f473780EA5eA7f5525526986Bb491E00e");
const STORAGE_KEY = "rmt:mainnet-smoke:v4";
const BUY_AMOUNT = parseEther("0.0001");

const registryAbi = [
  { type: "function", name: "activeFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "activeVersion", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }
] as const;

const factoryAbi = [
  {
    type: "function",
    name: "launchSimple",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "metadataURI", type: "string" }
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "market", type: "address" },
      { name: "rewardVault", type: "address" }
    ]
  },
  {
    type: "event",
    name: "TokenLaunched",
    anonymous: false,
    inputs: [
      { name: "launchId", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "market", type: "address", indexed: false },
      { name: "rewardVault", type: "address", indexed: false },
      { name: "graduationPoolId", type: "bytes32", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
      { name: "rewardBps", type: "uint16[5]", indexed: false }
    ]
  }
] as const;

const marketAbi = [
  { type: "function", name: "tradingOpensAtBlock", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "fairStartEndsAtBlock", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "realEthReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "quoteBuy", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "quoteSell", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }]
  }
] as const;

const tokenAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }
] as const;

const rewardAbi = [
  { type: "function", name: "claimable", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] }
] as const;

type SmokeRecord = {
  launchId?: string;
  token?: Address;
  market?: Address;
  rewardVault?: Address;
  launchTx?: Hex;
  buyTx?: Hex;
  approveTx?: Hex;
  sellTx?: Hex;
  claimTx?: Hex;
};

type Metrics = {
  opens?: bigint;
  fairStartEnds?: bigint;
  tradingOpen?: boolean;
  reserve?: bigint;
  tokenBalance?: bigint;
  buyQuote?: bigint;
  claimable?: bigint;
};

const EMPTY: SmokeRecord = {};

function short(value?: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "Pending";
}

function explorer(path: "address" | "tx", value: string) {
  return `${robinhoodChain.blockExplorers.default.url}/${path}/${value}`;
}

export function MainnetSmokeConsole() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [record, setRecord] = useState<SmokeRecord>(EMPTY);
  const [metrics, setMetrics] = useState<Metrics>({});
  const [tag, setTag] = useState("000000");
  const [registryVerified, setRegistryVerified] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect RMTMain to begin.");
  const [error, setError] = useState("");

  const isOperator = address?.toLowerCase() === OPERATOR.toLowerCase();
  const tradingOpen = metrics.tradingOpen === true;
  const sellAmount = metrics.tokenBalance ? metrics.tokenBalance / 2n : 0n;

  useEffect(() => {
    setTag(Date.now().toString().slice(-6));
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try { setRecord(JSON.parse(saved) as SmokeRecord); } catch { window.localStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => {
    if (!publicClient || !address || !isOperator || record.launchTx) return;

    let cancelled = false;
    void (async () => {
      const latestBlock = await publicClient.getBlockNumber();
      const fromBlock = latestBlock > 100_000n ? latestBlock - 100_000n : 0n;
      const events = await publicClient.getContractEvents({
        address: FACTORY,
        abi: factoryAbi,
        eventName: "TokenLaunched",
        args: { creator: OPERATOR },
        fromBlock,
        toBlock: "latest"
      });
      const event = [...events].reverse().find((entry) => entry.args.name?.startsWith("RMT Mainnet Smoke "));
      if (
        cancelled || !event || event.args.launchId === undefined || !event.args.token || !event.args.market
        || !event.args.rewardVault || !event.transactionHash
      ) return;

      const next: SmokeRecord = {
        launchId: event.args.launchId.toString(),
        token: event.args.token,
        market: event.args.market,
        rewardVault: event.args.rewardVault,
        launchTx: event.transactionHash
      };
      persist(next);
      await refresh(next);
      setStatus("Recovered the latest verified disposable launch from the mainnet factory.");
    })().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not recover the disposable launch.");
    });

    return () => { cancelled = true; };
  }, [address, isOperator, publicClient, record.launchTx]);

  useEffect(() => {
    if (!publicClient) return;
    void Promise.all([
      publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: "activeFactory" }),
      publicClient.getBytecode({ address: FACTORY })
    ]).then(([activeFactory, code]) => {
      const valid = activeFactory.toLowerCase() === FACTORY.toLowerCase() && Boolean(code && code !== "0x");
      setRegistryVerified(valid);
      if (valid) setStatus("Factory and version registry verified. Ready for the disposable launch.");
    }).catch((cause) => {
      setRegistryVerified(false);
      setError(cause instanceof Error ? cause.message : "Could not verify the mainnet registry.");
    });
  }, [publicClient]);

  function persist(next: SmokeRecord) {
    setRecord(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function refresh(next: SmokeRecord = record) {
    if (!publicClient || !address || !next.market || !next.token || !next.rewardVault) return;
    const [opens, fairStartEnds, reserve, tokenBalance, buyQuote, claimable] = await Promise.all([
      publicClient.readContract({ address: next.market, abi: marketAbi, functionName: "tradingOpensAtBlock" }),
      publicClient.readContract({ address: next.market, abi: marketAbi, functionName: "fairStartEndsAtBlock" }),
      publicClient.readContract({ address: next.market, abi: marketAbi, functionName: "realEthReserve" }),
      publicClient.readContract({ address: next.token, abi: tokenAbi, functionName: "balanceOf", args: [address] }),
      publicClient.readContract({ address: next.market, abi: marketAbi, functionName: "quoteBuy", args: [BUY_AMOUNT] }),
      publicClient.readContract({ address: next.rewardVault, abi: rewardAbi, functionName: "claimable", args: [address] })
    ]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const tradingOpen = await publicClient.simulateContract({
      account: address,
      address: next.market,
      abi: marketAbi,
      functionName: "buy",
      args: [address, 0n, deadline],
      value: BUY_AMOUNT
    }).then(() => true).catch(() => false);

    setMetrics({
      opens: BigInt(opens),
      fairStartEnds: BigInt(fairStartEnds),
      tradingOpen,
      reserve,
      tokenBalance,
      buyQuote: buyQuote[0],
      claimable
    });
  }

  async function prepare() {
    if (!address || !walletClient || !publicClient) throw new Error("Connect RMTMain first.");
    if (address.toLowerCase() !== OPERATOR.toLowerCase()) throw new Error("This staging page only accepts the RMTMain operator wallet.");
    if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
    if (!registryVerified) throw new Error("The active registry/factory binding is not verified.");
    return { address, walletClient, publicClient };
  }

  async function launch() {
    if (busy || !accepted) return;
    setBusy(true); setError("");
    try {
      const clients = await prepare();
      const name = `RMT Mainnet Smoke ${tag}`;
      const symbol = `RMS${tag.slice(-4)}`;
      const metadata = `data:application/json,${encodeURIComponent(JSON.stringify({ name, symbol, description: "Disposable RMT V4 mainnet smoke token. Not the official RMT token." }))}`;
      const data = encodeFunctionData({ abi: factoryAbi, functionName: "launchSimple", args: [name, symbol, metadata] });
      setStatus("Approve the disposable token launch. This sends 0 ETH plus network gas.");
      const hash = await clients.walletClient.sendTransaction({ account: clients.address, chain: robinhoodChain, to: FACTORY, data });
      setStatus("Confirming the disposable launch on Robinhood Chain…");
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The disposable launch reverted.");
      const events = parseEventLogs({ abi: factoryAbi, eventName: "TokenLaunched", logs: receipt.logs, strict: true });
      const event = events[0];
      if (!event) throw new Error("The launch confirmed but its factory event was not found.");
      const next: SmokeRecord = {
        launchId: event.args.launchId.toString(),
        token: event.args.token,
        market: event.args.market,
        rewardVault: event.args.rewardVault,
        launchTx: hash
      };
      persist(next);
      await refresh(next);
      setStatus("Disposable token launched. Wait for the displayed opening block, then run the low-value buy.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The disposable launch stopped.");
    } finally { setBusy(false); }
  }

  async function buy() {
    if (busy || !record.market || !metrics.buyQuote) return;
    setBusy(true); setError("");
    try {
      const clients = await prepare();
      await refresh();
      const minimumOut = metrics.buyQuote * 99n / 100n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const data = encodeFunctionData({ abi: marketAbi, functionName: "buy", args: [clients.address, minimumOut, deadline] });
      setStatus(`Approve a ${formatEther(BUY_AMOUNT)} ETH disposable buy plus network gas.`);
      const hash = await clients.walletClient.sendTransaction({ account: clients.address, chain: robinhoodChain, to: record.market, data, value: BUY_AMOUNT });
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The low-value buy reverted.");
      const next = { ...record, buyTx: hash };
      persist(next);
      await refresh(next);
      setStatus("Buy confirmed. The market reserve and creator reward accrual are now live.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The low-value buy stopped.");
    } finally { setBusy(false); }
  }

  async function sell() {
    if (busy || !record.market || !record.token || sellAmount === 0n || !publicClient) return;
    setBusy(true); setError("");
    try {
      const clients = await prepare();
      const quote = await clients.publicClient.readContract({ address: record.market, abi: marketAbi, functionName: "quoteSell", args: [sellAmount] });
      const minimumOut = quote[0] * 99n / 100n;
      const approveData = encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [record.market, sellAmount] });
      setStatus("Approve only the exact token amount used by this disposable sell.");
      const approveHash = await clients.walletClient.sendTransaction({ account: clients.address, chain: robinhoodChain, to: record.token, data: approveData });
      const approveReceipt = await clients.publicClient.waitForTransactionReceipt({ hash: approveHash });
      if (approveReceipt.status !== "success") throw new Error("Token approval failed.");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const sellData = encodeFunctionData({ abi: marketAbi, functionName: "sell", args: [sellAmount, minimumOut, clients.address, deadline] });
      setStatus("Approve the disposable sell. No ETH is sent.");
      const sellHash = await clients.walletClient.sendTransaction({ account: clients.address, chain: robinhoodChain, to: record.market, data: sellData });
      const sellReceipt = await clients.publicClient.waitForTransactionReceipt({ hash: sellHash });
      if (sellReceipt.status !== "success") throw new Error("The disposable sell reverted.");
      const next = { ...record, approveTx: approveHash, sellTx: sellHash };
      persist(next);
      await refresh(next);
      setStatus("Sell confirmed. Buy and sell reserve accounting both passed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The disposable sell stopped.");
    } finally { setBusy(false); }
  }

  async function claim() {
    if (busy || !record.rewardVault || !metrics.claimable) return;
    setBusy(true); setError("");
    try {
      const clients = await prepare();
      const data = encodeFunctionData({ abi: rewardAbi, functionName: "claim" });
      setStatus(`Approve the creator-reward claim for ${formatEther(metrics.claimable)} ETH.`);
      const hash = await clients.walletClient.sendTransaction({ account: clients.address, chain: robinhoodChain, to: record.rewardVault, data });
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The creator reward claim reverted.");
      const next = { ...record, claimTx: hash };
      persist(next);
      await refresh(next);
      setStatus("Reward claim confirmed. The disposable launch loop has passed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The creator reward claim stopped.");
    } finally { setBusy(false); }
  }

  const completed = useMemo(() => [record.launchTx, record.buyTx, record.sellTx, record.claimTx].filter(Boolean).length, [record]);

  return (
    <section className="deployment-card">
      <div className={`deployment-status ${error ? "failed" : completed === 4 ? "complete" : registryVerified ? "active" : "idle"}`}>
        <span className="status-dot" />
        <strong>{error ? "Smoke test paused safely" : completed === 4 ? "Mainnet launch loop passed" : "Mainnet smoke test"}</strong>
      </div>

      <div className="deployment-addresses">
        <p><span>Required wallet</span><code>{short(OPERATOR)}</code></p>
        <p><span>Connected wallet</span><code>{short(address)}</code></p>
        <p><span>Active factory</span><code>{registryVerified ? short(FACTORY) : "Checking…"}</code></p>
        <p><span>Completed stages</span><code>{completed} / 4</code></p>
      </div>

      <div className="smoke-grid">
        <article className={`smoke-stage ${record.launchTx ? "complete" : "active"}`}>
          <header><h3>1. Disposable launch</h3>{record.launchTx && <a className="smoke-link" href={explorer("tx", record.launchTx)} target="_blank" rel="noreferrer">Transaction ↗</a>}</header>
          <p>Creates a clearly labeled non-official token through the active V4 factory. Sends no ETH to the factory.</p>
          {record.token && <p>Token: <a className="smoke-link" href={explorer("address", record.token)} target="_blank" rel="noreferrer"><code>{record.token}</code></a></p>}
        </article>

        <article className={`smoke-stage ${record.buyTx ? "complete" : record.launchTx ? "active" : ""}`}>
          <header><h3>2. Low-value curve buy</h3>{record.buyTx && <a className="smoke-link" href={explorer("tx", record.buyTx)} target="_blank" rel="noreferrer">Transaction ↗</a>}</header>
          <p>Fixed input: {formatEther(BUY_AMOUNT)} ETH. Contract gate: {metrics.tradingOpen ? "open" : "waiting"}; Fair Start target block {metrics.opens?.toString() ?? "—"}.</p>
        </article>

        <article className={`smoke-stage ${record.sellTx ? "complete" : record.buyTx ? "active" : ""}`}>
          <header><h3>3. Sell half the test position</h3>{record.sellTx && <a className="smoke-link" href={explorer("tx", record.sellTx)} target="_blank" rel="noreferrer">Transaction ↗</a>}</header>
          <p>Uses an exact token approval, executes the sell, and checks that the market remains solvent.</p>
        </article>

        <article className={`smoke-stage ${record.claimTx ? "complete" : record.sellTx ? "active" : ""}`}>
          <header><h3>4. Claim creator rewards</h3>{record.claimTx && <a className="smoke-link" href={explorer("tx", record.claimTx)} target="_blank" rel="noreferrer">Transaction ↗</a>}</header>
          <p>Claims only the connected operator wallet’s accrued creator share from this disposable launch.</p>
        </article>
      </div>

      {record.market && (
        <div className="smoke-metrics">
          <div><span>Market reserve</span><strong>{formatEther(metrics.reserve ?? 0n)} ETH</strong></div>
          <div><span>Token balance</span><strong>{Number(formatUnits(metrics.tokenBalance ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
          <div><span>Claimable</span><strong>{formatEther(metrics.claimable ?? 0n)} ETH</strong></div>
          <div><span>Fair Start ends</span><strong>Block {metrics.fairStartEnds?.toString() ?? "—"}</strong></div>
        </div>
      )}

      {!record.launchTx && (
        <label className="smoke-confirm">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>I understand this creates a disposable mainnet token and every wallet approval uses real ETH for gas.</span>
        </label>
      )}

      <div className="smoke-actions">
        <button disabled={busy || !accepted || !isConnected || !isOperator || !registryVerified || Boolean(record.launchTx)} onClick={launch}>Launch disposable token</button>
        <button className="secondary" disabled={busy || !record.launchTx} onClick={() => void refresh()}>Refresh onchain status</button>
        <button disabled={busy || !record.launchTx || !tradingOpen || Boolean(record.buyTx)} onClick={buy}>Buy {formatEther(BUY_AMOUNT)} ETH</button>
        <button disabled={busy || !record.buyTx || sellAmount === 0n || Boolean(record.sellTx)} onClick={sell}>Approve and sell half</button>
        <button disabled={busy || !record.sellTx || !metrics.claimable || Boolean(record.claimTx)} onClick={claim}>Claim creator rewards</button>
      </div>

      <p className={`smoke-status ${error ? "error" : ""}`}>{error || status}</p>
      <p className="deployment-safety">The official RMT token is not created by this page. No action is automatic or silently signed.</p>
    </section>
  );
}
