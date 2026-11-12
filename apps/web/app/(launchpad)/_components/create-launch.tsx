"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { encodeFunctionData, formatEther, getAddress, isAddress, isHash, parseEther, toHex, zeroAddress, type Address } from "viem";
import { displayAmount, factoryAbi, longevityFactoryAbi, prepareTransaction, priceInWei } from "../../../lib/launchpad/direct-v4";
import { growthVaultDeployerAbi } from "../../../lib/launchpad/growth-vault";
import { openingExamples } from "../../../lib/launchpad/opening-examples";
import { walletMessage, type LaunchConfig, type LaunchRequest } from "../../../lib/launchpad/transactions";
import { TransactionFeedback, useLaunchTransaction } from "./launch-transactions";
import { useLaunchClient, useLaunchWallet, WalletConnection } from "./launch-wallet";

const supplies = ["1 million", "100 million", "1 billion"];
const draftKey = "rmt:launchpad:draft:v1";
const baseDraft = { name: "", symbol: "", projectURI: "", supplyPreset: "0", allocation: "80", seed: "0.1" };
const initial = { ...baseDraft, longevity: "off", creatorFees: "", treasuryFees: "", reserveFees: "", treasury: "", reserve: "",
  growthVault: "off", growthIntent: "" };
type Draft = typeof initial;
type FeePolicy = { treasury: Address; reserve: Address; creatorBps: number; treasuryBps: number; reserveBps: number };

function feePolicyFor(draft: Draft, creator: Address, growthVault?: Address): FeePolicy {
  const basisPoints = (value: string) => {
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter each fee share as a percentage, using 0 for an unused share.");
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  };
  const creatorBps = basisPoints(draft.creatorFees);
  const treasuryBps = basisPoints(draft.treasuryFees);
  const reserveBps = basisPoints(draft.reserveFees);
  if (growthVault && reserveBps === 0) throw new Error("Allocate a positive reserve share to use the growth vault.");
  if (creatorBps + treasuryBps + reserveBps !== 10_000 || treasuryBps + reserveBps === 0) {
    throw new Error("Shares must total 100%, including a treasury or reserve share.");
  }
  const recipient = (raw: string, share: number) => {
    if (share === 0) return zeroAddress;
    const value = raw.trim();
    if (!isAddress(value, { strict: false }) || value.toLowerCase() === zeroAddress) {
      throw new Error("Enter a valid recipient for each funded fee share.");
    }
    return getAddress(value);
  };
  const treasury = recipient(draft.treasury, treasuryBps);
  const reserve = growthVault ?? recipient(draft.reserve, reserveBps);
  const recipients = [creator, ...[treasury, reserve].filter((address) => address !== zeroAddress)];
  if (new Set(recipients.map((address) => address.toLowerCase())).size !== recipients.length) {
    throw new Error("Use distinct creator, treasury, and reserve wallets.");
  }
  return { treasury, reserve, creatorBps, treasuryBps, reserveBps };
}

function validated(draft: Draft) {
  const name = draft.name.trim();
  const symbol = draft.symbol.trim().toUpperCase();
  const projectURI = draft.projectURI.trim();
  const length = (value: string) => new TextEncoder().encode(value).length;
  if (!name || length(name) > 64 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Enter a token name up to 64 bytes.");
  if (!/^[A-Z0-9]{1,12}$/.test(symbol)) throw new Error("Use 1–12 letters or digits for the symbol.");
  if (projectURI) {
    let url: URL | undefined;
    try { url = new URL(projectURI); } catch { /* User can fix the value. */ }
    if (!url || url.protocol !== "https:" || url.username || url.password || length(projectURI) > 512) {
      throw new Error("Enter an HTTPS project link up to 512 bytes, or leave it empty.");
    }
  }
  const supplyPreset = Number(draft.supplyPreset);
  if (!/^[0-2]$/.test(draft.supplyPreset) || !/^\d{2,3}(?:\.\d{1,2})?$/.test(draft.allocation)) {
    throw new Error("Choose a supply preset and enter a liquidity allocation to two decimal places.");
  }
  const poolAllocationBps = Math.round(Number(draft.allocation) * 100);
  if (poolAllocationBps < 1_000 || poolAllocationBps > 10_000) throw new Error("Allocate 10–100% of supply to liquidity.");
  if (!/^\d{1,3}(?:\.\d{1,18})?$/.test(draft.seed)) throw new Error("Enter the initial ETH deposit as a decimal.");
  const nativeAmount = parseEther(draft.seed);
  if (nativeAmount < parseEther("0.001") || nativeAmount > parseEther("100")) throw new Error("The test deposit must be between 0.001 and 100 ETH.");
  return { name, symbol, projectURI, supplyPreset, poolAllocationBps, nativeAmount };
}

type Review = {
  request: LaunchRequest;
  symbol: string;
  supply: bigint;
  depositedETH: bigint;
  depositedTokens: bigint;
  maxETH: bigint;
  openingPrice: bigint;
  sqrtPrice: bigint;
  liquidity: bigint;
  feePolicy?: FeePolicy;
  growthVault?: Address;
};

export function CreateLaunch() {
  const { config, wallet, stillSelected, refresh } = useLaunchWallet();
  const deployment = config?.status === "ready" ? config.deployment : undefined;
  const growthDeployer = deployment?.growthVaultDeployer;
  const client = useLaunchClient(deployment);
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(initial);
  const [review, setReview] = useState<Review>();
  const [accepted, setAccepted] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const reviewRef = useRef<HTMLElement>(null);
  const transaction = useLaunchTransaction();
  const growthSelected = draft.longevity === "on" && draft.growthVault === "on" && Number(draft.reserveFees) > 0;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null") as Partial<Draft> | null;
      if (saved && Object.keys(baseDraft).every((key) => typeof saved[key as keyof Draft] === "string"
        && saved[key as keyof Draft]!.length <= 512)) {
        draftRef.current = { ...initial };
        for (const key of Object.keys(initial) as (keyof Draft)[]) {
          const value = saved[key];
          if (typeof value === "string" && value.length <= 512) draftRef.current[key] = value;
        }
        setDraft(draftRef.current);
      }
    } catch { /* A clean form remains available. */ }
  }, []);
  useEffect(() => {
    setReview(undefined);
    setAccepted(false);
  }, [wallet?.generation, growthDeployer]);
  useEffect(() => {
    if (review) reviewRef.current?.focus();
  }, [review]);

  function edit(key: keyof Draft, value: string) {
    draftRef.current = { ...draftRef.current, [key]: value };
    setDraft(draftRef.current);
    try { localStorage.setItem(draftKey, JSON.stringify(draftRef.current)); } catch { /* Draft stays in memory. */ }
    setReview(undefined);
    setAccepted(false);
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !deployment || !wallet || preparing || transaction.pending) return;
    setError("");
    setReview(undefined);
    setAccepted(false);
    setPreparing(true);
    try {
      const fields = validated(draft);
      let intentId = toHex(crypto.getRandomValues(new Uint8Array(32)));
      let growthVault: Address | undefined;
      if (growthSelected) {
        if (!growthDeployer) throw new Error("The test growth vault is unavailable. Choose a reserve wallet to continue.");
        const preparedIntent = draft.growthIntent.trim();
        if (!isHash(preparedIntent) || /^0x0+$/i.test(preparedIntent)) throw new Error("Enter the prepared test vault intent.");
        const registered = await client.readContract({ address: growthDeployer, abi: growthVaultDeployerAbi,
          functionName: "vaultFor", args: [wallet.address, preparedIntent] });
        const code = registered === zeroAddress ? undefined : await client.getCode({ address: registered });
        if (!code || code === "0x") {
          throw new Error("No test vault is registered for this account and intent.");
        }
        intentId = preparedIntent;
        growthVault = registered;
      }
      const feePolicy = deployment.engineVersion === 2 && draft.longevity === "on"
        ? feePolicyFor(draft, wallet.address, growthVault) : undefined;
      const [supply, , sqrtPrice, liquidity, depositedETH, depositedTokens] = await client.readContract({
        address: deployment.factory, abi: factoryAbi, functionName: "preview",
        args: [fields.supplyPreset, fields.poolAllocationBps, fields.nativeAmount],
      });
      const deadline = Math.floor(Date.now() / 1000) + 10 * 60;
      const terms = { ...fields, intentId, deadline: BigInt(deadline) };
      const data = feePolicy
        ? encodeFunctionData({ abi: longevityFactoryAbi, functionName: "launchWithLongevity", args: [terms, feePolicy] })
        : encodeFunctionData({ abi: factoryAbi, functionName: "launch", args: [terms] });
      const request = await prepareTransaction(client, deployment, wallet, {
        kind: "launch", to: deployment.factory, data, value: fields.nativeAmount, deadline, intentId,
      });
      if (!stillSelected(wallet)) throw new Error("Wallet selection changed. Review the launch again.");
      setReview({ request, symbol: fields.symbol, supply, depositedETH, depositedTokens, maxETH: fields.nativeAmount,
        openingPrice: priceInWei(sqrtPrice), sqrtPrice, liquidity, feePolicy, growthVault });
    } catch (cause) {
      setError(walletMessage(cause));
    } finally {
      setPreparing(false);
    }
  }

  async function confirm(current: Review) {
    if (!current.growthVault) return transaction.send(current.request);
    if (!deployment || !growthDeployer || !wallet || preparing) return;
    setPreparing(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/launchpad/config", { cache: "no-store", signal: controller.signal });
      const fresh = await response.json() as LaunchConfig;
      if (!response.ok || fresh.status !== "ready" || fresh.deployment.chainId !== deployment.chainId
        || fresh.deployment.factory !== deployment.factory || fresh.deployment.growthVaultDeployer !== growthDeployer) {
        setReview(undefined);
        setAccepted(false);
        refresh();
        throw new Error("The test vault can no longer be verified. Review the reserve choice again.");
      }
      if (!stillSelected(wallet)) throw new Error("Wallet selection changed. Review the launch again.");
      await transaction.send(current.request);
    } catch (cause) {
      setError(walletMessage(cause));
    } finally {
      window.clearTimeout(timeout);
      setPreparing(false);
    }
  }

  const wrongNetwork = Boolean(wallet && deployment && wallet.chainId !== deployment.chainId);
  const examples = review && openingExamples(review);

  return <>
    <header className="lpPageHeading"><div><h1>Create Token</h1><p>Review fixed supply, initial liquidity and position custody.</p></div></header>
    {config === null && <p className="lpNotice" role="status">Checking launch deployment…</p>}
    {config?.status === "disabled" && <p className="lpNotice">Preview only. You can fill in the form. Onchain review and signing are disabled.</p>}
    {config?.status === "unavailable" && <div className="lpNotice">{config.reason}<button type="button" className="lpButton lpSecondary" onClick={refresh}>Retry</button></div>}
    <TransactionFeedback transaction={transaction} />
    <div className="lpColumns">
      <form className="lpPanel lpForm" onSubmit={(event) => void prepare(event)}>
        <fieldset disabled={preparing || transaction.busy || Boolean(transaction.pending)}>
          <legend>Token details</legend>
          <div className="lpFormGrid">
            <label>Token name<input required value={draft.name} onChange={(event) => edit("name", event.target.value)} maxLength={64} placeholder="Token name" /></label>
            <label>Symbol<input required value={draft.symbol} onChange={(event) => edit("symbol", event.target.value.toUpperCase())} maxLength={12} placeholder="SYMBOL" /></label>
          </div>
          <label>Project link <small>Optional, public</small><input type="url" value={draft.projectURI} onChange={(event) => edit("projectURI", event.target.value)} maxLength={512} placeholder="https://" /></label>
        </fieldset>
        {deployment?.engineVersion === 2 && <fieldset disabled={preparing || transaction.busy || Boolean(transaction.pending)}>
          <legend>RMT Longevity V1 · Test only</legend>
          <label className="lpCheck">
            <input type="checkbox" checked={draft.longevity === "on"} onChange={(event) => edit("longevity", event.target.checked ? "on" : "off")} />
            <span>Split earned LP fees at launch</span>
          </label>
          {draft.longevity === "on" && <>
            <p>Choose recipients that can receive ETH and tokens. The split is permanent.</p>
            <div className="lpFormGrid">
              <label>Creator fee share (%)<input required value={draft.creatorFees} inputMode="decimal" maxLength={6} onChange={(event) => edit("creatorFees", event.target.value)} /></label>
              <label>Treasury fee share (%)<input required value={draft.treasuryFees} inputMode="decimal" maxLength={6} onChange={(event) => edit("treasuryFees", event.target.value)} /></label>
              <label>Liquidity reserve fee share (%)<input required value={draft.reserveFees} inputMode="decimal" maxLength={6} onChange={(event) => edit("reserveFees", event.target.value)} /></label>
            </div>
            {Number(draft.treasuryFees) > 0 && <label>Project treasury wallet<input required value={draft.treasury} maxLength={42} spellCheck={false} onChange={(event) => edit("treasury", event.target.value)} placeholder="0x…" /></label>}
            {Number(draft.reserveFees) > 0 && <>
              {growthDeployer && <label className="lpCheck">
                <input type="checkbox" checked={draft.growthVault === "on"} onChange={(event) => edit("growthVault", event.target.checked ? "on" : "off")} />
                <span>Commit the reserve to a test growth vault</span>
              </label>}
              {!growthDeployer && growthSelected && <div className="lpNotice">
                <p>The saved test vault is unavailable.</p>
                <button type="button" className="lpButton lpSecondary" onClick={() => edit("growthVault", "off")}>Use a reserve wallet</button>
              </div>}
              {growthDeployer && draft.growthVault === "on"
                ? <label>Prepared vault intent<input required value={draft.growthIntent} maxLength={66} spellCheck={false} onChange={(event) => edit("growthIntent", event.target.value)} placeholder="0x…" />
                  <small>Use the intent from a vault registered to the connected test wallet.</small></label>
                : <label>Liquidity reserve wallet<input required value={draft.reserve} maxLength={42} spellCheck={false} onChange={(event) => edit("reserve", event.target.value)} placeholder="0x…" /></label>}
            </>}
          </>}
        </fieldset>}
        <fieldset disabled={preparing || transaction.busy || Boolean(transaction.pending)}>
          <legend>Launch terms</legend>
          <label>Fixed token supply<select value={draft.supplyPreset} onChange={(event) => edit("supplyPreset", event.target.value)}>
            {supplies.map((supply, index) => <option key={supply} value={index}>{supply}</option>)}
          </select></label>
          <div className="lpFormGrid">
            <label>Supply for liquidity (%)<input required value={draft.allocation} onChange={(event) => edit("allocation", event.target.value)} inputMode="decimal" maxLength={6} />
              <small>10–100%, remainder to creator</small></label>
            <label>Initial ETH deposit<input required value={draft.seed} onChange={(event) => edit("seed", event.target.value)} inputMode="decimal" maxLength={22} />
              <small>0.001–100 test ETH</small></label>
          </div>
        </fieldset>
        {deployment && (!wallet || wrongNetwork) && <WalletConnection compact />}
        {error && <p className="lpNotice lpError" role="alert">{error}</p>}
        <button className="lpButton" disabled={!deployment || !wallet || wrongNetwork || preparing || transaction.busy || Boolean(transaction.pending)}>
          {preparing ? "Simulating launch…" : "Review launch"}
        </button>
      </form>
      <section ref={reviewRef} tabIndex={-1} className="lpPanel lpReview" aria-label="Launch review">
        <h2>{review ? "Review and confirm" : "Liquidity and fees"}</h2>
        <dl className="lpFacts">
          <dt>Quote asset</dt><dd>Native ETH</dd>
          <dt>Position range</dt><dd>Full range</dd>
          <dt>Principal custody</dt><dd>Permanent, factory held</dd>
          <dt>Pool swap fee</dt><dd>0.30%</dd>
          <dt>RMT creation and swap fee</dt><dd>0, draft terms</dd>
          <dt>Token transfers</dt><dd>Standard ERC-20, no transfer tax</dd>
          {deployment?.engineVersion === 2 && <><dt>Pool initialization</dt><dd>Factory-only guard. Standard v4 trading.</dd></>}
          <dt>Earned LP fees</dt><dd>{review?.feePolicy
            ? `${review.feePolicy.creatorBps / 100}% creator · ${review.feePolicy.treasuryBps / 100}% treasury · ${review.feePolicy.reserveBps / 100}% reserve`
            : "100% creator by default"}</dd>
          {review?.feePolicy && <>
            {review.feePolicy.treasuryBps > 0 && <><dt>Treasury recipient</dt><dd className="lpAddress">{review.feePolicy.treasury}</dd></>}
            {review.feePolicy.reserveBps > 0 && <><dt>Reserve recipient</dt><dd className="lpAddress">{review.feePolicy.reserve}</dd></>}
            {review.growthVault && <><dt>Reserve handling</dt><dd>Test vault · held for two-reviewer liquidity adds</dd></>}
          </>}
          {review && <>
            <dt>Fixed supply</dt><dd>{displayAmount(review.supply)} {review.symbol}</dd>
            <dt>Pool deposit</dt><dd>{displayAmount(review.depositedTokens)} {review.symbol} + {displayAmount(review.depositedETH)} ETH</dd>
            <dt>Creator allocation</dt><dd>{displayAmount(review.supply - review.depositedTokens)} {review.symbol}</dd>
            <dt>Maximum wallet value</dt><dd>{formatEther(review.maxETH)} ETH + gas</dd>
            <dt>ETH refunded</dt><dd>{formatEther(review.maxETH - review.depositedETH)} ETH</dd>
            <dt>Opening price</dt><dd>{displayAmount(review.openingPrice)} ETH per {review.symbol}</dd>
            <dt>Creator and refund address</dt><dd className="lpAddress">{review.request.from}</dd>
          </>}
        </dl>
        {review && examples && <details className="lpExamples">
          <summary>Example opening trades</summary>
          <p>Independent estimates using the starting full-range liquidity and 0.30% pool fee. Excludes gas and later price changes.</p>
          <p>Buy with {displayAmount(examples.grossBuy)} ETH → about {displayAmount(examples.tokensOut)} {review.symbol}.</p>
          <p>Sell {displayAmount(examples.grossSell)} {review.symbol} → about {displayAmount(examples.nativeOut)} ETH.</p>
        </details>}
        {review && <>
          {review.growthVault && <p>Reserve fees can stay held indefinitely. The vault has no withdrawal path.</p>}
          <label className="lpCheck"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span>I reviewed the allocations, fee terms, test ETH deposit, and permanent position lock. <Link href="/risks" target="_blank">Read risks</Link>.</span></label>
          <button className="lpButton" type="button" disabled={!accepted || preparing || transaction.busy || Boolean(transaction.pending) || Boolean(transaction.result?.launch)}
            onClick={() => void confirm(review)}>Confirm in wallet</button>
        </>}
      </section>
    </div>
  </>;
}
