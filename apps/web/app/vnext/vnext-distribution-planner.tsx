 "use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
import {
  HOODSTREET_CCFF00_PROGRAM,
  HOODSTREET_CCFF00_PROFILE,
  type EcosystemProjectProfile
} from "../../lib/vnext/distribution-ecosystem-profile";
import {
  CCFF00_RMT_TOKEN,
  summarizeCcff00EpochState,
  type Ccff00EpochState
} from "../../lib/vnext/distribution-ccff00";
import ccff00HistoricalAudit from "../../lib/vnext/fixtures/ccff00-public-audit-37451763.json";
import { DistributionEcosystemProjectProfile } from "./distribution-ecosystem-project-profile";

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
  publicMinted: string;
  excludedRecipients: number;
  rows: readonly Ccff00HistoricRow[];
  csvTemplate: string;
};

type Ccff00LiveChainCount = {
  blockNumber: string;
  blockHash: string;
  publicMinted: string;
  reserveMinted: string;
  totalSupply: string;
};

type Ccff00LiveCountState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  data: Ccff00LiveChainCount | null;
  error: string | null;
  lastRefreshedAt: number | null;
};

const LIVE_CCFF00_REFRESH_INTERVAL_MS = 60_000;

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
  publicMinted: CCFF00_PRESET_SOURCE.publicMinted,
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

function parsePositiveBigInt(value: string): bigint {
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
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
  const [ccff00Epoch, setCcff00Epoch] = useState<Ccff00EpochState>({ epochId: "1", servedTokenIds: [] });
  const [ccff00LiveCount, setCcff00LiveCount] = useState<Ccff00LiveCountState>({
    status: "idle",
    data: null,
    error: null,
    lastRefreshedAt: null
  });

  const activePreset = presetId === "hoodstreet-ccff00" ? HOODSTREET_CCFF00_PRESET : null;
  const isPresetMode = activePreset !== null;
  const snapshotPublicMinted = isPresetMode ? parsePositiveBigInt(activePreset.publicMinted) : 0n;
  const liveSnapshot = ccff00LiveCount.data;
  const livePublicMinted = liveSnapshot ? parsePositiveBigInt(liveSnapshot.publicMinted) : 0n;
  const canaryEpochProgress = isPresetMode && liveSnapshot !== null
    ? livePublicMinted - snapshotPublicMinted
    : null;
  const hasChainAuditInconsistency = isPresetMode && canaryEpochProgress !== null && canaryEpochProgress < 0n;
  const ccff00EpochProgress = isPresetMode && !hasChainAuditInconsistency && canaryEpochProgress !== null ? summarizeCcff00EpochState({
    epochId: ccff00Epoch.epochId,
    livePublicMinted,
    servedTokenIds: ccff00Epoch.servedTokenIds
  }) : null;
  const canRefreshLiveCount = ccff00LiveCount.lastRefreshedAt === null
    ? true
    : (Date.now() - ccff00LiveCount.lastRefreshedAt) >= LIVE_CCFF00_REFRESH_INTERVAL_MS;
  const projectProfile: EcosystemProjectProfile | null = isPresetMode ? HOODSTREET_CCFF00_PROFILE : null;
  const historicalAuditBlock = isPresetMode ? activePreset?.sourceBlock ?? "not available" : "not available";
  const historicalAuditPublicCount = isPresetMode ? activePreset?.publicMinted ?? "not available" : "not available";
  const snapshotExcludeCount = isPresetMode ? activePreset?.excludedRecipients ?? 0 : 0;
  const reserveCount = liveSnapshot ? liveSnapshot.reserveMinted : undefined;
  const canaryDeltaLabel = !isPresetMode
    ? "Preset not selected"
    : ccff00LiveCount.status !== "ready" || !liveSnapshot
      ? "LIVE COUNT UNAVAILABLE"
      : hasChainAuditInconsistency
        ? "CHAIN/AUDIT INCONSISTENCY"
        : canaryEpochProgress?.toString() ?? "0";
  const refreshStatusLabel = !isPresetMode
    ? "not tracking"
    : ccff00LiveCount.lastRefreshedAt === null
      ? "not yet refreshed"
      : ccff00LiveCount.status === "unavailable"
        ? `error (${ccff00LiveCount.error ?? "LIVE COUNT UNAVAILABLE"})`
        : `last updated ${new Date(ccff00LiveCount.lastRefreshedAt).toISOString()}`;
  const refreshLiveCcff00Count = async (force = false) => {
    if (!isPresetMode) return;
    if (!force && !canRefreshLiveCount) return;
    if (ccff00LiveCount.status === "loading") return;
    setCcff00LiveCount({ status: "loading", data: null, error: null, lastRefreshedAt: ccff00LiveCount.lastRefreshedAt });
    try {
      const response = await fetch("/api/vnext/ccff00-live-count", { cache: "no-store" });
      const payload = await response.json().catch(() => ({ error: "LIVE COUNT UNAVAILABLE" })) as {
        status?: string;
        liveChainState?: Ccff00LiveChainCount;
        error?: string;
      };
      if (!response.ok || payload.status !== "ready" || !payload.liveChainState) {
        throw new Error(payload.error ?? "LIVE COUNT UNAVAILABLE");
      }
      setCcff00LiveCount({
        status: "ready",
        data: payload.liveChainState,
        error: null,
        lastRefreshedAt: Date.now()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "LIVE COUNT UNAVAILABLE";
      setCcff00LiveCount({
        status: "unavailable",
        data: null,
        error: message.includes("LIVE COUNT UNAVAILABLE") ? "LIVE COUNT UNAVAILABLE" : message,
        lastRefreshedAt: Date.now()
      });
    }
  };

  useEffect(() => {
    if (!isPresetMode) return;
    void refreshLiveCcff00Count(true);
  }, [isPresetMode]);

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
    if (presetId !== "manual") {
      setPresetId("manual");
      setCcff00Epoch({ epochId: "1", servedTokenIds: [] });
    }
  };

  const onPresetChange = (nextPresetId: PresetId) => {
    setUploadError("");
    setCcff00LiveCount({ status: "idle", data: null, error: null, lastRefreshedAt: null });
    setCcff00Epoch({ epochId: "1", servedTokenIds: [] });
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

  const onStartEpoch = () => {
    setCcff00Epoch({
      epochId: (BigInt(ccff00Epoch.epochId) + 1n).toString(),
      servedTokenIds: []
    });
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
      <span>Final eligible manifest: <strong>NOT YET VERIFIED</strong></span>
      {isPresetMode ? <span>Source: <strong>{presetSnapshotEvidence}</strong></span> : null}
      {isPresetMode ? <span>Live chain state: <strong>{ccff00LiveCount.status === "ready" ? "observed" : "not observed"}</strong></span> : null}
      {hasChainAuditInconsistency ? <span>Consistency check: <strong>CHAIN/AUDIT INCONSISTENCY</strong></span> : null}
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
        {isPresetMode ? <div>
          <small>Current snapshot is read-only fixture evidence until refreshed from live chain state.</small>
          <button type="button" onClick={() => void refreshLiveCcff00Count()} disabled={ccff00LiveCount.status === "loading" || !canRefreshLiveCount}>Manual refresh</button>
          <button type="button" className="rmtDistributionSubmit" onClick={onStartEpoch}>Preview next epoch</button>
          <small>Session-only planning state — not persisted and does not authorize a distribution.</small>
        </div> : null}
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
              setManualMode();
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

    {isPresetMode ? <section className="rmtDistributionCards" aria-label="Planning evidence">
      {projectProfile ? <DistributionEcosystemProjectProfile profile={projectProfile} /> : null}
      <article>
        <h3>LIVE NETWORK STATE</h3>
        <dl>
          <div><dt>Live public memberships</dt><dd>{ccff00LiveCount.status === "ready" && liveSnapshot ? liveSnapshot.publicMinted : "LIVE COUNT UNAVAILABLE"}</dd></div>
          <div><dt>Reserve count</dt><dd>{reserveCount ?? "LIVE COUNT UNAVAILABLE"}</dd></div>
          <div><dt>Exact observation block</dt><dd>{liveSnapshot ? liveSnapshot.blockHash ? `${liveSnapshot.blockNumber} (${liveSnapshot.blockHash})` : liveSnapshot.blockNumber : "LIVE COUNT UNAVAILABLE"}</dd></div>
          <div><dt>Refresh</dt><dd>{refreshStatusLabel}</dd></div>
        </dl>
      </article>
      <article>
        <h3>DISTRIBUTION PROGRAM</h3>
        <dl>
          <div><dt>Program</dt><dd>{HOODSTREET_CCFF00_PROGRAM.programLabel}</dd></div>
          <div><dt>Canary status</dt><dd>{HOODSTREET_CCFF00_PROGRAM.canaryStatus}</dd></div>
          <div><dt>Canary cohort</dt><dd>{HOODSTREET_CCFF00_PROGRAM.canaryCohort}</dd></div>
          <div><dt>Current epoch</dt><dd>{ccff00EpochProgress?.epochId ?? "—"}</dd></div>
          <div><dt>Served</dt><dd>{ccff00EpochProgress?.servedThisEpoch ?? "—"}</dd></div>
          <div><dt>Pending</dt><dd>{ccff00EpochProgress?.pendingThisEpoch ?? "—"}</dd></div>
          <div><dt>Delta since audit snapshot</dt><dd>{canaryDeltaLabel}</dd></div>
        </dl>
      </article>
      <article>
        <h3>EVIDENCE</h3>
        <dl>
          <div><dt>Historical audit block</dt><dd>{historicalAuditBlock}</dd></div>
          <div><dt>Audit public count</dt><dd>{historicalAuditPublicCount}</dd></div>
          <div><dt>Final eligible manifest</dt><dd>NOT YET VERIFIED</dd></div>
          <div><dt>Snapshot status</dt><dd>{activePreset?.sourceStatus ?? "manual input"}</dd></div>
          <div><dt>Excluded/reserve</dt><dd>{snapshotExcludeCount}</dd></div>
        </dl>
      </article>
      <article>
        <h3>READINESS GATE</h3>
        <dl>
          <div><dt>Wallet submission</dt><dd className="rmtReadinessFail">disabled</dd></div>
          <div><dt>Server submission</dt><dd className="rmtReadinessFail">disabled</dd></div>
          <div><dt>Approval workflow</dt><dd>preview only</dd></div>
        </dl>
        <button type="button" className="rmtDistributionSubmit" disabled>Submission disabled</button>
        <small>Canonical execution batches are not yet admitted.</small>
      </article>
      {preview.status === "ready" ? <article>
        <h3>MANIFEST SNAPSHOT</h3>
        <dl>
          <div><dt>Asset</dt><dd>{preview.assetAddress}</dd></div>
          <div><dt>Rows</dt><dd>{summary?.rows}</dd></div>
          <div><dt>Proposed RMT per recipient</dt><dd>{estimatedPerRecipient}</dd></div>
          <div><dt>Total required</dt><dd>{estimatedAsset}</dd></div>
        </dl>
      </article> : null}
    </section> : null}

    {preview.status === "ready" ? <section aria-labelledby="distribution-preview-rows" className="rmtDistributionPreview">
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
    </section> : null}

    <section className="rmtDistributionFooter">
      <strong>Execution boundary</strong>
      <p>All actions above are intentionally read-only planning. A send/confirm flow is not implemented, and cannot execute from this screen.</p>
      <p>Utility policy and wallet submission remain owner-controlled and not configured in this view.</p>
    </section>
  </section>;
}
