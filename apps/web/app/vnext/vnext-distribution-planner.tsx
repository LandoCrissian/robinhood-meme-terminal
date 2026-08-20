"use client";

import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import {
  DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS,
  DISTRIBUTION_PLANNER_MODE,
  DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL,
  type DistributionPlannerActionKind,
  buildDistributionPlannerPreview,
  formatDistributionPreviewAmount,
  summarizePlannerReadyState
} from "../../lib/vnext/distribution-planner";
import { CCFF00_OFFICIAL_LINKS, CCFF00_PRESENTATION_EVIDENCE } from "../../lib/vnext/distribution-ccff00-presentation";

const ACTION_OPTIONS: { value: DistributionPlannerActionKind; label: string }[] = [
  { value: "erc20_equal", label: "ERC-20 Equal" }, { value: "erc20_custom", label: "ERC-20 Custom" },
  { value: "erc721", label: "ERC-721" }, { value: "erc1155", label: "ERC-1155" }
];
const WORKSPACE_TABS = [{ value: "community", label: "Community" }, { value: "planner", label: "Planner" }] as const;
const COMMUNITY_TABS = [
  { value: "overview", label: "Overview" }, { value: "program", label: "Program" },
  { value: "proof", label: "Proof" }, { value: "links", label: "Links" }
] as const;
const CCFF00_EXTERNAL_LINKS = [
  { label: "CCFF00", detail: "Official collection", href: CCFF00_OFFICIAL_LINKS.ccff00 },
  { label: "HoodStreet", detail: "Official site", href: CCFF00_OFFICIAL_LINKS.hoodstreet },
  { label: "My Neon", detail: "Member experience", href: CCFF00_OFFICIAL_LINKS.myNeon },
  { label: "OpenSea", detail: "CCFF00 collection", href: CCFF00_OFFICIAL_LINKS.openSea },
  { label: "CCFF00 on X", detail: "Official community account", href: CCFF00_OFFICIAL_LINKS.ccff00X },
  { label: "HoodStreet on X", detail: "Official HoodStreet account", href: CCFF00_OFFICIAL_LINKS.hoodstreetX }
] as const;
const PROGRAM_STAGES = [
  { label: "CCFF00 collection", state: "VERIFIED" }, { label: "Public token IDs", state: "VERIFIED" },
  { label: "Collection-returned TBAs", state: "VERIFIED" }, { label: "Frozen evidence snapshot", state: "VERIFIED" },
  { label: "Deterministic recipient set", state: "LOCKED" }, { label: "Distribution manifest", state: "LOCKED" },
  { label: "User authorization", state: "LOCKED" }, { label: "Settlement", state: "LOCKED" }
] as const;
const CANARY_PROOF_STAGES = [
  { label: "TBA identity", state: "VERIFIED" }, { label: "Current owner", state: "VERIFIED" },
  { label: "Account activation", state: "NOT ACTIVATED" }, { label: "1 RMT deposit", state: "LOCKED" },
  { label: "Owner-controlled transfer", state: "LOCKED" }, { label: "Reconciliation", state: "LOCKED" }
] as const;

type DistributionPresentation = "desktop" | "mobile";
type DistributionWorkspace = (typeof WORKSPACE_TABS)[number]["value"];
type CommunitySection = (typeof COMMUNITY_TABS)[number]["value"];

function csvTemplateForKind(actionKind: DistributionPlannerActionKind) {
  if (actionKind === "erc20_equal") return "recipient\\n";
  if (actionKind === "erc20_custom") return "recipient,amount\\n";
  if (actionKind === "erc721") return "recipient,tokenId\\n";
  return "recipient,tokenId,amount\\n";
}
function shortenAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function CopyAddress({ label, value }: { label: string; value: string }) {
  return <button type="button" className="rmtCcff00Address" title={`${value} · copy address`} aria-label={`${label}: ${value}. Copy address.`} onClick={() => { void navigator.clipboard?.writeText(value); }}>
    {shortenAddress(value)}<span aria-hidden="true">⧉</span>
  </button>;
}
function ExternalLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>{children}<span aria-hidden="true">↗</span></a>;
}

export function VNextDistributionPlanner({ presentation = "desktop" }: { presentation?: DistributionPresentation }) {
  const [workspace, setWorkspace] = useState<DistributionWorkspace>("community");
  const [communitySection, setCommunitySection] = useState<CommunitySection>("overview");
  const [actionKind, setActionKind] = useState<DistributionPlannerActionKind>("erc20_equal");
  const [assetAddress, setAssetAddress] = useState("");
  const [assetDecimals, setAssetDecimals] = useState(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
  const [senderAddress, setSenderAddress] = useState("");
  const [equalAmount, setEqualAmount] = useState("1");
  const [csv, setCsv] = useState(csvTemplateForKind("erc20_equal"));
  const [uploadError, setUploadError] = useState("");
  const idPrefix = presentation === "mobile" ? "rmt-mobile-distribution" : "rmt-desktop-distribution";
  const preview = useMemo(() => buildDistributionPlannerPreview({ actionKind, assetAddress, assetDecimals, equalAmount, csv, senderAddress }), [actionKind, assetAddress, assetDecimals, equalAmount, csv, senderAddress]);
  const isErc20 = actionKind === "erc20_equal" || actionKind === "erc20_custom";
  const summary = preview.status === "ready" ? summarizePlannerReadyState(preview) : null;
  const rowsToPreview = preview.status === "ready" ? preview.rowsPreview : [];

  const onUploadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { setCsv(await file.text()); setUploadError(""); } catch { setUploadError("Failed to read CSV upload."); }
    event.currentTarget.value = "";
  };
  const onActionKindChange = (next: DistributionPlannerActionKind) => {
    setActionKind(next); setUploadError(""); setCsv(csvTemplateForKind(next));
    setAssetDecimals(next === "erc20_equal" || next === "erc20_custom" ? String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS) : "");
  };
  const onResetDefaults = () => {
    setActionKind("erc20_equal"); setAssetAddress(""); setAssetDecimals(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
    setSenderAddress(""); setEqualAmount("1"); setCsv(csvTemplateForKind("erc20_equal")); setUploadError("");
  };
  const selectWorkspace = (next: DistributionWorkspace, target: HTMLElement) => {
    setWorkspace(next);
    if (presentation === "mobile") target.closest(".rmtDistributionPanel")?.scrollIntoView({ block: "start" });
  };

  return <section className="rmtDistributionPanel" aria-label="Distribution workspace" data-presentation={presentation} data-workspace={workspace} data-community-section={communitySection}>
    <nav className="rmtDistributionWorkspaceTabs" aria-label="Distribution workspace" role="tablist">
      {WORKSPACE_TABS.map((tab) => <button key={tab.value} id={`${idPrefix}-${tab.value}-tab`} type="button" role="tab" aria-selected={workspace === tab.value} aria-controls={`${idPrefix}-${tab.value}-panel`} className={workspace === tab.value ? "isActive" : ""} onClick={(event) => selectWorkspace(tab.value, event.currentTarget)}>{tab.label}</button>)}
      <span className="rmtDistributionReadOnly">READ-ONLY / PLANNING ONLY</span>
    </nav>

    {workspace === "community" ? <section id={`${idPrefix}-community-panel`} className="rmtCcff00Community" role="tabpanel" aria-labelledby={`${idPrefix}-community-tab`}>
      <div className="rmtCcff00TopGrid">
        <article className="rmtCcff00Hero">
          <header><span className="rmtCcff00Eyebrow">SUPPORTED COMMUNITY</span><span className="rmtCcff00Brand">#CCFF00</span><div className="rmtCcff00TitleLine"><h2>CCFF00</h2><span>Genesis Community</span></div></header>
          <div className="rmtCcff00HeroCopy"><p>HoodStreet&apos;s founding membership collection on Robinhood Chain. Each CCFF00 Square has a deterministic ERC-6551 token-bound account—an onchain wallet and identity attached to the NFT.</p><p>RMT is using CCFF00 as its first supported community to prove token-bound recipient discovery, auditable distribution and owner-controlled settlement.</p></div>
          <div className="rmtCcff00HeroLinks"><ExternalLink href={CCFF00_OFFICIAL_LINKS.ccff00} label="Explore CCFF00">Explore CCFF00</ExternalLink><ExternalLink href={CCFF00_OFFICIAL_LINKS.hoodstreet} label="HoodStreet">HoodStreet</ExternalLink></div>
          <p className="rmtCcff00Disclosure">Independent ecosystem support by RMT. No affiliation or endorsement implied.</p>
        </article>
        <aside className="rmtCcff00LiveProof" aria-labelledby={`${idPrefix}-live-proof-heading`}>
          <header><div><span className="rmtCcff00StatusRail" aria-hidden="true" /><h2 id={`${idPrefix}-live-proof-heading`}>LIVE PROOF STATE</h2></div><span>READ-ONLY</span></header>
          <div className="rmtCcff00LiveMetrics"><article><span>Public identities</span><strong>{CCFF00_PRESENTATION_EVIDENCE.publicMinted}</strong></article><article><span>Canary TBAs verified</span><strong>{CCFF00_PRESENTATION_EVIDENCE.canaries.verified} / {CCFF00_PRESENTATION_EVIDENCE.canaries.total}</strong></article><article><span>Canary accounts active</span><strong>{CCFF00_PRESENTATION_EVIDENCE.canaries.activated} / {CCFF00_PRESENTATION_EVIDENCE.canaries.total}</strong></article><article><span>Canary RMT deposits</span><strong>{CCFF00_PRESENTATION_EVIDENCE.canaries.rmtDeposited} / {CCFF00_PRESENTATION_EVIDENCE.canaries.total}</strong></article></div>
          <div className="rmtCcff00LiveStates"><span>Distribution <strong>LOCKED</strong></span><span>Proof <strong>IN PROGRESS</strong></span></div>
          <div className="rmtCcff00NextProof"><span>Next proof</span><strong>#470 · Activate → 1 RMT → owner-controlled return</strong></div>
        </aside>
      </div>
      <nav className="rmtCcff00SectionTabs" aria-label="CCFF00 community sections" role="tablist">
        {COMMUNITY_TABS.map((tab) => <button key={tab.value} id={`${idPrefix}-${tab.value}-tab`} type="button" role="tab" aria-selected={communitySection === tab.value} aria-controls={`${idPrefix}-${tab.value}-panel`} className={communitySection === tab.value ? "isActive" : ""} onClick={() => setCommunitySection(tab.value)}>{tab.label}</button>)}
      </nav>
      <div className="rmtCcff00SectionStage">
        {communitySection === "overview" ? <section id={`${idPrefix}-overview-panel`} className="rmtCcff00Overview" role="tabpanel" aria-labelledby={`${idPrefix}-overview-tab`}>
          <div className="rmtCcff00Concepts"><article><span>TOKEN-BOUND IDENTITY</span><strong>NFT <i>→</i> deterministic TBA</strong></article><article><span>OWNER CONTROL</span><strong>Current NFT owner controls the account</strong></article><article><span>SETTLEMENT</span><strong>Value routes directly to token-bound identity</strong></article></div>
          <div className="rmtCcff00Why"><span>WHY TOKEN-BOUND ACCOUNTS?</span><p>The NFT has its own deterministic account address. The account can hold supported assets. When NFT ownership changes, the account address remains the same while control follows the current owner under the CCFF00 implementation.</p></div>
        </section> : null}
        {communitySection === "program" ? <section id={`${idPrefix}-program-panel`} className="rmtCcff00Program" role="tabpanel" aria-labelledby={`${idPrefix}-program-tab`}>
          <div className="rmtCcff00Phase"><span>CURRENT PHASE</span><strong>CANARY CONTROL PROOF</strong><p>RMT is validating the settlement path with tiny canaries before any community-wide distribution is authorized.</p></div>
          <ol className="rmtCcff00ProgramFlow" aria-label="CCFF00 distribution program stages">{PROGRAM_STAGES.map((stage, index) => <li key={stage.label} className={stage.state === "LOCKED" ? "isLocked" : "isVerified"}><span>{String(index + 1).padStart(2, "0")}</span><strong>{stage.label}</strong><small>{stage.state}</small></li>)}</ol>
          <div className="rmtCcff00Boundaries"><span>No mass distribution</span><span>No approved utility rate</span><span>No wallet submission</span><span>No server submission</span></div>
        </section> : null}
        {communitySection === "proof" ? <section id={`${idPrefix}-proof-panel`} className="rmtCcff00Proof" role="tabpanel" aria-labelledby={`${idPrefix}-proof-tab`}>
          <div className="rmtCcff00ProofTableWrap"><table className="rmtCcff00ProofTable"><caption>Current block-bound CCFF00 canary evidence</caption><thead><tr><th>Square</th><th>Owner</th><th>TBA</th><th>CCFF00</th><th>RMT</th><th>Account</th></tr></thead><tbody>{CCFF00_PRESENTATION_EVIDENCE.canaryRows.map((row) => <tr key={row.tokenId}><td data-label="Square"><strong>#{row.tokenId}</strong></td><td data-label="Owner"><CopyAddress label={`CCFF00 #${row.tokenId} owner`} value={row.owner} /></td><td data-label="TBA"><CopyAddress label={`CCFF00 #${row.tokenId} token-bound account`} value={row.tokenBoundAccount} /></td><td data-label="CCFF00">{row.ccff00Balance}</td><td data-label="RMT">{row.rmtBalance}</td><td data-label="Account"><span className={row.activated ? "isVerified" : "isLocked"}>{row.activated ? "VERIFIED" : "NOT ACTIVATED"}</span></td></tr>)}</tbody></table></div>
          <div className="rmtCcff00CanaryProgress">{CCFF00_PRESENTATION_EVIDENCE.canaryRows.map((row) => <article key={row.tokenId}><header><strong>CCFF00 #{row.tokenId}</strong><span>PROOF IN PROGRESS</span></header><ol>{CANARY_PROOF_STAGES.map((stage) => <li key={stage.label} className={stage.state === "VERIFIED" ? "isVerified" : "isLocked"}><span aria-hidden="true" /><strong>{stage.label}</strong><small>{stage.state}</small></li>)}</ol></article>)}</div>
          <dl className="rmtCcff00SnapshotMeta"><div><dt>Snapshot block</dt><dd>{Number(CCFF00_PRESENTATION_EVIDENCE.snapshotBlock).toLocaleString("en-US")}</dd></div><div><dt>Public minted</dt><dd>{CCFF00_PRESENTATION_EVIDENCE.publicMinted}</dd></div><div><dt>Reserve minted</dt><dd>{CCFF00_PRESENTATION_EVIDENCE.reserveMinted}</dd></div><div><dt>Total supply</dt><dd>{CCFF00_PRESENTATION_EVIDENCE.totalSupply}</dd></div><div className="isHash"><dt>Snapshot hash</dt><dd title={CCFF00_PRESENTATION_EVIDENCE.snapshotHash}>{CCFF00_PRESENTATION_EVIDENCE.snapshotHash}</dd></div></dl>
        </section> : null}
        {communitySection === "links" ? <section id={`${idPrefix}-links-panel`} className="rmtCcff00LinksDirectory" role="tabpanel" aria-labelledby={`${idPrefix}-links-tab`}>{CCFF00_EXTERNAL_LINKS.map((link) => <ExternalLink key={link.label} href={link.href} label={link.label}><span><strong>{link.label}</strong><small>{link.detail}</small></span></ExternalLink>)}<p>Independent ecosystem support by RMT. No affiliation or endorsement implied.</p></section> : null}
      </div>
    </section> : <section id={`${idPrefix}-planner-panel`} className="rmtDistributionPlannerWorkspace" role="tabpanel" aria-labelledby={`${idPrefix}-planner-tab`}>
      <header className="rmtDistributionHeading"><div><h2>Deterministic planner</h2><p>Plan deterministic, auditable value distribution without creating an executable manifest.</p></div></header>
      <div className="rmtDistributionStatus" role="status"><span><strong>PLANNING ONLY</strong> · {DISTRIBUTION_PLANNER_MODE}</span><span>Wallet submission <strong>DISABLED</strong></span><span>Server submission <strong>DISABLED</strong></span><span>UTILITY RATE <strong>{DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL}</strong></span><span>Manifest: <strong>NOT AVAILABLE</strong></span><span>BATCH/GAS EVIDENCE: <strong>NOT YET ADMITTED</strong></span></div>
      <form className="rmtDistributionControls" onSubmit={(event) => event.preventDefault()}>
        <div className="rmtDistributionFieldRow"><label htmlFor={`${idPrefix}-kind`}>Distribution kind</label><div id={`${idPrefix}-kind`}>{ACTION_OPTIONS.map((option) => <button key={option.value} type="button" className={actionKind === option.value ? "isActive" : ""} onClick={() => onActionKindChange(option.value)}>{option.label}</button>)}</div></div>
        <label className="rmtDistributionField" htmlFor={`${idPrefix}-asset-address`}><span>Token contract</span><input id={`${idPrefix}-asset-address`} value={assetAddress} onChange={(event) => setAssetAddress(event.target.value)} inputMode="text" autoComplete="off" spellCheck={false} required /></label>
        <label className={`rmtDistributionField rmtDistributionFieldCompact${isErc20 ? "" : " isDisabled"}`} htmlFor={`${idPrefix}-token-decimals`}><span>Token decimals</span><input id={`${idPrefix}-token-decimals`} value={assetDecimals} onChange={(event) => setAssetDecimals(event.target.value)} inputMode="numeric" autoComplete="off" spellCheck={false} disabled={!isErc20} aria-disabled={!isErc20} /></label>
        <label className={`rmtDistributionField rmtDistributionFieldCompact${actionKind === "erc20_equal" ? "" : " isDisabled"}`} htmlFor={`${idPrefix}-equal-amount`}><span>Equal amount</span><input id={`${idPrefix}-equal-amount`} value={equalAmount} onChange={(event) => setEqualAmount(event.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} disabled={actionKind !== "erc20_equal"} aria-disabled={actionKind !== "erc20_equal"} /></label>
        <label className="rmtDistributionField" htmlFor={`${idPrefix}-sender-address`}><span>Planner sender</span><input id={`${idPrefix}-sender-address`} value={senderAddress} onChange={(event) => setSenderAddress(event.target.value)} inputMode="text" autoComplete="off" spellCheck={false} required /></label>
        <label className="rmtDistributionField" htmlFor={`${idPrefix}-csv`}><span>Recipient CSV</span><textarea id={`${idPrefix}-csv`} value={csv} onChange={(event) => { setUploadError(""); setCsv(event.target.value); }} spellCheck={false} rows={presentation === "mobile" ? 8 : 14} /></label>
        <div className="rmtDistributionUploadBar"><label className="rmtDistributionUpload"><input type="file" accept=".csv,text/csv" onChange={onUploadCsv} />Upload CSV</label><button type="button" onClick={() => setCsv(csvTemplateForKind(actionKind))}>Clear CSV</button></div><button type="button" className="rmtDistributionSubmit" onClick={onResetDefaults}>Reset planner</button>
      </form>
      <div className={`rmtDistributionStateBanner${preview.status === "error" ? " isError" : ""}`}><strong>{preview.status === "ready" ? "Planning output ready" : "Planning input check"}</strong><span>{preview.status === "ready" ? `${preview.totalRows} rows · ${preview.validRows} valid · ${preview.invalidRows} invalid` : preview.message}</span>{uploadError ? <small>{uploadError}</small> : null}</div>
      <div className="rmtDistributionEvidenceStack">{preview.status === "ready" ? <><section className="rmtDistributionCards" aria-label="Planning evidence"><article><h3>Manifest snapshot</h3><dl><div><dt>Manifest</dt><dd>NOT AVAILABLE</dd></div><div><dt>Asset</dt><dd>{preview.assetAddress}</dd></div><div><dt>Rows</dt><dd>{summary?.rows}</dd></div><div><dt>Batches</dt><dd>NOT YET ADMITTED</dd></div></dl></article><article><h3>Estimated totals</h3><dl><div><dt>Total amount (atomic)</dt><dd>{preview.estimatedAssetAmountAtomic}</dd></div><div><dt>Utility retirement (atomic)</dt><dd>NOT YET ADMITTED</dd></div><div><dt>Gas evidence</dt><dd>NOT YET ADMITTED</dd></div></dl></article><article><h3>Readiness gate</h3><dl><div><dt>Wallet submission</dt><dd className="rmtReadinessFail">disabled</dd></div><div><dt>Server submission</dt><dd className="rmtReadinessFail">disabled</dd></div><div><dt>Approval workflow</dt><dd>preview only</dd></div></dl><button type="button" className="rmtDistributionSubmit" disabled>Submission disabled</button></article></section><section aria-labelledby={`${idPrefix}-preview-rows`} className="rmtDistributionPreview"><h3 id={`${idPrefix}-preview-rows`}>Recipient preview (first {rowsToPreview.length})</h3><ul>{rowsToPreview.map((entry, index) => <li key={`${entry.recipient}-${index}`}><span>{index + 1}</span><strong>{entry.recipient}</strong><small>{formatDistributionPreviewAmount(actionKind, preview.decimals, entry)}</small></li>)}</ul></section><section aria-labelledby={`${idPrefix}-batches`} className="rmtDistributionPreview"><h3 id={`${idPrefix}-batches`}>Batches</h3><p>Canonical execution batches are not yet admitted.</p></section></> : <section className="rmtDistributionEmptyEvidence" aria-label="Planning evidence status"><strong>Evidence awaits valid planner input</strong><p>Complete the planner inputs for a deterministic preview and readiness boundary.</p></section>}<section className="rmtDistributionFooter"><strong>Execution boundary</strong><p>All actions above are intentionally read-only planning. A send/confirm flow is not implemented, and cannot execute from this screen.</p><p>Utility policy, wallet submission, server submission, canary transactions, and deployment remain unapproved and unavailable in this view.</p></section></div>
    </section>}
  </section>;
}
