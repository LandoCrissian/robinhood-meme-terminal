 "use client";

import { useMemo, useState, type ChangeEvent } from "react";
import {
  DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS,
  DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL,
  DISTRIBUTION_PLANNER_MODE,
  type DistributionPlannerActionKind,
  buildDistributionPlannerPreview,
  formatDistributionPreviewAmount,
  summarizePlannerReadyState
} from "../../lib/vnext/distribution-planner";
import { atomicToDecimal } from "../../lib/vnext/distribution-domain";
import { CCFF00_RMT_TOKEN } from "../../lib/vnext/distribution-ccff00";
import ccff00HistoricalAudit from "../../lib/vnext/fixtures/ccff00-public-audit-37451763.json";

const ACTION_OPTIONS: { value: DistributionPlannerActionKind; label: string }[] = [
  { value: "erc20_equal", label: "ERC-20 Equal" },
  { value: "erc20_custom", label: "ERC-20 Custom" },
  { value: "erc721", label: "ERC-721" },
  { value: "erc1155", label: "ERC-1155" }
];

type Ccff00HistoricRow = {
  tokenId: string;
  owner: string;
  tokenBoundAccount: string;
  activated: boolean;
  ccff00BalanceAtomic: string;
  rmtBalanceAtomic: string;
};

type Ccff00HistoricFixture = {
  status: string;
  manifestEligible: boolean;
  publicMinted: string;
  reserveMinted: string;
  canaries: Ccff00HistoricRow[];
  snapshotBlock?: string;
};

type Ccff00DistributionPreset = {
  id: string;
  name: string;
  sourceLabel: string;
  sourceStatus: string;
  sourceBlock?: string;
  eligibleRecipients: number;
  excludedRecipients: number;
  rows: readonly Ccff00HistoricRow[];
  csvTemplate: string;
};

const CCFF00_PRESET_SOURCE = ccff00HistoricalAudit as Ccff00HistoricFixture;

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const CCFF00_PRESET_ROWS = Array.isArray(CCFF00_PRESET_SOURCE.canaries)
  ? CCFF00_PRESET_SOURCE.canaries
  : [];

const HOODSTREET_CCFF00_PRESET: Ccff00DistributionPreset = {
  id: "hoodstreet-ccff00",
  name: "HoodStreet CCFF00",
  sourceLabel: "ccff00-public-audit-37451763.json",
  sourceStatus: CCFF00_PRESET_SOURCE.status,
  sourceBlock: CCFF00_PRESET_SOURCE.snapshotBlock,
  eligibleRecipients: CCFF00_PRESET_ROWS.length,
  excludedRecipients: parseInteger(CCFF00_PRESET_SOURCE.reserveMinted ?? "0"),
  rows: CCFF00_PRESET_ROWS,
  csvTemplate: `recipient\n${CCFF00_PRESET_ROWS.map((row) => row.tokenBoundAccount).join("\n")}\n`
};

const PRESET_OPTIONS = [
  { id: "manual", label: "Manual" },
  { id: HOODSTREET_CCFF00_PRESET.id, label: HOODSTREET_CCFF00_PRESET.name }
] as const;

type PresetId = (typeof PRESET_OPTIONS)[number]["id"];

function csvTemplateForKind(actionKind: DistributionPlannerActionKind) {
  if (actionKind === "erc20_equal") return "recipient\n";
  if (actionKind === "erc20_custom") return "recipient,amount\n";
  if (actionKind === "erc721") return "recipient,tokenId\n";
  return "recipient,tokenId,amount\n";
}

function formatAtomicToDecimal(atomic: string, decimals: number | null) {
  if (decimals === null) return atomic;
  return atomicToDecimal(atomic, decimals);
}

export function VNextDistributionPlanner() {
  const [presetId, setPresetId] = useState<PresetId>("manual");
  const [actionKind, setActionKind] = useState<DistributionPlannerActionKind>("erc20_equal");
  const [assetAddress, setAssetAddress] = useState<string>("");
  const [assetDecimals, setAssetDecimals] = useState(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
  const [senderAddress, setSenderAddress] = useState<string>("");
  const [equalAmount, setEqualAmount] = useState("1");
  const [csv, setCsv] = useState(csvTemplateForKind("erc20_equal"));
  const [uploadError, setUploadError] = useState("");

  const activePreset = presetId === "hoodstreet-ccff00" ? HOODSTREET_CCFF00_PRESET : null;
  const isPresetMode = activePreset !== null;

  const preview = useMemo(() => buildDistributionPlannerPreview({
    actionKind,
    assetAddress,
    assetDecimals,
    equalAmount,
    csv,
    senderAddress
  }), [actionKind, assetAddress, assetDecimals, equalAmount, csv, senderAddress]);

  const isErc20 = actionKind === "erc20_equal" || actionKind === "erc20_custom";
  const isReady = preview.status === "ready";
  const summary = isReady ? summarizePlannerReadyState(preview) : null;
  const rowsToPreview = isReady ? preview.rowsPreview : [];

  const setManualMode = () => {
    if (presetId !== "manual") setPresetId("manual");
  };

  const onPresetChange = (nextPresetId: PresetId) => {
    setUploadError("");
    if (nextPresetId === "manual") {
      setPresetId("manual");
      setActionKind("erc20_equal");
      setAssetAddress("");
      setAssetDecimals(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
      setSenderAddress("");
      setEqualAmount("1");
      setCsv(csvTemplateForKind("erc20_equal"));
      return;
    }
    setPresetId(nextPresetId);
    setActionKind("erc20_equal");
    setAssetAddress(CCFF00_RMT_TOKEN);
    setAssetDecimals(String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS));
    setSenderAddress("");
    setEqualAmount("1");
    setCsv(HOODSTREET_CCFF00_PRESET.csvTemplate);
  };

  const onPasteCsv = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setManualMode();
    setUploadError("");
    setCsv(event.target.value);
  };

  const onUploadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setManualMode();
    try {
      const content = await file.text();
      setCsv(content);
      setUploadError("");
    } catch {
      setUploadError("Failed to read CSV upload.");
    }
    event.currentTarget.value = "";
  };

  const clearCsv = () => {
    setManualMode();
    setCsv(csvTemplateForKind(actionKind));
  };

  const onActionKindChange = (next: DistributionPlannerActionKind) => {
    setManualMode();
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
    onPresetChange("manual");
  };

  const onDownloadPlannedCsv = () => {
    if (!isReady) return;
    const fileBlob = new Blob([preview.canonicalCsv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(fileBlob);
    link.href = objectUrl;
    link.download = "distribution-planner-preview.csv";
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  const presetSnapshotEvidence = activePreset
    ? `${activePreset.sourceLabel} · ${activePreset.sourceStatus}`
    : "manual input";

  const plannedDecimals = isReady ? preview.decimals : null;
  const estimatedAsset = summary && plannedDecimals !== null
    ? formatAtomicToDecimal(summary.assetTotal, plannedDecimals)
    : summary?.assetTotal ?? "0";

  const estimatedPerRecipient = actionKind === "erc20_equal"
    ? equalAmount
    : actionKind === "erc20_custom"
      ? "custom per row"
      : "not atomic";

  return <section className="rmtDistributionPanel" aria-labelledby="rmt-distribution-planner-heading" aria-live="polite">
    <header className="rmtDistributionHeading">
      <div>
        <h2 id="rmt-distribution-planner-heading">Distribution Studio (planning)</h2>
        <p>Build a deterministic manifest-only preview before wallet submission can ever happen.</p>
      </div>
    </header>

    <div className="rmtDistributionStatus" role="status">
      <span>Mode: <strong>{DISTRIBUTION_PLANNER_MODE}</strong></span>
      <span>RMT Utility Rate: <strong>{DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL}</strong></span>
      <span>Manifest: <strong>NOT AVAILABLE</strong></span>
      <span>BATCH/GAS EVIDENCE: <strong>NOT YET ADMITTED</strong></span>
    </div>

    <form className="rmtDistributionControls" onSubmit={(event) => event.preventDefault()}>
      <label className="rmtDistributionField">
        <span>Planning preset</span>
        <div>
          {PRESET_OPTIONS.map((option) => <button
            key={option.id}
            type="button"
            className={presetId === option.id ? "isActive" : ""}
            onClick={() => onPresetChange(option.id)}
          >{option.label}</button>)}
        </div>
      </label>

      <div className="rmtDistributionField">
        <span>Source/evidence</span>
        <p>{presetSnapshotEvidence}</p>
        {isPresetMode ? <small>Rows loaded from read-only fixture evidence; submission remains disabled.</small> : null}
      </div>

      <div className="rmtDistributionField">
        <span>Active distribution mode</span>
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
        <input
          id="distribution-asset-address"
          value={assetAddress}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setManualMode();
            setAssetAddress(event.target.value);
          }}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <label className={`rmtDistributionField${isErc20 ? "" : " isDisabled"}`} htmlFor="distribution-token-decimals">
        <span>Token decimals</span>
        <input
          id="distribution-token-decimals"
          value={assetDecimals}
          onChange={(event) => {
            setManualMode();
            setAssetDecimals(event.target.value);
          }}
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
          onChange={(event) => {
            if (isPresetMode) {
              setPresetId("manual");
            }
            setEqualAmount(event.target.value);
          }}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={actionKind !== "erc20_equal"}
          aria-disabled={actionKind !== "erc20_equal"}
        />
      </label>
      <label className="rmtDistributionField" htmlFor="distribution-sender-address">
        <span>Planner sender</span>
        <input
          id="distribution-sender-address"
          value={senderAddress}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setManualMode();
            setSenderAddress(event.target.value);
          }}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <label className="rmtDistributionField" htmlFor="distribution-csv">
        <span>Recipient CSV</span>
        <textarea
          id="distribution-csv"
          value={csv}
          onChange={onPasteCsv}
          spellCheck={false}
          rows={14}
        />
      </label>
      <div className="rmtDistributionUploadBar">
        <label className="rmtDistributionUpload"><input type="file" accept=".csv,text/csv" onChange={onUploadCsv} />Upload CSV</label>
        <button type="button" onClick={clearCsv}>Clear CSV</button>
        <button type="button" onClick={onDownloadPlannedCsv} disabled={!isReady}>Download Planned CSV</button>
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
          <h3>Source evidence</h3>
          <dl>
            <div><dt>Evidence source</dt><dd>{activePreset?.sourceLabel ?? "Manual planner inputs"}</dd></div>
            <div><dt>Evidence status</dt><dd>{activePreset?.sourceStatus ?? "manual input"}</dd></div>
            <div><dt>Snapshot block</dt><dd>{activePreset?.sourceBlock ?? "not provided"}</dd></div>
            {activePreset ? <>
              <div><dt>Eligible recipients</dt><dd>{activePreset.eligibleRecipients}</dd></div>
              <div><dt>Excluded/reserve</dt><dd>{activePreset.excludedRecipients}</dd></div>
            </> : null}
          </dl>
        </article>
        <article>
          <h3>Manifest snapshot</h3>
          <dl>
            <div><dt>Manifest</dt><dd>NOT AVAILABLE</dd></div>
            <div><dt>Asset</dt><dd>{preview.assetAddress}</dd></div>
            <div><dt>Rows</dt><dd>{summary?.rows}</dd></div>
            <div><dt>Proposed RMT per recipient</dt><dd>{estimatedPerRecipient}</dd></div>
            <div><dt>Total required</dt><dd>{estimatedAsset}</dd></div>
            <div><dt>Batches</dt><dd>NOT YET ADMITTED</dd></div>
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
        <h3 id="distribution-preview-rows">
          Recipient preview ({Math.min(rowsToPreview.length, preview.validRows)} rows)
        </h3>
        {isPresetMode && activePreset ? <p>Previewed from {activePreset.name} verified fixture snapshot.</p> : null}
        <ul>
            {rowsToPreview.map((entry, index) => <li key={`${entry.recipient}-${index}`}>
              <span>{index + 1}</span>
              <strong>{entry.recipient}</strong>
              <small>{formatDistributionPreviewAmount(actionKind, plannedDecimals, entry)}</small>
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
      <p>Utility policy and wallet submission remain owner-controlled and not configured in this view.</p>
    </section>
  </section>;
}
