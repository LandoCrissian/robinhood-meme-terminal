"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import {
  DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS,
  DISTRIBUTION_PLANNER_MODE,
  DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL,
  type DistributionPlannerActionKind,
  buildDistributionPlannerPreview,
  formatDistributionPreviewAmount,
  summarizePlannerReadyState
} from "../../lib/vnext/distribution-planner";
import {
  CCFF00_OFFICIAL_LINKS,
  CCFF00_PRESENTATION_EVIDENCE
} from "../../lib/vnext/distribution-ccff00-presentation";

const ACTION_OPTIONS: { value: DistributionPlannerActionKind; label: string }[] = [
  { value: "erc20_equal", label: "ERC-20 Equal" },
  { value: "erc20_custom", label: "ERC-20 Custom" },
  { value: "erc721", label: "ERC-721" },
  { value: "erc1155", label: "ERC-1155" }
];

const CCFF00_EXTERNAL_LINKS = [
  { label: "Explore CCFF00", href: CCFF00_OFFICIAL_LINKS.ccff00 },
  { label: "HoodStreet", href: CCFF00_OFFICIAL_LINKS.hoodstreet },
  { label: "My Neon", href: CCFF00_OFFICIAL_LINKS.myNeon },
  { label: "OpenSea", href: CCFF00_OFFICIAL_LINKS.openSea },
  { label: "CCFF00 on X", href: CCFF00_OFFICIAL_LINKS.ccff00X },
  { label: "HoodStreet on X", href: CCFF00_OFFICIAL_LINKS.hoodstreetX }
] as const;

const MOBILE_SECTIONS = [
  { value: "community", label: "Genesis" },
  { value: "planner", label: "Planner" },
  { value: "evidence", label: "Evidence" }
] as const;

type DistributionPresentation = "desktop" | "mobile";
type MobileDistributionSection = (typeof MOBILE_SECTIONS)[number]["value"];

function csvTemplateForKind(actionKind: DistributionPlannerActionKind) {
  if (actionKind === "erc20_equal") return "recipient\\n";
  if (actionKind === "erc20_custom") return "recipient,amount\\n";
  if (actionKind === "erc721") return "recipient,tokenId\\n";
  return "recipient,tokenId,amount\\n";
}

export function VNextDistributionPlanner({ presentation = "desktop" }: { presentation?: DistributionPresentation }) {
  const [actionKind, setActionKind] = useState<DistributionPlannerActionKind>("erc20_equal");
  const [assetAddress, setAssetAddress] = useState<string>("");
  const [assetDecimals, setAssetDecimals] = useState(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
  const [senderAddress, setSenderAddress] = useState<string>("");
  const [equalAmount, setEqualAmount] = useState("1");
  const [csv, setCsv] = useState(csvTemplateForKind("erc20_equal"));
  const [uploadError, setUploadError] = useState("");
  const [mobileSection, setMobileSection] = useState<MobileDistributionSection>("community");
  const idPrefix = presentation === "mobile" ? "rmt-mobile-distribution" : "rmt-desktop-distribution";

  const preview = useMemo(() => buildDistributionPlannerPreview({
    actionKind,
    assetAddress,
    assetDecimals,
    equalAmount,
    csv,
    senderAddress
  }), [actionKind, assetAddress, assetDecimals, equalAmount, csv, senderAddress]);

  const isErc20 = actionKind === "erc20_equal" || actionKind === "erc20_custom";

  const summary = preview.status === "ready" ? summarizePlannerReadyState(preview) : null;

  const rowsToPreview = preview.status === "ready" ? preview.rowsPreview : [];

  const onPasteCsv = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setUploadError("");
    setCsv(event.target.value);
  };

  const onUploadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setCsv(content);
      setUploadError("");
    } catch {
      setUploadError("Failed to read CSV upload.");
    }
    event.currentTarget.value = "";
  };

  const clearCsv = () => setCsv(csvTemplateForKind(actionKind));

  const onActionKindChange = (next: DistributionPlannerActionKind) => {
    setActionKind(next);
    setUploadError("");
    setCsv(csvTemplateForKind(next));
    if (next === "erc20_equal" || next === "erc20_custom") {
      setAssetDecimals(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
      return;
    }
    setAssetDecimals("");
  };

  const onResetDefaults = () => {
    setActionKind("erc20_equal");
    setAssetAddress("");
    setAssetDecimals(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
    setSenderAddress("");
    setEqualAmount("1");
    setCsv(csvTemplateForKind("erc20_equal"));
    setUploadError("");
  };

  return <section
    className="rmtDistributionPanel"
    aria-labelledby={`${idPrefix}-planner-heading`}
    aria-live="polite"
    data-presentation={presentation}
    data-mobile-section={mobileSection}
  >
    <header className="rmtDistributionHeading">
      <div>
        <h2 id={`${idPrefix}-planner-heading`}>Deterministic planner</h2>
        <p>Plan deterministic, auditable value distribution without creating an executable manifest.</p>
      </div>
    </header>

    {presentation === "mobile" ? <nav className="rmtDistributionMobileTabs" aria-label="Distribution workspace sections">
      {MOBILE_SECTIONS.map((section) => <button
        key={section.value}
        type="button"
        aria-pressed={mobileSection === section.value}
        className={mobileSection === section.value ? "isActive" : ""}
        onClick={(event) => {
          setMobileSection(section.value);
          event.currentTarget.closest(".rmtDistributionPanel")?.scrollIntoView({ block: "start" });
        }}
      >{section.label}{section.value === "evidence" ? <span>{preview.status === "ready" ? "READY" : "CHECK"}</span> : null}</button>)}
    </nav> : null}

    <div
      className="rmtDistributionStatus rmtDistributionEvidenceOnly"
      role="status"
    >
      <span><strong>PLANNING ONLY</strong> · {DISTRIBUTION_PLANNER_MODE}</span>
      <span><strong>NO WALLET SUBMISSION</strong></span>
      <span><strong>NO SERVER SUBMISSION</strong></span>
      <span>UTILITY RATE <strong>{DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL}</strong></span>
      <span>Manifest: <strong>NOT AVAILABLE</strong></span>
      <span>BATCH/GAS EVIDENCE: <strong>NOT YET ADMITTED</strong></span>
    </div>

    <section
      className="rmtCcff00Genesis rmtDistributionCommunityOnly"
      aria-labelledby={`${idPrefix}-source-ccff00`}
    >
      <header className="rmtCcff00GenesisHeader">
        <div>
          <span className="rmtCcff00Eyebrow">Supported ecosystem · read-only</span>
          <h3 id={`${idPrefix}-source-ccff00`}><strong>CCFF00</strong><span>Genesis Community</span></h3>
        </div>
        <span className="rmtCcff00ProofState">{CCFF00_PRESENTATION_EVIDENCE.status}</span>
      </header>

      <div className="rmtCcff00Story">
        <p>CCFF00 is HoodStreet&apos;s founding membership collection on Robinhood Chain. Each CCFF00 Square has a deterministic ERC-6551 token-bound account—an onchain wallet and identity attached to the NFT.</p>
        <p>RMT is using CCFF00 as the first supported community to prove deterministic recipient discovery, token-bound identity, auditable distribution planning, and owner-controlled settlement.</p>
        <p className="rmtCcff00Disclosure">Independent ecosystem support by RMT. No affiliation or endorsement implied.</p>
      </div>

      <div className="rmtCcff00Metrics" aria-label="Latest CCFF00 read-only evidence">
        <article><span>Public identities discovered</span><strong>{CCFF00_PRESENTATION_EVIDENCE.publicMinted}</strong></article>
        <article><span>Token-bound identities</span><strong>{CCFF00_PRESENTATION_EVIDENCE.tokenBoundIdentitiesDiscovered}</strong></article>
        <article><span>CCFF00 per Square</span><strong>{CCFF00_PRESENTATION_EVIDENCE.ccff00PerSquare}</strong></article>
        <article><span>Canary TBAs verified</span><strong>{CCFF00_PRESENTATION_EVIDENCE.canaries.verified} / {CCFF00_PRESENTATION_EVIDENCE.canaries.total}</strong></article>
        <article><span>Canary activation</span><strong>{CCFF00_PRESENTATION_EVIDENCE.canaries.activated} / {CCFF00_PRESENTATION_EVIDENCE.canaries.total}</strong></article>
        <article><span>Canary RMT deposits</span><strong>{CCFF00_PRESENTATION_EVIDENCE.canaries.rmtDeposited} / {CCFF00_PRESENTATION_EVIDENCE.canaries.total}</strong></article>
      </div>

      <div className="rmtCcff00EvidenceMeta">
        <span>Latest RMT evidence · block {Number(CCFF00_PRESENTATION_EVIDENCE.snapshotBlock).toLocaleString("en-US")}</span>
        <span>Supply at snapshot · {CCFF00_PRESENTATION_EVIDENCE.publicMinted} public + {CCFF00_PRESENTATION_EVIDENCE.reserveMinted} reserve = {CCFF00_PRESENTATION_EVIDENCE.totalSupply} total</span>
      </div>

      <details className="rmtCcff00Education">
        <summary>Why token-bound accounts? <span>Your NFT is the wallet</span></summary>
        <p>The NFT has its own deterministic account address, and that account can hold supported assets. Under the current CCFF00 implementation, the NFT&apos;s current owner controls the account. If ownership changes, the account address and its assets remain in place while control follows the NFT&apos;s current owner.</p>
      </details>

      <nav className="rmtCcff00Links" aria-label="Official CCFF00 and HoodStreet links">
        {CCFF00_EXTERNAL_LINKS.map((link) => <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${link.label} (opens in a new tab)`}
        >{link.label}<span aria-hidden="true">↗</span></a>)}
      </nav>

      <div className="rmtCcff00Safety" aria-label="CCFF00 execution safety status">
        <span>Planning / read-only <strong>ACTIVE</strong></span>
        <span>Wallet submission <strong>DISABLED</strong></span>
        <span>Server submission <strong>DISABLED</strong></span>
        <span>Mass distribution <strong>NOT AUTHORIZED</strong></span>
        <span>Canary proof <strong>IN PROGRESS</strong></span>
      </div>

      <small className="rmtCcff00ReleaseBoundary">Fresh full-public evidence, canary receipt/control proofs, reconciliation, a small batch, and separate engine deployment/activation authorization remain mandatory before any future execution. CCFF00 is never required to use RMT.</small>
    </section>

    <form
      className="rmtDistributionControls rmtDistributionPlannerOnly"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="rmtDistributionFieldRow">
        <label htmlFor={`${idPrefix}-kind`}>Distribution kind</label>
        <div id={`${idPrefix}-kind`}>
          {ACTION_OPTIONS.map((option) => <button
            key={option.value}
            type="button"
            className={actionKind === option.value ? "isActive" : ""}
            onClick={() => onActionKindChange(option.value)}
          >{option.label}</button>)}
        </div>
      </div>
      <label className="rmtDistributionField" htmlFor={`${idPrefix}-asset-address`}>
        <span>Token contract</span>
        <input id={`${idPrefix}-asset-address`} value={assetAddress} onChange={(event: ChangeEvent<HTMLInputElement>) => setAssetAddress(event.target.value)} inputMode="text" autoComplete="off" spellCheck={false} required />
      </label>
      <label className={`rmtDistributionField rmtDistributionFieldCompact${isErc20 ? "" : " isDisabled"}`} htmlFor={`${idPrefix}-token-decimals`}>
        <span>Token decimals</span>
        <input
          id={`${idPrefix}-token-decimals`}
          value={assetDecimals}
          onChange={(event) => setAssetDecimals(event.target.value)}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={!isErc20}
          aria-disabled={!isErc20}
        />
      </label>
      <label className={`rmtDistributionField rmtDistributionFieldCompact${actionKind === "erc20_equal" ? "" : " isDisabled"}`} htmlFor={`${idPrefix}-equal-amount`}>
        <span>Equal amount</span>
        <input
          id={`${idPrefix}-equal-amount`}
          value={equalAmount}
          onChange={(event) => setEqualAmount(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={actionKind !== "erc20_equal"}
          aria-disabled={actionKind !== "erc20_equal"}
        />
      </label>
      <label className="rmtDistributionField" htmlFor={`${idPrefix}-sender-address`}>
        <span>Planner sender</span>
        <input id={`${idPrefix}-sender-address`} value={senderAddress} onChange={(event: ChangeEvent<HTMLInputElement>) => setSenderAddress(event.target.value)} inputMode="text" autoComplete="off" spellCheck={false} required />
      </label>
      <label className="rmtDistributionField" htmlFor={`${idPrefix}-csv`}>
        <span>Recipient CSV</span>
        <textarea id={`${idPrefix}-csv`} value={csv} onChange={onPasteCsv} spellCheck={false} rows={presentation === "mobile" ? 8 : 14} />
      </label>
      <div className="rmtDistributionUploadBar">
        <label className="rmtDistributionUpload"><input type="file" accept=".csv,text/csv" onChange={onUploadCsv} />Upload CSV</label>
        <button type="button" onClick={clearCsv}>Clear CSV</button>
      </div>
      <button type="button" className="rmtDistributionSubmit" onClick={onResetDefaults}>Reset planner</button>
    </form>

    <div className={`rmtDistributionStateBanner rmtDistributionPlannerEvidence${preview.status === "error" ? " isError" : ""}`}>
        <strong>{preview.status === "ready" ? "Planning output ready" : "Planning input check"}</strong>
        <span>
          {preview.status === "ready"
          ? `${preview.totalRows} rows · ${preview.validRows} valid · ${preview.invalidRows} invalid`
          : preview.message}
        </span>
      {uploadError ? <small>{uploadError}</small> : null}
    </div>

    <div className="rmtDistributionEvidenceOnly rmtDistributionEvidenceStack">
    {preview.status === "ready" ? <>
      <section className="rmtDistributionCards" aria-label="Planning evidence">
        <article>
          <h3>Manifest snapshot</h3>
          <dl>
            <div><dt>Manifest</dt><dd>NOT AVAILABLE</dd></div>
            <div><dt>Asset</dt><dd>{preview.assetAddress}</dd></div>
            <div><dt>Rows</dt><dd>{summary?.rows}</dd></div>
            <div><dt>Batches</dt><dd>NOT YET ADMITTED</dd></div>
          </dl>
        </article>
        <article>
          <h3>Estimated totals</h3>
          <dl>
            <div><dt>Total amount (atomic)</dt><dd>{preview.estimatedAssetAmountAtomic}</dd></div>
            <div><dt>Utility retirement (atomic)</dt><dd>NOT YET ADMITTED</dd></div>
            <div><dt>Gas evidence</dt><dd>NOT YET ADMITTED</dd></div>
          </dl>
        </article>
        <article>
          <h3>Readiness gate</h3>
          <dl>
            <div><dt>Wallet submission</dt><dd className="rmtReadinessFail">disabled</dd></div>
            <div><dt>Server submission</dt><dd className="rmtReadinessFail">disabled</dd></div>
            <div><dt>Approval workflow</dt><dd>preview only</dd></div>
          </dl>
          <button type="button" className="rmtDistributionSubmit" disabled>Submission disabled</button>
        </article>
      </section>

      <section aria-labelledby={`${idPrefix}-preview-rows`} className="rmtDistributionPreview">
        <h3 id={`${idPrefix}-preview-rows`}>Recipient preview (first {rowsToPreview.length})</h3>
        <ul>
          {rowsToPreview.map((entry, index) => <li key={`${entry.recipient}-${index}`}>
            <span>{index + 1}</span>
            <strong>{entry.recipient}</strong>
            <small>{formatDistributionPreviewAmount(actionKind, preview.decimals, entry)}</small>
          </li>)}
        </ul>
      </section>

      <section aria-labelledby={`${idPrefix}-batches`} className="rmtDistributionPreview">
        <h3 id={`${idPrefix}-batches`}>Batches</h3>
        <p>Canonical execution batches are not yet admitted.</p>
      </section>
    </> : <section className="rmtDistributionEmptyEvidence" aria-label="Planning evidence status">
      <strong>Evidence awaits valid planner input</strong>
      <p>Complete the Planner section, then return here for the deterministic preview and readiness boundary.</p>
    </section>}

    <section className="rmtDistributionFooter">
      <strong>Execution boundary</strong>
      <p>All actions above are intentionally read-only planning. A send/confirm flow is not implemented, and cannot execute from this screen.</p>
      <p>Utility policy, wallet submission, server submission, canary transactions, and deployment remain unapproved and unavailable in this view.</p>
    </section>
    </div>
  </section>;
}
