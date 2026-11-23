"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import dynamic from "next/dynamic";
import {
  creationReviewPath, emptyLaunchDraft, launchDraftLimits, projectTreasuryShareUnit, readStoredLaunchDraft,
  restoreLegacyLaunchDraft, reviewableFields, treasuryProjectPercent, validateLaunchDraft,
  type LaunchDraft, type LaunchDraftErrors, type LaunchDraftField, type LaunchReviewRequest, type ReviewedLaunchDraft,
} from "../../lib/launch-draft";
import { proposedCurveLifecycle } from "../../lib/curve-lifecycle";
import { formatEther } from "viem";
import { launchTerms, launchTokenDecimals, launchTokenSupply, minimumGraduationGrossWei } from "../../lib/launch-terms";
import { TestCreationWallet } from "./test-creation-wallet";
import { PublishDescription } from "./publish-description";
import {descriptionMetadata, originalRmtMetadataCID, rmtImageURL} from "../../lib/rmt-metadata";
import { ArtworkUpload, clearPendingArtwork } from "./artwork-upload";
import { assetCID, receiptForImage, verifyArtworkReceipt } from "../../lib/token-artwork";
import { TokenArtwork } from "./token-artwork";
import { useAccount } from "./account-provider";
import { ProjectTreasurySetup } from "./project-treasury-setup";
import type { ProjectTreasuryProof } from "../../lib/project-treasury";
import { projectTreasuryDraftKey, type ProjectTreasuryMode } from "../../lib/project-treasury-draft";

// The read-only build never mounts or loads the production wallet controller.
const ProductionCreationWallet = dynamic(() => import("./production-creation-wallet").then((module) => module.ProductionCreationWallet), { ssr: false });

const storageKey = "rmt:new-engine:creation-draft:v2";
const legacyStorageKey = "rmt:new-engine:creation-draft:v1";
const controls = [
  { key: "name", label: "Token name", max: launchDraftLimits.name, placeholder: "e.g. Robinhood Builders" },
  { key: "symbol", label: "Ticker", max: launchDraftLimits.symbol, placeholder: "e.g. BUILD" },
] as const;
const projectLinks = [
  { key: "projectURI", label: "Project or metadata URL", max: launchDraftLimits.projectURI },
  { key: "artworkURL", label: "Artwork URL", max: launchDraftLimits.artworkURL },
] as const;
const treasuryFields = [
  { key: "treasury", label: "Treasury address", max: 42, placeholder: "0xâ€¦" },
  { key: "treasuryShare", label: "Treasury share of project fees (%)", max: 6, placeholder: "0" },
] as const;
const number = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const fieldId = (field: LaunchDraftField) => "draft-" + field;

function DraftTerms({ draft, production }: { draft?: ReviewedLaunchDraft; production?: { operating: string; reserve: string } }) {
  const fullTerms = <>
    <dl className="lpFacts lpCreatorTermsFacts">
      <dt>Creation fee</dt><dd>{launchTerms.creationFeeEth} ETH, plus network gas</dd>
      <dt>Creation fee recipient</dt><dd>{production ? <code className="lpAddress">{production.operating}</code> : "RMT operations"}</dd>
      {production && <><dt>Future reserve recipient</dt><dd><code className="lpAddress">{production.reserve}</code></dd></>}
      <dt>Creator token allocation</dt><dd>0 tokens</dd>
      <dt>Opening curve inventory</dt><dd>{number.format(launchTokenSupply)} tokens</dd>
      <dt>Opening real reserve</dt><dd>0 ETH Â· creators supply no liquidity</dd>
      <dt>Opening virtual reserve</dt><dd>{launchTerms.virtualEth} ETH for pricing only. Buyers supply the actual ETH.</dd>
      <dt>Curve trading fee</dt><dd>{launchTerms.curveTradeFeePercent}% of gross ETH, plus gas</dd>
      <dt>Curve and locked-position fee split</dt><dd>
        {draft ? <>
          {percent.format(launchTerms.projectFeeSharePercent - draft.treasuryShareBps / 100)}% creator Â· {percent.format(draft.treasuryShareBps / 100)}% treasury
        </> : <>{launchTerms.projectFeeSharePercent}% creator/project</>}
        { " Â· " }{launchTerms.operatingFeeSharePercent}% RMT operations Â· {launchTerms.futureReserveFeeSharePercent}% RMT future reserve
      </dd>
      <dt>Treasury share of project fees</dt><dd>{treasuryProjectPercent(draft?.treasuryShareBps ?? 0)}</dd>
      <dt>Rewards after graduation</dt><dd>Same recipients for ETH and token fees collected from the original locked position</dd>
      <dt>Graduation target</dt><dd>{number.format(launchTokenSupply * launchTerms.curveAllocationPercent / 100)} tokens net sold ({launchTerms.curveAllocationPercent}%) and {launchTerms.graduationBackingEth} ETH of real backing</dd>
      <dt>Minimum gross buy from launch</dt><dd>{formatEther(minimumGraduationGrossWei)} ETH in a single buy, including the curve fee. Gas is separate. Sells reduce progress and splitting buys can add rounding costs.</dd>
      <dt>Original v4 position</dt><dd>{number.format(launchTokenSupply * launchTerms.liquidityAllocationPercent / 100)} tokens available before rounding ({launchTerms.liquidityAllocationPercent}%) Â· permanently locked principal</dd>
      <dt>v4 pool fee</dt><dd>{launchTerms.graduationPoolFeePercent}% Â· project earnings depend on fees earned by the locked position</dd>
    </dl>
    <p>At the target, anyone can complete graduation. The transaction seeds the locked v4 position at the final curve price. Small rounding balances stay in the curve.</p>
  </>;
  return <section className="lpPanel lpForm lpCreatorTerms" aria-label="Factory v1 launch terms">
    <div className="lpCreatorSectionHeader">
      <div><span className="lpEyebrow">Costs &amp; allocation</span><h2>Factory v1 launch terms</h2></div>
    </div>
    {draft ? fullTerms : <>
      <dl className="lpCreatorTermHighlights">
        <div><dt>Creation fee</dt><dd>{launchTerms.creationFeeEth} ETH<small>Plus network gas</small></dd></div>
        <div><dt>Fixed supply</dt><dd>{number.format(launchTokenSupply)}<small>Tokens Â· {launchTokenDecimals} decimals</small></dd></div>
        <div><dt>Curve trading fee</dt><dd>{launchTerms.curveTradeFeePercent}%<small>Of gross ETH, plus gas</small></dd></div>
        <div><dt>v4 pool fee</dt><dd>{launchTerms.graduationPoolFeePercent}%<small>After graduation</small></dd></div>
      </dl>
      <div className="lpCreatorTermsSummary">
        <p><strong>{launchTerms.projectFeeSharePercent}% project</strong> Â· {launchTerms.operatingFeeSharePercent}% RMT operations Â· {launchTerms.futureReserveFeeSharePercent}% RMT future reserve</p>
        <p>Applies to curve fees and fees earned by the original locked position. An optional treasury receives part of the project share.</p>
        <p><strong>0 creator tokens.</strong> Creators supply no liquidity.</p>
        <p>Graduation requires {number.format(launchTokenSupply * launchTerms.curveAllocationPercent / 100)} tokens net sold and {launchTerms.graduationBackingEth} ETH of buyer-funded backing. One buy from launch costs about {Number(formatEther(minimumGraduationGrossWei)).toFixed(4)} ETH including the fee, plus gas.</p>
        <p>At graduation, that backing and the remaining {number.format(launchTokenSupply * launchTerms.liquidityAllocationPercent / 100)} tokens fund the permanently locked v4 position, subject to rounding.</p>
      </div>
      <details className="lpCreatorDisclosure lpCreatorTermsDisclosure">
        <summary><span>View full launch terms</span></summary>
        <div className="lpCreatorDisclosureBody">{fullTerms}</div>
      </details>
    </>}
  </section>;
}

export function CreatorDraft({ executionTest, productionCreation }: {
  executionTest?: { factory: string; projectTreasury?: boolean }; productionCreation?: { factory: string; operating: string; reserve: string };
}) {
  const account = useAccount();
  const accountBinding = account.wallet ? `${account.wallet.address}:${account.wallet.chainId}`
    : account.session.authenticated ? account.session.account.walletAddress : "anonymous";
  const [draft, setDraft] = useState<LaunchDraft>(emptyLaunchDraft);
  const [artworkPending, setArtworkPending] = useState(false);
  const [artworkReset, setArtworkReset] = useState(0);
  const [restored, setRestored] = useState(false);
  const [reviewed, setReviewed] = useState<ReviewedLaunchDraft>();
  const [errors, setErrors] = useState<LaunchDraftErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [treasuryMode, setTreasuryMode] = useState<ProjectTreasuryMode>("none");
  const [treasuryProof, setTreasuryProof] = useState<ProjectTreasuryProof>();
  const [treasurySetupVersion, setTreasurySetupVersion] = useState(0);
  const reviewing = useRef(false);
  const currentDraft = useRef<ReviewedLaunchDraft>(undefined);
  const liveAccountBinding = useRef(accountBinding), reviewedAccountBinding = useRef<string>(undefined);
  liveAccountBinding.current = accountBinding;
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const priorAccount = useRef(accountBinding);
  useEffect(() => {
    if (priorAccount.current === accountBinding) return;
    priorAccount.current = accountBinding; currentDraft.current = undefined; setReviewed(undefined);
    setMessage("Wallet account or network changed. Review the saved token fields again before continuing.");
  }, [accountBinding]);

  useEffect(() => {
    function storedDraft(key: string) {
      try {
        const saved = localStorage.getItem(key);
        if (!saved || saved.length > 4096) return;
        return readStoredLaunchDraft(JSON.parse(saved));
      } catch { /* Try the other storage version if this entry is unavailable. */ }
    }
    const current = storedDraft(storageKey);
    if (current) setDraft(current);
    else {
      const legacy = storedDraft(legacyStorageKey);
      if (legacy) setDraft(restoreLegacyLaunchDraft(legacy));
    }
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
      localStorage.removeItem(legacyStorageKey);
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
    if (reviewing.current || artworkPending) return;
    setMessage("");
    if (treasuryMode === "contract" && !treasuryProof) {
      setMessage("Verify the optional treasury deployment first, or choose creator-only fees. A predicted address is not a deployed beneficiary.");
      return;
    }
    const checked = validateLaunchDraft(draft);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    setErrors({});
    reviewing.current = true;
    const boundAccount = liveAccountBinding.current;
    setPending(true);
    try {
      const { name, symbol, treasury, treasuryShare } = draft;
      let projectURI = draft.projectURI;
      if (productionCreation && name === "RMT" && symbol === "RMT") {
        const reviewedMetadata = descriptionMetadata(draft.description);
        if (draft.artworkURL !== rmtImageURL && projectURI !== reviewedMetadata.projectURI && assetCID(projectURI,"metadata.json") !== originalRmtMetadataCID) {
          setMessage("Restore the approved RMT artwork before launching.");return;
        }
        projectURI = reviewedMetadata.projectURI;
        checked.draft = {...checked.draft, description:draft.description, projectURI, artworkURL:rmtImageURL};
      }
      const request: LaunchReviewRequest = {
        name, symbol, projectURI, treasury, treasuryShare, treasuryShareUnit: projectTreasuryShareUnit,
      };
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
      if (liveAccountBinding.current !== boundAccount) throw new Error("Wallet identity changed during review");
      reviewedAccountBinding.current = boundAccount;
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
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => edit(key, event.target.value),
      "aria-invalid": Boolean(errors[key]),
      "aria-describedby": description || undefined,
    };
  }

  function errorFor(key: LaunchDraftField) {
    return errors[key] && <span className="lpDraftFieldError" id={fieldId(key) + "-error"}>{errors[key]}</span>;
  }

  const draftPanel = reviewed ? <section className="lpPanel lpForm lpDraft lpCreatorDraft lpCreatorReviewed">
      <div className="lpCreatorSectionHeader"><div><span className="lpEyebrow">Your draft</span><h2 ref={reviewHeading} tabIndex={-1}>Review token draft</h2></div></div>
      <div className="lpTokenHeading">
        <TokenArtwork symbol={reviewed.symbol} projectURI={reviewed.projectURI} />
        <div className="lpTokenName"><strong>{reviewed.name}</strong><span>{reviewed.symbol}</span></div>
      </div>
      <div><span className="lpPill">{proposedCurveLifecycle.label}</span></div>
      <dl className="lpFacts lpCreatorReviewFacts">
        <dt>Fixed total supply</dt><dd>{number.format(reviewed.supply)} tokens Â· {launchTokenDecimals} decimals</dd>
        {reviewed.description && <><dt>Project description</dt><dd className="lpDraftDescription">{reviewed.description}</dd></>}
        <dt>Registration metadata</dt><dd>{reviewed.projectURI ? <span className="lpAddress">{reviewed.projectURI}</span> : "None"}</dd>
        <dt>Artwork URL</dt><dd>{reviewed.artworkURL || "None"}</dd>
        <dt>Project treasury</dt><dd className={reviewed.treasury ? "lpAddress" : undefined}>{reviewed.treasury || "None"}</dd>
        {treasuryProof && <><dt>Separate project treasury contract</dt><dd className="lpAddress">{treasuryProof.treasury}</dd><dt>Treasury deployment</dt><dd>Verified synthetic block {treasuryProof.deployment.blockNumber} Â· purchases OFF at creation</dd></>}
        <dt>Treasury share of project fees</dt><dd>{treasuryProjectPercent(reviewed.treasuryShareBps)} Â· {percent.format(reviewed.treasuryShareBps / 100)}% of all eligible fees</dd>
      </dl>
      <p className="lpCreatorHelp">The server verified the registration fields. {assetCID(reviewed.projectURI,"metadata.json") ? "The registration includes your saved image metadata." : "Optional draft notes stay in this browser."}
        {executionTest ? " The test wallet signs only the transaction reviewed below." : " No token has been created."}</p>
      <button type="button" className="lpButton lpSecondary" onClick={() => {
        currentDraft.current = undefined;
        setReviewed(undefined);
        requestAnimationFrame(() => formHeading.current?.focus());
      }}>Edit draft</button>
      {!productionCreation && !executionTest && <p role="status">Your draft is saved. Launching is currently closed. Return here when owner creation opens.</p>}
    </section> : <form className="lpPanel lpForm lpDraft lpCreatorDraft" method="post" noValidate onSubmit={(event) => void review(event)}>
      <div className="lpCreatorSectionHeader">
        <div><span className="lpEyebrow">Your draft</span><h2 id="creator-token-details" ref={formHeading} tabIndex={-1}>Token details</h2></div>
        <span className="lpCreatorOptional">Name &amp; ticker required</span>
      </div>
      <fieldset disabled={pending || !restored} aria-labelledby="creator-token-details">
        {restored && <ArtworkUpload key={artworkReset} projectURI={draft.projectURI} onPending={setArtworkPending}
          onSave={receipt=>{ setDraft(previous=>({...previous,...receipt})); setMessage(""); }} />}
        <div className="lpFormGrid">
          {controls.map(({ key, label, max, placeholder }) => <div className="lpDraftField" key={key}>
            <label htmlFor={fieldId(key)}>{label}</label>
            <input {...inputProps(key)} required maxLength={max} placeholder={placeholder} autoComplete="off"
              autoCapitalize={key === "symbol" ? "characters" : undefined} spellCheck={key !== "symbol"} />
            {errorFor(key)}
          </div>)}
        </div>
        <div className="lpDraftField lpCreatorSupply">
          <label htmlFor="draft-fixed-supply">Fixed supply</label>
          <input id="draft-fixed-supply" value={`${number.format(launchTokenSupply)} tokens`} readOnly aria-describedby="draft-fixed-supply-hint" />
          <small id="draft-fixed-supply-hint">Set by the launch contract Â· {launchTokenDecimals} decimals</small>
        </div>
      </fieldset>
      <details className="lpCreatorDisclosure lpCreatorMetadata">
        <summary><span><span>Project information</span><small>Description and advanced URL options</small></span><span className="lpCreatorOptional">Optional</span></summary>
        <fieldset className="lpCreatorDisclosureBody" disabled={pending || !restored} aria-label="Project information">
          <div className="lpDraftField">
            <label htmlFor={fieldId("description")}>Project description</label>
            <textarea {...inputProps("description", true)} maxLength={launchDraftLimits.description} rows={3} placeholder="What are you launching?" />
            <small id={fieldId("description") + "-hint"}>Up to 500 UTF-8 bytes. Private until explicitly published.</small>
            {errorFor("description")}
          </div>
          {!productionCreation && draft.name==="RMT" && draft.symbol==="RMT" && (draft.artworkURL===rmtImageURL || assetCID(draft.projectURI,"metadata.json")===originalRmtMetadataCID) &&
            <PublishDescription description={draft.description} projectURI={draft.projectURI} onSave={receipt=>setDraft(previous=>
              previous.description===draft.description && previous.projectURI===draft.projectURI && previous.artworkURL===draft.artworkURL ? {...previous,...receipt}:previous)} />}
          <details><summary>Advanced URLs</summary>{projectLinks.map(({ key, label, max }) => <div className="lpDraftField" key={key}>
            <label htmlFor={fieldId(key)}>{label}</label>
            <input {...inputProps(key, true)} readOnly={Boolean(assetCID(draft.projectURI,"metadata.json"))} type="url" maxLength={max} placeholder="https://" autoComplete="off" />
            <small id={fieldId(key) + "-hint"}>{key === "projectURI" ? "Included in the creation transactionâ€™s registration fields" : "Paste a saved RMT Launch image URL to reuse it. For other links, upload the original file to include it in registration."}</small>
            {errorFor(key)}
          </div>)}
          {assetCID(draft.artworkURL,"image.webp") && !assetCID(draft.projectURI,"metadata.json") &&
            <button type="button" disabled={pending || artworkPending} onClick={async()=>{
              setPending(true);
              try {
                const receipt = receiptForImage(draft.artworkURL);
                await verifyArtworkReceipt(receipt,AbortSignal.timeout(20_000));
                setDraft(previous=>({...previous,...receipt}));
              } catch { setMessage("Could not verify that saved image. Try again or choose a file."); }
              finally { setPending(false); }
            }}>Use saved image URL</button>}
          </details>
        </fieldset>
      </details>
      <details className="lpDraftTreasury lpCreatorDisclosure">
        <summary><span><span>Optional project treasury</span><small>Allocate part of your projectâ€™s fee share</small></span></summary>
        <fieldset disabled={pending || !restored} aria-label="Project treasury settings">
          {restored && <ProjectTreasurySetup key={treasurySetupVersion} creatorFields={{ name: draft.name, symbol: draft.symbol, projectURI: draft.projectURI }}
            fixture={executionTest?.projectTreasury === true} initialExisting={Boolean(draft.treasury)}
            onModeChange={mode => {
              currentDraft.current = undefined; setReviewed(undefined); setTreasuryMode(mode); setTreasuryProof(undefined);
              if (mode !== "existing") setDraft(previous => ({ ...previous, treasury: "", treasuryShare: "" }));
            }} onInvalidate={() => {
              currentDraft.current = undefined; setReviewed(undefined); setTreasuryProof(undefined);
              if (treasuryMode === "contract") setDraft(previous => ({ ...previous, treasury: "", treasuryShare: "" }));
            }} onVerified={proof => {
              currentDraft.current = undefined; setReviewed(undefined); setTreasuryProof(proof);
              // The first two-decimal project percentage that maps to the exact
              // already-reviewed onchain allocation; never reinterpret 9000 as100% of total fees.
              const share = (Math.ceil(proof.treasuryShareBps * 10_000 / 9000) / 100).toFixed(2);
              setDraft(previous => ({ ...previous, treasury: proof.treasuryShareBps ? proof.treasury.toLowerCase() : "",
                treasuryShare: proof.treasuryShareBps ? share : "" }));
            }} existingChildren={<>
          <p>Allocate 0â€“100% of the projectâ€™s 90% share. The creator receives the rest. Leave both fields empty to pay the creator directly.</p>
          <p>The treasury address is permanent and must be able to claim fees. Verify smart-account claim support on the launch chain first.</p>
          {treasuryFields.map(({ key, label, max, placeholder }) => <div className="lpDraftField" key={key}>
            <label htmlFor={fieldId(key)}>{label}</label>
            <input {...inputProps(key, key === "treasuryShare")} maxLength={max} placeholder={placeholder} autoComplete="off"
              inputMode={key === "treasuryShare" ? "decimal" : undefined} spellCheck={false} />
            {key === "treasuryShare" && <small id={fieldId(key) + "-hint"}>The contract rounds down to whole basis points of all fees. Review the exact split before confirming.</small>}
            {errorFor(key)}
          </div>)}
            </>} />}
        </fieldset>
      </details>
      {message && <p className="lpNotice lpError" role="alert">{message}</p>}
      <div className="lpDraftActions lpCreatorActions">
        <button type="submit" className="lpButton" disabled={pending || !restored || artworkPending}>{pending ? "Reviewing draftâ€¦" : "Review draft"}</button>
        <button type="button" className="lpButton lpSecondary" disabled={pending || !restored} onClick={() => {
          void clearPendingArtwork(); setArtworkReset(value=>value+1);
          setDraft(emptyLaunchDraft);
          setTreasuryProof(undefined);
          setTreasuryMode("none");
          try { localStorage.removeItem(projectTreasuryDraftKey); } catch { /* Submitted transaction journals remain independent. */ }
          setTreasurySetupVersion(value => value + 1);
          setErrors({});
          setMessage("");
        }}>Clear draft</button>
      </div>
      <p className="lpCreatorHelp">Your draft is saved in this browser. Saving artwork publishes the image. Publishing the RMT description creates a new metadata URL.</p>
    </form>;
  return <div className="lpColumns lpCreatorColumns">
    {draftPanel}
    <DraftTerms draft={reviewed} production={productionCreation} />
    {(executionTest || productionCreation) && <div className="lpStack lpCreatorWallet">
      {executionTest ? <TestCreationWallet factory={executionTest.factory}
        treasuryIntentId={treasuryProof?.intentId}
        treasuryCreator={treasuryProof?.creator}
        draft={reviewed}
        isCurrentDraft={(value) => value === currentDraft.current && reviewedAccountBinding.current === liveAccountBinding.current} />
        : productionCreation && <ProductionCreationWallet factory={productionCreation.factory} draft={reviewed}
          metadataSaved={draft.projectURI === reviewed?.projectURI}
          onMetadataSaved={(value) => setDraft(previous => previous.description === value.description && previous.name === value.name && previous.symbol === value.symbol ? {...previous,projectURI:value.projectURI,artworkURL:value.artworkURL}:previous)}
          isCurrentDraft={(value) => value === currentDraft.current && reviewedAccountBinding.current === liveAccountBinding.current} />}
    </div>}
  </div>;
}
