import React, { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, useConnectWallet, useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isHash, keccak256, toHex, type Hex } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { useTradingTermsAcceptance } from "../use-trading-terms";
import TermsPage from "../../app/terms/page";
import RisksPage from "../../app/risks/page";
import PrivacyPage from "../../app/privacy/page";
import { connectedWalletMessage, exactConnectedExternalWallet, readConnectedWallet, soleConnectedExternalWallet,
  uncheckedConnectedWallet, type ConnectedWalletRead, type ConnectedWalletProvider } from "../connected-wallet-state";
import {
  CANNACAT_EMBED, createCannaCatClient, parseCannaCatAmount, externalEthereumWallets, walletGatewayKey,
  prepareVNextWalletTransaction, vNextWalletRpcTransaction, assessVNextWalletGasReadiness,
  findBlockingVNextWalletRequest, findUnresolvedVNextExecution, recordPreparedVNextWalletRequest,
  transitionVNextWalletRequest, promoteVNextWalletRequestToSubmitted, readVNextExecutionJournal,
  readVNextWalletRequestJournal, resolveVNextExecution, verifyVNextErc20OutputSettlement,
  boundVNextNativeSettlementEnvelope, verifyVNextNativeOutputSettlement,
  promoteDiscoveredVNextWalletRequestToSubmitted,
  type CannaCatPrepared, type CannaCatSide, type VNextExecutionRecord
} from "./cannacat-client";

export type CannaCatPanelConfig = {
  enabled: boolean; apiBaseUrl: string; privyAppId: string; privyClientId: string;
};
type Provider = ConnectedWalletProvider;
type Ready = {
  trade: CannaCatPrepared; provider: Provider; walletKey: string; identityToken: string;
  nonce: bigint; block: bigint; blockHash: Hex; chainId: number;
};
const client = createPublicClient({ chain: robinhoodChain, transport: http(CANNACAT_EMBED.rpc, { timeout: 12_000, retryCount: 0 }) });
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
  const [status, setStatus] = useState("Connect an existing wallet to get a live quote.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Ready | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hash, setHash] = useState("");
  const [recoveryHash, setRecoveryHash] = useState("");
  const [balances, setBalances] = useState<{ eth: bigint; token: bigint } | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [tabOwnsWallet, setTabOwnsWallet] = useState(false);
  const [leaseAttempt, setLeaseAttempt] = useState(0);
  const epoch = useRef(0);
  const operation = useRef<AbortController | null>(null);
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

  function invalidate() {
    epoch.current += 1;
    operation.current?.abort();
    setPrepared(null);
    setError("");
  }
  const { connectWallet } = useConnectWallet({ onSuccess: () => { void refreshWallet.current?.(); } });

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

  useEffect(() => { invalidate(); setBalances(null); }, [selectedKey, identityToken, user?.id, wallet?.chainId, authenticated, terms.accepted]);
  useEffect(() => {
    if (!prepared) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [prepared]);
  useEffect(() => () => { operation.current?.abort(); epoch.current += 1; }, []);
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
    const refresh = async () => {
      const candidate = walletRef.current;
      if (!candidate || disposed) return;
      const attempt = ++sequence;
      invalidate(); publish(uncheckedConnectedWallet); providerRef.current = null;
      const state = await readConnectedWallet(candidate);
      if (disposed || sequence !== attempt || currentRef.current.key !== selectedKey) return;
      if (active !== state.provider) {
        detach(); active = state.provider;
        active?.on?.("chainChanged", changed); active?.on?.("accountsChanged", changed); active?.on?.("disconnect", disconnected);
      }
      providerRef.current = state.provider; publish(state);
      setStatus(connectedWalletMessage(state));
    };
    function changed() { if (document.visibilityState !== "hidden") void refresh(); else suspend(); }
    function disconnected() {
      sequence += 1; invalidate(); providerRef.current = null;
      publish({ status: "disconnected", chainId: null, provider: null });
      setStatus("The signing wallet disconnected. Reconnect it before requesting a quote.");
    }
    function suspend() { sequence += 1; invalidate(); providerRef.current = null; publish(uncheckedConnectedWallet); }
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
      else if (pending) setStatus("An earlier wallet response is unresolved. Check your wallet before submitting another transaction.");
    } catch { setError("Local recovery storage is unavailable. Enable site storage before trading."); setBlocking(true); }
    return () => {
      disposed = true; sequence += 1; detach(); refreshWallet.current = null;
      window.removeEventListener("focus", resumed); window.removeEventListener("pageshow", resumed); window.removeEventListener("pagehide", suspend);
      document.removeEventListener("visibilitychange", visible); providerRef.current = null;
    };
  }, [selectedKey, wallet?.address, wallet?.chainId, wallet?.linked, authenticated, user?.id, walletsReady]);

  async function verifyWallet() {
    if (!wallet || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await wallet.loginOrLink(); setStatus("Wallet ownership verified. Choose an amount and request a quote."); }
    catch (cause) { setError(safeError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function switchNetwork() {
    if (!wallet || inFlight.current) return;
    invalidate(); inFlight.current = true; setBusy(true);
    try { await wallet.switchChain(4663); await refreshWallet.current?.(); }
    catch { setError("Network switch was not completed. Select Robinhood Chain in your wallet."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function getQuote() {
    if (!connected || !wallet || !identityToken || inFlight.current || blocking || !tabOwnsWallet || !terms.accepted || walletStateRef.current.status !== "ready") return;
    invalidate(); const generation = epoch.current;
    const controller = new AbortController(); operation.current = controller;
    const key = selectedKey; const token = identityToken;
    inFlight.current = true; setBusy(true); setStatus("Checking wallet, live quote and transaction safety…");
    try {
      const tokenAmountAtomic = parseCannaCatAmount(amount);
      const liveWallet = await readConnectedWallet(wallet);
      if (generation !== epoch.current || currentRef.current.key !== key || currentRef.current.token !== token) return;
      walletStateRef.current = liveWallet; setWalletState(liveWallet);
      if (liveWallet.status !== "ready" || !liveWallet.provider) throw new Error(connectedWalletMessage(liveWallet));
      const provider = liveWallet.provider;
      const [chainId, eth, held, nonce, block] = await Promise.all([
        client.getChainId(),
        client.getBalance({ address: getAddress(wallet.address) }),
        client.readContract({ address: CANNACAT_EMBED.token, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(wallet.address)] }),
        client.getTransactionCount({ address: getAddress(wallet.address), blockTag: "pending" }), client.getBlock()
      ]);
      if (chainId !== 4663) throw new Error("The recovery RPC returned the wrong network. No transaction was prepared.");
      setBalances({ eth, token: held });
      if (eth <= 0n) throw new Error("ETH is needed for network gas, including when selling tokens.");
      if (side === "sell" && BigInt(tokenAmountAtomic) > held) throw new Error("Your selected token amount exceeds this wallet's CannaCat balance.");
      const api = createCannaCatClient({ baseUrl: config.apiBaseUrl, identityToken: token });
      const quote = await api.quote({ side, tokenAmountAtomic, wallet: wallet.address, maximumEthInputAtomic: eth.toString(), signal: controller.signal });
      const trade = await api.prepare(quote, controller.signal);
      const [balanceNow, gasPrice] = await Promise.all([client.getBalance({ address: getAddress(wallet.address) }), client.getGasPrice()]);
      const gas = assessVNextWalletGasReadiness({ nativeBalanceWei: balanceNow, currentGasPriceWei: gasPrice,
        evidenceFeeCeilingWei: trade.evidence.feeCeilingWei, gasLimitUnits: trade.plan.gasLimit, transactionValueAtomic: trade.plan.value });
      if (!gas.ready) throw new Error(`More ETH is required for input and the protected gas reserve (shortfall ${units(gas.shortfallWei)} ETH).`);
      prepareVNextWalletTransaction({ plan: trade.plan, evidence: trade.evidence, connectedAddress: wallet.address, connectedChainId: 4663, nowMs: Date.now() });
      const finalWallet = await readConnectedWallet(wallet);
      if (generation !== epoch.current || currentRef.current.key !== key || currentRef.current.token !== token) return;
      walletStateRef.current = finalWallet; setWalletState(finalWallet);
      if (finalWallet.status !== "ready" || finalWallet.provider !== provider) throw new Error("The signing provider changed while preparing the quote. Request a fresh quote.");
      if (generation !== epoch.current || currentRef.current.key !== key || currentRef.current.token !== token) return;
      if (!block.hash || !block.number) throw new Error("Current chain recovery evidence is unavailable.");
      setPrepared({ trade, provider, walletKey: key, identityToken: token, nonce: BigInt(nonce), block: block.number, blockHash: block.hash, chainId: 4663 });
      setNow(Date.now());
      setStatus(trade.plan.kind === "erc20_approval" ? "Approve only the displayed CannaCat amount. A fresh swap review follows after confirmation." : "Review the protected quote, then confirm explicitly in your wallet.");
    } catch (cause) { if (generation === epoch.current && !controller.signal.aborted) { setError(safeError(cause)); setStatus("No transaction was submitted."); } }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function checkTransaction(recordOverride?: VNextExecutionRecord) {
    if (!wallet || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const record = recordOverride ?? readVNextExecutionJournal(localStorage).find((entry) => entry.wallet.toLowerCase() === wallet.address.toLowerCase() && entry.txHash.toLowerCase() === hash.toLowerCase());
      if (!record) throw new Error("Keep this transaction hash and check your wallet. Its saved recovery record is unavailable; do not submit again.");
      const [receipt, transaction, chainId] = await Promise.all([client.getTransactionReceipt({ hash: record.txHash }), client.getTransaction({ hash: record.txHash }), client.getChainId()]);
      if (chainId !== 4663) throw new Error("The recovery RPC returned the wrong network.");
      if (transaction.chainId !== 4663 || transaction.hash.toLowerCase() !== record.txHash.toLowerCase()
        || receipt.transactionHash.toLowerCase() !== record.txHash.toLowerCase()
        || transaction.from.toLowerCase() !== record.wallet.toLowerCase() || receipt.from.toLowerCase() !== record.wallet.toLowerCase()
        || transaction.blockHash !== receipt.blockHash) throw new Error("The mined transaction does not match this wallet's saved recovery record.");
      if (receipt.status === "reverted") {
        resolveVNextExecution(record.txHash, "reverted", localStorage);
        setBlocking(false); setStatus("Transaction reverted. The trade did not complete; network gas may still apply."); return;
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
        invalidate(); setBlocking(false); setStatus("Approval confirmed. Request a fresh quote to review the swap. No sale has occurred yet."); return;
      }
      let proof = verifyVNextErc20OutputSettlement(record, receipt, transaction);
      if (!proof && boundVNextNativeSettlementEnvelope(record, receipt, transaction) && identityToken) {
        const result = await createCannaCatClient({ baseUrl: config.apiBaseUrl, identityToken }).nativeSettlementTrace(record.txHash, record.wallet);
        if (result && typeof result === "object" && "status" in result && result.status === "available"
          && "blockHash" in result && result.blockHash === receipt.blockHash.toLowerCase() && "txHash" in result
          && typeof result.txHash === "string" && result.txHash.toLowerCase() === record.txHash.toLowerCase() && "trace" in result) {
          proof = verifyVNextNativeOutputSettlement(record, receipt, transaction, result.trace);
        }
      }
      if (!proof) { setStatus("Receipt confirmed; output settlement is still unverified. Keep the hash and check again. Do not resend."); return; }
      if (!resolveVNextExecution(record.txHash, "confirmed", localStorage, Date.now(), { outputAmountAtomic: proof.amountAtomic, outputSettlement: proof })) throw new Error("Verified output could not be saved. Keep the hash and check again.");
      setBlocking(false); setBalances(null); setStatus(`Settlement verified: ${units(proof.amountAtomic)} ${record.outputAsset.toLowerCase() === CANNACAT_EMBED.token.toLowerCase() ? "CannaCat" : "ETH"} received by ${short(record.wallet)}.`);
    } catch (cause) {
      if (cause instanceof Error && /not.*found|could not be found/i.test(cause.message)) setStatus("Transaction submitted; confirmation is pending. Check again in a moment. Do not resend.");
      else setError(safeError(cause));
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function recoverWalletResponse() {
    if (!wallet || inFlight.current || !isHash(recoveryHash)) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const request = findBlockingVNextWalletRequest(wallet.address, localStorage);
      const plan = request?.recoveryPlan;
      if (!request || !plan) throw new Error("No unresolved saved wallet request matches this wallet.");
      const transaction = await client.getTransaction({ hash: recoveryHash });
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
    } catch (cause) { setError(safeError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function confirmTrade() {
    if (!prepared || !wallet || inFlight.current || !connected || blocking || !tabOwnsWallet || !terms.accepted) return;
    let requestId = "";
    try {
      if (prepared.walletKey !== selectedKey || prepared.identityToken !== identityToken || prepared.chainId !== 4663
        || walletStateRef.current.status !== "ready" || walletStateRef.current.provider !== prepared.provider) throw new Error("Wallet authority changed. Request a fresh quote.");
      if (findBlockingVNextWalletRequest(wallet.address, localStorage) || findUnresolvedVNextExecution(wallet.address, localStorage)) throw new Error("Resolve the earlier wallet request before another trade.");
      const transaction = prepareVNextWalletTransaction({ plan: prepared.trade.plan, evidence: prepared.trade.evidence, connectedAddress: wallet.address, connectedChainId: 4663, nowMs: Date.now() });
      requestId = crypto.randomUUID();
      const saved = recordPreparedVNextWalletRequest({ requestId, wallet: wallet.address, plan: prepared.trade.plan, walletNonceBeforeRequest: prepared.nonce, requestBlockNumber: prepared.block, requestBlockHash: prepared.blockHash, connectorType: wallet.connectorType, walletClientType: wallet.walletClientType, connectorId: wallet.meta.id }, localStorage);
      if (!saved || !transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", localStorage)) throw new Error("Recovery storage failed. No wallet request was opened.");
      inFlight.current = true; setBusy(true); setBlocking(true); setError(""); setStatus("Confirm the exact transaction in your wallet. Waiting for your response…");
      // User-gesture path: no quote fetch, chain lookup or automatic signature.
      const pending = prepared.provider.request({ method: "eth_sendTransaction", params: [{ ...vNextWalletRpcTransaction(transaction), chainId: toHex(4663) }] });
      setPrepared(null);
      void pending.then((result) => {
        if (typeof result !== "string" || !isHash(result)) throw new Error("Wallet response did not contain a valid transaction hash.");
        setHash(result);
        const record = promoteVNextWalletRequestToSubmitted({ requestId, wallet: wallet.address, plan: prepared.trade.plan, txHash: result }, localStorage);
        setStatus(record ? "Transaction submitted. Check confirmation and settlement below." : "Transaction submitted, but recovery storage failed. Keep this hash and check your wallet; do not resend.");
      }).catch((cause) => {
        const rejected = isUserRejection(cause);
        transitionVNextWalletRequest(requestId, rejected ? "USER_REJECTED" : "UNRESOLVED", localStorage);
        setBlocking(!rejected); setError(rejected ? "Wallet request declined. Nothing was confirmed; refresh the quote when ready." : "The wallet response is unresolved. Check wallet history before trying anything else. Do not resend.");
      }).finally(() => { inFlight.current = false; setBusy(false); });
    } catch (cause) {
      // An EIP-1193 provider can throw before returning its promise. Keep the
      // durable request unresolved unless the wallet explicitly rejected it.
      if (requestId) {
        const rejected = isUserRejection(cause);
        transitionVNextWalletRequest(requestId, rejected ? "USER_REJECTED" : "UNRESOLVED", localStorage);
        setBlocking(!rejected);
        setStatus(rejected ? "Wallet request declined. Refresh the quote when ready." : "Check wallet history before retrying. Do not resend an unresolved request.");
      }
      inFlight.current = false; setBusy(false); setError(safeError(cause)); setPrepared(null);
    }
  }

  const expired = Boolean(prepared && Math.min(prepared.trade.plan.expiresAtMs, prepared.trade.evidence.expiresAtMs) <= now);
  const evidence = prepared?.trade.evidence;
  const fee = evidence?.providerNativeFee;
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
      {(["buy", "sell"] as const).map((direction) => <button key={direction} type="button" aria-pressed={side === direction} disabled={busy} onClick={() => { invalidate(); setSide(direction); setStatus("Choose an amount and request a fresh quote."); }}>{direction === "buy" ? "Buy CannaCat" : "Sell CannaCat"}</button>)}
    </div>
    <div className="rmtcat-wallet">
      {(external.length > 1 || (!wallet && external.length > 0)) && <label className="rmtcat-wallet-choice">Choose signing wallet<select aria-label="Choose signing wallet" value={selectedKey} disabled={busy || !terms.accepted} onChange={(event) => { invalidate(); explicitChoiceRequired.current = true; setSelectedKey(event.target.value); }}>
          <option value="" disabled>Select a wallet</option>
          {external.map((option) => <option key={walletGatewayKey(option)} value={walletGatewayKey(option)}>{short(option.address)} · {option.meta.name ?? option.walletClientType}</option>)}
        </select></label>}
      {wallet && external.length === 1 && <div className="rmtcat-wallet-identity"><span className="rmtcat-wallet-caption">Trading wallet</span><span className="rmtcat-wallet-address" title={wallet.address}>{short(wallet.address)}</span><span className="rmtcat-wallet-name">{wallet.meta.name ?? wallet.walletClientType}</span></div>}
      <div className="rmtcat-wallet-actions">
      {!wallet ? <button type="button" disabled={!ready || !walletsReady || busy || !terms.accepted} onClick={() => { explicitChoiceRequired.current = external.length > 1; connectWallet({ walletChainType: "ethereum-only", walletList: ["metamask", "coinbase_wallet", "detected_ethereum_wallets", "wallet_connect"] }); }}>Connect wallet</button> : <>
        {!connected && <button type="button" disabled={busy || !terms.accepted} onClick={() => void verifyWallet()}>Verify wallet ownership</button>}
        {walletState.status === "wrong-chain" && <button type="button" disabled={busy || !terms.accepted} onClick={() => void switchNetwork()}>Switch to Robinhood Chain</button>}
        {(["disconnected", "unavailable", "account-mismatch"] as const).some(value => value === walletState.status) && <button type="button" disabled={busy || !terms.accepted} onClick={() => connectWallet({ walletChainType: "ethereum-only" })}>Reconnect wallet</button>}
        {!tabOwnsWallet && <button type="button" disabled={busy} onClick={() => setLeaseAttempt((value) => value + 1)}>Use this tab</button>}
        <button className="rmtcat-textbutton" type="button" disabled={busy || blocking} onClick={() => { invalidate(); explicitChoiceRequired.current = true; setSelectedKey(""); void logout(); }}>Disconnect</button>
      </>}
      </div>
    </div>
    {wallet && <p className="rmtcat-balances" data-wallet-status={walletState.status}>{connectedWalletMessage(walletState)}</p>}
    <label className="rmtcat-amountlabel" htmlFor={inputId}>{side === "buy" ? "Minimum CannaCat to receive" : "CannaCat to sell"}</label>
    <div className="rmtcat-amount"><input id={inputId} inputMode="decimal" autoComplete="off" value={amount} disabled={busy} maxLength={60} onChange={(event) => { invalidate(); setAmount(event.target.value); }} /><span>CANNACAT</span></div>
    {side === "buy" && <div className="rmtcat-presets">{["10000", "25000", "50000"].map((value) => <button type="button" key={value} disabled={busy} onClick={() => { invalidate(); setAmount(value); }}>{Number(value).toLocaleString("en-US")}</button>)}</div>}
    {balances && <p className="rmtcat-balances">Available: {units(balances.eth)} ETH · {units(balances.token, 4)} CannaCat</p>}
    {evidence && <div className="rmtcat-quote" aria-label="Verified trade review"><dl>
      <div><dt>{side === "buy" ? "Exact ETH input" : "Exact token input"}</dt><dd>{units(evidence.inputAmountAtomic)} {side === "buy" ? "ETH" : "CannaCat"}</dd></div>
      <div><dt>Expected received</dt><dd>{units(evidence.expectedOutputAtomic)} {side === "buy" ? "CannaCat" : "ETH"}</dd></div>
      <div><dt>Protected minimum</dt><dd>{units(evidence.protectedOutputAtomic)} {side === "buy" ? "CannaCat" : "ETH"}</dd></div>
      <div><dt>{prepared?.trade.plan.kind === "erc20_approval" ? "Planned swap fee · 0.25%" : "RMT fee · 0.25%"}</dt><dd>{fee ? `${units(fee.feeAmountAtomic)} ETH` : "Unavailable"}</dd></div>
      <div><dt>Estimated network gas</dt><dd>{evidence.estimatedNetworkCostWei ? `${units(evidence.estimatedNetworkCostWei)} ETH` : "Unavailable"}</dd></div>
      <div><dt>Provider fee</dt><dd>{fee?.providerFeeAtomic ? `${units(fee.providerFeeAtomic)} ${fee.providerFeeAsset?.toLowerCase() === CANNACAT_EMBED.token.toLowerCase() ? "CannaCat" : "ETH"}` : "None disclosed"}</dd></div>
      <div><dt>Maximum slippage</dt><dd>1%</dd></div>
      <div><dt>Recipient</dt><dd>{short(evidence.recipient)}</dd></div>
    </dl><p>{expired ? "Quote expired — refresh before confirming." : prepared?.trade.plan.kind === "erc20_approval" ? "No swap fee is charged by this approval. Network gas applies. Review a fresh swap quote after confirmation." : "Fees are disclosed estimates. Network gas is additional. Review exact amounts in your wallet."}</p></div>}
    <div className="rmtcat-actions"><button type="button" disabled={!terms.accepted || !connected || busy || blocking || !tabOwnsWallet || walletState.status !== "ready"} onClick={() => void getQuote()}>{busy ? "Working…" : prepared ? "Refresh quote" : "Get live quote"}</button>
      {prepared && <button type="button" className="rmtcat-confirm" disabled={!terms.accepted || busy || expired || blocking} onClick={confirmTrade}>{prepared.trade.plan.kind === "erc20_approval" ? "Review token approval" : `Confirm ${side} in wallet`}</button>}
    </div>
    <p className="rmtcat-status" role="status" aria-live="polite">{status === connectedWalletMessage(walletState) || (wallet && status === "Connect an existing wallet to get a live quote.") ? "" : status}</p>
    {error && <p className="rmtcat-error" role="alert">{error}</p>}
    {blocking && !hash && <div className="rmtcat-transaction"><label>Recover an unanswered wallet request<input aria-label="Transaction hash from your wallet" value={recoveryHash} maxLength={66} autoComplete="off" onChange={(event) => setRecoveryHash(event.target.value)} placeholder="0x… transaction hash" /></label><button type="button" disabled={busy || !isHash(recoveryHash)} onClick={() => void recoverWalletResponse()}>Verify saved transaction</button><p>Paste a hash from your wallet history. Only an exact match can be recovered. This never sends another transaction.</p></div>}
    {hash && <div className="rmtcat-transaction"><a href={explorer(hash)} target="_blank" rel="noopener noreferrer">View transaction {short(hash)}</a><button type="button" disabled={busy} onClick={() => void checkTransaction()}>Check settlement</button></div>}
    <details className="rmtcat-details"><summary>Fees, eligibility & recovery</summary><p>RMT requests a 0.25% fee in ETH for this pair. Provider fees and network gas are shown separately. Approving tokens is not a completed sale. A receipt alone is not verified settlement. If a wallet response is lost, do not send again; check the saved transaction.</p><p>Buying does not reserve an NFT or guarantee GTD. NFT holdings, the same-wallet token balance at the final snapshot, Founder exclusion and first-come-first-served access still apply. Selling before the snapshot may remove eligibility. NFT registration and minting remain closed.</p><p>Only public transaction and wallet details are stored locally for recovery. Wallet credentials and identity tokens are never written to this trading journal. Never share a private key or seed phrase.</p></details>
    <a className="rmtcat-contract" href={`${robinhoodChain.blockExplorers.default.url}/token/${CANNACAT_EMBED.token}`} target="_blank" rel="noopener noreferrer">Token contract: {CANNACAT_EMBED.token}</a>
  </div>;
}

const css = `
.rmtcat-terms{padding:16px;border:1px solid #637b2c;background:#11180b;border-radius:12px;margin:16px 0;font-size:13px}.rmtcat-terms details{margin:12px 0}.rmtcat-terms summary{cursor:pointer;min-height:44px;line-height:44px}.rmtcat-legal{max-height:320px;overflow:auto;padding:12px;border:1px solid #39432c}.rmtcat-legal h2{font-size:15px;line-height:1.4;margin:14px 0 6px}.rmtcat-legal p{font-size:13px;line-height:1.6}.rmtcat-root{font:400 16px/1.5 system-ui,sans-serif;color:#f2f4e9;color-scheme:dark;width:100%;box-sizing:border-box}.rmtcat-root *{box-sizing:border-box}.rmtcat-panel{padding:clamp(20px,4vw,36px);border:1px solid #485032;background:linear-gradient(135deg,#171c13,#0c0e0b);border-radius:20px;max-width:680px;margin:auto}.rmtcat-top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.rmtcat-eyebrow{font-size:11px;letter-spacing:.13em;color:#d6ff24;font-weight:800}.rmtcat-powered{font-size:11px;color:#b7beaa}.rmtcat-panel h3{font-size:clamp(28px,6vw,42px);line-height:1.1;margin:18px 0 10px;font-weight:850;letter-spacing:-.04em}.rmtcat-intro{color:#c1c8b7;font-size:14px;margin:0 0 22px}.rmtcat-tabs{display:flex;padding:4px;background:#080a06;border-radius:12px;margin-bottom:18px;gap:4px}.rmtcat-root button{font:inherit;border:1px solid #596344;border-radius:9px;min-height:44px;padding:9px 16px;cursor:pointer;color:#edf2e6;background:#252c20;font-weight:650}.rmtcat-tabs button{flex:1;border:0;background:transparent;font-size:14px}.rmtcat-tabs button[aria-pressed=true],.rmtcat-root button.rmtcat-confirm{color:#101500;background:#d6ff24}.rmtcat-root button:disabled{opacity:.45;cursor:not-allowed}.rmtcat-root :focus-visible{outline:3px solid #edff9c;outline-offset:3px}.rmtcat-wallet{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:18px}.rmtcat-wallet label{display:grid;gap:4px;font-size:11px;flex:1;min-width:0}.rmtcat-wallet select{font:inherit;font-size:13px;background:#11150d;color:#f3f8eb;border:1px solid #596344;border-radius:7px;min-height:44px;max-width:100%;padding:8px}.rmtcat-root .rmtcat-textbutton{font-size:12px;padding:5px 10px;border:0;background:none;text-decoration:underline}.rmtcat-amountlabel{font-size:13px;color:#c1c8b7;display:block;margin-bottom:6px}.rmtcat-amount{display:flex;align-items:center;gap:8px;border:1px solid #586447;background:#070a05;border-radius:12px;padding:12px 16px}.rmtcat-amount input{width:100%;min-width:0;font:700 28px/1.3 system-ui;color:#fff;background:none;border:0}.rmtcat-amount span{font-size:10px;letter-spacing:.06em;color:#c5d5aa}.rmtcat-presets{display:flex;gap:8px;margin-top:10px}.rmtcat-presets button{font-size:12px;padding:5px 12px;min-height:44px}.rmtcat-balances{font-size:12px;color:#b7beaa}.rmtcat-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.rmtcat-actions button{flex:1;min-width:150px}.rmtcat-quote{padding:16px;background:#0a0d08;border-radius:12px;margin-top:18px}.rmtcat-quote dl{margin:0;display:grid;gap:8px;font-size:13px}.rmtcat-quote dl>div{display:flex;justify-content:space-between;gap:15px}.rmtcat-quote dt{color:#b7beaa}.rmtcat-quote dd{margin:0;text-align:right;overflow-wrap:anywhere}.rmtcat-quote p{font-size:11px;color:#c1c8b7;margin:12px 0 0}.rmtcat-status{font-size:13px;color:#d7dfcc;margin:16px 0}.rmtcat-error{font-size:13px;padding:12px;border:1px solid #b86b52;background:#27150f;border-radius:8px;color:#ffd8c9}.rmtcat-transaction{display:grid;gap:10px;padding:12px;border:1px solid #5b6d36;border-radius:9px;font-size:13px}.rmtcat-root a{color:#d6ff24;text-underline-offset:3px}.rmtcat-details{font-size:12px;color:#b7beaa;border-top:1px solid #39432c;margin-top:18px;padding-top:14px}.rmtcat-details summary{cursor:pointer;min-height:36px;display:list-item;line-height:28px;color:#d7dfcc}.rmtcat-contract{font-size:10px;overflow-wrap:anywhere;display:block;margin-top:12px}.rmtcat-root .rmtcat-paused{padding:18px;background:#0a0d08;border-radius:12px;color:#d6ff24;font-size:14px}
/* Wallet identity and controls own separate rows, including unverified sessions. */
.rmtcat-root{min-width:0}
.rmtcat-panel{min-width:0}
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
