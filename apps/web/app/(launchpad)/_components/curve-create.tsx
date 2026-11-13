"use client";

import { useEffect, useState, type FormEvent } from "react";
import { encodeFunctionData, getAddress, isAddress, toHex, zeroAddress } from "viem";
import { curveReviewTime } from "../../../lib/launchpad/curve-receipt";
import { curveFactoryAbi, curveProjectURI, curveSupplyPresets } from "../../../lib/launchpad/curve-v1";
import { prepareTransaction } from "../../../lib/launchpad/direct-v4";
import { walletMessage, type LaunchRequest } from "../../../lib/launchpad/transactions";
import { TransactionFeedback, useLaunchTransaction } from "./launch-transactions";
import { useLaunchClient, useLaunchWallet, WalletConnection } from "./launch-wallet";

const initial = { name: "", symbol: "", projectURI: "", supplyPreset: "0", treasury: "", share: "" };
const draftKey = "rmt:curve-v1:create";

export function CurveCreate() {
  const { config, wallet, stillSelected, refresh } = useLaunchWallet();
  const deployment = config?.status === "ready" && config.curve ? config.deployment : undefined;
  const rpc = useLaunchClient(deployment);
  const transaction = useLaunchTransaction();
  const [draft, setDraft] = useState(initial);
  const [restored, setRestored] = useState(false);
  const [review, setReview] = useState<{ request: LaunchRequest; name: string; symbol: string; preset: number; treasuryShareBps: number }>();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null") as typeof initial | null;
      if (saved && Object.keys(initial).every((key) => typeof saved[key as keyof typeof initial] === "string"
        && saved[key as keyof typeof initial].length <= 196)) setDraft(saved);
    } catch { /* The form can still be used without stored input. */ }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored) try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* Retain in-memory input. */ }
  }, [draft, restored]);
  useEffect(() => { setReview(undefined); }, [wallet?.generation, transaction.result]);

  function edit(key: keyof typeof draft, value: string) {
    setDraft((prior) => ({ ...prior, [key]: value }));
    setReview(undefined);
    setError("");
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet || !deployment || !rpc || preparing || transaction.pending) return;
    setReview(undefined);
    setError("");
    setPreparing(true);
    try {
      const name = draft.name.trim();
      const symbol = draft.symbol.trim().toUpperCase();
      const projectURI = draft.projectURI.trim();
      const bytes = new TextEncoder();
      if (!name || bytes.encode(name).length > 48 || /[\x00-\x1f\x7f]/.test(name) || !/^[A-Z0-9]{1,12}$/.test(symbol)) {
        throw new Error("Use a token name up to 48 bytes and a symbol of up to 12 letters or digits.");
      }
      if (projectURI && (!curveProjectURI(projectURI) || bytes.encode(projectURI).length > 196)) throw new Error("Use an HTTPS project link up to 196 bytes.");
      if (!/^[0-2]$/.test(draft.supplyPreset)) throw new Error("Choose a fixed supply preset.");
      const preset = Number(draft.supplyPreset);
      const share = draft.share.trim();
      const treasuryShareBps = share && /^\d{1,2}(?:\.\d{1,2})?$/.test(share) ? Math.round(Number(share) * 100) : share ? -1 : 0;
      const treasuryInput = draft.treasury.trim();
      if (treasuryShareBps < 0 || treasuryShareBps > 9_000 || (treasuryShareBps > 0
        ? !isAddress(treasuryInput) || getAddress(treasuryInput) === zeroAddress
        : treasuryInput !== "")) throw new Error("Use a treasury address and a fee share above 0% and at most 90%, or leave both empty.");
      const treasury = treasuryShareBps > 0 ? getAddress(treasuryInput) : zeroAddress;
      if (treasury === wallet.address) throw new Error("Use a project treasury address distinct from your creator wallet.");
      const intentId = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const deadline = await curveReviewTime(rpc) + 300;
      const data = encodeFunctionData({ abi: curveFactoryAbi, functionName: "create",
        args: [name, symbol, projectURI, preset, treasury, treasuryShareBps, intentId, BigInt(deadline)] });
      const request = await prepareTransaction(rpc, deployment, wallet, { kind: "curve-create", to: deployment.factory, data, deadline, intentId });
      if (!stillSelected(wallet)) throw new Error("Wallet selection changed. Review creation again.");
      setReview({ request, name, symbol, preset, treasuryShareBps });
    } catch (cause) { setError(walletMessage(cause)); }
    finally { setPreparing(false); }
  }

  const wrongNetwork = Boolean(wallet && deployment && wallet.chainId !== deployment.chainId);
  const busy = preparing || transaction.busy || Boolean(transaction.pending);
  return <>
    <header className="lpPageHeading"><div><h1>Create Token</h1><p>Fixed supply, bonding-curve trading and v4 graduation.</p></div></header>
    {!config && <p className="lpNotice" role="status">Checking the review deployment…</p>}
    {config?.status === "disabled" && <p className="lpNotice">Onchain creation is disabled on this deployment.</p>}
    {config?.status === "unavailable" && <div className="lpNotice">{config.reason}<button className="lpButton lpSecondary" type="button" onClick={refresh}>Retry</button></div>}
    <TransactionFeedback transaction={transaction} />
    <div className="lpColumns">
      <form className="lpPanel lpForm" onSubmit={(event) => void prepare(event)}>
        <fieldset disabled={busy}>
          <legend>Token details</legend>
          <div className="lpFormGrid">
            <label>Token name<input required maxLength={48} value={draft.name} onChange={(event) => edit("name", event.target.value)} /></label>
            <label>Symbol<input required maxLength={12} value={draft.symbol} onChange={(event) => edit("symbol", event.target.value.toUpperCase())} /></label>
          </div>
          <label>Project link<input type="url" maxLength={196} value={draft.projectURI} onChange={(event) => edit("projectURI", event.target.value)} placeholder="https://" /></label>
          <label>Fixed supply<select value={draft.supplyPreset} onChange={(event) => edit("supplyPreset", event.target.value)}>
            {curveSupplyPresets.map((supply, index) => <option value={index} key={supply}>{supply.toLocaleString("en-US")} tokens</option>)}
          </select></label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Optional project treasury</legend>
          <label>Treasury wallet<input maxLength={42} value={draft.treasury} onChange={(event) => edit("treasury", event.target.value)} placeholder="0x…" /></label>
          <label>Treasury share of fees (%)<input inputMode="decimal" maxLength={5} value={draft.share} onChange={(event) => edit("share", event.target.value)} placeholder="0" /></label>
        </fieldset>
        {(!wallet || wrongNetwork) && <WalletConnection compact />}
        {error && <p className="lpNotice lpError" role="alert">{error}</p>}
        <button className="lpButton" disabled={!wallet || !rpc || wrongNetwork || busy}>{preparing ? "Simulating creation…" : "Review creation"}</button>
      </form>
      <section className="lpPanel lpForm">
        <h2>{review ? `Review ${review.symbol}` : "Launch terms"}</h2>
        <dl className="lpFacts">
          <dt>Creation cost</dt><dd>Network gas only</dd>
          <dt>Creator token allocation</dt><dd>0 tokens</dd>
          <dt>Curve inventory</dt><dd>{review ? `${curveSupplyPresets[review.preset].toLocaleString("en-US")} tokens` : "100% of fixed supply"}</dd>
          <dt>Opening real ETH reserve</dt><dd>0 ETH</dd>
          <dt>Curve trade fee</dt><dd>1% of gross ETH, plus gas</dd>
          <dt>RMT operating and future reserve</dt><dd>5% of collected fees each</dd>
          <dt>Project treasury</dt><dd>{review ? `${review.treasuryShareBps / 100}% of collected fees` : "Optional share of collected fees"}</dd>
          <dt>Graduation</dt><dd>60% net supply sold · 1 ETH backing target</dd>
          <dt>v4 position</dt><dd>Permanent principal custody</dd>
        </dl>
        {review && <button className="lpButton" type="button" disabled={busy} onClick={() => void transaction.send(review.request)}>Confirm creation in wallet</button>}
      </section>
    </div>
  </>;
}
