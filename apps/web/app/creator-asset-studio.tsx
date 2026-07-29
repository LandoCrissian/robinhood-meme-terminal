"use client";

import type { User } from "firebase/auth";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  ASSET_LICENSES,
  COLLABORATOR_ROLES,
  CREATION_METHODS,
  CREATOR_ASSET_TYPES,
  EDITION_MODES,
  EMPTY_CREATOR_ASSET,
  MUSIC_RELEASE_TYPES,
  RIGHTS_BASES,
  hashCreatorAssetDraft,
  normalizeCreatorAsset,
  validateCreatorAsset,
  type AssetCollaborator,
  type AssetRevenueSplit,
  type CreatorAsset,
  type CreatorAssetDraft,
  type CreatorAssetType
} from "../lib/creator-assets";
import {
  deleteCreatorAsset,
  saveCreatorAsset,
  subscribeToCreatorAssets
} from "../lib/creator-assets-cloud";
import { evaluateCreatorReleaseReadiness } from "../lib/creator-release-readiness";
import type { CreatorConsentInvitationRecord } from "../lib/creator-consent";
import type { ProjectAssignment } from "../lib/project-ownership";
import { CreatorConsentLinkBuilder } from "./creator-consent-link-builder";
import { CreatorImageField } from "./creator-media-upload";

const TYPE_LABELS: Record<CreatorAssetType, string> = {
  artwork: "AI or digital artwork",
  music_release: "Music release",
  nft_collection: "NFT collection"
};

function freshAsset(assetType: CreatorAssetType): CreatorAssetDraft {
  return normalizeCreatorAsset({
    ...EMPTY_CREATOR_ASSET,
    assetType,
    masterRightsConfirmed: assetType === "music_release" ? false : undefined,
    compositionRightsConfirmed: assetType === "music_release" ? false : undefined
  });
}

function allowedAssetTypes(assignment: ProjectAssignment) {
  return CREATOR_ASSET_TYPES.filter((type) => (
    type === "music_release"
      ? assignment.allowedModules.includes("music")
      : assignment.allowedModules.includes("nft")
  ));
}

function splitTotal(splits: AssetRevenueSplit[]) {
  return splits.reduce((total, split) => total + (Number.isFinite(split.shareBps) ? split.shareBps : 0), 0);
}

export function CreatorAssetStudio({
  assignment,
  projectSlug,
  user
}: {
  assignment: ProjectAssignment;
  projectSlug: string;
  user: User;
}) {
  const allowedTypes = useMemo(() => allowedAssetTypes(assignment), [assignment]);
  const [assets, setAssets] = useState<CreatorAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<CreatorAssetDraft>(() => freshAsset(allowedTypes[0] ?? "artwork"));
  const [status, setStatus] = useState<"loading" | "live" | "unavailable">("loading");
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [message, setMessage] = useState("");
  const [consentRecords, setConsentRecords] = useState<CreatorConsentInvitationRecord[]>([]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToCreatorAssets(user, projectSlug, (next) => {
      if (!active) return;
      setAssets(next);
      setStatus("live");
    }, () => {
      if (active) setStatus("unavailable");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (active) setStatus("unavailable");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [projectSlug, user]);

  useEffect(() => {
    if (selectedId && !assets.some((asset) => asset.assetId === selectedId)) {
      setSelectedId("");
      setDraft(freshAsset(allowedTypes[0] ?? "artwork"));
    }
  }, [allowedTypes, assets, selectedId]);

  if (allowedTypes.length === 0) return null;

  const chooseAsset = (asset: CreatorAsset) => {
    setSelectedId(asset.assetId);
    setDraft(normalizeCreatorAsset(asset));
    setDeleteArmed(false);
    setMessage("");
  };

  const startNew = () => {
    setSelectedId("");
    setDraft(freshAsset(allowedTypes[0]));
    setDeleteArmed(false);
    setMessage("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateCreatorAsset(draft);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const assetId = await saveCreatorAsset(user, projectSlug, draft, selectedId || undefined);
      setSelectedId(assetId);
      setMessage("Private rights draft saved. Nothing was published, minted, licensed, sold, or paid.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The private asset draft could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedId) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      setMessage("Choose Delete draft again to permanently remove this private draft.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await deleteCreatorAsset(user, projectSlug, selectedId);
      setSelectedId("");
      setDraft(freshAsset(allowedTypes[0]));
      setDeleteArmed(false);
      setMessage("Private asset draft deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The private asset draft could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const addCollaborator = () => {
    if (draft.collaborators.length >= 6) return;
    setDraft((current) => ({
      ...current,
      collaborators: [...current.collaborators, {
        name: "",
        role: "artist",
        walletAddress: "",
        consentStatus: "unverified"
      }]
    }));
  };

  const updateCollaborator = (index: number, value: Partial<AssetCollaborator>) => {
    setDraft((current) => ({
      ...current,
      collaborators: current.collaborators.map((collaborator, candidate) => (
        candidate === index ? { ...collaborator, ...value, consentStatus: "unverified" } : collaborator
      ))
    }));
  };

  const addSplit = () => {
    if (draft.revenueSplits.length >= 5) return;
    setDraft((current) => ({
      ...current,
      revenueSplits: [...current.revenueSplits, {
        label: "",
        walletAddress: "",
        shareBps: current.revenueSplits.length === 0 ? 10_000 : 0
      }]
    }));
  };

  const updateSplit = (index: number, value: Partial<AssetRevenueSplit>) => {
    setDraft((current) => ({
      ...current,
      revenueSplits: current.revenueSplits.map((split, candidate) => (
        candidate === index ? { ...split, ...value } : split
      ))
    }));
  };

  const totalBps = splitTotal(draft.revenueSplits);
  const draftRevisionHash = hashCreatorAssetDraft(draft);
  const savedRevisionHash = assets.find((asset) => asset.assetId === selectedId)?.draftRevisionHash;
  const readiness = evaluateCreatorReleaseReadiness(draft, {
    savedRevisionHash,
    consentRecords
  });
  const aiUsed = draft.creationMethod !== "human";
  const isMusic = draft.assetType === "music_release";

  return (
    <section className="creatorAssetStudio" aria-labelledby="creator-assets-title">
      <header className="creatorAssetHeader">
        <div>
          <p className="eyebrow">ASSET + RIGHTS FOUNDATION</p>
          <h3 id="creator-assets-title">Prepare works before contracts or marketplace access</h3>
          <p>Build private, structured records for provenance, rights, editions, licensing, collaborators and proposed revenue splits.</p>
        </div>
        <span>PRIVATE DRAFTS · {assets.length}/50</span>
      </header>

      <div className="creatorAssetBoundary">
        <strong>No minting. No marketplace. No payouts.</strong>
        <span>Collaborator consent is revision-bound and becomes release-ready only after RMT records each invited wallet’s signed acceptance. A saved split is a proposal—not an executable payment instruction.</span>
        <small title={draftRevisionHash}>DRAFT REVISION · {draftRevisionHash.slice(0, 10)}…{draftRevisionHash.slice(-8)}</small>
      </div>

      <section className={`creatorReleasePassport ${readiness.status}`} aria-labelledby="creator-release-passport-title">
        <header>
          <div>
            <p className="eyebrow">RELEASE PASSPORT · PRIVATE</p>
            <h4 id="creator-release-passport-title">Preparation status, not verification or approval</h4>
          </div>
          <span>{readiness.status.toUpperCase()} · {readiness.readyCount}/{readiness.totalCount} READY</span>
        </header>
        <div className="creatorReleaseChecks">
          {readiness.checks.map((item) => (
            <div className={item.status} key={item.id}>
              <span>{item.status === "ready" ? "✓" : item.status === "attention" ? "!" : "×"}</span>
              <div><strong>{item.label}</strong><small>{item.detail}</small></div>
            </div>
          ))}
        </div>
      </section>

      <div className="creatorAssetWorkspace">
        <aside className="creatorAssetList">
          <button type="button" className="creatorAssetNew" onClick={startNew}>+ New rights draft</button>
          {status === "loading" && <p>Loading private drafts…</p>}
          {status === "unavailable" && <p>Private drafts are temporarily unavailable. Nothing was changed.</p>}
          {status === "live" && assets.length === 0 && <p>No asset drafts yet.</p>}
          {assets.map((asset) => (
            <button type="button" className={selectedId === asset.assetId ? "selected" : ""} onClick={() => chooseAsset(asset)} key={asset.assetId}>
              <span>{TYPE_LABELS[asset.assetType]}</span>
              <strong>{asset.title}</strong>
              <small>DRAFT · PRIVATE</small>
            </button>
          ))}
        </aside>

        <form className="creatorAssetEditor" onSubmit={save}>
          <div className="creatorAssetFields">
            <label>Asset type<select value={draft.assetType} onChange={(event) => {
              const assetType = event.target.value as CreatorAssetType;
              setDraft((current) => normalizeCreatorAsset({ ...current, assetType }));
            }}>{allowedTypes.map((type) => <option value={type} key={type}>{TYPE_LABELS[type]}</option>)}</select></label>
            <label>Title<input maxLength={100} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
            <label className="creatorAssetWide">Description<textarea maxLength={1200} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
            {isMusic
              ? <label className="creatorAssetWide">Primary audio or metadata URL<input maxLength={512} inputMode="url" placeholder="https:// or ipfs://" value={draft.primaryMediaUri} onChange={(event) => setDraft((current) => ({ ...current, primaryMediaUri: event.target.value }))} /></label>
              : <div className="creatorAssetWide"><CreatorImageField label="Primary artwork" description="The creator-supplied work represented by this private draft." projectSlug={projectSlug} user={user} value={draft.primaryMediaUri} onChange={(primaryMediaUri) => setDraft((current) => ({ ...current, primaryMediaUri }))} /></div>}
            <div className="creatorAssetWide"><CreatorImageField label={isMusic ? "Cover artwork" : "Preview artwork"} description="Optional public-facing preview candidate. Saving it here does not publish it." projectSlug={projectSlug} user={user} value={draft.previewMediaUri} onChange={(previewMediaUri) => setDraft((current) => ({ ...current, previewMediaUri }))} optional /></div>
          </div>

          <fieldset className="creatorAssetSection">
            <legend>Creation provenance</legend>
            <div className="creatorAssetFields">
              <label>Creation method<select value={draft.creationMethod} onChange={(event) => setDraft((current) => normalizeCreatorAsset({ ...current, creationMethod: event.target.value }))}>{CREATION_METHODS.map((method) => <option value={method} key={method}>{method.replaceAll("_", " ")}</option>)}</select></label>
              {aiUsed && <label>AI tools<input maxLength={327} placeholder="Comma separated · OpenAI, Midjourney…" value={draft.aiTools.join(", ")} onChange={(event) => setDraft((current) => ({ ...current, aiTools: event.target.value.split(",").slice(0, 8) }))} /></label>}
              {aiUsed && <label className="creatorAssetWide">AI contribution disclosure<textarea maxLength={600} placeholder="Explain what AI produced and what the creator selected, changed or finished." value={draft.aiDisclosure} onChange={(event) => setDraft((current) => ({ ...current, aiDisclosure: event.target.value }))} /></label>}
            </div>
          </fieldset>

          <fieldset className="creatorAssetSection">
            <legend>Rights and license</legend>
            <div className="creatorAssetFields">
              <label>Rights basis<select value={draft.rightsBasis} onChange={(event) => setDraft((current) => ({ ...current, rightsBasis: event.target.value as CreatorAssetDraft["rightsBasis"] }))}>{RIGHTS_BASES.map((basis) => <option value={basis} key={basis}>{basis.replaceAll("_", " ")}</option>)}</select></label>
              <label>Intended license<select value={draft.license} onChange={(event) => setDraft((current) => normalizeCreatorAsset({ ...current, license: event.target.value }))}>{ASSET_LICENSES.map((license) => <option value={license} key={license}>{license.replaceAll("_", " ")}</option>)}</select></label>
              <label>Secondary royalty preference<input type="number" min="0" max="10" step="0.01" value={draft.secondaryRoyaltyBps / 100} onChange={(event) => setDraft((current) => ({ ...current, secondaryRoyaltyBps: Math.round(Number(event.target.value) * 100) }))} /><small>0–10%. ERC-2981 can signal this preference; other marketplaces may not honor it.</small></label>
              <label className="creatorAssetWide">Rights statement<textarea maxLength={1000} placeholder="Explain who created the work and the basis for using every included element." value={draft.rightsStatement} onChange={(event) => setDraft((current) => ({ ...current, rightsStatement: event.target.value }))} /></label>
              {draft.license === "custom" && <label className="creatorAssetWide">Custom license URL<input maxLength={512} inputMode="url" placeholder="https://" value={draft.licenseUri} onChange={(event) => setDraft((current) => ({ ...current, licenseUri: event.target.value }))} /></label>}
              <label className="creatorAssetCheck creatorAssetWide"><input type="checkbox" checked={draft.rightsConfirmed} onChange={(event) => setDraft((current) => ({ ...current, rightsConfirmed: event.target.checked }))} /><span>I confirm I control the rights necessary to prepare this asset.</span></label>
              <label className="creatorAssetCheck creatorAssetWide"><input type="checkbox" checked={draft.containsThirdPartyMaterial} onChange={(event) => setDraft((current) => ({ ...current, containsThirdPartyMaterial: event.target.checked, thirdPartyRightsConfirmed: event.target.checked ? current.thirdPartyRightsConfirmed : false }))} /><span>This work contains third-party material, samples, likenesses or trademarks.</span></label>
              {draft.containsThirdPartyMaterial && <label className="creatorAssetCheck creatorAssetWide"><input type="checkbox" checked={draft.thirdPartyRightsConfirmed} onChange={(event) => setDraft((current) => ({ ...current, thirdPartyRightsConfirmed: event.target.checked }))} /><span>I confirm I obtained the permissions required for those elements.</span></label>}
            </div>
          </fieldset>

          <fieldset className="creatorAssetSection">
            <legend>Edition design</legend>
            <div className="creatorAssetFields">
              <label>Edition model<select value={draft.editionMode} onChange={(event) => setDraft((current) => normalizeCreatorAsset({ ...current, editionMode: event.target.value }))}>{EDITION_MODES.map((mode) => <option value={mode} key={mode}>{mode.replaceAll("_", " ")}</option>)}</select></label>
              <label>Maximum editions<input type="number" min={draft.editionMode === "open" ? 0 : 1} max={1_000_000} disabled={draft.editionMode !== "limited"} value={draft.editionSupply} onChange={(event) => setDraft((current) => ({ ...current, editionSupply: Number(event.target.value) }))} /></label>
              {isMusic && <>
                <label>Release format<select value={draft.musicReleaseType} onChange={(event) => setDraft((current) => ({ ...current, musicReleaseType: event.target.value as CreatorAssetDraft["musicReleaseType"] }))}>{MUSIC_RELEASE_TYPES.map((type) => <option value={type} key={type}>{type.toUpperCase()}</option>)}</select></label>
                <label className="creatorAssetCheck"><input type="checkbox" checked={draft.explicitContent} onChange={(event) => setDraft((current) => ({ ...current, explicitContent: event.target.checked }))} /><span>Explicit content</span></label>
                <label className="creatorAssetCheck creatorAssetWide"><input type="checkbox" checked={draft.masterRightsConfirmed} onChange={(event) => setDraft((current) => ({ ...current, masterRightsConfirmed: event.target.checked }))} /><span>I control or am authorized to use the master recording.</span></label>
                <label className="creatorAssetCheck creatorAssetWide"><input type="checkbox" checked={draft.compositionRightsConfirmed} onChange={(event) => setDraft((current) => ({ ...current, compositionRightsConfirmed: event.target.checked }))} /><span>I control or am authorized to use the composition and lyrics.</span></label>
              </>}
            </div>
          </fieldset>

          <fieldset className="creatorAssetSection">
            <legend>Collaborator credits</legend>
            <p>Credits are creator-proposed. RMT calls a collaborator accepted only after the invited wallet signs this exact revision and RMT records the receipt.</p>
            <div className="creatorAssetRows">
              {draft.collaborators.map((collaborator, index) => <div className="creatorAssetRow" key={`collaborator-${index}`}>
                <input aria-label={`Collaborator ${index + 1} name`} maxLength={60} placeholder="Display name" value={collaborator.name} onChange={(event) => updateCollaborator(index, { name: event.target.value })} />
                <select aria-label={`Collaborator ${index + 1} role`} value={collaborator.role} onChange={(event) => updateCollaborator(index, { role: event.target.value as AssetCollaborator["role"] })}>{COLLABORATOR_ROLES.map((role) => <option value={role} key={role}>{role}</option>)}</select>
                <input aria-label={`Collaborator ${index + 1} wallet`} maxLength={42} placeholder="Optional wallet" value={collaborator.walletAddress} onChange={(event) => updateCollaborator(index, { walletAddress: event.target.value })} />
                <button type="button" onClick={() => setDraft((current) => ({ ...current, collaborators: current.collaborators.filter((_, candidate) => candidate !== index) }))}>Remove</button>
              </div>)}
            </div>
            <button type="button" disabled={draft.collaborators.length >= 6} onClick={addCollaborator}>+ Add collaborator</button>
          </fieldset>

          <CreatorConsentLinkBuilder
            assetId={selectedId}
            draft={draft}
            draftRevisionHash={draftRevisionHash}
            projectSlug={projectSlug}
            savedRevisionHash={savedRevisionHash}
            user={user}
            onRecordsChange={setConsentRecords}
          />

          <fieldset className="creatorAssetSection">
            <legend>Proposed revenue split</legend>
            <p>Optional at the draft stage. If added, unique EVM wallets must total exactly 100%. This does not create a splitter or promise revenue.</p>
            <div className="creatorAssetRows">
              {draft.revenueSplits.map((split, index) => <div className="creatorAssetRow revenue" key={`split-${index}`}>
                <input aria-label={`Revenue recipient ${index + 1} label`} maxLength={60} placeholder="Recipient label" value={split.label} onChange={(event) => updateSplit(index, { label: event.target.value })} />
                <input aria-label={`Revenue recipient ${index + 1} wallet`} maxLength={42} placeholder="0x wallet" value={split.walletAddress} onChange={(event) => updateSplit(index, { walletAddress: event.target.value })} />
                <label><span>Percent</span><input type="number" min="0.01" max="100" step="0.01" value={split.shareBps / 100} onChange={(event) => updateSplit(index, { shareBps: Math.round(Number(event.target.value) * 100) })} /></label>
                <button type="button" onClick={() => setDraft((current) => ({ ...current, revenueSplits: current.revenueSplits.filter((_, candidate) => candidate !== index) }))}>Remove</button>
              </div>)}
            </div>
            <div className="creatorSplitFooter"><button type="button" disabled={draft.revenueSplits.length >= 5} onClick={addSplit}>+ Add recipient</button><span className={totalBps === 0 || totalBps === 10_000 ? "valid" : "invalid"}>{(totalBps / 100).toFixed(2)}% / 100%</span></div>
          </fieldset>

          <div className="creatorAssetActions">
            <button type="submit" disabled={saving}>{saving ? "Saving…" : selectedId ? "Update private draft" : "Save private draft"}</button>
            {selectedId && <button type="button" className={deleteArmed ? "danger armed" : "danger"} disabled={saving} onClick={() => void remove()}>{deleteArmed ? "Confirm delete draft" : "Delete draft"}</button>}
          </div>
          {message && <p className="creatorControlMessage" role="status">{message}</p>}
        </form>
      </div>
    </section>
  );
}
