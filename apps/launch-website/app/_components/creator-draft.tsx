"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  creationReviewPath, emptyLaunchDraft, isLaunchDraft, launchDraftLimits, reviewableFields, validateLaunchDraft,
  type LaunchDraft, type LaunchDraftErrors, type LaunchDraftField, type LaunchReviewRequest, type ReviewedLaunchDraft,
} from "../../lib/launch-draft";
import { proposedCurveLifecycle } from "../../lib/curve-lifecycle";
import { launchTerms } from "../../lib/launch-terms";
import { TestCreationWallet } from "./test-creation-wallet";
import { TokenArtwork } from "./token-artwork";

const storageKey = "rmt:new-engine:creation-draft:v1";
const controls = [
  { key: "name", label: "Token name", max: launchDraftLimits.name, placeholder: "e.g. Robinhood Builders" },
  { key: "symbol", label: "Ticker", max: launchDraftLimits.symbol, placeholder: "e.g. BUILD" },
] as const;
const projectLinks = [
  { key: "projectURI", label: "Project or metadata URL", max: launchDraftLimits.projectURI },
  { key: "artworkURL", label: "Artwork URL", max: launchDraftLimits.artworkURL },
] as const;
const treasuryFields = [
  { key: "treasury", label: "Treasury address", max: 42, placeholder: "0x…" },
  { key: "treasuryShare", label: "Treasury share of collected fees (%)", max: 5, placeholder: "0" },
] as const;
const number = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const fieldId = (field: LaunchDraftField) => "draft-" + field;

function DraftTerms({ draft }: { draft?: ReviewedLaunchDraft }) {
  return <section className="lpPanel lpForm" aria-label="Provisional launch terms">
    <h2>Provisional launch terms</h2>
    <dl className="lpFacts">
      <dt>Creation fee</dt><dd>{launchTerms.creationFeeEth} ETH, plus network gas</dd>
      <dt>Illustrative value</dt><dd>About $1 at a fixed $2,500 per ETH reference</dd>
      <dt>Creation fee recipient</dt><dd>RMT operations · production address pending approval</dd>
      <dt>Creator token allocation</dt><dd>0 tokens</dd>
      <dt>Opening curve inventory</dt><dd>{draft ? `${number.format(draft.supply)} tokens` : "100% of the fixed supply"}</dd>
      <dt>Opening real reserve</dt><dd>0 ETH · creators supply no liquidity</dd>
      <dt>Curve trading fee</dt><dd>{launchTerms.curveTradeFeePercent}% of gross ETH, plus gas</dd>
      <dt>Collected curve fees</dt><dd>
        {draft ? <>
          {percent.format(launchTerms.projectFeeSharePercent - draft.treasuryShareBps / 100)}% creator · {percent.format(draft.treasuryShareBps / 100)}% treasury
        </> : <>{launchTerms.projectFeeSharePercent}% creator/project</>}
        { " · " }{launchTerms.operatingFeeSharePercent}% RMT operations · {launchTerms.futureReserveFeeSharePercent}% RMT future reserve
      </dd>
      <dt>Graduation target</dt><dd>{launchTerms.curveAllocationPercent}% net supply sold and {launchTerms.graduationBackingEth} ETH of real backing in the review fixture</dd>
      <dt>Original v4 position</dt><dd>{launchTerms.liquidityAllocationPercent}% of supply available before rounding · permanently locked principal</dd>
      <dt>v4 pool fee</dt><dd>{launchTerms.graduationPoolFeePercent}% · project earnings depend on fees earned by the locked position</dd>
    </dl>
    <p>At the target, the reviewed engine permits a separate graduation transaction. Production terms require approval.</p>
  </section>;
}

export function CreatorDraft({ executionTest }: { executionTest?: { factory: string } }) {
  const [draft, setDraft] = useState<LaunchDraft>(emptyLaunchDraft);
  const [restored, setRestored] = useState(false);
  const [reviewed, setReviewed] = useState<ReviewedLaunchDraft>();
  const [errors, setErrors] = useState<LaunchDraftErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const reviewing = useRef(false);
  const currentDraft = useRef<ReviewedLaunchDraft>(undefined);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && saved.length <= 4096) {
        const input: unknown = JSON.parse(saved);
        if (isLaunchDraft(input) && Object.values(input).every((value) => value.length <= 500)) setDraft(input);
      }
    } catch { /* Draft entry still works when storage is unavailable. */ }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      if (Object.keys(emptyLaunchDraft).every((field) => draft[field as LaunchDraftField] === emptyLaunchDraft[field as LaunchDraftField])) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(draft));
      }
    } catch { /* Keep the in-memory draft. */ }
  }, [draft, restored]);

  useEffect(() => {
    if (reviewed) reviewHeading.current?.focus();
  }, [reviewed]);

  function edit(field: LaunchDraftField, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setMessage("");
  }

  function showErrors(fields: LaunchDraftErrors) {
    setErrors(fields);
    const first = Object.keys(fields)[0];
    if (first) requestAnimationFrame(() => {
      const input = document.getElementById(fieldId(first as LaunchDraftField));
      const section = input?.closest("details");
      if (section) section.open = true;
      input?.focus();
    });
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reviewing.current) return;
    setMessage("");
    const checked = validateLaunchDraft(draft);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    setErrors({});
    reviewing.current = true;
    setPending(true);
    try {
      const { name, symbol, projectURI, supplyPreset, treasury, treasuryShare } = draft;
      const request: LaunchReviewRequest = { name, symbol, projectURI, supplyPreset, treasury, treasuryShare };
      const response = await fetch(creationReviewPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Draft validation unavailable");
      const result: { status?: string; draft?: Record<string, unknown> } = await response.json();
      const expected = Object.entries(reviewableFields(checked.draft));
      if (result.status !== "reviewed" || !result.draft || Object.keys(result.draft).length !== expected.length
        || !expected.every(([key, value]) => result.draft?.[key] === value)) throw new Error("Draft validation did not match");
      currentDraft.current = checked.draft;
      setReviewed(checked.draft);
    } catch {
      setMessage("The draft review is temporarily unavailable. Your fields are still here. Try again.");
    } finally {
      reviewing.current = false;
      setPending(false);
    }
  }

  function inputProps(key: LaunchDraftField, hasHint = false) {
    const description = [hasHint ? fieldId(key) + "-hint" : "", errors[key] ? fieldId(key) + "-error" : ""].filter(Boolean).join(" ");
    return {
      id: fieldId(key),
      name: key,
      value: draft[key],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => edit(key, event.target.value),
      "aria-invalid": Boolean(errors[key]),
      "aria-describedby": description || undefined,
    };
  }

  function errorFor(key: LaunchDraftField) {
    return errors[key] && <span className="lpDraftFieldError" id={fieldId(key) + "-error"}>{errors[key]}</span>;
  }

  const draftPanel = reviewed ? <section className="lpPanel lpForm lpDraft">
      <h2 ref={reviewHeading} tabIndex={-1}>Review token draft</h2>
      <div className="lpTokenHeading">
        <TokenArtwork symbol={reviewed.symbol} />
        <div className="lpTokenName"><strong>{reviewed.name}</strong><span>{reviewed.symbol}</span></div>
      </div>
      <div><span className="lpPill">{proposedCurveLifecycle.label}</span></div>
      <dl className="lpFacts">
        <dt>Total supply</dt><dd>{number.format(reviewed.supply)} tokens</dd>
        {reviewed.description && <><dt>Project description</dt><dd className="lpDraftDescription">{reviewed.description}</dd></>}
        <dt>Project or metadata URL</dt><dd>{reviewed.projectURI || "None"}</dd>
        <dt>Artwork URL</dt><dd>{reviewed.artworkURL || "None"}</dd>
        <dt>Project treasury</dt><dd className={reviewed.treasury ? "lpAddress" : undefined}>{reviewed.treasury || "None"}</dd>
      </dl>
      <p>The server verified the launch fields for this review. Your description and artwork URL stay in this browser.
        {executionTest ? " The test wallet signs only the transaction reviewed below." : " No token has been created."}</p>
      <button type="button" className="lpButton lpSecondary" onClick={() => {
        currentDraft.current = undefined;
        setReviewed(undefined);
        requestAnimationFrame(() => formHeading.current?.focus());
      }}>Edit draft</button>
    </section> : <form className="lpPanel lpForm lpDraft" method="post" noValidate onSubmit={(event) => void review(event)}>
      <h2 ref={formHeading} tabIndex={-1}>Token details</h2>
      <fieldset disabled={pending || !restored}>
        <div className="lpFormGrid">
          {controls.map(({ key, label, max, placeholder }) => <div className="lpDraftField" key={key}>
            <label htmlFor={fieldId(key)}>{label}</label>
            <input {...inputProps(key)} required maxLength={max} placeholder={placeholder} autoComplete="off"
              autoCapitalize={key === "symbol" ? "characters" : undefined} spellCheck={key !== "symbol"} />
            {errorFor(key)}
          </div>)}
        </div>
        <div className="lpDraftField">
          <label htmlFor={fieldId("supplyPreset")}>Fixed supply</label>
          <select {...inputProps("supplyPreset")}>
            {launchTerms.supplyPresets.map((supply, preset) => <option key={supply} value={preset}>{number.format(supply)} tokens</option>)}
          </select>
          {errorFor("supplyPreset")}
        </div>
      </fieldset>
      <fieldset disabled={pending || !restored}>
        <legend>Project information</legend>
        <div className="lpDraftField">
          <label htmlFor={fieldId("description")}>Project description</label>
          <textarea {...inputProps("description", true)} maxLength={launchDraftLimits.description} rows={3} placeholder="What are you launching?" />
          <small id={fieldId("description") + "-hint"}>Optional · up to 500 UTF-8 bytes · kept on this device</small>
          {errorFor("description")}
        </div>
        {projectLinks.map(({ key, label, max }) => <div className="lpDraftField" key={key}>
          <label htmlFor={fieldId(key)}>{label}</label>
          <input {...inputProps(key, true)} type="url" maxLength={max} placeholder="https://" autoComplete="off" />
          <small id={fieldId(key) + "-hint"}>{key === "projectURI" ? "Optional · candidate registration field" : "Optional · draft only · no upload or remote preview"}</small>
          {errorFor(key)}
        </div>)}
      </fieldset>
      <details className="lpDraftTreasury">
        <summary>Optional project treasury</summary>
        <fieldset disabled={pending || !restored} aria-label="Project treasury settings">
          <p>The project treasury can receive up to 90% of collected fees. The creator receives the rest of the project share.</p>
          {treasuryFields.map(({ key, label, max, placeholder }) => <div className="lpDraftField" key={key}>
            <label htmlFor={fieldId(key)}>{label}</label>
            <input {...inputProps(key)} maxLength={max} placeholder={placeholder} autoComplete="off"
              inputMode={key === "treasuryShare" ? "decimal" : undefined} spellCheck={false} />
            {errorFor(key)}
          </div>)}
        </fieldset>
      </details>
      {message && <p className="lpNotice lpError" role="alert">{message}</p>}
      <div className="lpDraftActions">
        <button type="submit" className="lpButton" disabled={pending || !restored}>{pending ? "Reviewing draft…" : "Review draft"}</button>
        <button type="button" className="lpButton lpSecondary" disabled={pending || !restored} onClick={() => {
          setDraft(emptyLaunchDraft);
          setErrors({});
          setMessage("");
        }}>Clear draft</button>
      </div>
      <p>Drafts are saved in this browser. Review sends the launch fields and fee choices for validation. Your description and artwork URL stay here.</p>
    </form>;
  return <div className="lpColumns">
    {executionTest ? <div className="lpStack">
      {draftPanel}
      <TestCreationWallet factory={executionTest.factory} draft={reviewed}
        isCurrentDraft={(value) => value === currentDraft.current} />
    </div> : draftPanel}
    <DraftTerms draft={reviewed} />
  </div>;
}
