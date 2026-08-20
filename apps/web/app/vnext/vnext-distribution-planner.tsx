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

const ACTION_OPTIONS: { value: DistributionPlannerActionKind; label: string }[] = [
  { value: "erc20_equal", label: "ERC-20 Equal" },
  { value: "erc20_custom", label: "ERC-20 Custom" },
  { value: "erc721", label: "ERC-721" },
  { value: "erc1155", label: "ERC-1155" }
];

function csvTemplateForKind(actionKind: DistributionPlannerActionKind) {
  if (actionKind === "erc20_equal") return "recipient\\n";
  if (actionKind === "erc20_custom") return "recipient,amount\\n";
  if (actionKind === "erc721") return "recipient,tokenId\\n";
  return "recipient,tokenId,amount\\n";
}

export function VNextDistributionPlanner() {
  const [actionKind, setActionKind] = useState<DistributionPlannerActionKind>("erc20_equal");
  const [assetAddress, setAssetAddress] = useState<string>("");
  const [assetDecimals, setAssetDecimals] = useState(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
  const [senderAddress, setSenderAddress] = useState<string>("");
  const [equalAmount, setEqualAmount] = useState("1");
  const [csv, setCsv] = useState(csvTemplateForKind("erc20_equal"));
  const [uploadError, setUploadError] = useState("");

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

  return <section className="rmtDistributionPanel" aria-labelledby="rmt-distribution-planner-heading" aria-live="polite">
    <header className="rmtDistributionHeading">
      <div>
        <h2 id="rmt-distribution-planner-heading">Deterministic planner</h2>
        <p>Plan deterministic, auditable value distribution without creating an executable manifest.</p>
      </div>
    </header>

    <div className="rmtDistributionStatus" role="status">
      <span><strong>PLANNING ONLY</strong> · {DISTRIBUTION_PLANNER_MODE}</span>
      <span><strong>NO WALLET SUBMISSION</strong></span>
      <span><strong>NO SERVER SUBMISSION</strong></span>
      <span>UTILITY RATE <strong>{DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL}</strong></span>
      <span>Manifest: <strong>NOT AVAILABLE</strong></span>
      <span>BATCH/GAS EVIDENCE: <strong>NOT YET ADMITTED</strong></span>
    </div>

    <section className="rmtDistributionSource" aria-labelledby="distribution-source-ccff00">
      <div>
        <span>Supported ecosystem source</span>
        <h3 id="distribution-source-ccff00">Genesis Community / CCFF00</h3>
      </div>
      <p>Optional read-only recipient evidence for the first identity + settlement proof. CCFF00 is never required to use RMT.</p>
      <p><strong>Independent ecosystem support by RMT. No affiliation or endorsement implied.</strong></p>
      <small>Fresh full-public snapshot, canary receipt/control proofs, reconciliation, a small batch, and separate engine deployment/activation authorization remain mandatory before any future execution.</small>
    </section>

    <form className="rmtDistributionControls" onSubmit={(event) => event.preventDefault()}>
      <div className="rmtDistributionFieldRow">
        <label htmlFor="distribution-kind">Distribution kind</label>
        <div>
          {ACTION_OPTIONS.map((option) => <button
            key={option.value}
            type="button"
            className={actionKind === option.value ? "isActive" : ""}
            onClick={() => onActionKindChange(option.value)}
          >{option.label}</button>)}
        </div>
      </div>
      <label className="rmtDistributionField" htmlFor="distribution-asset-address">
        <span>Token contract</span>
        <input id="distribution-asset-address" value={assetAddress} onChange={(event: ChangeEvent<HTMLInputElement>) => setAssetAddress(event.target.value)} inputMode="text" autoComplete="off" spellCheck={false} required />
      </label>
      <label className={`rmtDistributionField${isErc20 ? "" : " isDisabled"}`} htmlFor="distribution-token-decimals">
        <span>Token decimals</span>
        <input
          id="distribution-token-decimals"
          value={assetDecimals}
          onChange={(event) => setAssetDecimals(event.target.value)}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={!isErc20}
          aria-disabled={!isErc20}
        />
      </label>
      <label className={`rmtDistributionField${actionKind === "erc20_equal" ? "" : " isDisabled"}`} htmlFor="distribution-equal-amount">
        <span>Equal amount</span>
        <input
          id="distribution-equal-amount"
          value={equalAmount}
          onChange={(event) => setEqualAmount(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={actionKind !== "erc20_equal"}
          aria-disabled={actionKind !== "erc20_equal"}
        />
      </label>
      <label className="rmtDistributionField" htmlFor="distribution-sender-address">
        <span>Planner sender</span>
        <input id="distribution-sender-address" value={senderAddress} onChange={(event: ChangeEvent<HTMLInputElement>) => setSenderAddress(event.target.value)} inputMode="text" autoComplete="off" spellCheck={false} required />
      </label>
      <label className="rmtDistributionField" htmlFor="distribution-csv">
        <span>Recipient CSV</span>
        <textarea id="distribution-csv" value={csv} onChange={onPasteCsv} spellCheck={false} rows={14} />
      </label>
      <div className="rmtDistributionUploadBar">
        <label className="rmtDistributionUpload"><input type="file" accept=".csv,text/csv" onChange={onUploadCsv} />Upload CSV</label>
        <button type="button" onClick={clearCsv}>Clear CSV</button>
      </div>
      <button type="button" className="rmtDistributionSubmit" onClick={onResetDefaults}>Reset planner</button>
    </form>

    <div className={`rmtDistributionStateBanner${preview.status === "error" ? " isError" : ""}`}>
        <strong>{preview.status === "ready" ? "Planning output ready" : "Planning input check"}</strong>
        <span>
          {preview.status === "ready"
          ? `${preview.totalRows} rows · ${preview.validRows} valid · ${preview.invalidRows} invalid`
          : preview.message}
        </span>
      {uploadError ? <small>{uploadError}</small> : null}
    </div>

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

      <section aria-labelledby="distribution-preview-rows" className="rmtDistributionPreview">
        <h3 id="distribution-preview-rows">Recipient preview (first {rowsToPreview.length})</h3>
        <ul>
          {rowsToPreview.map((entry, index) => <li key={`${entry.recipient}-${index}`}>
            <span>{index + 1}</span>
            <strong>{entry.recipient}</strong>
            <small>{formatDistributionPreviewAmount(actionKind, preview.decimals, entry)}</small>
          </li>)}
        </ul>
      </section>

      <section aria-labelledby="distribution-batches" className="rmtDistributionPreview">
        <h3 id="distribution-batches">Batches</h3>
        <p>Canonical execution batches are not yet admitted.</p>
      </section>
    </> : null}

    <section className="rmtDistributionFooter">
      <strong>Execution boundary</strong>
      <p>All actions above are intentionally read-only planning. A send/confirm flow is not implemented, and cannot execute from this screen.</p>
      <p>Utility policy, wallet submission, server submission, canary transactions, and deployment remain unapproved and unavailable in this view.</p>
    </section>
  </section>;
}
