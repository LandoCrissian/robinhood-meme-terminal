import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, useConnectWallet, useIdentityToken, useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isHash, keccak256, toHex, type Hex } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { useTradingTermsAcceptance } from "../use-trading-terms";
import TermsPage from "../../app/terms/page";
import RisksPage from "../../app/risks/page";
import PrivacyPage from "../../app/privacy/page";
import { approximateUsd, cannaCatQuoteBudget, freshCannaCatFunds, freshEthUsd, readEthUsd, usdTargetToWei,
  type BuyInputMode, type CannaCatFunds, type EthUsdPrice } from "./cannacat-funds";
import { connectedWalletMessage, exactConnectedExternalWallet, readConnectedWallet, soleConnectedExternalWallet,
  uncheckedConnectedWallet, type ConnectedWalletRead, type ConnectedWalletProvider } from "../connected-wallet-state";
import {
  CANNACAT_EMBED, createCannaCatClient, parseCannaCatAmount, externalEthereumWallets, walletGatewayKey,
  prepareVNextWalletTransaction, vNextWalletRpcTransaction, assessVNextWalletGasReadiness,
  findBlockingVNextWalletRequest, findUnresolvedVNextExecution, recordPreparedVNextWalletRequest,
  transitionVNextWalletRequest, promoteVNextWalletRequestToSubmitted, readVNextExecutionJournal,
  readVNextWalletRequestJournal, resolveVNextExecution, verifyVNextErc20OutputSettlement,
  boundVNextNativeSettlementEnvelope, verifyVNextNativeOutputSettlement,
  hasVerifiedVNextSwapSettlement,
  cannaCatRecoveryDetails,
  promoteDiscoveredVNextWalletRequestToSubmitted,
  VNEXT_EXECUTION_EVENT, VNEXT_WALLET_REQUEST_EVENT, VNEXT_EXECUTION_STORAGE_KEY,
  type CannaCatPrepared, type CannaCatSide, type VNextExecutionRecord, type CannaCatRecoveryResult
} from "./cannacat-client";

import { createCannaCatSpotReader, observeCannaCatAmount, type CannaCatObservation } from "./cannacat-observation";
import { rmtCuratedMarketByToken } from "../vnext/curated-market-registry";
import { ROBINHOOD_V4_STATE_VIEW } from "../uniswap-v4";

export type CannaCatPanelConfig = {
  enabled: boolean; apiBaseUrl: string; privyAppId: string; privyClientId: string;
};
type Provider = ConnectedWalletProvider;
type PanelAction = { id: number; controller: AbortController; key: string; kind: "quote" | "recovery" | "identity" | "network" | "wallet" };
type Ready = {
  trade: CannaCatPrepared; provider: Provider; walletKey: string; identityToken: string;
  nonce: bigint; block: bigint; blockHash: Hex; chainId: number;
};
const client = createPublicClient({ chain: robinhoodChain, transport: http(CANNACAT_EMBED.rpc, { timeout: 12_000, retryCount: 0 }) });
// Existing verified RMT market identity; no new execution adapter/provider.
const stateViewAbi = [{ type: "function", name: "getSlot0", stateMutability: "view", inputs: [{name:"poolId",type:"bytes32"}],
  outputs: [{name:"sqrtPriceX96",type:"uint160"},{name:"tick",type:"int24"},{name:"protocolFee",type:"uint24"},{name:"lpFee",type:"uint24"}] }] as const;
const readCannaCatSpot = createCannaCatSpotReader(async () => {
  const market = rmtCuratedMarketByToken(CANNACAT_EMBED.token);
  if (!market || market.chainId !== 4663 || market.market.sourceId !== "uniswap-v4"
    || market.market.token0 !== CANNACAT_EMBED.native || market.market.token1 !== CANNACAT_EMBED.token.toLowerCase()
    || !/^0x[0-9a-f]{64}$/i.test(market.market.poolKey)) throw new Error("The approved CannaCat pool identity is unavailable.");
  const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
  if (chainId !== 4663 || block.number === null || !block.hash || Number(block.timestamp) * 1000 > Date.now() + 5000 || Date.now() - Number(block.timestamp) * 1000 > 60_000)
    throw new Error("Fresh Robinhood Chain price evidence is unavailable.");
  const slot = await client.readContract({ address: ROBINHOOD_V4_STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0",
    args: [market.market.poolKey as Hex], blockNumber: block.number });
  return { chainId: 4663, sqrtPriceX96: slot[0], blockNumber: block.number, blockHash: block.hash, observedAtMs: Date.now() };
});
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const units = (value: string | bigint, digits = 18) => {
  const exact = formatUnits(BigInt(value), 18);
  const [whole, fraction = ""] = exact.split(".");
  const tail = fraction.slice(0, digits).replace(/0+$/, "");
  if (whole === "0" && !tail && BigInt(value) > 0n) return `<0.${"0".repeat(digits - 1)}1`;
  return tail ? `${whole}.${tail}` : whole;
};
const safeError = (cause: unknown) => cause instanceof Error ? cause.message.slice(0, 240) : "The request could not be completed. Try again after checking your wallet.";
const isUserRejection = (cause: unknown) => Boolean(cause && typeof cause === "object" && "code" in cause && cause.code === 4001);
const explorer = (hash: string) => `${robinhoodChain.blockExplorers.default.url}/tx/${hash}`;

async function readWalletFunds(key: string, wallet: string): Promise<CannaCatFunds> {
  const checkedAtMs = Date.now();
  const address = getAddress(wallet);
  const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
  if (chainId !== 4663 || block.number === null || !block.hash || Number(block.timestamp) * 1000 > Date.now() + 5000
    || Date.now() - Number(block.timestamp) * 1000 > 60_000) throw new Error("Fresh Robinhood Chain balance evidence is unavailable.");
  const [confirmedEth, pendingEth, confirmedToken, pendingToken, gasPrice] = await Promise.all([
    client.getBalance({ address, blockNumber: block.number }), client.getBalance({ address, blockTag: "pending" }),
    client.readContract({ address: CANNACAT_EMBED.token, abi: erc20Abi, functionName: "balanceOf", args: [address], blockNumber: block.number }),
    client.readContract({ address: CANNACAT_EMBED.token, abi: erc20Abi, functionName: "balanceOf", args: [address], blockTag: "pending" }), client.getGasPrice()
  ]);
  if (gasPrice <= 0n || Date.now() - checkedAtMs > 20_000) throw new Error("Fresh gas and balance evidence is unavailable.");
  return { key, wallet: address, chainId: 4663, checkedAtMs, block: block.number, blockHash: block.hash,
    eth: confirmedEth < pendingEth ? confirmedEth : pendingEth, token: confirmedToken < pendingToken ? confirmedToken : pendingToken, gasPrice };
}

const WalletBalanceSummary = React.memo(function WalletBalanceSummary({ funds, usd, health, disabled, onRefresh }: {
  funds: CannaCatFunds | null; usd: string | null; health: "loading" | "current" | "stale" | "checking" | "unavailable";
  disabled: boolean; onRefresh: () => void;
}) {
  const messages = {
    loading: "Reading balances on Robinhood Chain.",
    current: "Balances current. Review rechecks funds and gas.",
    stale: "Last known balances. Review rechecks funds and gas.",
    checking: "Rechecking wallet. Last known balances are retained.",
    unavailable: "Balances could not be refreshed. Confirmation needs fresh data."
  };
  return <section className="rmtcat-funds" aria-label="Wallet balances">
    <dl><div><dt>Native Robinhood ETH</dt><dd className="rmtcat-funds-amount">{funds ? `${units(funds.eth)} ETH` : "Loading…"}</dd>
      <dd className="rmtcat-usd">{usd ? `≈ ${usd} USD` : "USD estimate unavailable"}</dd></div>
      <div><dt>CannaCat available</dt><dd className="rmtcat-funds-amount">{funds ? `${units(funds.token, 4)} CannaCat` : "Loading…"}</dd></div></dl>
    <p className="rmtcat-funds-snapshot"><span>{funds ? <>As of <time dateTime={new Date(funds.checkedAtMs).toISOString()}>{new Date(funds.checkedAtMs).toLocaleTimeString()}</time></> : "Balance snapshot pending"}</span>
      <span>{funds ? `Block ${String(funds.block)}` : "Block pending"}</span></p>
    <p className="rmtcat-funds-health" data-balance-health={health} aria-live="off">{messages[health]}</p>
    <button type="button" className="rmtcat-textbutton" disabled={disabled} onClick={onRefresh}>Refresh balances</button>
  </section>;
});

function Panel({ config }: { config: CannaCatPanelConfig }) {
  const terms = useTradingTermsAcceptance();
  const { ready, authenticated, user, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { identityToken } = useIdentityToken();
  const [selectedKey, setSelectedKey] = useState("");
  const [walletState, setWalletState] = useState<ConnectedWalletRead>(uncheckedConnectedWallet);
  const walletStateRef = useRef<ConnectedWalletRead>(uncheckedConnectedWallet);
  const explicitChoiceRequired = useRef(false);
  const refreshWallet = useRef<(() => Promise<void>) | null>(null);
  const [side, setSide] = useState<CannaCatSide>("buy");
  const [amount, setAmount] = useState("10000");
  const [buyMode, setBuyMode] = useState<BuyInputMode>("token");
  const amounts = useRef({ token: "10000", eth: "0.01", usd: "25", sell: "10000" });
  const [intentRestored, setIntentRestored] = useState(false);
  const [status, setStatus] = useState("Connect an existing wallet to get a live quote.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Ready | null>(null);
  const [review, setReview] = useState<CannaCatPrepared | null>(null);
  const [observation, setObservation] = useState<CannaCatObservation | null>(null);
  const [quoteMessage, setQuoteMessage] = useState("");
  const indicativeRead = useRef<AbortController | null>(null);
  const indicativeNotBefore = useRef(0);
  const [now, setNow] = useState(Date.now());
  const [hash, setHash] = useState("");
  const [displayRecord, setDisplayRecord] = useState<VNextExecutionRecord | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [balances, setBalances] = useState<CannaCatFunds | null>(null);
  const balancesRef = useRef<CannaCatFunds | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [price, setPrice] = useState<EthUsdPrice | null>(null);
  const priceRef = useRef(price); priceRef.current = price;
  const [priceError, setPriceError] = useState("");
  const refreshFunds = useRef<(() => Promise<void>) | null>(null);
  const refreshBalanceDisplay = useCallback(() => { void refreshFunds.current?.(); }, []);
  const [blocking, setBlocking] = useState(false);
  const [recoveryChecking, setRecoveryChecking] = useState(false);
  const recoveryRead = useRef<AbortController | null>(null);
  const recoveryDiagnostic = useRef<{ txHash: string; result: CannaCatRecoveryResult }>({ txHash: "", result: "not_checked" });
  const [recoveryCopyMessage, setRecoveryCopyMessage] = useState("");
  const refreshRecovery = useRef<((record?: VNextExecutionRecord) => Promise<void>) | null>(null);
  const [tabOwnsWallet, setTabOwnsWallet] = useState(false);
  const [leaseAttempt, setLeaseAttempt] = useState(0);
  const epoch = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const actionSequence = useRef(0);
  const activeAction = useRef<PanelAction | null>(null);
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const providerRef = useRef<Provider | null>(null);
  const currentRef = useRef({ key: selectedKey, token: identityToken, side, amount, userId: user?.id });
  currentRef.current = { key: selectedKey, token: identityToken, side, amount, userId: user?.id };
  const external = externalEthereumWallets(wallets);
  const wallet = exactConnectedExternalWallet(wallets, selectedKey);
  const walletRef = useRef(wallet); walletRef.current = wallet;
  const walletInventoryKey = JSON.stringify(wallets.filter((value) => value.type === "ethereum").map(walletGatewayKey).sort());
  const inputId = useId();
  const connected = Boolean(ready && walletsReady && authenticated && identityToken && wallet?.linked);

  // Restore display intent only, never a quote, wallet authority or transaction.
  // The durable execution journals remain separate and are never cleared here.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("rmt:cannacat:form:1");
      if (raw && raw.length < 512) {
        const saved = JSON.parse(raw);
        if (saved.version === 1 && ["buy", "sell"].includes(saved.side) && ["token", "eth", "usd"].includes(saved.mode)
          && saved.amounts && ["token", "eth", "usd", "sell"].every(key => typeof saved.amounts[key] === "string"
            && saved.amounts[key].length <= 60 && /^[0-9]*\.?[0-9]*$/.test(saved.amounts[key]))) {
          amounts.current = { token: saved.amounts.token, eth: saved.amounts.eth, usd: saved.amounts.usd, sell: saved.amounts.sell };
          setSide(saved.side); setBuyMode(saved.mode); setAmount(saved.amounts[saved.side === "sell" ? "sell" : saved.mode]);
        }
      }
    } catch { /* Unavailable or malformed optional form storage never grants authority. */ }
    setIntentRestored(true);
  }, []);
  useEffect(() => {
    if (!intentRestored) return;
    try { sessionStorage.setItem("rmt:cannacat:form:1", JSON.stringify({ version: 1, side, mode: buyMode, amounts: amounts.current })); }
    catch { /* Trading recovery uses the independently checked durable journals. */ }
  }, [intentRestored, side, buyMode, amount]);

  function finishAction(action: PanelAction) {
    if (activeAction.current?.id !== action.id) return;
    if (actionTimer.current) clearTimeout(actionTimer.current);
    actionTimer.current = null; activeAction.current = null; operation.current = null;
    inFlight.current = false; setBusy(false);
  }
  function actionCurrent(action: PanelAction) { return activeAction.current?.id === action.id && !action.controller.signal.aborted && currentRef.current.key === action.key; }
  function beginAction(kind: PanelAction["kind"]): PanelAction {
    indicativeRead.current?.abort();
    const action = { id: ++actionSequence.current, controller: new AbortController(), key: selectedKey, kind };
    activeAction.current = action; operation.current = action.controller;
    inFlight.current = true; setBusy(true);
    actionTimer.current = setTimeout(() => {
      if (!actionCurrent(action)) return;
      action.controller.abort(); finishAction(action); epoch.current += 1; setPrepared(null);
      setStatus(kind === "wallet" ? "The wallet response is still unresolved. History is saved. Check your wallet; do not resend."
        : "The read timed out. You can retry, change the amount or disconnect. Transaction history is preserved.");
    }, 45_000);
    return action;
  }
  function recoveryRequired(address: string) { return Boolean(findBlockingVNextWalletRequest(address, localStorage) || findUnresolvedVNextExecution(address, localStorage)); }
  function cancelRecoveryRead() {
    recoveryRead.current?.abort(); recoveryRead.current = null; setRecoveryChecking(false);
  }

  function invalidate(preserveReview = false) {
    epoch.current += 1;
    operation.current?.abort();
    if (actionTimer.current) clearTimeout(actionTimer.current);
    actionTimer.current = null; activeAction.current = null; actionSequence.current += 1;
    inFlight.current = false; setBusy(false);
    setPrepared(null);
    if (!preserveReview) { setReview(null); setObservation(null); }
    setError("");
  }
  const { connectWallet } = useConnectWallet({ onSuccess: ({ wallet: attached }) => {
    if (external.length <= 1 && external.every(candidate => walletGatewayKey(candidate) === walletGatewayKey(attached))
      && soleConnectedExternalWallet([attached])) { explicitChoiceRequired.current = false; setSelectedKey(walletGatewayKey(attached)); }
    void refreshWallet.current?.();
  } });
  // Connect + SIWE is one user-initiated Privy flow. The former connect-only
  // modal intentionally did not authenticate, forcing a second manual action.
  // Never synthesize authentication or reuse a wallet signature ourselves.
  const { login } = useLogin({
    onComplete: () => { void refreshWallet.current?.(); },
    onError: () => { setStatus("Wallet sign-in was not completed. You can reconnect when ready. No transaction was requested."); }
  });
  function connectForTrading() {
    if (!ready || !walletsReady || !terms.accepted) return;
    explicitChoiceRequired.current = external.length > 1;
    if (authenticated) connectWallet({ walletChainType: "ethereum-only", walletList: ["metamask", "coinbase_wallet", "detected_ethereum_wallets", "wallet_connect"] });
    else login({ loginMethods: ["wallet"], walletChainType: "ethereum-only" });
  }

  useEffect(() => {
    if (!walletsReady) return;
    if (selectedKey) {
      if (!exactConnectedExternalWallet(wallets, selectedKey)) {
        invalidate(); setSelectedKey(""); explicitChoiceRequired.current = true;
        setStatus("The selected wallet changed. Choose the signing wallet again.");
      }
      return;
    }
    if (external.length > 1) explicitChoiceRequired.current = true;
    const sole = soleConnectedExternalWallet(wallets);
    if (sole && !explicitChoiceRequired.current) setSelectedKey(walletGatewayKey(sole));
  }, [walletsReady, walletInventoryKey, selectedKey]);

  // A rotated authentication token invalidates signing authority, not the
  // displayed public balance snapshot for the same selected wallet.
  useEffect(() => { invalidate(true); balancesRef.current = null; void refreshFunds.current?.(); }, [selectedKey, identityToken, user?.id, authenticated, terms.accepted]);
  useEffect(() => { setBalances(null); setObservation(null); setReview(null); }, [selectedKey]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!terms.accepted) return;
    let disposed = false; let active = false; let controller: AbortController | null = null;
    const refresh = async () => {
      if (active || document.visibilityState === "hidden") return;
      active = true; controller = new AbortController();
      try { const result = await readEthUsd(controller.signal); if (!disposed) { setPrice(result); setPriceError(""); } }
      catch { if (!disposed) setPriceError("USD estimate unavailable. ETH and CannaCat inputs still work."); }
      finally { active = false; }
    };
    const visible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    void refresh(); const timer = setInterval(() => void refresh(), 30_000);
    window.addEventListener("pageshow", visible); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; controller?.abort(); clearInterval(timer); window.removeEventListener("pageshow", visible); document.removeEventListener("visibilitychange", visible); };
  }, [terms.accepted]);
  useEffect(() => {
    if (!wallet || !terms.accepted || walletState.status !== "ready") { balancesRef.current = null; return; }
    let disposed = false; let active = false;
    const key = selectedKey; const address = wallet.address;
    const refresh = async () => {
      if (active || disposed || document.visibilityState === "hidden") return;
      active = true;
      try {
        const result = await readWalletFunds(key, address);
        if (!disposed && currentRef.current.key === key && walletStateRef.current.status === "ready") {
          if (!balancesRef.current || balancesRef.current.checkedAtMs <= result.checkedAtMs) { balancesRef.current = result; setBalances(result); }
          setBalanceError("");
        }
      } catch { if (!disposed) { balancesRef.current = null; setBalanceError("Balances could not be refreshed. Confirmation is paused until fresh balances return."); } }
      finally { active = false; }
    };
    refreshFunds.current = refresh; void refresh(); const timer = setInterval(() => void refresh(), 30_000);
    return () => { disposed = true; clearInterval(timer); refreshFunds.current = null; balancesRef.current = null; };
  }, [selectedKey, wallet?.address, walletState.status, terms.accepted]);
  useEffect(() => () => { operation.current?.abort(); if (actionTimer.current) clearTimeout(actionTimer.current); activeAction.current = null; epoch.current += 1; }, []);
  useEffect(() => {
    setTabOwnsWallet(false);
    if (!wallet) return;
    let disposed = false;
    let release: (() => void) | undefined;
    if (!navigator.locks) {
      setError("This browser cannot safely coordinate wallet requests across tabs. Update it before trading.");
      return;
    }
    void navigator.locks.request(`rmt:cannacat:4663:${wallet.address.toLowerCase()}`, { ifAvailable: true }, async (lock) => {
      if (disposed) return;
      if (!lock) { setStatus("This wallet is active in another LAMMB trading tab. Close that panel, then choose Use this tab."); return; }
      setTabOwnsWallet(true);
      await new Promise<void>((resolve) => { release = resolve; });
    }).catch(() => { if (!disposed) setError("Wallet tab coordination is unavailable. No transaction was opened."); });
    return () => { disposed = true; release?.(); };
  }, [wallet?.address, leaseAttempt]);
  useEffect(() => {
    walletStateRef.current = uncheckedConnectedWallet; setWalletState(uncheckedConnectedWallet);
    if (!wallet) return;
    let disposed = false;
    let sequence = 0;
    let active: Provider | null = null;
    const publish = (state: ConnectedWalletRead) => { walletStateRef.current = state; setWalletState(state); };
    const detach = () => {
      active?.removeListener?.("chainChanged", changed); active?.removeListener?.("accountsChanged", changed); active?.removeListener?.("disconnect", disconnected);
    };
    let pendingRefresh: Promise<void> | null = null;
    const refresh = (force = false): Promise<void> => {
      if (pendingRefresh && !force) return pendingRefresh;
      const work = refreshOnce(); pendingRefresh = work;
      void work.finally(() => { if (pendingRefresh === work) pendingRefresh = null; }).catch(() => undefined);
      return work;
    };
    const refreshOnce = async () => {
      const candidate = walletRef.current;
      if (!candidate || disposed) return;
      const attempt = ++sequence;
      cancelRecoveryRead();
      invalidate(true); publish(uncheckedConnectedWallet); providerRef.current = null;
      const state = await readConnectedWallet(candidate);
      if (disposed || sequence !== attempt || currentRef.current.key !== selectedKey) return;
      if (active !== state.provider) {
        detach(); active = state.provider;
        active?.on?.("chainChanged", changed); active?.on?.("accountsChanged", changed); active?.on?.("disconnect", disconnected);
      }
      providerRef.current = state.provider; publish(state);
      // The dedicated wallet row owns network/readiness copy. A background
      // revalidation must not replace a trade or settlement status message.
      if (state.status === "ready") void refreshFunds.current?.();
      // Safari may complete checking -> ready in one React batch. In that case
      // a status-dependency effect sees no change. Resume recovery explicitly
      // after the live provider read instead of waiting for its polling timer.
      if (state.status === "ready" && currentRef.current.token && walletRef.current?.linked) {
        try {
          const record = findUnresolvedVNextExecution(candidate.address, localStorage);
          if (record) void refreshRecovery.current?.(record);
        } catch { setBlocking(true); setError("Local recovery storage is unavailable. History is preserved; trading is paused."); }
      }
    };
    function changed() { if (document.visibilityState !== "hidden") void refresh(true); else suspend(); }
    function disconnected() {
      cancelRecoveryRead();
      sequence += 1; invalidate(); providerRef.current = null;
      publish({ status: "disconnected", chainId: null, provider: null });
      setStatus("The signing wallet disconnected. Reconnect it before requesting a quote.");
    }
    function suspend() { sequence += 1; cancelRecoveryRead(); invalidate(true); balancesRef.current = null; providerRef.current = null; publish(uncheckedConnectedWallet); }
    const visible = () => { if (document.visibilityState === "hidden") suspend(); else void refresh(); };
    const resumed = () => { if (document.visibilityState !== "hidden") void refresh(); };
    refreshWallet.current = refresh;
    window.addEventListener("focus", resumed); window.addEventListener("pageshow", resumed); window.addEventListener("pagehide", suspend);
    document.addEventListener("visibilitychange", visible);
    void refresh();
    try {
      const unresolved = findUnresolvedVNextExecution(wallet.address, localStorage);
      const pending = findBlockingVNextWalletRequest(wallet.address, localStorage);
      setBlocking(Boolean(unresolved || pending));
      if (unresolved) { setHash(unresolved.txHash); setStatus("An earlier transaction needs verification. Check its status before another trade."); }
      else { setHash(pending ? "" : readVNextExecutionJournal(localStorage).filter(entry => entry.wallet.toLowerCase() === wallet.address.toLowerCase())[0]?.txHash ?? "");
        if (pending) setStatus("An earlier wallet response is unresolved. Check your wallet before submitting another transaction."); }
    } catch { setError("Local recovery storage is unavailable. Enable site storage before trading."); setBlocking(true); }
    return () => {
      disposed = true; sequence += 1; detach(); refreshWallet.current = null;
      window.removeEventListener("focus", resumed); window.removeEventListener("pageshow", resumed); window.removeEventListener("pagehide", suspend);
      document.removeEventListener("visibilitychange", visible); providerRef.current = null;
    };
  }, [selectedKey, wallet?.address, wallet?.chainId, wallet?.linked, authenticated, user?.id, walletsReady]);

  // Reconcile the canonical journal after authentication/restoration, not just
  // after a manual button click. A read never owns the foreground wallet lock.
  // Only resolveVNextExecution with exact receipt/output proof can release it.
  useEffect(() => { refreshRecovery.current = checkTransaction; });
  useEffect(() => {
    if (!wallet) return;
    const sync = () => {
      try {
        const unresolved = findUnresolvedVNextExecution(wallet.address, localStorage);
        const pending = findBlockingVNextWalletRequest(wallet.address, localStorage);
        setBlocking(Boolean(unresolved || pending));
        const latest = readVNextExecutionJournal(localStorage).filter(entry => entry.wallet.toLowerCase() === wallet.address.toLowerCase())[0];
        setDisplayRecord(unresolved ?? (pending ? null : latest ?? null));
        setHash(unresolved?.txHash ?? (pending ? "" : latest?.txHash ?? ""));
        return unresolved;
      } catch { setBlocking(true); setError("Local recovery storage is unavailable. History is preserved; trading is paused."); return null; }
    };
    const refresh = () => {
      const record = sync();
      if (record && connected && terms.accepted && walletStateRef.current.status === "ready"
        && document.visibilityState !== "hidden" && activeAction.current?.kind !== "wallet") void refreshRecovery.current?.(record);
    };
    const storageChanged = (event: StorageEvent) => { if (!event.key || event.key === VNEXT_EXECUTION_STORAGE_KEY) sync(); };
    sync(); refresh(); const timer = setInterval(refresh, 30_000);
    window.addEventListener(VNEXT_EXECUTION_EVENT, sync); window.addEventListener(VNEXT_WALLET_REQUEST_EVENT, sync);
    window.addEventListener("storage", storageChanged); window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      recoveryRead.current?.abort(); recoveryRead.current = null; setRecoveryChecking(false); clearInterval(timer);
      window.removeEventListener(VNEXT_EXECUTION_EVENT, sync); window.removeEventListener(VNEXT_WALLET_REQUEST_EVENT, sync);
      window.removeEventListener("storage", storageChanged); window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [selectedKey, wallet?.address, connected, terms.accepted, walletState.status]);

  // Observation is read-only: no funds/nonce gate, verify/authorize request,
  // journal write or wallet prompt. A separate explicit review obtains fresh
  // executable terms and applies all canonical funds/authority checks.
  useEffect(() => {
    if (!connected || !wallet || !identityToken || !terms.accepted || walletState.status !== "ready") return;
    let disposed = false; let failures = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const key = selectedKey; const token = identityToken;
    const schedule = (delay: number) => { clearTimeout(timer); if (!disposed) timer = setTimeout(() => void refresh(), Math.min(delay, 2_147_483_647)); };
    const refresh = async () => {
      if (disposed) return;
      if (document.visibilityState === "hidden" || activeAction.current || indicativeRead.current) { schedule(1500); return; }
      if (Date.now() < indicativeNotBefore.current) { schedule(indicativeNotBefore.current - Date.now()); return; }
      let target: string; let ethInput: bigint | null;
      try {
        target = side === "sell" || buyMode === "token" ? parseCannaCatAmount(amount) : "0";
        ethInput = side === "buy" && buyMode !== "token"
          ? buyMode === "usd" ? usdTargetToWei(amount, priceRef.current) : BigInt(parseCannaCatAmount(amount)) : null;
      } catch (cause) { setQuoteMessage(safeError(cause)); schedule(15_000); return; }
      const controller = new AbortController(); indicativeRead.current = controller;
      const generation = epoch.current;
      const deadline = setTimeout(() => { controller.abort(); if (!disposed) { failures += 1; indicativeNotBefore.current = Date.now() + 15_000 * 2 ** Math.min(failures - 1, 3); setQuoteMessage("Pricing timed out. The last estimate is retained; retrying automatically."); } }, 30_000);
      indicativeNotBefore.current = Date.now() + 2000;
      try {
        const spot = await readCannaCatSpot();
        const quote = observeCannaCatAmount(spot, { side, tokenAmountAtomic: target, ethInputAtomic: ethInput?.toString() ?? null });
        if (disposed || controller.signal.aborted || generation !== epoch.current || currentRef.current.key !== key || currentRef.current.token !== token) return;
        setObservation(quote); setQuoteMessage(""); failures = 0;
      } catch (cause) {
        if (disposed || controller.signal.aborted || generation !== epoch.current) return;
        failures += 1;
        const status = cause && typeof cause === "object" && "status" in cause ? cause.status : null;
        const retry = cause && typeof cause === "object" && "retryAfterMs" in cause && typeof cause.retryAfterMs === "number" ? cause.retryAfterMs : 0;
        const delay = Math.max(status === 429 ? 60_000 : 15_000 * 2 ** Math.min(failures - 1, 3), retry);
        indicativeNotBefore.current = Date.now() + delay;
        setQuoteMessage(safeError(cause));
        // A failed authentication does not poll endlessly or ask for signatures.
        if (status === 401 || status === 403) disposed = true;
      } finally {
        clearTimeout(deadline);
        if (indicativeRead.current === controller) indicativeRead.current = null;
        schedule(Math.max(30_000, indicativeNotBefore.current - Date.now()));
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") { clearTimeout(timer); indicativeRead.current?.abort(); }
      else schedule(Math.max(750, indicativeNotBefore.current - Date.now()));
    };
    schedule(750); document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; clearTimeout(timer); indicativeRead.current?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [selectedKey, connected, identityToken, terms.accepted, walletState.status, side, buyMode, amount]);

  async function verifyWallet() {
    if (!wallet || inFlight.current) return;
    const action = beginAction("identity"); setError("");
    try { await wallet.loginOrLink(); if (actionCurrent(action)) setStatus("Wallet ownership verified. Choose an amount and request a quote."); }
    catch (cause) { if (actionCurrent(action)) setError(safeError(cause)); }
    finally { finishAction(action); }
  }
  async function switchNetwork() {
    if (!wallet || inFlight.current) return;
    invalidate(); const action = beginAction("network");
    try { await wallet.switchChain(4663); await refreshWallet.current?.(); }
    catch { if (actionCurrent(action)) setError("Network switch was not completed. Select Robinhood Chain in your wallet."); }
    finally { finishAction(action); }
  }
  function disconnectWallet() {
    invalidate(); explicitChoiceRequired.current = true; currentRef.current.key = ""; setSelectedKey("");
    setBlocking(false); setStatus("Disconnected. Saved transaction history is preserved; reconnect the same wallet to reconcile it.");
    void logout().catch(() => { /* Local selection is already disconnected. Never erase the journal. */ });
  }
  async function getQuote() {
    if (!connected || !wallet || !identityToken || inFlight.current || !tabOwnsWallet || !terms.accepted || walletStateRef.current.status !== "ready") return;
    invalidate(true); const generation = epoch.current;
    const action = beginAction("quote"); const controller = action.controller;
    const key = selectedKey; const token = identityToken;
    setStatus("Checking wallet, live quote and transaction safety…");
    try {
      const tokenAmountAtomic = side === "sell" || buyMode === "token" ? parseCannaCatAmount(amount) : "0";
      // Freeze the indicative conversion for this request. Background prices
      // never rewrite the entered amount or an already reviewed firm quote.
      const ethInput = side === "buy" && buyMode !== "token" ? (buyMode === "usd" ? usdTargetToWei(amount, price) : BigInt(parseCannaCatAmount(amount))) : null;
      const liveWallet = await readConnectedWallet(wallet);
      if (generation !== epoch.current || currentRef.current.key !== key || currentRef.current.token !== token) return;
      walletStateRef.current = liveWallet; setWalletState(liveWallet);
      if (liveWallet.status !== "ready" || !liveWallet.provider) throw new Error(connectedWalletMessage(liveWallet));
      const provider = liveWallet.provider;
      const [funds, nonce] = await Promise.all([readWalletFunds(key, wallet.address), client.getTransactionCount({ address: getAddress(wallet.address), blockTag: "pending" })]);
      if (generation !== epoch.current || currentRef.current.key !== key || currentRef.current.token !== token) return;
      balancesRef.current = funds; setBalances(funds); setBalanceError("");
      const { eth, token: held } = funds;
      if (eth <= 0n) throw new Error("Insufficient ETH for network gas, including when selling tokens.");
      if (side === "sell" && BigInt(tokenAmountAtomic) > held) throw new Error("Your selected token amount exceeds this wallet's CannaCat balance.");
      const api = createCannaCatClient({ baseUrl: config.apiBaseUrl, identityToken: token });
      const budget = cannaCatQuoteBudget(funds);
      if (side === "buy" && (budget.spendable <= 0n || (ethInput !== null && ethInput > budget.spendable))) throw new Error(`Insufficient ETH: input plus gas reserve exceeds ${units(eth)} ETH available. Use Max ETH or choose a smaller amount.`);
      const quote = ethInput !== null
        ? await api.quoteEth({ ethAmountAtomic: ethInput.toString(), wallet: wallet.address, maximumEthInputAtomic: budget.spendable.toString(), signal: controller.signal })
        : await api.quote({ side, tokenAmountAtomic, wallet: wallet.address, maximumEthInputAtomic: (side === "buy" ? budget.spendable : eth).toString(), signal: controller.signal });
      if (!actionCurrent(action) || generation !== epoch.current) return;
      const unresolved = recoveryRequired(wallet.address); setBlocking(unresolved);
      if (unresolved) { setObservation({side:quote.side,inputAmountAtomic:quote.inputAmountAtomic,
        expectedOutputAtomic:quote.attempt.expectedOutputAtomic!,feeEstimateAtomic:quote.attempt.providerNativeFee?.feeAmountAtomic ?? "0",
        observedAtMs:quote.attempt.quotedAtMs!,expiresAtMs:quote.attempt.expiresAtMs!,source:"Requested 0x price"}); setReview(null); setPrepared(null); setStatus("Indicative quote only. Reconcile the saved transaction before another wallet confirmation."); return; }
      const trade = await api.prepare(quote, controller.signal);
      const finalFunds = await readWalletFunds(key, wallet.address);
      const gas = assessVNextWalletGasReadiness({ nativeBalanceWei: finalFunds.eth, currentGasPriceWei: finalFunds.gasPrice,
        evidenceFeeCeilingWei: trade.evidence.feeCeilingWei, gasLimitUnits: trade.plan.gasLimit, transactionValueAtomic: trade.plan.value });
      if (!gas.ready) throw new Error(`Insufficient ETH for input and the verified gas reserve (shortfall ${units(gas.shortfallWei)} ETH).`);
      if (side === "sell" && BigInt(trade.evidence.inputAmountAtomic) > finalFunds.token) throw new Error("Your CannaCat balance changed. Refresh the quote.");
      prepareVNextWalletTransaction({ plan: trade.plan, evidence: trade.evidence, connectedAddress: wallet.address, connectedChainId: 4663, nowMs: Date.now() });
      const finalWallet = await readConnectedWallet(wallet);
      if (generation !== epoch.current || currentRef.current.key !== key || currentRef.current.token !== token) return;
      walletStateRef.current = finalWallet; setWalletState(finalWallet);
      if (finalWallet.status !== "ready" || finalWallet.provider !== provider) throw new Error("The signing provider changed while preparing the quote. Request a fresh quote.");
      if (generation !== epoch.current || currentRef.current.key !== key || currentRef.current.token !== token) return;
      balancesRef.current = finalFunds; setBalances(finalFunds); setBalanceError("");
      setPrepared({ trade, provider, walletKey: key, identityToken: token, nonce: BigInt(nonce), block: finalFunds.block, blockHash: finalFunds.blockHash, chainId: 4663 });
      setReview(trade);
      setNow(Date.now());
      setStatus(trade.plan.kind === "erc20_approval" ? "Approve only the displayed CannaCat amount. A fresh swap review follows after confirmation." : "Review the protected quote, then confirm explicitly in your wallet.");
    } catch (cause) { if (generation === epoch.current && !controller.signal.aborted) {
      setError(side === "buy" && cause && typeof cause === "object" && "code" in cause && cause.code === "INSUFFICIENT_BALANCE"
        ? "Insufficient ETH for the selected token target plus network gas. Choose a smaller amount or use Max ETH in ETH input mode." : safeError(cause));
      setStatus("No transaction was submitted.");
    } }
    finally { finishAction(action); }
  }

  async function checkTransaction(recordOverride?: VNextExecutionRecord) {
    if (!wallet || recoveryRead.current || activeAction.current?.kind === "wallet") return;
    const controller = new AbortController(); recoveryRead.current = controller; setRecoveryChecking(true);
    const key = selectedKey; const token = identityToken;
    const current = () => recoveryRead.current === controller && !controller.signal.aborted
      && currentRef.current.key === key && currentRef.current.token === token;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const record = recordOverride ?? readVNextExecutionJournal(localStorage).find((entry) => entry.wallet.toLowerCase() === wallet.address.toLowerCase() && entry.txHash.toLowerCase() === hash.toLowerCase());
      if (!record) throw new Error("Keep this transaction hash and check your wallet. Its saved recovery record is unavailable; do not submit again.");
      const [receipt, transaction, chainId] = await Promise.all([client.getTransactionReceipt({ hash: record.txHash }), client.getTransaction({ hash: record.txHash }), client.getChainId()]);
      if (!current()) return;
      if (chainId !== 4663) throw new Error("The recovery RPC returned the wrong network.");
      if (transaction.chainId !== 4663 || transaction.hash.toLowerCase() !== record.txHash.toLowerCase()
        || receipt.transactionHash.toLowerCase() !== record.txHash.toLowerCase()
        || transaction.from.toLowerCase() !== record.wallet.toLowerCase() || receipt.from.toLowerCase() !== record.wallet.toLowerCase()
        || transaction.blockHash !== receipt.blockHash) throw new Error("The mined transaction does not match this wallet's saved recovery record.");
      if (receipt.status === "reverted") {
        if (!resolveVNextExecution(record.txHash, "reverted", localStorage)) throw new Error("Recovery could not be saved. Keep the transaction hash.");
        setBlocking(recoveryRequired(wallet.address)); setStatus("Transaction reverted. The trade did not complete; network gas may still apply."); return;
      }
      if (record.kind === "erc20_approval") {
        if (receipt.from.toLowerCase() !== record.wallet.toLowerCase() || transaction.from.toLowerCase() !== record.wallet.toLowerCase()
          || transaction.chainId !== 4663 || receipt.blockHash !== transaction.blockHash
          || receipt.to?.toLowerCase() !== CANNACAT_EMBED.token.toLowerCase()
          || transaction.to?.toLowerCase() !== CANNACAT_EMBED.token.toLowerCase()) throw new Error("Approval receipt does not match the saved wallet and token.");
        // Canonical journal verifies the exact approval plan at preparation/submission.
        const request = readVNextWalletRequestJournal(localStorage).find((entry) => entry.planId === record.planId && entry.txHash === record.txHash);
        if (!request?.recoveryPlan || transaction.input.toLowerCase() !== request.recoveryPlan.data.toLowerCase() || transaction.value !== BigInt(request.recoveryPlan.value)) throw new Error("Approval transaction bytes do not match the saved plan.");
        if (!resolveVNextExecution(record.txHash, "confirmed", localStorage)) throw new Error("Approval recovery could not be saved. Keep the hash.");
        invalidate(true); setBlocking(recoveryRequired(wallet.address)); void refreshFunds.current?.(); setStatus("Approval confirmed. Request a fresh quote to review the swap. No sale has occurred yet."); return;
      }
      let proof = verifyVNextErc20OutputSettlement(record, receipt, transaction);
      const nativeEnvelope = boundVNextNativeSettlementEnvelope(record, receipt, transaction);
      let diagnostic: CannaCatRecoveryResult = proof ? "verified_token_output" : !nativeEnvelope ? "stored_envelope_or_output_not_bound"
        : !identityToken ? "authenticated_recovery_required" : "native_trace_unavailable";
      if (!proof && nativeEnvelope && identityToken) {
        const result = await createCannaCatClient({ baseUrl: config.apiBaseUrl, identityToken }).nativeSettlementTrace(record.txHash, record.wallet, controller.signal);
        if (!current()) return;
        if (result && typeof result === "object" && "status" in result && result.status === "available") diagnostic = "trace_envelope_mismatch";
        if (result && typeof result === "object" && "status" in result && result.status === "available"
          && "blockHash" in result && result.blockHash === receipt.blockHash.toLowerCase() && "txHash" in result
          && typeof result.txHash === "string" && result.txHash.toLowerCase() === record.txHash.toLowerCase() && "trace" in result) {
          proof = verifyVNextNativeOutputSettlement(record, receipt, transaction, result.trace);
          diagnostic = proof ? "verified_native_output" : "trace_failed_saved_record_verification";
        }
      }
      recoveryDiagnostic.current = { txHash: record.txHash, result: diagnostic };
      if (!proof) { setStatus("Receipt confirmed; output settlement is still unverified. This is not proof of failed execution. Keep the hash and check again; do not resend. Wallet controls remain available."); return; }
      if (!resolveVNextExecution(record.txHash, "confirmed", localStorage, Date.now(), { outputAmountAtomic: proof.amountAtomic, outputSettlement: proof })) throw new Error("Verified output could not be saved. Keep the hash and check again.");
      invalidate(true); setBlocking(recoveryRequired(wallet.address)); balancesRef.current = null; void refreshFunds.current?.(); setStatus(`Settlement verified: ${units(proof.amountAtomic)} ${record.outputAsset.toLowerCase() === CANNACAT_EMBED.token.toLowerCase() ? "CannaCat" : "ETH"} received by ${short(record.wallet)}.`);
    } catch (cause) {
      if (!current()) return;
      recoveryDiagnostic.current = { txHash: recordOverride?.txHash ?? hash, result: "recovery_read_unavailable" };
      if (cause instanceof Error && /not.*found|could not be found/i.test(cause.message)) setStatus("Transaction submitted; confirmation is pending. Check again in a moment. Do not resend.");
      else setError(`Settlement check unavailable. ${safeError(cause)} History is preserved; do not resend.`);
    } finally { clearTimeout(timeout); if (recoveryRead.current === controller) { recoveryRead.current = null; setRecoveryChecking(false); } }
  }

  async function copyRecoveryDetails() {
    if (!wallet) return;
    const record = readVNextExecutionJournal(localStorage).find(entry => entry.txHash.toLowerCase() === hash.toLowerCase()
      && entry.wallet.toLowerCase() === wallet.address.toLowerCase());
    if (!record) { setRecoveryCopyMessage("This transaction's saved record is unavailable. History is unchanged."); return; }
    try {
      const diagnostic = recoveryDiagnostic.current;
      await navigator.clipboard.writeText(JSON.stringify(cannaCatRecoveryDetails(record,
        diagnostic.txHash.toLowerCase() === record.txHash.toLowerCase() ? diagnostic.result : "not_checked"), null, 2));
      setRecoveryCopyMessage("Recovery details copied. Login tokens, signatures and authorization data are excluded. History is unchanged.");
    } catch { setRecoveryCopyMessage("Copy is unavailable in this browser. History is unchanged."); }
  }

  async function recoverWalletResponse() {
    if (!wallet || inFlight.current || !isHash(recoveryHash)) return;
    const action = beginAction("recovery"); setError("");
    try {
      const request = findBlockingVNextWalletRequest(wallet.address, localStorage);
      const plan = request?.recoveryPlan;
      if (!request || !plan) throw new Error("No unresolved saved wallet request matches this wallet.");
      const transaction = await client.getTransaction({ hash: recoveryHash });
      if (!actionCurrent(action)) return;
      if (transaction.chainId !== 4663 || transaction.hash.toLowerCase() !== recoveryHash.toLowerCase()
        || transaction.from.toLowerCase() !== request.wallet.toLowerCase()
        || transaction.to?.toLowerCase() !== plan.target.toLowerCase()
        || transaction.value !== BigInt(plan.value) || keccak256(transaction.input).toLowerCase() !== request.calldataHash.toLowerCase()
        || BigInt(transaction.nonce) !== BigInt(request.walletNonceBeforeRequest)
        || (transaction.blockNumber !== null && request.requestBlockNumber && transaction.blockNumber < BigInt(request.requestBlockNumber))) {
        throw new Error("That hash does not match the exact saved wallet request. Nothing was changed.");
      }
      const record = promoteDiscoveredVNextWalletRequestToSubmitted({ requestId: request.requestId, txHash: recoveryHash }, localStorage);
      if (!record) throw new Error("The matched transaction could not be saved. Keep the hash and do not resend.");
      setHash(record.txHash); setRecoveryHash(""); setStatus("The exact submitted transaction was recovered. Check its settlement below.");
    } catch (cause) { if (actionCurrent(action)) setError(safeError(cause)); }
    finally { finishAction(action); }
  }

  function confirmTrade() {
    if (!prepared || !wallet || inFlight.current || !connected || blocking || !tabOwnsWallet || !terms.accepted) return;
    let requestId = "";
    let action: PanelAction | null = null;
    try {
      if (prepared.walletKey !== selectedKey || prepared.identityToken !== identityToken || prepared.chainId !== 4663
        || walletStateRef.current.status !== "ready" || walletStateRef.current.provider !== prepared.provider) throw new Error("Wallet authority changed. Request a fresh quote.");
      const funds = balancesRef.current;
      if (!freshCannaCatFunds(funds, selectedKey, wallet.address)) throw new Error("Fresh matching balances are required before confirmation. Refresh your quote.");
      const gas = assessVNextWalletGasReadiness({ nativeBalanceWei: funds.eth, currentGasPriceWei: funds.gasPrice,
        evidenceFeeCeilingWei: prepared.trade.evidence.feeCeilingWei, gasLimitUnits: prepared.trade.plan.gasLimit, transactionValueAtomic: prepared.trade.plan.value });
      if (!gas.ready || (prepared.trade.quote.side === "sell" && BigInt(prepared.trade.evidence.inputAmountAtomic) > funds.token)) throw new Error("Your balance or gas reserve changed. Choose a smaller amount and refresh the quote.");
      if (findBlockingVNextWalletRequest(wallet.address, localStorage) || findUnresolvedVNextExecution(wallet.address, localStorage)) throw new Error("Resolve the earlier wallet request before another trade.");
      const transaction = prepareVNextWalletTransaction({ plan: prepared.trade.plan, evidence: prepared.trade.evidence, connectedAddress: wallet.address, connectedChainId: 4663, nowMs: Date.now() });
      requestId = crypto.randomUUID();
      const saved = recordPreparedVNextWalletRequest({ requestId, wallet: wallet.address, plan: prepared.trade.plan, walletNonceBeforeRequest: prepared.nonce, requestBlockNumber: prepared.block, requestBlockHash: prepared.blockHash, connectorType: wallet.connectorType, walletClientType: wallet.walletClientType, connectorId: wallet.meta.id }, localStorage);
      if (!saved || !transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", localStorage)) throw new Error("Recovery storage failed. No wallet request was opened.");
      action = beginAction("wallet"); setBlocking(true); setHash(""); setRecoveryHash(""); setError(""); setStatus("Confirm the exact transaction in your wallet. Waiting for your response…");
      // User-gesture path: no quote fetch, chain lookup or automatic signature.
      const pending = prepared.provider.request({ method: "eth_sendTransaction", params: [{ ...vNextWalletRpcTransaction(transaction), chainId: toHex(4663) }] });
      setPrepared(null);
      void pending.then((result) => {
        if (typeof result !== "string" || !isHash(result)) throw new Error("Wallet response did not contain a valid transaction hash.");
        const record = promoteVNextWalletRequestToSubmitted({ requestId, wallet: wallet.address, plan: prepared.trade.plan, txHash: result }, localStorage);
        if (currentRef.current.key === prepared.walletKey) { invalidate(true); setHash(result); setBlocking(true); setStatus(record ? "Transaction submitted. Check confirmation and settlement below." : "Transaction submitted, but recovery storage failed. Keep this hash and check your wallet; do not resend."); }
      }).catch((cause) => {
        const rejected = isUserRejection(cause);
        transitionVNextWalletRequest(requestId, rejected ? "USER_REJECTED" : "UNRESOLVED", localStorage);
        if (currentRef.current.key === prepared.walletKey) { setBlocking(recoveryRequired(wallet.address)); setError(rejected ? "Wallet request declined. Nothing was confirmed; refresh the quote when ready." : "The wallet response is unresolved. Check wallet history before trying anything else. Do not resend."); }
      }).finally(() => { if (action) finishAction(action); });
    } catch (cause) {
      // An EIP-1193 provider can throw before returning its promise. Keep the
      // durable request unresolved unless the wallet explicitly rejected it.
      if (requestId) {
        const rejected = isUserRejection(cause);
        transitionVNextWalletRequest(requestId, rejected ? "USER_REJECTED" : "UNRESOLVED", localStorage);
        setBlocking(!rejected);
        setStatus(rejected ? "Wallet request declined. Refresh the quote when ready." : "Check wallet history before retrying. Do not resend an unresolved request.");
      }
      if (action) finishAction(action); setError(safeError(cause)); setPrepared(null);
    }
  }

  const expired = Boolean(review && Math.min(review.plan.expiresAtMs, review.evidence.expiresAtMs) <= now);
  const evidence = review?.evidence;
  const fee = evidence?.providerNativeFee;
  const visibleFunds = balances?.key === selectedKey && balances.wallet.toLowerCase() === wallet?.address.toLowerCase() ? balances : null;
  const fundsFresh = walletState.status === "ready" && wallet && freshCannaCatFunds(balancesRef.current, selectedKey, wallet.address, now);
  let fundsAllowTrade = false;
  if (prepared && fundsFresh && balancesRef.current) {
    const funds = balancesRef.current;
    const gas = assessVNextWalletGasReadiness({ nativeBalanceWei: funds.eth, currentGasPriceWei: funds.gasPrice,
      evidenceFeeCeilingWei: prepared.trade.evidence.feeCeilingWei, gasLimitUnits: prepared.trade.plan.gasLimit, transactionValueAtomic: prepared.trade.plan.value });
    fundsAllowTrade = gas.ready && (prepared.trade.quote.side !== "sell" || BigInt(prepared.trade.evidence.inputAmountAtomic) <= funds.token);
  }
  const freshPrice = freshEthUsd(price, now);
  const amountKey = side === "sell" ? "sell" : buyMode;
  const editAmount = (value: string) => { invalidate(); amounts.current[amountKey] = value; setAmount(value); };
  const amountLabel = side === "sell" ? "CannaCat to sell" : buyMode === "token" ? "Minimum CannaCat to receive" : buyMode === "eth" ? "ETH to spend" : "USD purchase target";
  const presets = buyMode === "usd" ? [["10", "$10"], ["25", "$25"], ["50", "$50"], ["100", "$100"]]
    : buyMode === "eth" ? [["0.001", "0.001"], ["0.01", "0.01"], ["0.05", "0.05"], ["0.1", "0.1"]]
    : [["10000", "10K"], ["25000", "25K"], ["50000", "50K"]];
  let inputProblem = "";
  // Keep last-known amount warnings visible while freshness is rechecked;
  // transaction authority still requires freshCannaCatFunds above.
  if (visibleFunds) {
    try {
      const requested = side === "buy" ? (buyMode === "eth" ? BigInt(parseCannaCatAmount(amount)) : buyMode === "usd" && freshPrice ? usdTargetToWei(amount, price, now) : null) : null;
      const budget = cannaCatQuoteBudget(visibleFunds);
      if (side === "buy" && (budget.spendable <= 0n || requested !== null && requested > budget.spendable)) inputProblem = `Insufficient ETH: input plus ${units(budget.reserve)} ETH gas reserve exceeds ${units(visibleFunds.eth)} ETH available. Choose a smaller amount or use Max ETH.`;
      if (side === "sell" && BigInt(parseCannaCatAmount(amount)) > visibleFunds.token) inputProblem = `Insufficient CannaCat: ${units(visibleFunds.token, 4)} available. Choose a smaller amount.`;
    } catch { /* Invalid or incomplete text is diagnosed on explicit quote preparation. */ }
  }
  return <div className="rmtcat-panel">
    <div className="rmtcat-top"><span className="rmtcat-eyebrow">CANNACAT · ROBINHOOD CHAIN</span><span className="rmtcat-powered">Execution by RMT</span></div>
    <h3>Get your CannaCat.</h3>
    <p className="rmtcat-intro">Buy or sell here with your existing wallet. Keep 10,000 tokens in the same wallet for the final GTD snapshot.</p>
    {!terms.accepted && <div className="rmtcat-terms" role="note" aria-label="RMT trading acknowledgement">
      <strong>Trade with your eyes open</strong>
      <p>RMT is non-custodial software. Tokens can lose all value, liquidity can disappear, and no automated check can prevent every rug or malicious contract.</p>
      <p>Your wallet controls and confirms every transaction. RMT evidence is not an endorsement, guarantee, or financial advice. Always verify the token, amount, minimum received, and network in your wallet.</p>
      <details><summary>RMT trading terms</summary><TermsPage /></details>
      <details><summary>Risk disclosures</summary><RisksPage /></details>
      <details><summary>Privacy</summary><PrivacyPage /></details>
      <button type="button" disabled={!terms.ready} onClick={terms.accept}>I understand — continue</button>
    </div>}
    <div className="rmtcat-tabs" role="group" aria-label="Trade direction">
      {(["buy", "sell"] as const).map((direction) => <button key={direction} type="button" aria-pressed={side === direction} onClick={() => { invalidate(); setSide(direction); setAmount(amounts.current[direction === "sell" ? "sell" : buyMode]); setStatus("Choose an amount and request a fresh quote."); }}>{direction === "buy" ? "Buy CannaCat" : "Sell CannaCat"}</button>)}
    </div>
    <div className="rmtcat-wallet">
      {(external.length > 1 || (!wallet && external.length > 0)) && <label className="rmtcat-wallet-choice">Choose signing wallet<select aria-label="Choose signing wallet" value={selectedKey} disabled={!terms.accepted} onChange={(event) => { invalidate(); explicitChoiceRequired.current = true; setSelectedKey(event.target.value); }}>
          <option value="" disabled>Select a wallet</option>
          {external.map((option) => <option key={walletGatewayKey(option)} value={walletGatewayKey(option)}>{short(option.address)} · {option.meta.name ?? option.walletClientType}</option>)}
        </select></label>}
      {wallet && external.length === 1 && <div className="rmtcat-wallet-identity"><span className="rmtcat-wallet-caption">Trading wallet</span><span className="rmtcat-wallet-address" title={wallet.address}>{short(wallet.address)}</span><span className="rmtcat-wallet-name">{wallet.meta.name ?? wallet.walletClientType}</span></div>}
      <div className="rmtcat-wallet-actions">
      {!wallet ? <button type="button" disabled={!ready || !walletsReady || busy || !terms.accepted} onClick={connectForTrading}>Connect wallet</button> : <>
        {!connected && <button type="button" disabled={busy || !terms.accepted} onClick={() => void verifyWallet()}>Verify wallet ownership</button>}
        {walletState.status === "wrong-chain" && <button type="button" disabled={busy || !terms.accepted} onClick={() => void switchNetwork()}>Switch to Robinhood Chain</button>}
        {(["disconnected", "unavailable", "account-mismatch"] as const).some(value => value === walletState.status) && <button type="button" disabled={busy || !terms.accepted} onClick={() => connectWallet({ walletChainType: "ethereum-only" })}>Reconnect wallet</button>}
        {!tabOwnsWallet && <button type="button" disabled={busy} onClick={() => setLeaseAttempt((value) => value + 1)}>Use this tab</button>}
        <button className="rmtcat-textbutton" type="button" onClick={disconnectWallet}>Disconnect</button>
      </>}
      </div>
    </div>
    {wallet && <p className="rmtcat-balances" data-wallet-status={walletState.status}>{connectedWalletMessage(walletState)}</p>}
    {wallet && <WalletBalanceSummary funds={visibleFunds} usd={visibleFunds ? approximateUsd(visibleFunds.eth, price, now) : null}
      health={balanceError ? "unavailable" : walletState.status !== "ready" ? "checking" : !visibleFunds ? "loading" : fundsFresh ? "current" : "stale"}
      disabled={busy || walletState.status !== "ready"} onRefresh={refreshBalanceDisplay} />}
    {side === "buy" && <div className="rmtcat-modes" role="group" aria-label="Buy input mode">{([["usd", "USD target"], ["eth", "ETH input"], ["token", "CannaCat target"]] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={buyMode === mode} onClick={() => { invalidate(); setBuyMode(mode); setAmount(amounts.current[mode]); }}>{label}</button>)}</div>}
    <label className="rmtcat-amountlabel" htmlFor={inputId}>{amountLabel}</label>
    <div className="rmtcat-amount"><input id={inputId} inputMode="decimal" autoComplete="off" value={amount} maxLength={60} onChange={(event) => editAmount(event.target.value)} /><span>{side === "sell" || buyMode === "token" ? "CANNACAT" : buyMode === "usd" ? "USD TARGET" : "NATIVE ETH"}</span></div>
    {side === "buy" && <div className="rmtcat-presets" style={{ gridTemplateColumns: `repeat(${presets.length},minmax(0,1fr))` }}>{presets.map(([value, label]) => <button type="button" key={value} onClick={() => editAmount(value)}>{label}</button>)}</div>}
    {side === "buy" && buyMode === "eth" && <button className="rmtcat-textbutton" type="button" disabled={!fundsFresh || !visibleFunds || cannaCatQuoteBudget(visibleFunds).spendable <= 0n} onClick={() => { if (visibleFunds && fundsFresh) editAmount(formatUnits(cannaCatQuoteBudget(visibleFunds).spendable, 18)); }}>Max ETH · leave gas</button>}
    {inputProblem && <p className="rmtcat-error" role="note" aria-label="Amount availability">{inputProblem}</p>}
    <p className="rmtcat-price">{freshPrice && price ? <>ETH/USD ≈ {approximateUsd(10n ** 18n, price, now)} · {price.source} · <time dateTime={new Date(price.priceAtMs).toISOString()}>{new Date(price.priceAtMs).toLocaleTimeString()}</time></> : priceError || "ETH/USD estimate loading…"}<br/>USD is indicative only. Payment and settlement use native Robinhood ETH. Firm terms are verified before confirmation.</p>
    {side === "buy" && visibleFunds && <p className="rmtcat-balances">Quote budget reserves {units(cannaCatQuoteBudget(visibleFunds).reserve)} ETH for gas. The verified transaction may require more.</p>}
    {blocking && <aside className="rmtcat-transaction" aria-label="Transaction recovery"><strong>Earlier transaction needs reconciliation</strong><p>Another wallet transaction is paused. You can change amounts, switch Buy/Sell, get an indicative quote or disconnect. Saved history remains intact. Do not resend the previous trade.</p></aside>}
    {<div className="rmtcat-quote rmtcat-observation" aria-label="Indicative quote review"><strong>Live estimate · not a trade authorization</strong>
      <p className="rmtcat-freshness" aria-live="off">{observation ? <> {observation.expiresAtMs && observation.expiresAtMs > now && !quoteMessage ? "Updated" : "Last estimate · refreshing"} <time dateTime={new Date(observation.observedAtMs).toISOString()}>{new Date(observation.observedAtMs).toLocaleTimeString()}</time></> : "Enter an amount and connect to see automatic estimates."}</p>
      {observation && <dl>
      <div><dt>Input</dt><dd>{units(observation.inputAmountAtomic)} {observation.side === "buy" ? "ETH" : "CannaCat"}</dd></div>
      <div><dt>Expected output</dt><dd>{units(observation.expectedOutputAtomic)} {observation.side === "buy" ? "CannaCat" : "ETH"}</dd></div>
      <div><dt>RMT fee · 0.25%</dt><dd>{`${units(observation.feeEstimateAtomic)} ETH · estimate`}</dd></div>
      <div><dt>Estimated network gas</dt><dd>{"Verified at trade review"}</dd></div>
      <div><dt>{observation.side === "buy" ? "Input · USD estimate" : "Proceeds · USD estimate"}</dt><dd>{approximateUsd(observation.side === "buy" ? observation.inputAmountAtomic : observation.expectedOutputAtomic, price, now) ?? "Unavailable"}</dd></div>
    </dl>}<p className="rmtcat-price-state"><span>{quoteMessage || "Pool spot estimate updates automatically; liquidity impact and pool fees are excluded. Review fresh 0x terms before signing. Network gas is additional; maximum slippage is 1%."}</span><span className="rmtcat-price-sizer" aria-hidden="true">Pool spot estimate updates automatically; liquidity impact and pool fees are excluded. Review fresh 0x terms before signing. Network gas is additional; maximum slippage is 1%.</span></p></div>}
    {evidence && <div className="rmtcat-quote" aria-label="Verified trade review"><dl>
      <div><dt>{side === "buy" ? "Exact ETH input" : "Exact token input"}</dt><dd>{units(evidence.inputAmountAtomic)} {side === "buy" ? "ETH" : "CannaCat"}</dd></div>
      <div><dt>Expected received</dt><dd>{units(evidence.expectedOutputAtomic)} {side === "buy" ? "CannaCat" : "ETH"}</dd></div>
      {side === "sell" && <div><dt>Estimated proceeds · USD</dt><dd>{approximateUsd(evidence.expectedOutputAtomic, price, now) ? `≈ ${approximateUsd(evidence.expectedOutputAtomic, price, now)}` : "USD estimate unavailable"}</dd></div>}
      {side === "buy" && <div><dt>Input estimate · USD</dt><dd>{approximateUsd(evidence.inputAmountAtomic, price, now) ? `≈ ${approximateUsd(evidence.inputAmountAtomic, price, now)}` : "USD estimate unavailable"}</dd></div>}
      <div><dt>Protected minimum</dt><dd>{units(evidence.protectedOutputAtomic)} {side === "buy" ? "CannaCat" : "ETH"}</dd></div>
      <div><dt>{review?.plan.kind === "erc20_approval" ? "Planned swap fee · 0.25%" : "RMT fee · 0.25%"}</dt><dd>{fee ? `${units(fee.feeAmountAtomic)} ETH` : "Unavailable"}</dd></div>
      <div><dt>Estimated network gas</dt><dd>{evidence.estimatedNetworkCostWei ? `${units(evidence.estimatedNetworkCostWei)} ETH` : "Unavailable"}</dd></div>
      <div><dt>Provider fee</dt><dd>{fee?.providerFeeAtomic ? `${units(fee.providerFeeAtomic)} ${fee.providerFeeAsset?.toLowerCase() === CANNACAT_EMBED.token.toLowerCase() ? "CannaCat" : "ETH"}` : "None disclosed"}</dd></div>
      <div><dt>Maximum slippage</dt><dd>1%</dd></div>
      <div><dt>Recipient</dt><dd>{short(evidence.recipient)}</dd></div>
    </dl><p>{!prepared ? "Saved review only. Refresh the quote before confirming." : expired ? "Quote expired — refresh before confirming." : prepared.trade.plan.kind === "erc20_approval" ? "No swap fee is charged by this approval. Network gas applies. Review a fresh swap quote after confirmation." : "Fees are disclosed estimates. Network gas is additional. Review exact amounts in your wallet."}</p>{prepared && !fundsAllowTrade && <p>Confirmation paused: fresh matching balances and enough gas are required.</p>}</div>}
    <div className="rmtcat-actions"><button type="button" disabled={!terms.accepted || !connected || busy || !tabOwnsWallet || walletState.status !== "ready"} onClick={() => void getQuote()}>{busy ? "Working…" : prepared ? "Refresh quote" : "Review trade"}</button>
      {prepared && <button type="button" className="rmtcat-confirm" disabled={!terms.accepted || busy || expired || blocking || !connected || !tabOwnsWallet || walletState.status !== "ready" || !fundsAllowTrade} onClick={confirmTrade}>{prepared.trade.plan.kind === "erc20_approval" ? "Review token approval" : `Confirm ${side} in wallet`}</button>}
    </div>
    {busy && <button className="rmtcat-textbutton" type="button" onClick={() => { const kind = activeAction.current?.kind; invalidate(true); setStatus(kind === "wallet" ? "Stopped waiting for the wallet response. It may still complete. History is preserved; do not resend." : "Read cancelled. You can retry, edit the amount or disconnect. Transaction history is preserved."); }}>Stop waiting</button>}
    <p className="rmtcat-status" role="status" aria-live="polite">{status === connectedWalletMessage(walletState) || (wallet && status === "Connect an existing wallet to get a live quote.") ? "" : status}</p>
    {error && <p className="rmtcat-error" role="alert">{error}</p>}
    {blocking && !hash && <div className="rmtcat-transaction"><label>Recover an unanswered wallet request<input aria-label="Transaction hash from your wallet" value={recoveryHash} maxLength={66} autoComplete="off" onChange={(event) => setRecoveryHash(event.target.value)} placeholder="0x… transaction hash" /></label><button type="button" disabled={busy || !isHash(recoveryHash)} onClick={() => void recoverWalletResponse()}>Verify saved transaction</button><p>Paste a hash from your wallet history. Only an exact match can be recovered. This never sends another transaction.</p></div>}
    {hash && <div className="rmtcat-transaction"><a href={explorer(hash)} target="_blank" rel="noopener noreferrer">View transaction {short(hash)}</a>
      {displayRecord?.txHash === hash && <p aria-label="Saved transaction status">{hasVerifiedVNextSwapSettlement(displayRecord)
        ? `Settlement verified: ${units(displayRecord.outputAmountAtomic!)} ${displayRecord.outputAsset.toLowerCase() === CANNACAT_EMBED.token.toLowerCase() ? "CannaCat" : "ETH"} received.`
        : displayRecord.state === "reverted" ? "Transaction reverted. Network gas may still apply."
        : displayRecord.state === "confirmed" && displayRecord.kind === "erc20_approval" ? "Approval confirmed. A token approval is not a completed sale."
        : "Submitted; settlement is not yet verified. Do not resend."}</p>}
      <button type="button" disabled={recoveryChecking || !wallet} onClick={() => void checkTransaction()}>{recoveryChecking ? "Checking settlement…" : "Check settlement"}</button>
      <details className="rmtcat-details"><summary>Recovery support details</summary><p>Copy this transaction's saved recovery fields for private support. This does not change history or send a transaction.</p><button type="button" disabled={!wallet || !displayRecord} onClick={() => void copyRecoveryDetails()}>Copy recovery details</button>{recoveryCopyMessage && <p>{recoveryCopyMessage}</p>}</details></div>}
    <details className="rmtcat-details"><summary>Fees, eligibility & recovery</summary><p>RMT requests a 0.25% fee in ETH for this pair. Provider fees and network gas are shown separately. Approving tokens is not a completed sale. A receipt alone is not verified settlement. If a wallet response is lost, do not send again; check the saved transaction.</p><p>Estimates update automatically while this page is visible. An estimate can become stale between updates. Review trade obtains new executable terms; it never signs or sends automatically. Review the exact input and protected minimum again if they change.</p><p>Buying does not reserve an NFT or guarantee GTD. NFT holdings, the same-wallet token balance at the final snapshot, Founder exclusion and first-come-first-served access still apply. Selling before the snapshot may remove eligibility. NFT registration and minting remain closed.</p><p>Only public transaction and wallet details are stored locally for recovery. Wallet credentials and identity tokens are never written to this trading journal. Never share a private key or seed phrase.</p></details>
    <a className="rmtcat-contract" href={`${robinhoodChain.blockExplorers.default.url}/token/${CANNACAT_EMBED.token}`} target="_blank" rel="noopener noreferrer">Token contract: {CANNACAT_EMBED.token}</a>
  </div>;
}

const css = `
.rmtcat-terms{padding:16px;border:1px solid #637b2c;background:#11180b;border-radius:12px;margin:16px 0;font-size:13px}.rmtcat-terms details{margin:12px 0}.rmtcat-terms summary{cursor:pointer;min-height:44px;line-height:44px}.rmtcat-legal{max-height:320px;overflow:auto;padding:12px;border:1px solid #39432c}.rmtcat-legal h2{font-size:15px;line-height:1.4;margin:14px 0 6px}.rmtcat-legal p{font-size:13px;line-height:1.6}.rmtcat-root{font:400 16px/1.5 system-ui,sans-serif;color:#f2f4e9;color-scheme:dark;width:100%;box-sizing:border-box}.rmtcat-root *{box-sizing:border-box}.rmtcat-panel{padding:clamp(20px,4vw,36px);border:1px solid #485032;background:linear-gradient(135deg,#171c13,#0c0e0b);border-radius:20px;max-width:680px;margin:auto}.rmtcat-top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.rmtcat-eyebrow{font-size:11px;letter-spacing:.13em;color:#d6ff24;font-weight:800}.rmtcat-powered{font-size:11px;color:#b7beaa}.rmtcat-panel h3{font-size:clamp(28px,6vw,42px);line-height:1.1;margin:18px 0 10px;font-weight:850;letter-spacing:-.04em}.rmtcat-intro{color:#c1c8b7;font-size:14px;margin:0 0 22px}.rmtcat-tabs{display:flex;padding:4px;background:#080a06;border-radius:12px;margin-bottom:18px;gap:4px}.rmtcat-root button{font:inherit;border:1px solid #596344;border-radius:9px;min-height:44px;padding:9px 16px;cursor:pointer;color:#edf2e6;background:#252c20;font-weight:650}.rmtcat-tabs button{flex:1;border:0;background:transparent;font-size:14px}.rmtcat-tabs button[aria-pressed=true],.rmtcat-root button.rmtcat-confirm{color:#101500;background:#d6ff24}.rmtcat-root button:disabled{opacity:.45;cursor:not-allowed}.rmtcat-root :focus-visible{outline:3px solid #edff9c;outline-offset:3px}.rmtcat-wallet{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:18px}.rmtcat-wallet label{display:grid;gap:4px;font-size:11px;flex:1;min-width:0}.rmtcat-wallet select{font:inherit;font-size:13px;background:#11150d;color:#f3f8eb;border:1px solid #596344;border-radius:7px;min-height:44px;max-width:100%;padding:8px}.rmtcat-root .rmtcat-textbutton{font-size:12px;padding:5px 10px;border:0;background:none;text-decoration:underline}.rmtcat-amountlabel{font-size:13px;color:#c1c8b7;display:block;margin-bottom:6px}.rmtcat-amount{display:flex;align-items:center;gap:8px;border:1px solid #586447;background:#070a05;border-radius:12px;padding:12px 16px}.rmtcat-amount input{width:100%;min-width:0;font:700 28px/1.3 system-ui;color:#fff;background:none;border:0}.rmtcat-amount span{font-size:10px;letter-spacing:.06em;color:#c5d5aa}.rmtcat-presets{display:flex;gap:8px;margin-top:10px}.rmtcat-presets button{font-size:12px;padding:5px 12px;min-height:44px}.rmtcat-balances{font-size:12px;color:#b7beaa}.rmtcat-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.rmtcat-actions button{flex:1;min-width:150px}.rmtcat-quote{padding:16px;background:#0a0d08;border-radius:12px;margin-top:18px}.rmtcat-quote dl{margin:0;display:grid;gap:8px;font-size:13px}.rmtcat-quote dl>div{display:flex;justify-content:space-between;gap:15px}.rmtcat-quote dt{color:#b7beaa}.rmtcat-quote dd{margin:0;text-align:right;overflow-wrap:anywhere}.rmtcat-quote p{font-size:11px;color:#c1c8b7;margin:12px 0 0}.rmtcat-status{font-size:13px;color:#d7dfcc;margin:16px 0}.rmtcat-error{font-size:13px;padding:12px;border:1px solid #b86b52;background:#27150f;border-radius:8px;color:#ffd8c9}.rmtcat-transaction{display:grid;gap:10px;padding:12px;border:1px solid #5b6d36;border-radius:9px;font-size:13px}.rmtcat-root a{color:#d6ff24;text-underline-offset:3px}.rmtcat-details{font-size:12px;color:#b7beaa;border-top:1px solid #39432c;margin-top:18px;padding-top:14px}.rmtcat-details summary{cursor:pointer;min-height:36px;display:list-item;line-height:28px;color:#d7dfcc}.rmtcat-contract{font-size:10px;overflow-wrap:anywhere;display:block;margin-top:12px}.rmtcat-root .rmtcat-paused{padding:18px;background:#0a0d08;border-radius:12px;color:#d6ff24;font-size:14px}
/* Wallet identity and controls own separate rows, including unverified sessions. */
.rmtcat-funds{min-width:0;background:#0a0d08;border:1px solid #39432c;padding:14px;border-radius:12px;margin:14px 0 18px}
.rmtcat-funds .rmtcat-funds-amount{min-block-size:2.6em;line-height:1.3}
.rmtcat-funds .rmtcat-usd{min-block-size:1.6em}
.rmtcat-funds .rmtcat-funds-snapshot{display:grid;grid-template-rows:1.6em 1.6em;min-block-size:3.2em}
.rmtcat-funds .rmtcat-funds-health{block-size:4.8em;min-block-size:4.8em;line-height:1.6}
.rmtcat-balances[data-wallet-status]{min-block-size:3.2em}

.rmtcat-funds dl{margin:0;display:grid;grid-template-columns:minmax(0,1fr);gap:14px}.rmtcat-funds dt{font-size:12px;color:#b7beaa}.rmtcat-funds dd{margin:3px 0 0;font-size:16px;font-weight:650;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.rmtcat-funds .rmtcat-usd{font-size:13px;color:#c1c8b7;font-weight:400}.rmtcat-funds p,.rmtcat-price{font-size:12px;color:#b7beaa;line-height:1.6;overflow-wrap:anywhere}.rmtcat-funds p{margin:12px 0 0}.rmtcat-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0 0 16px}.rmtcat-modes button{min-width:0;font-size:12px;padding:8px 5px;line-height:1.4}.rmtcat-modes button[aria-pressed=true]{background:#d6ff24;color:#101500}.rmtcat-price{margin:14px 0}
.rmtcat-root{min-width:0}
.rmtcat-panel{min-width:0}
.rmtcat-price-state,.rmtcat-observation{min-width:0;overflow-wrap:anywhere}
.rmtcat-price-state{display:grid}.rmtcat-price-state>span{grid-area:1/1}.rmtcat-price-sizer{visibility:hidden}
.rmtcat-top{align-items:baseline}
.rmtcat-wallet{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:stretch;margin:20px 0 14px}
.rmtcat-wallet .rmtcat-wallet-choice{display:grid;gap:6px;min-width:0;font-size:13px;line-height:1.5}
.rmtcat-wallet select{width:100%;min-width:0;max-width:100%;font-size:14px;min-height:48px}
.rmtcat-wallet-identity{display:grid;grid-template-columns:minmax(0,1fr);gap:3px;min-width:0}
.rmtcat-wallet-caption{font-size:12px;color:#b7beaa}
.rmtcat-wallet-address{font:600 15px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;max-width:100%}
.rmtcat-wallet-name{font-size:13px;line-height:1.5;color:#c1c8b7;overflow-wrap:anywhere;min-width:0}
.rmtcat-wallet-actions{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
.rmtcat-wallet-actions>button{flex:1 1 180px;min-width:0;max-width:100%;min-height:48px;white-space:normal;overflow-wrap:anywhere}
.rmtcat-root .rmtcat-textbutton{min-height:48px;font-size:13px;padding:10px 12px}
.rmtcat-balances{font-size:13px;line-height:1.6;overflow-wrap:anywhere}
.rmtcat-amount{min-width:0;padding:12px 14px;min-height:62px}
.rmtcat-amount input{font-size:clamp(24px,6vw,28px);line-height:1.35}
.rmtcat-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.rmtcat-presets button{min-width:0;padding:8px 5px;min-height:44px}
.rmtcat-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.rmtcat-actions button{width:100%;min-width:0;min-height:50px;white-space:normal;line-height:1.4}
.rmtcat-quote{padding:14px;min-width:0}
.rmtcat-quote dl>div{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:12px;align-items:start;line-height:1.5}
.rmtcat-quote dt,.rmtcat-quote dd{min-width:0;overflow-wrap:anywhere}
.rmtcat-quote p{font-size:12px;line-height:1.6}
.rmtcat-status{line-height:1.6;overflow-wrap:anywhere}
.rmtcat-status:empty{display:none}
.rmtcat-error{line-height:1.6;overflow-wrap:anywhere}
.rmtcat-transaction{min-width:0;line-height:1.6}
.rmtcat-transaction label{display:grid;gap:6px;min-width:0}
.rmtcat-transaction input{width:100%;min-width:0;max-width:100%;min-height:48px;padding:10px;font:inherit;background:#080b07;color:#f2f4e9;border:1px solid #596344;border-radius:8px}
.rmtcat-transaction a{overflow-wrap:anywhere;min-height:44px;display:flex;align-items:center}
.rmtcat-transaction button{min-width:0;min-height:48px;white-space:normal}
.rmtcat-details{font-size:13px;line-height:1.6}
.rmtcat-details summary{min-height:44px;line-height:1.5;padding:10px 0}
.rmtcat-contract{font-size:11px;line-height:1.6;min-height:44px;padding:10px 0}
@media(max-width:430px){.rmtcat-wallet-actions>button{flex-basis:100%}.rmtcat-panel{padding:20px}.rmtcat-terms{padding:14px}.rmtcat-quote dl{gap:12px}.rmtcat-quote dl>div{grid-template-columns:minmax(0,1fr);gap:2px}.rmtcat-quote dt{font-size:12px}.rmtcat-quote dd{text-align:left;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}}
`;
export function mountCannaCatPanel(element: HTMLElement, config: CannaCatPanelConfig) {
  if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") throw new Error("HTTPS is required for the CannaCat panel.");
  element.classList.add("rmtcat-root");
  const style = document.createElement("style"); style.textContent = css; element.append(style);
  const container = document.createElement("div"); element.append(container);
  const root = createRoot(container);
  if (!config.enabled || !config.privyAppId) {
    root.render(<div className="rmtcat-panel"><div className="rmtcat-top"><span className="rmtcat-eyebrow">CANNACAT · ROBINHOOD CHAIN</span><span className="rmtcat-powered">Execution by RMT</span></div><h3>Get your CannaCat.</h3><p className="rmtcat-intro">Buy or sell here with your existing wallet. Keep 10,000 tokens in the same wallet for the final GTD snapshot.</p><p className="rmtcat-paused">On-site trading is being prepared. Wallet actions remain disabled.</p><button type="button" disabled>Connect wallet · coming soon</button><p className="rmtcat-status">0.25% RMT fee · Network gas applies. Buying does not guarantee GTD.</p></div>);
  } else {
    const url = new URL(config.apiBaseUrl);
    if (url.protocol !== "https:" || url.pathname !== "/api/embed/cannacat" || url.username || url.password || url.search || url.hash) throw new Error("Invalid RMT API configuration.");
    root.render(<PrivyProvider appId={config.privyAppId} clientId={config.privyClientId || undefined} config={{
      loginMethods: ["wallet"], defaultChain: robinhoodChain, supportedChains: [robinhoodChain],
      appearance: { theme: "dark", accentColor: "#d6ff24", walletList: ["metamask", "coinbase_wallet", "detected_ethereum_wallets", "wallet_connect"], showWalletLoginFirst: true },
      embeddedWallets: { ethereum: { createOnLogin: "off" } }
    }}><Panel config={config} /></PrivyProvider>);
  }
  return () => { root.unmount(); container.remove(); style.remove(); element.classList.remove("rmtcat-root"); };
}
