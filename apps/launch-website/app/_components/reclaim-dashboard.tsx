"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { keccak256, parseUnits, type Address } from "viem";
import { claimDelegatePin } from "../../lib/claim-profiles";
import { readActiveTestCreation } from "../../lib/test-creation-history";
import { isLocalTestWallet, isTransactionHash } from "../../lib/test-creation";
import { assertTestWalletBinding, connectTestWallet, subscribeTestWallet, testWalletErrorCode, type TestWallet } from "../../lib/test-wallet";
import { assertNoUnresolvedFinancialRequests } from "./treasury-wallet-controls";
import { isReclaimReview, isReclaimSnapshot, reclaimAddress, reclaimHash, reclaimReadPath, reclaimTestPath, reclaimVerificationMatches,
  reclaimFieldsDigest, sameReclaimHex, type ReclaimFields, type ReclaimOperation, type ReclaimReview, type ReclaimSnapshot, type ReclaimVerification } from "../../lib/reclaim";
import { assertNoPendingLifecycleForReclaim, canStartAnotherReclaimCampaign, listReclaimJournals, reclaimCampaignIntentKey, reclaimJournalTerminal,
  startAnotherReclaimCampaign, storeReclaimJournal, reconcileReclaimRecovery, type ReclaimJournal } from "../../lib/reclaim-recovery";
import { canonicalSafeApprovals, canonicalSafeTypedData, isReclaimSafeOuterReview, isReclaimSafeProposal,
  reclaimSafeVerificationMatches, verifyReclaimSafeApproval, verifyReclaimSafeApprovals,
  type ReclaimSafeApproval, type ReclaimSafeOuterReview, type ReclaimSafeProposal } from "../../lib/reclaim-safe";
import { listReclaimSafeJournals, storeReclaimSafeJournal, reconcileReclaimSafeRecovery, type ReclaimSafeJournal } from "../../lib/reclaim-safe-recovery";
import { MyLaunchesNav } from "./my-launches-nav";
import {reclaimAdministrationWallet} from "../../lib/reclaim-administration";

const amount = (value: string) => {
  try { const n = BigInt(value), whole = n / 10n ** 18n, fraction = (n % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, ""); return whole + (fraction ? "." + fraction : ""); }
  catch { return "Unavailable"; }
};
const when = (value: string) => { const millis = /^[0-9]+$/.test(value) ? Number(value) * 1000 : Date.parse(value); return Number.isFinite(millis) ? new Date(millis).toLocaleString() : "Time unavailable"; };
const label = (operation: string) => operation.replaceAll("-", " ");
const retirement = (mode: 1 | 2) => mode === 1 ? "Verified native burn" : "Permanent immutable-contract sink";
const tokens = (value: string) => { if (!/^(0|[1-9][0-9]{0,30})(\.[0-9]{1,18})?$/.test(value)) throw Error("Enter a positive token amount with at most 18 decimals."); return parseUnits(value, 18).toString(); };
const entries = (value: string) => value.split(",").map(item => item.trim());
const bounded = async (response: Response) => {
  const text = await response.text(); if (new TextEncoder().encode(text).byteLength > 262144) throw Error("Reclaim evidence exceeds its response bound."); return JSON.parse(text) as unknown;
};
async function post(body: object) {
  if (!isLocalTestWallet(window.location)) throw Error("Reclaim transactions are limited to the isolated local test build.");
  const response = await fetch(reclaimTestPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000) });
  const payload = await bounded(response);
  if (!response.ok) throw Error(response.status === 429 ? "Evidence reads are limited. Preserve the original request." : "Reclaim request could not be verified. No wallet submission was requested.");
  return payload;
}
function intentFor(account: string) {
  const key = reclaimCampaignIntentKey(account), saved = localStorage.getItem(key);
  if (saved !== null) { if (!reclaimHash(saved)) throw Error("The campaign intent is invalid. Preserve its original recovery records."); return saved; }
  const bytes = crypto.getRandomValues(new Uint8Array(32)); const next = "0x" + [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  if (!reclaimHash(next)) throw Error("Campaign intent unavailable."); localStorage.setItem(key, next);
  if (localStorage.getItem(key) !== next) throw Error("Campaign intent could not be preserved."); return next;
}

export function ReclaimDashboard({ fixture = false, initialCampaign = "", adminCreators=[] }: { fixture?: boolean; initialCampaign?: string; adminCreators?:readonly Address[] }) {
  const [campaignInput, setCampaignInput] = useState(initialCampaign), [snapshot, setSnapshot] = useState<ReclaimSnapshot | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState(""), [stale, setStale] = useState(false), [message, setMessage] = useState("");
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [wallet, setWallet] = useState<TestWallet | null>(null);
  const [review, setReview] = useState<ReclaimReview | null>(null), [journals, setJournals] = useState<ReclaimJournal[]>([]), [journalKey, setJournalKey] = useState("");
  const [manualHashInput, setManualHashInput] = useState({ identity: "", value: "" });
  const [safeActor, setSafeActor] = useState(""), [collection, setCollection] = useState(""), [tokenIds, setTokenIds] = useState(""), [quantities, setQuantities] = useState("1");
  const [controller, setController] = useState(""), [rewardUnits, setRewardUnits] = useState("5"), [walletCap, setWalletCap] = useState("4"), [fundUnits, setFundUnits] = useState("2000");
  const [collectionCap, setCollectionCap] = useState("32"), [collectionWalletCap, setCollectionWalletCap] = useState("4"), [nextController, setNextController] = useState("");
  const [creationIntent, setCreationIntent] = useState<string | null>(null);
  const [permanentConsent, setPermanentConsent] = useState(false), [safeConsentHash, setSafeConsentHash] = useState<string | null>(null), [gasPayer, setGasPayer] = useState("");
  const [safeJournals, setSafeJournals] = useState<ReclaimSafeJournal[]>([]), [safeKey, setSafeKey] = useState("");
  const [safeManualHashInput, setSafeManualHashInput] = useState({ identity: "", value: "" });
  const manualHash = manualHashInput.identity === journalKey ? manualHashInput.value : "";
  const safeManualHash = safeManualHashInput.identity === safeKey ? safeManualHashInput.value : "";
  const generation = useRef(0), revision = useRef(0), lock = useRef(false), active = useRef<AbortController | null>(null);
  const selected = useRef("");
  const actor = safeActor || wallet?.account || "";
  const invalidate = () => { revision.current++; setReview(null); setPermanentConsent(false); setSafeConsentHash(null); setMessage(""); };
  const refreshJournals = () => { if (fixture) { setJournals(listReclaimJournals(localStorage)); const saved = listReclaimSafeJournals(localStorage); setSafeJournals(saved); setSafeKey(current => current || saved[0]?.proposal.proposalHash || ""); setCreationIntent(reclaimAddress(actor) ? localStorage.getItem(reclaimCampaignIntentKey(actor)) : null); } };
  useEffect(() => { setReady(true); if (fixture) { try { refreshJournals(); } catch (error) { setMessage(error instanceof Error ? error.message : "Recovery unavailable."); } } }, []);
  useEffect(() => () => { generation.current++; revision.current++; active.current?.abort(); }, []);
  useEffect(() => { setManualHashInput({ identity: journalKey, value: "" }); }, [journalKey]);
  useEffect(() => { setSafeManualHashInput({ identity: safeKey, value: "" }); setSafeConsentHash(null); }, [safeKey]);
  useEffect(() => { if (reclaimAddress(initialCampaign)) void load(initialCampaign); }, []);
  useEffect(() => { if (fixture) { try { refreshJournals(); } catch (error) { setMessage(error instanceof Error ? error.message : "Recovery unavailable."); } } }, [actor]);
  useEffect(() => {
    if (!wallet) return;
    return subscribeTestWallet(wallet, () => { revision.current++; setWallet(null); setReview(null); setPermanentConsent(false); setSafeConsentHash(null); setMessage("Wallet account or network changed. Original requests, Safe proposals and approvals remain recoverable."); });
  }, [wallet]);
  async function run(task: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage("");
    try { if (!fixture || !isLocalTestWallet(window.location)) throw Error("Public Reclaim financial execution is disabled."); await task(); }
    catch (error) { if (testWalletErrorCode(error) !== 4001) setReview(null); setMessage(testWalletErrorCode(error) === 4001 ? "Wallet request rejected. No transaction was submitted by this page." : error instanceof Error ? error.message : "Verified Reclaim evidence is unavailable."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function load(address: string) {
    if (!reclaimAddress(address)) { setMessage("Enter the complete campaign address."); return; }
    active.current?.abort(); const abort = new AbortController(); active.current = abort;
    const version = ++generation.current; setBusy(true); setMessage("");
    if (!sameReclaimHex(selectedCampaign, address)) { setSnapshot(null); setStale(false); }
    setSelectedCampaign(address); selected.current = address; invalidate();
    try {
      const url = new URL(reclaimReadPath, window.location.origin); url.searchParams.set("campaign", address);
      const response = await fetch(url.pathname + url.search, { cache: "no-store", redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) });
      const payload = await bounded(response);
      if (!response.ok || !fixture || !isReclaimSnapshot(payload) || !sameReclaimHex(payload.campaign, address)) throw Error("Reclaim evidence unavailable.");
      if (generation.current !== version) return;
      setSnapshot(payload); setStale(false); setCollection(current => payload.collections.some(item => sameReclaimHex(item.address, current)) ? current : payload.collections[0]?.address || "");
    } catch { if (generation.current === version) { setStale(true); setMessage("Verified campaign evidence is unavailable. A failed read does not prove a zero reserve, missing campaign or eligible NFT."); } }
    finally { if (generation.current === version) setBusy(false); }
  }
  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready) return;
    const value = new FormData(event.currentTarget).get("campaignAddress");
    if (typeof value !== "string" || !reclaimAddress(value.trim())) { setMessage("Enter the complete campaign address."); return; }
    setCampaignInput(value.trim()); void load(value.trim());
  }
  async function connect() {
    await run(async () => { const current = await connectTestWallet(); revision.current++; setWallet(current); setReview(null); setPermanentConsent(false); setSafeConsentHash(null); setMessage("Test wallet connected on isolated chain 31337. Connection grants no campaign authority."); });
  }
  function expiry() {
    if (!snapshot) throw Error("Load verified campaign evidence first.");
    return Math.floor(Date.parse(snapshot.observed.timestamp) / 1000 + 3 * 86400).toString();
  }
  async function prepare(operation: ReclaimOperation, fields: ReclaimFields) {
    await run(async () => {
      if (!wallet) throw Error("Connect the fresh test wallet first.");
      if (operation === "redeem" && (!permanentConsent || fields.permanentConsent !== true)) throw Error("Explicitly acknowledge permanent NFT loss before reviewing surrender.");
      await assertTestWalletBinding(wallet);
      if (!reclaimAddress(actor)) throw Error("Choose a valid acting wallet or Safe address.");
      const fieldDigest = reclaimFieldsDigest(operation, fields);
      if (operation === "create-campaign") setCreationIntent(fields.intentId!);
      const version = ++revision.current; setReview(null);
      const payload = await post({ action: "prepare", operation, account: actor, ...(operation !== "create-campaign" && { campaign: selectedCampaign }), fields });
      if (!isReclaimReview(payload) || payload.operation !== operation || !sameReclaimHex(payload.actor, actor)
        || operation !== "create-campaign" && !sameReclaimHex(payload.campaign, selectedCampaign) || reclaimFieldsDigest(operation, payload.fields) !== fieldDigest) throw Error("Unsigned Reclaim terms could not be bound to this form.");
      if (operation === "redeem") {
        const admitted = snapshot?.collections.find(item => sameReclaimHex(item.address, fields.collection!)), nft = payload.nft;
        if (!admitted || admitted.admission !== "admitted" || !admitted.enabled || !nft || !snapshot || payload.policyEpoch !== snapshot.policyEpoch
          || nft.retirementMode !== admitted.retirementMode || !sameReclaimHex(nft.destination, admitted.destination) || !sameReclaimHex(nft.policyHash, admitted.policyHash)) throw Error("The displayed retirement policy changed. Refresh canonical evidence before acknowledging permanent loss again.");
      }
      if (revision.current !== version) throw Error("The form or wallet changed. Review current terms again.");
      setReview(payload);
    });
  }
  async function confirm() {
    const original = review, bound = wallet, form = revision.current;
    if (!original || original.status !== "prepared" || !original.request || !bound) return;
    await run(async () => {
      if (!navigator.locks?.request) throw Error("This browser cannot coordinate wallet submissions safely.");
      await navigator.locks.request(`rmt.claim.execution.v1:31337:${original.actor.toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async acquired => {
        if (!acquired) throw Error("Another transaction is using this wallet. Preserve its recovery record.");
        if (!sameReclaimHex(bound.account, original.actor) || Date.now() / 1000 >= original.expiresAt || revision.current !== form) throw Error("The account, review or deadline changed. Review current terms.");
        if (original.operation === "redeem" && (!permanentConsent || original.fields.permanentConsent !== true)) throw Error("Permanent NFT surrender requires your explicit acknowledgement.");
        assertNoUnresolvedFinancialRequests(original.actor);
        assertNoPendingLifecycleForReclaim(localStorage, original.actor);
        const creation = readActiveTestCreation(localStorage);
        if (creation && sameReclaimHex(creation.request.from, original.actor)) throw Error("Recover or explicitly archive the earlier token creation before submitting Reclaim.");
        await assertTestWalletBinding(bound, { blockNumber: "0x" + BigInt(original.observed.blockNumber).toString(16), blockHash: original.observed.blockHash });
        const [code, delegate, nonce, targetCode] = await Promise.all([
          bound.request.call(bound.provider, { method: "eth_getCode", params: [original.actor, "latest"] }),
          original.kind === "metamask-7702" ? bound.request.call(bound.provider, { method: "eth_getCode", params: [claimDelegatePin.address, "latest"] }) : undefined,
          bound.request.call(bound.provider, { method: "eth_getTransactionCount", params: [original.actor, "pending"] }),
          bound.request.call(bound.provider, { method: "eth_getCode", params: [original.innerCall.to, "latest"] }),
        ]);
        if (typeof code !== "string" || keccak256(code as `0x${string}`) !== original.actorCodeHash
          || original.kind === "eoa" && code !== "0x" || original.kind === "metamask-7702" && !sameReclaimHex(code, claimDelegatePin.designator)
          || original.kind === "metamask-7702" && (typeof delegate !== "string" || keccak256(delegate as `0x${string}`) !== claimDelegatePin.runtimeHash)
          || typeof targetCode !== "string" || keccak256(targetCode as `0x${string}`) !== original.targetRuntimeHash
          || typeof nonce !== "string" || !/^0x[0-9a-f]+$/i.test(nonce) || BigInt(nonce) !== BigInt(original.request!.nonce)) throw Error("The actor runtime or pending nonce no longer matches the review.");
        const fresh = await post({ action: "revalidate", review: original }) as Record<string, unknown>;
        if (fresh.status !== "unchanged" || fresh.reviewHash !== original.reviewHash || fresh.executionEnabled !== false || revision.current !== form) throw Error("The reviewed nonce, policy, eligibility or transaction changed. Review again.");
        await assertTestWalletBinding(bound, { blockNumber: "0x" + BigInt(original.observed.blockNumber).toString(16), blockHash: original.observed.blockHash });
        assertNoUnresolvedFinancialRequests(original.actor);
        assertNoPendingLifecycleForReclaim(localStorage, original.actor);
        const now = Date.now(); const old = listReclaimJournals(localStorage).find(item => item.review.reviewHash === original.reviewHash);
        let entry: ReclaimJournal = { schemaVersion: 2, review: original, stage: "awaiting-wallet", transactionHash: null, result: null, createdAt: old?.createdAt ?? now, updatedAt: now };
        storeReclaimJournal(localStorage, entry); refreshJournals();
        try {
          const hash = await bound.request.call(bound.provider, { method: "eth_sendTransaction", params: [original.request] });
          entry = { ...entry, stage: isTransactionHash(hash) ? "pending" : "hash-missing", transactionHash: isTransactionHash(hash) ? hash : null, updatedAt: Date.now() };
          storeReclaimJournal(localStorage, entry); refreshJournals(); setReview(null);
          setMessage(entry.transactionHash ? "Transaction submitted. Verify its canonical receipt and indexed settlement." : "The wallet returned no transaction hash. Recover the original request; do not submit it again.");
        } catch (error) {
          entry = { ...entry, stage: testWalletErrorCode(error) === 4001 ? "wallet-rejected" : "hash-missing", updatedAt: Date.now() };
          storeReclaimJournal(localStorage, entry); refreshJournals(); if (entry.stage !== "wallet-rejected") setReview(null); throw error;
        }
      });
    });
  }
  async function recover() {
    const original = journals.find(item => item.review.reviewHash === journalKey);
    if (!original) return;
    await run(async () => {
      const hash = manualHash.trim() || original.transactionHash;
      if (hash && !reclaimHash(hash)) throw Error("Enter the complete original transaction hash.");
      if (original.transactionHash && hash && !sameReclaimHex(original.transactionHash, hash)) throw Error("The original transaction hash cannot be replaced.");
      const payload = await post({ action: "verify", review: original.review, ...(hash && { transactionHash: hash }) });
      if (!reclaimVerificationMatches(original.review, payload, hash ?? undefined)) throw Error("Recovery evidence does not match the original reviewed transaction.");
      const entry = reconcileReclaimRecovery(original, payload, Date.now(), hash ?? undefined);
      storeReclaimJournal(localStorage, entry); refreshJournals();
      if (payload.snapshot && selected.current && sameReclaimHex(selected.current, payload.snapshot.campaign)) { setSnapshot(payload.snapshot); setStale(false); }
      if (original.review.operation === "create-campaign" && payload.status === "confirmed") {
        setCampaignInput(original.review.campaign); setSelectedCampaign(original.review.campaign); selected.current = original.review.campaign;
        if (payload.snapshot) setSnapshot(payload.snapshot);
      }
      setMessage(verificationLabel(payload));
    });
  }
  function saveSafe(entry: ReclaimSafeJournal) { storeReclaimSafeJournal(localStorage, entry); setSafeKey(entry.proposal.proposalHash); refreshJournals(); }
  const safeEntry = safeJournals.find(entry => entry.proposal.proposalHash === safeKey);
  const requirePermanentConsent = (inner: ReclaimReview) => {
    if (inner.operation === "redeem" && (!permanentConsent || inner.fields.permanentConsent !== true)) throw Error("Acknowledge permanent NFT loss for this exact Safe proposal before approving or submitting it.");
  };
  const requireSafePermanentConsent = (entry: ReclaimSafeJournal) => {
    if (entry.proposal.innerReview.operation === "redeem" && (safeConsentHash !== entry.proposal.proposalHash || entry.proposal.innerReview.fields.permanentConsent !== true)) throw Error("Acknowledge permanent loss for this exact Safe proposal before its approval or execution.");
  };
  async function proposeSafe() {
    const inner = review;
    await run(async () => {
      if (!inner || inner.kind !== "safe-inner" || !wallet || !reclaimAddress(gasPayer)) throw Error("Review an exact Safe action and choose its synthetic gas payer first.");
      requirePermanentConsent(inner); await assertTestWalletBinding(wallet);
      const payload = await post({ action: "safe-propose", review: inner, gasPayer });
      if (!isReclaimSafeProposal(payload) || payload.innerReview.reviewHash !== inner.reviewHash || !sameReclaimHex(payload.gasPayer, gasPayer)) throw Error("The Safe proposal does not match the reviewed action.");
      const existing = listReclaimSafeJournals(localStorage).find(e => sameReclaimHex(e.proposal.safe, payload.safe) && e.proposal.safeNonce === payload.safeNonce);
      if (existing) {
        if (existing.proposal.proposalHash !== payload.proposalHash) throw Error("A proposal for this Safe nonce is already preserved. Continue the original approval or reconcile its nonce; do not sign a conflicting plan.");
        setSafeKey(existing.proposal.proposalHash); return;
      }
      const now = Date.now(); saveSafe({ schemaVersion: 1, proposal: payload, approvals: [], outerReview: null, stage: "proposal", transactionHash: null, result: null, createdAt: now, updatedAt: now });
      setMessage("Exact Safe proposal saved. Two different current owners must each explicitly approve the typed action; no transaction has been submitted.");
    });
  }
  async function approveSafe(owner: Address) {
    const entry = safeEntry;
    await run(async () => {
      if (!entry || !wallet || !sameReclaimHex(wallet.account, owner)) throw Error("Connect the selected current Safe owner before requesting its approval.");
      if (entry.approvals.some(a => sameReclaimHex(a.signer, owner)) || entry.approvals.length >= 2) throw Error("This owner approval is already collected; no duplicate signature is requested.");
      requireSafePermanentConsent(entry);
      if (Date.now() / 1000 >= entry.proposal.expiresAt) throw Error("The application review expired. Preserve the original Safe nonce and approvals; this does not revoke an on-chain nonce-only authorization.");
      await assertTestWalletBinding(wallet, { blockNumber: "0x" + BigInt(entry.proposal.observed.blockNumber).toString(16), blockHash: entry.proposal.observed.blockHash });
      saveSafe({ ...entry, stage: "awaiting-owner", updatedAt: Date.now() });
      const signature = await wallet.request.call(wallet.provider, { method: "eth_signTypedData_v4", params: [wallet.account, JSON.stringify(canonicalSafeTypedData(entry.proposal))] });
      const approval = { signer: owner, signature } as ReclaimSafeApproval;
      if (!await verifyReclaimSafeApproval(entry.proposal, approval)) throw Error("The returned approval does not recover the selected current Safe owner.");
      const validated = await post({ action: "safe-approve", proposal: entry.proposal, approval }) as Record<string, unknown>;
      if (validated.status !== "approved" || validated.proposalHash !== entry.proposal.proposalHash || typeof validated.signer !== "string" || !sameReclaimHex(validated.signer, owner) || validated.executionEnabled !== false) throw Error("Current on-chain Safe authority could not validate that approval.");
      const approvals = canonicalSafeApprovals([...entry.approvals, approval]);
      saveSafe({ ...entry, approvals, stage: approvals.length === 2 ? "approvals-ready" : "proposal", updatedAt: Date.now() });
      setMessage(`${approvals.length} of 2 verified owner approvals saved. No transaction has been submitted.`);
    });
  }
  async function prepareSafeOuter() {
    const entry = safeEntry;
    await run(async () => {
      if (!entry || !wallet || !sameReclaimHex(wallet.account, entry.proposal.gasPayer)) throw Error("Connect this proposal's original gas payer to review the outer transaction.");
      if (!await verifyReclaimSafeApprovals(entry.proposal, entry.approvals)) throw Error("Two distinct current-owner approvals are required.");
      requireSafePermanentConsent(entry); await assertTestWalletBinding(wallet);
      const payload = await post({ action: "safe-prepare", proposal: entry.proposal, approvals: entry.approvals });
      if (!isReclaimSafeOuterReview(payload) || payload.proposal.proposalHash !== entry.proposal.proposalHash || !await verifyReclaimSafeApprovals(payload.proposal, payload.approvals)) throw Error("Safe execution review does not match the original proposal and approvals.");
      saveSafe({ ...entry, outerReview: payload, stage: "approvals-ready", updatedAt: Date.now() });
      setMessage("Outer Safe transaction simulated. Review its Safe nonce, gas-payer nonce, exact recipient and maximum synthetic network fee before confirming.");
    });
  }
  async function confirmSafeOuter() {
    const entry = safeEntry, bound = wallet, outer = entry?.outerReview;
    await run(async () => {
      if (!entry || !outer || !bound || !sameReclaimHex(bound.account, entry.proposal.gasPayer) || !navigator.locks?.request) throw Error("Connect the reviewed gas payer in a browser that coordinates wallet submissions.");
      requireSafePermanentConsent(entry);
      await navigator.locks.request(`rmt.claim.execution.v1:31337:${entry.proposal.gasPayer.toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async acquired => {
        if (!acquired) throw Error("Another transaction is using this gas payer. Preserve the original Safe request.");
        assertNoUnresolvedFinancialRequests(entry.proposal.gasPayer); assertNoUnresolvedFinancialRequests(entry.proposal.safe);
        assertNoPendingLifecycleForReclaim(localStorage, entry.proposal.gasPayer);
        const creation = readActiveTestCreation(localStorage); if (creation && sameReclaimHex(creation.request.from, entry.proposal.gasPayer)) throw Error("Recover the earlier creation before using this gas payer.");
        await assertTestWalletBinding(bound, { blockNumber: "0x" + BigInt(outer.observed.blockNumber).toString(16), blockHash: outer.observed.blockHash });
        const [nonce, code] = await Promise.all([
          bound.request.call(bound.provider, { method: "eth_getTransactionCount", params: [entry.proposal.gasPayer, "pending"] }),
          bound.request.call(bound.provider, { method: "eth_getCode", params: [entry.proposal.gasPayer, "latest"] }),
        ]);
        if (typeof nonce !== "string" || BigInt(nonce) !== BigInt(entry.proposal.gasPayerNonce) || typeof code !== "string" || keccak256(code as `0x${string}`) !== outer.gasPayerCodeHash
          || !await verifyReclaimSafeApprovals(entry.proposal, entry.approvals) || !await verifyReclaimSafeApprovals(outer.proposal, outer.approvals)) throw Error("The gas payer, nonce or Safe approvals changed.");
        const fresh = await post({ action: "safe-revalidate", review: outer }) as Record<string, unknown>;
        if (fresh.status !== "unchanged" || fresh.reviewHash !== outer.reviewHash || fresh.executionEnabled !== false) throw Error("The Safe nonce, authority, gas or retirement proof changed. Preserve the original review.");
        await assertTestWalletBinding(bound); requireSafePermanentConsent(entry);
        let pending: ReclaimSafeJournal = { ...entry, stage: "awaiting-wallet", updatedAt: Date.now() }; saveSafe(pending);
        try {
          const hash = await bound.request.call(bound.provider, { method: "eth_sendTransaction", params: [outer.request] });
          pending = { ...pending, transactionHash: isTransactionHash(hash) ? hash : null, stage: isTransactionHash(hash) ? "pending" : "hash-missing", updatedAt: Date.now() }; saveSafe(pending);
          setMessage(isTransactionHash(hash) ? "Safe execution submitted. Reconcile its exact outer receipt and inner settlement." : "Wallet returned no hash. Recover the original gas-payer nonce and Safe action; never resubmit automatically.");
        } catch (error) {
          saveSafe({ ...pending, stage: testWalletErrorCode(error) === 4001 ? "wallet-rejected" : "hash-missing", updatedAt: Date.now() }); throw error;
        }
      });
    });
  }
  async function recoverSafe() {
    const entry = safeEntry;
    await run(async () => {
      if (!entry?.outerReview) throw Error("Select an original Safe execution review.");
      const hash = safeManualHash.trim() || entry.transactionHash;
      if (hash && !reclaimHash(hash) || hash && entry.transactionHash && !sameReclaimHex(hash, entry.transactionHash)) throw Error("Preserve the exact original Safe transaction hash.");
      const payload = await post({ action: "safe-verify", review: entry.outerReview, ...(hash && { transactionHash: hash }) });
      if (!reclaimSafeVerificationMatches(entry.outerReview, payload, hash ?? undefined)) throw Error("Safe receipt or permanent surrender evidence does not match the original proposal.");
      saveSafe(reconcileReclaimSafeRecovery(entry, payload, Date.now(), hash ?? undefined));
      if (payload.snapshot && selected.current && sameReclaimHex(payload.snapshot.campaign, selected.current)) { setSnapshot(payload.snapshot); setStale(false); }
      setMessage(verificationLabel(payload));
    });
  }
  function change(setter: (value: string) => void) { return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setter(event.target.value); invalidate(); }; }
  async function startAnother(entry: ReclaimJournal) {
    await run(async () => {
      if (!wallet || !sameReclaimHex(wallet.account, actor) || !navigator.locks?.request) throw Error("Connect the original test creator in a browser that coordinates wallet requests.");
      await navigator.locks.request(`rmt.claim.execution.v1:31337:${actor.toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async acquired => {
        if (!acquired) throw Error("Another transaction is using this wallet. Preserve its recovery record.");
        assertNoUnresolvedFinancialRequests(actor); assertNoPendingLifecycleForReclaim(localStorage, actor);
        const creation = readActiveTestCreation(localStorage);
        if (creation && sameReclaimHex(creation.request.from, actor)) throw Error("Recover and archive the earlier token creation first.");
        startAnotherReclaimCampaign(localStorage, entry, actor);
        active.current?.abort(); generation.current++; selected.current = "";
        setCreationIntent(null); setCampaignInput(""); setSelectedCampaign(""); setSnapshot(null); setStale(false); setCollection(""); invalidate(); refreshJournals();
        setMessage("Ready for a separate campaign review. Every prior request and transaction hash remains in recovery history.");
      });
    });
  }
  const collectionData = snapshot?.collections.find(item => sameReclaimHex(item.address, collection));
  const localDisabled = !fixture || !ready || busy;
  const selectedJournal = journals.find(entry => entry.review.reviewHash === journalKey);
  const completedCreation = journals.find(entry => entry.review.fields.intentId === creationIntent && sameReclaimHex(entry.review.actor, actor) && canStartAnotherReclaimCampaign(entry));
  const mayCreate=!!wallet&&sameReclaimHex(actor,wallet.account)&&adminCreators.some(address=>sameReclaimHex(address,wallet.account));
  const mayAdminister=!!wallet&&!stale&&snapshot?.administration?.status==="verified"&&reclaimAdministrationWallet(snapshot.administration.controller,actor,wallet.account);
  const mayAcceptController=!!wallet&&!stale&&snapshot?.administration?.status==="verified"&&snapshot.administration.incoming?.ready===true&&reclaimAdministrationWallet(snapshot.administration.incoming,actor,wallet.account);
  return <>
    <header className="lpPageHeading"><div><h1>RMT Reclaim</h1><p>Permanent NFT surrender. Separate funding, verified retirement and exact rewards.</p></div></header>
    <MyLaunchesNav active="reclaim" />
    <p className="lpInlineNotice">{fixture ? "Isolated chain 31337 · synthetic NFTs and tokens only. No production financial execution." : "Read-only · No verified live campaign, new RMT token, price reference or funded reward reserve. Claims are disabled."}</p>
    <section className="lpPanel lpForm lpReclaimIntro" aria-label="Reclaim custody and funding">
      <h2>Permanent means permanent</h2><p>Accepted ERC-721 and ERC-1155 NFTs are retired by a verified native burn or transfer to a validated, immutable contract sink. A sink transfer is not a burn. There is no NFT withdrawal, repayment, buyback or return path. Used eligibility and lifetime caps never reset.</p>
      <p>Rewards require manually deposited tokens. No project fees, treasury funds, Operations, Reserve or royalties are drawn automatically.</p>
      <details><summary>Proposed reward budget</summary><p>The $20 budget and $0.05 per eligible NFT are nominal goals, not a live price or promise. The local model assumes 1 synthetic RMT = $0.01 and uses fixed 5-token rewards from 2,000 synthetic tokens. Production requires its own approved token-unit schedule or a defensible price reference and funded reserve.</p></details>
    </section>
    <form className="lpPanel lpForm lpEarningsLookup" aria-label="Find Reclaim campaign" data-reclaim-ready={ready ? "true" : "false"} onSubmit={lookup}>
      <label htmlFor="reclaim-campaign">Campaign address<input id="reclaim-campaign" name="campaignAddress" value={campaignInput} disabled={!ready || busy} maxLength={42} onChange={change(setCampaignInput)} placeholder="0x…" spellCheck={false} autoComplete="off" /></label>
      <button className="lpButton" disabled={!ready || busy} type="submit">{busy ? "Checking evidence…" : "View campaign"}</button>
      <small>A lookup is not proof of eligibility, ownership, funding or wallet authority.</small>
    </form>
    {message && <p className="lpInlineNotice" role="status">{message}</p>}
    {stale && <p className="lpInlineNotice" role="alert">Evidence unavailable or stale. Previous observations cannot authorize a new trade-in.</p>}
    {snapshot ? <section className="lpPanel lpForm lpReclaimCampaign" aria-label="Verified Reclaim campaign">
      <div className="lpTreasuryHeading"><h2>Verified campaign</h2><strong>{snapshot.closed ? "Closed" : snapshot.paused ? "Paused"
        : BigInt(snapshot.reserve.availableWei) < BigInt(snapshot.rewardPerUnit) ? "Awaiting funded reserve"
          : !snapshot.collections.some(item => item.admission === "admitted" && item.enabled) ? "Awaiting collection admission" : "Accepting eligible trade-ins"}</strong></div>
      <dl className="lpFacts"><dt>Campaign</dt><dd>{snapshot.campaign}</dd><dt>Controller</dt><dd>{snapshot.controller} · epoch {snapshot.controllerEpoch}</dd>
        <dt>Fixed reward</dt><dd>{amount(snapshot.rewardPerUnit)} {snapshot.rewardSymbol} per eligible unit · no live USD valuation</dd><dt>Policy epoch</dt><dd>{snapshot.policyEpoch}</dd>
        <dt>Held reserve</dt><dd>{amount(snapshot.reserve.heldWei)} {snapshot.rewardSymbol}</dd><dt>Available reserve</dt><dd>{amount(snapshot.reserve.availableWei)} {snapshot.rewardSymbol}</dd>
        <dt>Rewards paid</dt><dd>{amount(snapshot.reserve.paidWei)} {snapshot.rewardSymbol}</dd><dt>Unpaid liability</dt><dd>{amount(snapshot.reserve.liabilityWei)} · atomic funded rewards only</dd>
        <dt>Indexed evidence</dt><dd>{snapshot.history.indexed ? "Indexed and verified" : "On-chain evidence observed; indexing pending"}</dd></dl>
      <p className="lpEarningsCheckpoint">Observed synthetic block {snapshot.observed.blockNumber} · {when(snapshot.observed.timestamp)}. This is not production L1 finality.</p>
      <button className="lpButton lpButtonSecondary" type="button" disabled={busy} onClick={() => void load(snapshot.campaign)}>Refresh campaign evidence</button>
      <h3>Accepted collections</h3><ul className="lpTreasuryHistory">{snapshot.collections.length ? snapshot.collections.map(item => <li key={item.address}>
        <strong>ERC-{item.standard === 1 ? "721" : "1155"} · {item.admission === "unsupported" ? "Unsupported" : item.admission === "candidate" ? "Not admitted" : item.enabled ? "Admitted" : "Disabled"}</strong><span>{item.address}</span>
        <span>{retirement(item.retirementMode)} · {item.retirementMode === 1 ? "NFT supply decreases; no sink transfer" : `Irrecoverable destination ${item.destination}`}</span>
        <span>Reviewed policy {item.policyHash}. Unsupported issuer, upgrade or recovery powers are not accepted.</span>
        <span>Collection cap {item.collectionCap}; wallet cap {item.walletCap}; accepted units {item.acceptedUnits}.</span>
        {item.admission === "admitted" && item.enabled && <span>Eligible IDs: {item.eligibleItems.length ? item.eligibleItems.map(nft => `${nft.tokenId} (up to ${nft.remainingQuantity} remaining)`).join(" · ") : "No verified eligible inventory."}</span>}
      </li>) : <li>No collection has been admitted. Metadata or ownership alone does not establish eligibility.</li>}</ul>
      {snapshot.pending.length > 0 && <details><summary>Pending owner notices</summary><ul className="lpTreasuryHistory">{snapshot.pending.map(item => <li key={item.kind}><strong>{label(item.kind)}</strong><span>{item.detail}</span><span>Ready {when(item.readyAt)} · expires {when(item.expiresAt)} · epoch {item.epoch}</span></li>)}</ul></details>}
    </section> : <section className="lpPanel lpForm" aria-label="Reclaim availability"><h2>No verified campaign selected</h2><p>Rewards and NFT eligibility are unavailable until a real campaign, token, deposited reserve and admission policy are verified. No balances or accepted NFTs are assumed.</p></section>}
    {fixture && <section className="lpPanel lpForm lpReclaimWallet" aria-label="Local Reclaim wallet controls">
      <h2>Test wallet</h2><button className="lpButton lpButtonSecondary" type="button" disabled={localDisabled} onClick={() => void connect()}>{wallet ? "Reconnect test wallet" : "Connect test wallet"}</button>
      {wallet && <p>Selected wallet: <span className="lpReclaimAddress">{wallet.account}</span> · chain 31337</p>}
      <details><summary>Act through an existing Safe</summary><label htmlFor="reclaim-safe">Safe acting address (optional)<input id="reclaim-safe" value={safeActor} disabled={localDisabled} onChange={change(setSafeActor)} placeholder="0x…" /></label><label htmlFor="reclaim-gas-payer">Safe gas payer<input id="reclaim-gas-payer" value={gasPayer} disabled={localDisabled} onChange={change(setGasPayer)} placeholder="0x…" /></label><small>The local Safe path collects two explicit current-owner approvals and a separate gas-payer confirmation. An owner EOA cannot surrender Safe-owned NFTs directly.</small></details>
      <h3>Review an NFT trade-in</h3>
      <label htmlFor="reclaim-collection">Collection<select id="reclaim-collection" aria-label="Collection" value={collection} disabled={localDisabled || !snapshot} onChange={change(setCollection)}><option value="">Choose a verified collection</option>{snapshot?.collections.map(item => <option key={item.address} value={item.address}>ERC-{item.standard === 1 ? "721" : "1155"} · {item.address} · {item.admission}</option>)}</select></label>
      <div className="lpReclaimGrid"><label htmlFor="reclaim-token-ids">Exact token IDs<input id="reclaim-token-ids" value={tokenIds} disabled={localDisabled} onChange={change(setTokenIds)} placeholder="1, 2" inputMode="text" /></label><label htmlFor="reclaim-quantities">Quantities in matching order<input id="reclaim-quantities" value={quantities} disabled={localDisabled} onChange={change(setQuantities)} placeholder="1, 1" inputMode="text" /></label></div>
      <small>At most eight strictly increasing IDs and twenty units. ERC-721 quantities must be one. Approval is separate from surrender.</small>
      {collectionData && <p className="lpInlineNotice">Method: {retirement(collectionData.retirementMode)}. {collectionData.retirementMode === 1 ? "The admitted NFT is actually burned and its supply reduced." : `The NFT is transferred permanently to ${collectionData.destination}; it is not burned.`} No participant or administrator can recover an accepted NFT.</p>}
      <label className="lpReclaimConsent" htmlFor="reclaim-permanent-consent"><input id="reclaim-permanent-consent" type="checkbox" checked={permanentConsent} disabled={localDisabled} onChange={event => setPermanentConsent(event.target.checked)} />I understand these NFTs will be permanently removed from circulation and can never be returned.</label>
      <div className="lpReclaimActions"><button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !collectionData} onClick={() => void prepare(collectionData?.standard === 1 ? "approve-721" : "approve-1155", collectionData?.standard === 1 ? { collection, tokenId: entries(tokenIds)[0] } : { collection })}>Review NFT approval</button>
        <button className="lpButton" disabled={localDisabled || !wallet || !permanentConsent || !snapshot || stale || snapshot.paused || snapshot.closed || !collectionData?.enabled || collectionData.admission !== "admitted"} onClick={() => void prepare("redeem", { collection, tokenIds: entries(tokenIds), quantities: entries(quantities), permanentConsent: true })}>Review permanent NFT surrender</button></div>
      {collectionData?.standard === 2 && <p className="lpInlineNotice">ERC-1155 approval covers this collection for the exact campaign operator. It is not a one-token allowance. Review the immutable campaign and operator address before confirming.</p>}
      {collectionData?.standard === 2 && <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet} onClick={() => void prepare("revoke-1155", { collection })}>Review ERC-1155 approval revocation</button>}
      {(mayCreate||mayAdminister||mayAcceptController)&&<details className="lpReclaimOwner"><summary>Campaign owner dashboard</summary><p>Only an explicitly admitted controller may administer this campaign through RMT. The server rechecks its on-chain authority, runtime, notices and reserves before every review. An unsigned review does not prove wallet ownership; actual execution still requires the controller's wallet signature or two Safe-owner approvals.</p>
        {mayCreate&&<>
        <h3>Create an isolated campaign</h3><label htmlFor="reclaim-controller">Controller address<input id="reclaim-controller" value={controller} disabled={localDisabled} onChange={change(setController)} placeholder={wallet?.account ?? "0x…"} /></label>
        <div className="lpReclaimGrid"><label htmlFor="reclaim-reward">Fixed reward per NFT (synthetic RMT)<input id="reclaim-reward" value={rewardUnits} disabled={localDisabled} onChange={change(setRewardUnits)} inputMode="decimal" /></label><label htmlFor="reclaim-wallet-cap">Campaign units per wallet<input id="reclaim-wallet-cap" value={walletCap} disabled={localDisabled} onChange={change(setWalletCap)} inputMode="numeric" /></label></div>
        <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet} onClick={() => { try { if (!wallet) throw Error("Connect a test wallet."); void prepare("create-campaign", { intentId: intentFor(actor), controller: controller || actor, rewardPerUnit: tokens(rewardUnits), walletCap }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid campaign terms."); } }}>Review campaign creation</button>
        {completedCreation && <><button type="button" className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet} onClick={() => void startAnother(completedCreation)}>Start another campaign</button><small>Available only after the original creation is confirmed and indexed. This releases its creation intent; all transaction recovery records remain intact.</small></>}
        </>}
        {mayAdminister&&<>
        <h3>Manual funding and reserve</h3><label htmlFor="reclaim-funding">Amount (synthetic RMT)<input id="reclaim-funding" value={fundUnits} disabled={localDisabled} onChange={change(setFundUnits)} inputMode="decimal" /></label><div className="lpReclaimActions">
          <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare("approve-funding", { amountWei: tokens(fundUnits) }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid amount."); } }}>Review exact funding approval</button>
          <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare("fund", { amountWei: tokens(fundUnits) }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid amount."); } }}>Review manual funding</button></div>
        <h3>Collection admission</h3><div className="lpReclaimGrid"><label htmlFor="reclaim-collection-cap">Collection unit cap<input id="reclaim-collection-cap" value={collectionCap} disabled={localDisabled} onChange={change(setCollectionCap)} inputMode="numeric" /></label><label htmlFor="reclaim-collection-wallet-cap">Collection units per wallet<input id="reclaim-collection-wallet-cap" value={collectionWalletCap} disabled={localDisabled} onChange={change(setCollectionWalletCap)} inputMode="numeric" /></label></div>
        <div className="lpReclaimActions">{(["propose-collection", "execute-collection", "cancel-collection", "disable-collection"] as const).map(operation => <button key={operation} className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot || !collection} onClick={() => { try { void prepare(operation, operation === "propose-collection" ? { collection, collectionCap, collectionWalletCap, expiresAt: expiry() } : operation === "disable-collection" ? { collection } : {}); } catch (error) { setMessage(error instanceof Error ? error.message : "Notice unavailable."); } }}>{operation === "propose-collection" ? "Review collection notice" : operation === "execute-collection" ? "Review collection admission" : label(operation)}</button>)}</div>
        <h3>Availability and future rates</h3><div className="lpReclaimActions">{(["pause", "resume", "execute-rate", "cancel-rate", "propose-close", "execute-close", "cancel-close", "execute-recovery", "cancel-recovery"] as const).map(operation => <button key={operation} className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare(operation, operation === "propose-close" ? { expiresAt: expiry() } : {}); } catch (error) { setMessage(error instanceof Error ? error.message : "Notice unavailable."); } }}>{label(operation)}</button>)}</div>
        <div className="lpReclaimActions"><button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare("propose-rate", { rewardPerUnit: tokens(rewardUnits), expiresAt: expiry() }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid rate."); } }}>Review future reward notice</button>
          <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot || !snapshot.closed} onClick={() => { try { void prepare("propose-recovery", { amountWei: tokens(fundUnits), expiresAt: expiry() }); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid recovery amount."); } }}>Review uncommitted reserve recovery</button></div>
        <h3>Controller continuity</h3><label htmlFor="reclaim-next-controller">Incoming controller<input id="reclaim-next-controller" value={nextController} disabled={localDisabled} onChange={change(setNextController)} placeholder="0x…" /></label>
        <div className="lpReclaimActions">{(["propose-controller", "cancel-controller"] as const).map(operation => <button key={operation} className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !snapshot} onClick={() => { try { void prepare(operation, operation === "propose-controller" ? { next: nextController, expiresAt: expiry() } : {}); } catch (error) { setMessage(error instanceof Error ? error.message : "Controller notice unavailable."); } }}>{label(operation)}</button>)}</div>
        </>}
        {mayAcceptController&&<button className="lpButton lpButtonSecondary" disabled={localDisabled} onClick={()=>void prepare("accept-controller",{})}>accept controller</button>}
      </details>}
      {!mayCreate&&!mayAdminister&&!mayAcceptController&&<p className="lpInlineNotice">Dashboard administration is unavailable for this wallet. Public eligibility and your own permanent-surrender recovery remain available. No production controller is assigned.</p>}
      {snapshot && <details><summary>Permanent surrender records</summary><p>Every accepted record is permanent. Eligibility remains consumed and no repayment or return is possible.</p><ul className="lpTreasuryHistory">{snapshot.receipts.length ? snapshot.receipts.map(receipt => <li key={receipt.id}><strong>Record {receipt.id} · {retirement(receipt.retirementMode)}</strong><span>{receipt.collection} · IDs {receipt.tokenIds.join(", ")} · quantities {receipt.quantities.join(", ")}</span><span>Claimant {receipt.claimant} · paid reward {amount(receipt.rewardWei)} {snapshot.rewardSymbol}</span><span>{receipt.retirementMode === 1 ? "Verified supply reduction" : `Permanent sink ${receipt.destination}`}</span></li>) : <li>No canonically verified permanent surrender is available.</li>}</ul></details>}
      {review && <section className="lpRecovery lpReclaimReview" aria-label="Reviewed Reclaim transaction"><h3>{review.status === "needs-safe-approvals" ? "Safe approval required" : "Review exact test transaction"}</h3><dl className="lpFacts"><dt>Action</dt><dd>{label(review.operation)}</dd><dt>Acting wallet</dt><dd>{review.actor}</dd><dt>Campaign</dt><dd>{review.campaign}</dd><dt>Target</dt><dd>{review.innerCall.to}</dd><dt>Native value</dt><dd>0 ETH</dd><dt>Reward or funding</dt><dd>{amount(review.rewardWei)} synthetic tokens · fixed units, no USD quote</dd>
        {review.fields.amountWei && <><dt>Exact token amount</dt><dd>{amount(review.fields.amountWei)} synthetic tokens</dd></>}
        {review.transfer && <><dt>Token transfer</dt><dd>{amount(review.transfer.amountWei)} synthetic tokens · {review.transfer.asset}</dd><dt>From</dt><dd>{review.transfer.from}</dd><dt>Recipient</dt><dd>{review.transfer.to}</dd></>}
        {review.fields.rewardPerUnit && <><dt>Fixed reward per eligible unit</dt><dd>{amount(review.fields.rewardPerUnit)} synthetic tokens</dd></>}
        {review.fields.collection && <><dt>NFT collection</dt><dd>{review.fields.collection}</dd></>}
        {(review.fields.tokenIds || review.fields.tokenId) && <><dt>Exact NFT IDs / quantities</dt><dd>{review.fields.tokenIds?.join(", ") ?? review.fields.tokenId} / {review.fields.quantities?.join(", ") ?? "1"}</dd></>}
        {review.nft && <><dt>Permanent retirement method</dt><dd>{retirement(review.nft.retirementMode)}</dd><dt>Destination</dt><dd>{review.nft.retirementMode === 1 ? "None — actual native burn" : review.nft.destination}</dd><dt>Retirement policy</dt><dd>{review.nft.policyHash}</dd></>}
        {review.operation === "approve-1155" && <><dt>Approval scope</dt><dd>All NFTs in this collection for this exact campaign operator. This is not a one-token allowance.</dd></>}
        <dt>Policy / controller epoch</dt><dd>{review.policyEpoch} / {review.controllerEpoch}</dd><dt>Maximum network fee</dt><dd>{review.status === "needs-safe-approvals" ? "Not estimated — prepare a Safe outer transaction" : `${amount(review.maximumNetworkFeeWei)} synthetic ETH`}</dd><dt>Expiry</dt><dd>{when(String(review.expiresAt))}</dd><dt>NFT outcome</dt><dd>Permanent loss by verified native burn or validated immutable sink. No return or buyback.</dd></dl>
        <ul>{review.notices.map(notice => <li key={notice}>{notice}</li>)}</ul><details><summary>Exact contract data and normalized fields</summary><pre>{JSON.stringify({ fields: review.fields, innerCall: review.innerCall, request: review.request }, null, 2)}</pre></details>
        {review.status === "prepared" ? <button className="lpButton" disabled={localDisabled || !wallet || review.operation === "redeem" && !permanentConsent} onClick={() => void confirm()}>Confirm test Reclaim transaction</button> : <button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !reclaimAddress(gasPayer) || review.operation === "redeem" && !permanentConsent} onClick={() => void proposeSafe()}>Prepare exact Safe proposal</button>}
      </section>}
      <details className="lpReclaimRecovery lpReclaimSafe"><summary>Safe approvals and recovery</summary>
        <p>Each current owner explicitly signs the exact Safe EIP-712 action. The gas payer separately reviews and confirms its outer transaction. Owner signatures never authorize an EOA to act as the Safe.</p>
        <label htmlFor="reclaim-safe-original">Original Safe proposal<select id="reclaim-safe-original" aria-label="Original Safe proposal" value={safeKey} disabled={localDisabled} onChange={event => setSafeKey(event.target.value)}><option value="">Choose a preserved proposal</option>{safeJournals.map(entry => <option key={entry.proposal.proposalHash} value={entry.proposal.proposalHash}>{label(entry.proposal.innerReview.operation)} · Safe nonce {entry.proposal.safeNonce} · {entry.stage}</option>)}</select></label>
        {safeEntry && <>
          <dl className="lpFacts"><dt>Safe</dt><dd>{safeEntry.proposal.safe}</dd><dt>Safe nonce</dt><dd>{safeEntry.proposal.safeNonce}</dd><dt>Gas payer</dt><dd>{safeEntry.proposal.gasPayer}</dd><dt>Gas-payer nonce</dt><dd>{safeEntry.proposal.gasPayerNonce}</dd><dt>Exact action</dt><dd>{label(safeEntry.proposal.innerReview.operation)} · {safeEntry.proposal.innerReview.innerCall.to}</dd><dt>Safe typed-data digest</dt><dd>{safeEntry.proposal.digest}</dd><dt>Approvals</dt><dd>{safeEntry.approvals.length} / 2 current owners · 3-owner SafeL2 1.4.1</dd><dt>Application review expires</dt><dd>{when(String(safeEntry.proposal.expiresAt))}</dd>
          {safeEntry.proposal.innerReview.nft && <><dt>Permanent NFT retirement</dt><dd>{retirement(safeEntry.proposal.innerReview.nft.retirementMode)} · {safeEntry.proposal.innerReview.nft.collection} · IDs {safeEntry.proposal.innerReview.nft.tokenIds.join(", ")} · quantities {safeEntry.proposal.innerReview.nft.quantities.join(", ")}</dd><dt>Retirement destination</dt><dd>{safeEntry.proposal.innerReview.nft.retirementMode === 1 ? "None — actual native burn" : safeEntry.proposal.innerReview.nft.destination}</dd><dt>Exact funded reward</dt><dd>{amount(safeEntry.proposal.innerReview.rewardWei)} synthetic RMT token units; no USD guarantee</dd></>}
          <dt>Maximum outer network fee</dt><dd>{safeEntry.outerReview ? `${amount(safeEntry.outerReview.maximumNetworkFeeWei)} synthetic ETH · local L1 data fee not applicable` : "Not estimated — prepare the exact outer transaction"}</dd></dl>
          <p className="lpInlineNotice">Safe signatures do not contain a general expiry. Surrender calls enforce their own contract deadline; other approvals remain usable until the Safe nonce is consumed. Application expiry does not revoke a previously issued nonce-only authorization.</p>
          {safeEntry.proposal.innerReview.operation === "redeem" && <label className="lpReclaimConsent" htmlFor="reclaim-safe-consent"><input id="reclaim-safe-consent" type="checkbox" checked={safeConsentHash === safeEntry.proposal.proposalHash} disabled={localDisabled} onChange={event => setSafeConsentHash(event.target.checked ? safeEntry.proposal.proposalHash : null)} />I understand this exact Safe proposal permanently removes its listed NFTs from circulation. No NFT return or buyback is possible.</label>}
          <ul className="lpTreasuryHistory">{safeEntry.proposal.owners.map((owner, index) => <li key={owner}><strong>Current owner {index + 1}</strong><span>{owner}</span><span>{safeEntry.approvals.some(approval => sameReclaimHex(approval.signer, owner)) ? "Verified approval saved" : "Approval not collected"}</span><button className="lpButton lpButtonSecondary" disabled={localDisabled || !wallet || !sameReclaimHex(wallet.account, owner) || safeEntry.approvals.length >= 2 || safeEntry.approvals.some(approval => sameReclaimHex(approval.signer, owner)) || safeEntry.proposal.innerReview.operation === "redeem" && safeConsentHash !== safeEntry.proposal.proposalHash} onClick={() => void approveSafe(owner)}>Approve Safe owner {index + 1}</button></li>)}</ul>
          <button className="lpButton lpButtonSecondary" disabled={localDisabled || safeEntry.approvals.length !== 2 || !wallet || !sameReclaimHex(wallet.account, safeEntry.proposal.gasPayer) || safeEntry.proposal.innerReview.operation === "redeem" && safeConsentHash !== safeEntry.proposal.proposalHash} onClick={() => void prepareSafeOuter()}>Review Safe execution costs</button>
          {safeEntry.outerReview && <section className="lpRecovery" aria-label="Reviewed Safe outer transaction"><h3>Review exact Safe execution</h3><p>{safeEntry.proposal.innerReview.operation === "redeem" ? "This transaction permanently retires the listed NFTs and pays only the exact funded reward. It cannot be reversed." : "Only the original approved action may execute."} Native call value is 0 ETH; the gas payer pays network costs.</p><dl className="lpFacts"><dt>From</dt><dd>{safeEntry.outerReview.request.from}</dd><dt>To</dt><dd>{safeEntry.outerReview.request.to}</dd><dt>Gas limit</dt><dd>{BigInt(safeEntry.outerReview.request.gas).toString()}</dd><dt>Maximum network fee</dt><dd>{amount(safeEntry.outerReview.maximumNetworkFeeWei)} synthetic ETH</dd><dt>Review hash</dt><dd>{safeEntry.outerReview.reviewHash}</dd></dl><details><summary>Exact Safe outer transaction data</summary><pre>{JSON.stringify(safeEntry.outerReview.request, null, 2)}</pre></details><button className="lpButton" disabled={localDisabled || !wallet || !["approvals-ready", "wallet-rejected"].includes(safeEntry.stage) || !sameReclaimHex(wallet.account, safeEntry.proposal.gasPayer) || safeEntry.proposal.innerReview.operation === "redeem" && safeConsentHash !== safeEntry.proposal.proposalHash} onClick={() => void confirmSafeOuter()}>Confirm Safe execution transaction</button></section>}
          <p>{safeEntry.transactionHash ?? "Original outer hash not returned or not submitted. No automatic retry is allowed."}</p>
          <p>{safeEntry.result ? verificationLabel(safeEntry.result) : `Preserved Safe status: ${safeEntry.stage}`}</p>
          <label htmlFor="reclaim-safe-hash">Original Safe transaction hash (if available)<input id="reclaim-safe-hash" value={safeManualHash} onChange={event => setSafeManualHashInput({ identity: safeKey, value: event.target.value })} disabled={localDisabled} maxLength={66} placeholder="0x…" /></label>
          <button className="lpButton lpButtonSecondary" disabled={localDisabled || !safeEntry.outerReview} onClick={() => void recoverSafe()}>Verify original Safe execution</button>
        </>}
      </details>
      <details className="lpReclaimRecovery"><summary>Recover original Reclaim transaction</summary><p>Recovery only reads the original transaction. It never requests another signature or broadcasts a duplicate.</p>
        <label htmlFor="reclaim-original">Original Reclaim request<select id="reclaim-original" aria-label="Original Reclaim request" value={journalKey} onChange={event => setJournalKey(event.target.value)} disabled={localDisabled}><option value="">Choose a preserved request</option>{journals.map(entry => <option key={entry.review.reviewHash} value={entry.review.reviewHash}>{label(entry.review.operation)} · {entry.stage} · {entry.review.actor.slice(0, 10)}…</option>)}</select></label>
        {selectedJournal && <><p>{selectedJournal.transactionHash ?? "Transaction hash not returned; original actor and nonce remain preserved."}</p><p>{selectedJournal.result ? verificationLabel(selectedJournal.result) : reclaimJournalTerminal(selectedJournal) ? "This original outcome remains in history." : "Original outcome unresolved. Do not submit it again."}</p></>}
        <label htmlFor="reclaim-original-hash">Original transaction hash (if available)<input id="reclaim-original-hash" value={manualHash} onChange={event => setManualHashInput({ identity: journalKey, value: event.target.value })} disabled={localDisabled} maxLength={66} placeholder="0x…" /></label>
        <button className="lpButton lpButtonSecondary" disabled={localDisabled || !selectedJournal} onClick={() => void recover()}>Verify original Reclaim transaction</button>
      </details>
    </section>}
  </>;
}
function verificationLabel(value: ReclaimVerification) {
  if (value.status === "confirmed") return value.indexed ? "Canonical transaction and indexed settlement verified." : "Confirmed on-chain; canonical indexing is pending.";
  if (value.status === "reverted") return "Transaction reverted. Permanent NFT surrender and reward settlement were not accepted.";
  if (value.status === "reorged") return "Previously observed evidence was invalidated by a reorganization. Preserve the original transaction identity.";
  if (value.status === "pending") return "Original transaction or its settlement evidence remains pending. No duplicate submission was requested.";
  return "Original transaction evidence is unavailable. This is not proof of success, rejection or a missing campaign.";
}
