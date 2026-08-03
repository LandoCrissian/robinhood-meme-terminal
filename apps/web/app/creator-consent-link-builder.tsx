"use client";

import type { User } from "firebase/auth";
import { bytesToHex, getAddress, isAddress, type Address } from "viem";
import { useEffect, useState } from "react";
import {
  CREATOR_CONSENT_SCHEMA_VERSION,
  CREATOR_CONSENT_TERMS_HASH,
  decodeCreatorConsentResponsePacket,
  encodeCreatorConsentPacket,
  hashCreatorConsentInvitation,
  normalizeCreatorConsentInvitation,
  verifyCreatorConsentResponse,
  type CreatorConsentInvitationPacket,
  type CreatorConsentInvitationRecord
} from "../lib/creator-consent";
import {
  revokeCreatorConsentInvitation,
  saveCreatorConsentInvitation,
  subscribeToCreatorConsentInvitations
} from "../lib/creator-consent-cloud";
import { activeChain } from "../lib/network";
import type { CreatorAssetDraft } from "../lib/creator-assets";

type PreparedInvitation = {
  packet: CreatorConsentInvitationPacket;
  url: string;
};

function randomNonce() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function CreatorConsentLinkBuilder({
  assetId,
  draft,
  draftRevisionHash,
  projectSlug,
  savedRevisionHash,
  user,
  onRecordsChange
}: {
  assetId: string;
  draft: CreatorAssetDraft;
  draftRevisionHash: `0x${string}`;
  projectSlug: string;
  savedRevisionHash?: `0x${string}`;
  user: User;
  onRecordsChange?: (records: CreatorConsentInvitationRecord[]) => void;
}) {
  const [prepared, setPrepared] = useState<Record<number, PreparedInvitation>>({});
  const [records, setRecords] = useState<CreatorConsentInvitationRecord[]>([]);
  const [responseCode, setResponseCode] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const revisionSaved = Boolean(assetId && savedRevisionHash === draftRevisionHash);

  useEffect(() => {
    if (!assetId) {
      setRecords([]);
      onRecordsChange?.([]);
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToCreatorConsentInvitations(user, projectSlug, assetId, (next) => {
      if (active) {
        setRecords(next);
        onRecordsChange?.(next);
      }
    }, () => {
      if (active) setMessage("Saved consent invitations are temporarily unavailable.");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (active) setMessage("Saved consent invitations are temporarily unavailable.");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [assetId, onRecordsChange, projectSlug, user]);

  const proposedShare = (wallet: string) => draft.revenueSplits.find(
    (split) => split.walletAddress.toLowerCase() === wallet.toLowerCase()
  )?.shareBps ?? 0;

  const prepare = async (index: number) => {
    const collaborator = draft.collaborators[index];
    if (!revisionSaved) {
      setMessage("Save the current asset revision before preparing a collaborator link.");
      return;
    }
    if (!isAddress(collaborator.walletAddress, { strict: false })) {
      setMessage("Add the collaborator's valid EVM wallet before preparing consent.");
      return;
    }
    const now = Math.floor(Date.now() / 1_000);
    const invitation = {
      schemaVersion: CREATOR_CONSENT_SCHEMA_VERSION,
      projectSlug,
      assetId,
      draftRevisionHash,
      collaboratorName: collaborator.name,
      collaboratorRole: collaborator.role,
      collaboratorWallet: getAddress(collaborator.walletAddress).toLowerCase() as Address,
      shareBps: proposedShare(collaborator.walletAddress),
      chainId: activeChain.id,
      expiresAt: now + 7 * 24 * 60 * 60,
      termsHash: CREATOR_CONSENT_TERMS_HASH,
      nonce: randomNonce()
    } as const;
    const packet: CreatorConsentInvitationPacket = {
      kind: "rmt_creator_consent_invitation",
      invitation,
      invitationDigest: hashCreatorConsentInvitation(invitation)
    };
    const url = `${window.location.origin}/creator-consent#packet=${encodeCreatorConsentPacket(packet)}`;
    setBusyId(`prepare-${index}`);
    setMessage("");
    try {
      await saveCreatorConsentInvitation(user, invitation);
      setPrepared((current) => ({ ...current, [index]: { packet, url } }));
      setMessage("Private consent invitation saved and link prepared. It has not been sent or accepted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The private consent invitation could not be saved.");
    } finally {
      setBusyId("");
    }
  };

  const copy = async (index: number) => {
    const invitation = prepared[index];
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.url);
      setMessage("Consent link copied. Send it directly to the invited wallet owner.");
    } catch {
      setMessage("Copy was unavailable. Select the consent link manually.");
    }
  };

  const inspectResponse = async () => {
    const response = decodeCreatorConsentResponsePacket(responseCode.trim());
    if (!response) {
      setMessage("The signed response code is malformed or incomplete.");
      return;
    }
    const preparedInvitation = Object.values(prepared).find(
      (candidate) => candidate.packet.invitationDigest === response.response.invitationDigest
    );
    const savedRecord = records.find(
      (candidate) => candidate.invitationDigest === response.response.invitationDigest
    );
    const savedInvitation = savedRecord ? normalizeCreatorConsentInvitation(savedRecord) : null;
    const invitation = preparedInvitation?.packet.invitation ?? savedInvitation;
    if (!invitation) {
      setMessage("This response does not match a saved consent invitation.");
      return;
    }
    try {
      if (savedRecord?.status === "revoked") {
        setMessage("The signature is linked to a revoked invitation and cannot become a final receipt.");
        return;
      }
      if (savedRecord?.status === "accepted" || savedRecord?.status === "rejected") {
        setMessage(`RMT already recorded this invitation as ${savedRecord.status}. Final receipts cannot be replaced.`);
        return;
      }
      if (savedRecord && savedRecord.expiresAt <= Math.floor(Date.now() / 1_000)) {
        setMessage("The signature is linked to an expired invitation and cannot become a final receipt.");
        return;
      }
      const valid = await verifyCreatorConsentResponse(invitation, response.response);
      setMessage(valid
        ? `Valid ${response.response.action} signature from ${short(response.response.collaboratorWallet)}. This is cryptographic evidence, not a final server receipt.`
        : "The signature does not belong to the invited collaborator wallet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The response signature could not be verified.");
    }
  };

  const linkForRecord = (record: CreatorConsentInvitationRecord) => {
    const invitation = normalizeCreatorConsentInvitation(record);
    if (!invitation) return "";
    return `${window.location.origin}/creator-consent#packet=${encodeCreatorConsentPacket({
      kind: "rmt_creator_consent_invitation",
      invitation,
      invitationDigest: record.invitationDigest
    })}`;
  };

  const copyRecord = async (record: CreatorConsentInvitationRecord) => {
    try {
      await navigator.clipboard.writeText(linkForRecord(record));
      setMessage("Saved consent link copied.");
    } catch {
      setMessage("Copy was unavailable.");
    }
  };

  const revoke = async (record: CreatorConsentInvitationRecord) => {
    setBusyId(record.invitationId);
    setMessage("");
    try {
      await revokeCreatorConsentInvitation(user, projectSlug, assetId, record.invitationId);
      setMessage("Invitation revoked. A returned response cannot become a final receipt.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The invitation could not be revoked.");
    } finally {
      setBusyId("");
    }
  };

  if (draft.collaborators.length === 0) return null;

  return (
    <fieldset className="creatorAssetSection creatorConsentBuilder">
      <legend>Collaborator consent links</legend>
      <p>Prepare a seven-day, wallet-specific link for the exact saved revision. Links include the collaborator name, wallet, role and proposed share. Release readiness changes only after RMT validates and records the invited wallet’s signed response.</p>
      {!revisionSaved && <p className="creatorConsentBuilderWarning">Save the current revision to enable consent links. Any later edit changes the fingerprint and invalidates these links for release readiness.</p>}
      <div className="creatorConsentBuilderRows">
        {draft.collaborators.map((collaborator, index) => {
          const invitation = prepared[index];
          const walletReady = isAddress(collaborator.walletAddress, { strict: false });
          return <div key={`consent-${index}`}>
            <div><strong>{collaborator.name || `Collaborator ${index + 1}`}</strong><small>{collaborator.role} · {walletReady ? short(collaborator.walletAddress) : "wallet required"} · {(proposedShare(collaborator.walletAddress) / 100).toFixed(2)}% proposed</small></div>
            <button type="button" disabled={Boolean(busyId) || !revisionSaved || !walletReady || collaborator.name.trim().length < 2} onClick={() => void prepare(index)}>{busyId === `prepare-${index}` ? "Saving…" : invitation ? "Replace link" : "Prepare link"}</button>
            {invitation && <><input aria-label={`${collaborator.name} consent link`} readOnly value={invitation.url} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => void copy(index)}>Copy</button></>}
          </div>;
        })}
      </div>
      {records.length > 0 && <div className="creatorConsentSaved">
        <strong>Saved invitation history</strong>
        {records.map((record) => {
          const expired = record.expiresAt <= Math.floor(Date.now() / 1_000);
          return <div key={record.invitationId}>
            <span className={record.status}>{record.status === "pending" && expired ? "EXPIRED" : record.status.toUpperCase()}</span>
            <div><b>{record.collaboratorName}</b><small>{record.collaboratorRole} · {short(record.collaboratorWallet)} · revision {short(record.draftRevisionHash)}</small></div>
            <button type="button" disabled={record.status !== "pending" || expired} onClick={() => void copyRecord(record)}>Copy</button>
            <button type="button" className="revoke" disabled={Boolean(busyId) || record.status !== "pending"} onClick={() => void revoke(record)}>{busyId === record.invitationId ? "Revoking…" : "Revoke"}</button>
          </div>;
        })}
      </div>}
      {(records.length > 0 || Object.keys(prepared).length > 0) && <div className="creatorConsentImport">
        <label>Inspect returned signed response<textarea placeholder="Paste the response code the collaborator returns…" value={responseCode} onChange={(event) => setResponseCode(event.target.value)} /></label>
        <button type="button" disabled={!responseCode.trim()} onClick={() => void inspectResponse()}>Verify response signature</button>
      </div>}
      {message && <p className="creatorControlMessage" role="status">{message}</p>}
    </fieldset>
  );
}
