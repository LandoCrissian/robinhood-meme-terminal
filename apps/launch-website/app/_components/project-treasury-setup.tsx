"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { isProjectTreasuryPreview, isProjectTreasuryProof, type ProjectTreasuryPreview, type ProjectTreasuryProof } from "../../lib/project-treasury";
import { emptyProjectTreasuryDraft, newProjectTreasuryIntent, projectTreasuryDraftKey, readProjectTreasuryDraft, validateProjectTreasuryDraft,
  type ProjectTreasuryDraft, type ProjectTreasuryDraftErrors, type ProjectTreasuryMode } from "../../lib/project-treasury-draft";
import { postProjectTreasury, TreasuryTransactionPanel, useTreasuryExecution } from "./treasury-wallet-controls";
import { launchTerms } from "../../lib/launch-terms";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function ProjectTreasurySetup({ creatorFields, onVerified, onInvalidate, fixture, initialExisting = false,
  onModeChange, existingChildren }: { creatorFields: { name: string; symbol: string; projectURI: string };
  onVerified(proof: ProjectTreasuryProof): void; onInvalidate(): void; fixture: boolean; initialExisting?: boolean;
  onModeChange(mode: ProjectTreasuryMode): void; existingChildren: ReactNode }) {
  const [draft, setDraft] = useState<ProjectTreasuryDraft>(emptyProjectTreasuryDraft), [restored, setRestored] = useState(false);
  const [errors, setErrors] = useState<ProjectTreasuryDraftErrors>({}), [preview, setPreview] = useState<ProjectTreasuryPreview | null>(null);
  const [notice, setNotice] = useState(""), [verified, setVerified] = useState<ProjectTreasuryProof | null>(null);
  const settings = useRef(draft), revision = useRef(0), mounted = useRef(true); settings.current = draft;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++; }; }, []);
  const verifiedProof = (proof: ProjectTreasuryProof) => {
    if (!mounted.current) return;
    const current = validateProjectTreasuryDraft(settings.current);
    if (current.ok && current.draft.mode === "contract" && current.draft.controller && current.draft.intentId
      && same(proof.controller, current.draft.controller) && same(proof.intentId, current.draft.intentId)
      && proof.treasuryShareBps === current.draft.treasuryShareBps) {
      setVerified(proof); onVerified(proof); setNotice("Treasury deployment verified. The token creation remains a separate transaction from the same creator wallet.");
    } else setNotice("The original treasury was recovered. Its immutable settings differ from the current draft; no token beneficiary was changed.");
  };
  const execution = useTreasuryExecution({ fixture, onVerified: verifiedProof });
  useEffect(() => {
    let saved: ProjectTreasuryDraft | undefined;
    try { const raw = localStorage.getItem(projectTreasuryDraftKey); if (raw && raw.length <= 2048) saved = readProjectTreasuryDraft(JSON.parse(raw)); }
    catch { setNotice("Treasury draft storage is unavailable. Original transaction recovery is retained separately."); }
    const value = saved ?? { ...emptyProjectTreasuryDraft, mode: initialExisting ? "existing" as const : "none" as const };
    if (!value.intentId) { try { value.intentId = newProjectTreasuryIntent(); } catch { setNotice("Secure project intent unavailable. Treasury deployment is blocked."); } }
    setDraft(value); onModeChange(value.mode); setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(projectTreasuryDraftKey, JSON.stringify(draft)); }
    catch { setNotice("Treasury draft could not be saved. A submitted transaction still requires its original journal and hash."); }
  }, [draft, restored]);
  useEffect(() => { revision.current++; setPreview(null); execution.invalidate(); }, [creatorFields.name, creatorFields.symbol, creatorFields.projectURI]);
  useEffect(() => {
    if (verified && (!execution.wallet || !same(verified.creator, execution.wallet.account))) {
      setVerified(null); setPreview(null); onInvalidate();
      setNotice("Wallet identity changed. Recover and verify the original treasury before continuing token creation.");
    }
  }, [execution.wallet, verified]);
  function edit<K extends keyof ProjectTreasuryDraft>(field: K, value: ProjectTreasuryDraft[K]) {
    revision.current++; execution.invalidate(); setPreview(null); setVerified(null); onInvalidate(); setErrors({}); setNotice("");
    setDraft(previous => ({ ...previous, [field]: value }));
    if (field === "mode") onModeChange(value as ProjectTreasuryMode);
  }
  async function previewAddress() {
    if (!execution.wallet) throw Error("Connect the synthetic creator wallet to bind its deterministic treasury address.");
    const checked = validateProjectTreasuryDraft(draft);
    if (!checked.ok) { setErrors(checked.errors); return; }
    const terms = checked.draft;
    if (!terms.controller || !terms.intentId) throw Error("Choose an independent contract treasury first.");
    const at = revision.current;
    const result = await postProjectTreasury({ action: "preview", account: execution.wallet.account, controller: terms.controller,
      intentId: terms.intentId, treasuryShareBps: terms.treasuryShareBps });
    if (at !== revision.current || !isProjectTreasuryPreview(result) || !same(result.creator, execution.wallet.account)
      || !same(result.controller, terms.controller) || !same(result.intentId, terms.intentId) || result.treasuryShareBps !== terms.treasuryShareBps) throw Error("The treasury address preview does not match this creator and committed terms.");
    setPreview(result);
    if (result.deployed && result.proof && isProjectTreasuryProof(result.proof)) verifiedProof(result.proof);
  }
  async function reviewDeployment() {
    if (!preview || preview.deployed || !execution.wallet) throw Error("A current vacant treasury address preview is required.");
    const checked = validateProjectTreasuryDraft(draft); if (!checked.ok) { setErrors(checked.errors); return; }
    if (!checked.draft.controller || !checked.draft.intentId || !same(preview.creator, execution.wallet.account)
      || !same(preview.controller, checked.draft.controller) || !same(preview.intentId, checked.draft.intentId)
      || preview.treasuryShareBps !== checked.draft.treasuryShareBps) throw Error("Treasury settings changed. Verify the address again.");
    await execution.prepare("create-treasury", {}, preview);
  }
  return <div className="lpForm lpProjectTreasurySetup" aria-label="Optional per-project treasury setup">
    <fieldset disabled={!restored || execution.busy}><legend>Treasury setup</legend>
      <div className="lpTreasuryChoices">{([["none", "Pay the creator directly", "No treasury deployment or independent fee recipient."],
        ["existing", "Use an existing beneficiary", "An existing wallet or verified smart account with its own claim support."],
        ["contract", "Create a project treasury", "A unique controlled contract; separate gas and wallet review."]] as const).map(([mode, label, help]) =>
        <label key={mode}><input type="radio" name="project-treasury-mode" value={mode} checked={draft.mode === mode} onChange={() => edit("mode", mode)} /><span>{label}<small>{help}</small></span></label>)}</div>
    </fieldset>
    {draft.mode === "existing" && existingChildren}
    {draft.mode === "none" && <p>All of the project&apos;s 90% fee share is paid to the creator. RMT Operations and Reserve retain their unchanged 5% shares.</p>}
    {draft.mode === "contract" && <>
      <fieldset className="lpForm" disabled={!restored || execution.busy}><legend>Project treasury terms</legend>
        <label>Project type<select aria-label="Treasury project type" value={draft.projectKind} onChange={e => edit("projectKind", e.target.value as ProjectTreasuryDraft["projectKind"])}>
          <option value="standalone">Standalone token</option><option value="nft-community">Existing NFT community</option></select></label>
        {draft.projectKind === "nft-community" && <><label>Existing collection address (optional)<input aria-label="Existing NFT collection address" value={draft.nftCollection} maxLength={42} spellCheck={false} onChange={e => edit("nftCollection", e.target.value)} /></label>
          <p>Collection metadata stays in this browser. No royalty setting is read or changed. Supported payments can arrive only after deployment; marketplace enforcement and future royalties are not guaranteed.</p>{errors.nftCollection && <p role="alert">{errors.nftCollection}</p>}</>}
        <label>Controller wallet<input aria-label="Project treasury controller" value={draft.controller} maxLength={42} placeholder="0x…" autoComplete="off" spellCheck={false} onChange={e => edit("controller", e.target.value)} /></label>
        {errors.controller && <p role="alert">{errors.controller}</p>}
        <label>Controller type<select aria-label="Project treasury controller type" value={draft.controllerKind} onChange={e => edit("controllerKind", e.target.value as ProjectTreasuryDraft["controllerKind"])}>
          <option value="eoa">EOA or supported delegated wallet</option><option value="safe-1.4.1">SafeL2 1.4.1</option></select></label>
        <p>The controller authorizes this treasury&apos;s actions. It does not inherit the creator&apos;s token ownership or another beneficiary&apos;s claims.</p>
        {draft.controllerKind === "safe-1.4.1" && <p className="lpInlineNotice">Safe controllers require the Safe&apos;s own approvals. The dashboard provides an unsigned inner CALL; it cannot substitute an EOA owner or submit a Safe transaction.</p>}
        <label>Project fees sent to treasury<input aria-label="Contract treasury share slider" type="range" min="0" max="100" step="1" value={Number.isFinite(Number(draft.sharePercent)) ? Math.min(100, Math.max(0, Number(draft.sharePercent))) : 0}
          onChange={e => edit("sharePercent", e.target.value)} /></label>
        <label>Exact share of project fees (%)<input aria-label="Contract treasury share of project fees" value={draft.sharePercent} maxLength={6} inputMode="decimal" onChange={e => edit("sharePercent", e.target.value)} /></label>
        {errors.sharePercent && <p role="alert">{errors.sharePercent}</p>}
        <p>0–100% of the project&apos;s 90% allocation. The contract uses 0–9000 basis points of eligible fees; fractions round down. Creator receives the rest. A 0% allocation creates no treasury fee entitlement.</p>
        <p className="lpInlineNotice"><strong>Purchases OFF by default.</strong> Incoming funding is independent of purchase permission. Purchases remain unavailable without verified independent price evidence; enabling a policy is not execution or a return guarantee.</p>
      </fieldset>
      {!fixture && <p className="lpInlineNotice">Read-only preview. Project treasury deployment, wallet connection and token creation are disabled. No treasury address is presented as deployed.</p>}
      <div className="lpDraftActions">{!execution.wallet ? <button type="button" className="lpButton lpSecondary" disabled={!fixture || execution.busy || !restored} onClick={() => void execution.connect()}>Connect synthetic treasury creator</button>
        : <><p className="lpAddress">Treasury creator: {execution.wallet.account}</p><button type="button" className="lpButton lpSecondary" disabled={execution.busy} onClick={() => void execution.run(previewAddress)}>Preview project treasury address</button></>}
      </div>
      {errors.intentId && <p role="alert">{errors.intentId}</p>}
      {preview && <div className="lpReview lpForm" aria-label="Project treasury address preview"><h3>{preview.deployed ? "Verified treasury deployment" : "Predicted treasury address · not deployed"}</h3>
        <code className="lpAddress">{preview.treasury}</code><dl className="lpFacts"><dt>Creator</dt><dd className="lpAddress">{preview.creator}</dd><dt>Controller</dt><dd className="lpAddress">{preview.controller}</dd>
          <dt>Exact treasury allocation</dt><dd>{preview.treasuryShareBps} / 10,000 of eligible fees · project denominator 9,000</dd><dt>Purchase permission</dt><dd>OFF</dd>
          <dt>Creation sequence</dt><dd>1. Treasury deployment + gas. 2. Token creation + {launchTerms.creationFeeEth} ETH and gas. Separate reviews; the existing creator factory is unchanged.</dd></dl>
        {!preview.deployed && <button type="button" className="lpButton" disabled={execution.busy} onClick={() => void execution.run(reviewDeployment)}>Review synthetic treasury deployment</button>}
      </div>}
      {verified && <p className="lpInlineNotice" role="status">Project treasury verified at block {verified.deployment.blockNumber}. Token creation can use this intent only after its own review; no token has been created by this treasury step.</p>}
      <button type="button" className="lpTextButton" disabled={execution.busy} onClick={() => {
        try { edit("intentId", newProjectTreasuryIntent()); } catch { setNotice("Secure project intent unavailable. No treasury request was changed."); }
      }}>Start a new treasury intent</button>
      <p>Changing the intent never erases an earlier deployment or submitted transaction. Recover it above. Cancelling this optional step does not undo an already confirmed treasury.</p>
    </>}
    <TreasuryTransactionPanel execution={execution} />
    {notice && <p className="lpInlineNotice" role="status">{notice}</p>}
  </div>;
}
