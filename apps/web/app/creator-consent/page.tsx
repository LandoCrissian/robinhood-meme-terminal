"use client";

import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import {
  CREATOR_CONSENT_SCHEMA_VERSION,
  CREATOR_CONSENT_TERMS,
  CREATOR_CONSENT_TERMS_HASH,
  CREATOR_CONSENT_WITHDRAWAL_TERMS,
  CREATOR_CONSENT_WITHDRAWAL_TERMS_HASH,
  creatorConsentResponseTypedData,
  creatorConsentWithdrawalTypedData,
  decodeCreatorConsentInvitationPacket,
  encodeCreatorConsentPacket,
  type CreatorConsentAction,
  type CreatorConsentInvitationPacket
} from "../../lib/creator-consent";
import { subscribeToCreatorConsentPublicStatus } from "../../lib/creator-consent-cloud";
import { WalletButton } from "../wallet-button";

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function packetFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return decodeCreatorConsentInvitationPacket(params.get("packet") ?? "");
}

export default function CreatorConsentPage() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [packet, setPacket] = useState<CreatorConsentInvitationPacket | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [responseCode, setResponseCode] = useState("");
  const [message, setMessage] = useState("");
  const [registryStatus, setRegistryStatus] = useState<"loading" | "pending" | "revoked" | "accepted" | "rejected" | "withdrawn" | "unavailable">("loading");

  useEffect(() => {
    const read = () => {
      setPacket(packetFromHash());
      setLoaded(true);
      setResponseCode("");
      setMessage("");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!packet) {
      setRegistryStatus("unavailable");
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setRegistryStatus("loading");
    const invitationId = packet.invitationDigest.slice(2);
    void subscribeToCreatorConsentPublicStatus(invitationId, (status) => {
      if (!active) return;
      const matchesPacket = Boolean(
        status
        && status.invitationDigest === packet.invitationDigest
        && status.projectSlug === packet.invitation.projectSlug
        && status.assetId === packet.invitation.assetId
        && status.expiresAt === packet.invitation.expiresAt
      );
      setRegistryStatus(matchesPacket && status
        ? status.status
        : "unavailable");
    }, () => {
      if (active) setRegistryStatus("unavailable");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (active) setRegistryStatus("unavailable");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [packet]);

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const expired = packet ? packet.invitation.expiresAt <= nowSeconds : false;
  const recognizedTerms = packet?.invitation.termsHash === CREATOR_CONSENT_TERMS_HASH;
  const correctWallet = Boolean(
    packet
    && address
    && address.toLowerCase() === packet.invitation.collaboratorWallet
  );
  const correctChain = Boolean(packet && chainId === packet.invitation.chainId);
  const supportedChain = packet?.invitation.chainId === robinhoodChain.id
    || packet?.invitation.chainId === robinhoodChainTestnet.id;
  const target = packet?.invitation.chainId === robinhoodChain.id ? "mainnet" : "testnet";
  const share = packet ? `${(packet.invitation.shareBps / 100).toFixed(2)}%` : "—";
  const expires = useMemo(() => (
    packet ? new Date(packet.invitation.expiresAt * 1_000).toLocaleString() : "—"
  ), [packet]);

  const respond = async (action: CreatorConsentAction) => {
    if (!packet || !address || !walletClient || !correctWallet || !correctChain || expired || !recognizedTerms || registryStatus !== "pending") return;
    setBusy(true);
    setMessage("");
    let signedResponseCode = "";
    try {
      const respondedAt = Math.floor(Date.now() / 1_000);
      const signature = await walletClient.signTypedData({
        account: address,
        ...creatorConsentResponseTypedData(packet.invitation, action, respondedAt)
      });
      const encodedResponse = encodeCreatorConsentPacket({
        kind: "rmt_creator_consent_response",
        response: {
          schemaVersion: CREATOR_CONSENT_SCHEMA_VERSION,
          invitationDigest: packet.invitationDigest,
          action,
          collaboratorWallet: packet.invitation.collaboratorWallet,
          respondedAt,
          signature
        }
      });
      signedResponseCode = encodedResponse;
      setResponseCode(encodedResponse);
      const receipt = await fetch("/api/creator-consent/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseCode: encodedResponse })
      });
      const receiptBody = await receipt.json().catch(() => null) as { error?: unknown; status?: unknown } | null;
      if (receipt.ok && (receiptBody?.status === "accepted" || receiptBody?.status === "rejected")) {
        setMessage(`${receiptBody.status === "accepted" ? "Acceptance" : "Rejection"} recorded by RMT’s trusted receipt service.`);
      } else {
        const detail = typeof receiptBody?.error === "string"
          ? receiptBody.error
          : "The trusted receipt service is temporarily unavailable.";
        setMessage(`${action === "accept" ? "Acceptance" : "Rejection"} signed, but not recorded: ${detail} Keep the response code and try again.`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setMessage(signedResponseCode
        ? "The wallet response was signed, but the receipt service could not be reached. Keep the response code and try again."
        : /rejected|denied|cancelled|canceled/i.test(detail)
        ? "The wallet signature was cancelled. Nothing changed."
        : "The wallet could not sign this response. Nothing changed.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!packet || !address || !walletClient || !correctWallet || !correctChain || registryStatus !== "accepted") return;
    setBusy(true);
    setMessage("");
    try {
      const withdrawnAt = Math.floor(Date.now() / 1_000);
      const signature = await walletClient.signTypedData({
        account: address,
        ...creatorConsentWithdrawalTypedData(packet.invitation, withdrawnAt)
      });
      const withdrawalCode = encodeCreatorConsentPacket({
        kind: "rmt_creator_consent_withdrawal",
        withdrawal: {
          schemaVersion: CREATOR_CONSENT_SCHEMA_VERSION,
          invitationDigest: packet.invitationDigest,
          collaboratorWallet: packet.invitation.collaboratorWallet,
          withdrawnAt,
          termsHash: CREATOR_CONSENT_WITHDRAWAL_TERMS_HASH,
          signature
        }
      });
      setResponseCode(withdrawalCode);
      const receipt = await fetch("/api/creator-consent/withdrawal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdrawalCode })
      });
      const receiptBody = await receipt.json().catch(() => null) as { error?: unknown; status?: unknown } | null;
      if (receipt.ok && receiptBody?.status === "withdrawn") {
        setMessage("Consent withdrawal recorded. This receipt no longer satisfies release readiness.");
      } else {
        const detail = typeof receiptBody?.error === "string"
          ? receiptBody.error
          : "The trusted withdrawal service is temporarily unavailable.";
        setMessage(`Withdrawal signed, but not recorded: ${detail} Keep the response code and try again.`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setMessage(/rejected|denied|cancelled|canceled/i.test(detail)
        ? "The wallet signature was cancelled. The recorded acceptance remains unchanged."
        : "The wallet could not sign this withdrawal. The recorded acceptance remains unchanged.");
    } finally {
      setBusy(false);
    }
  };

  const copyResponse = async () => {
    if (!responseCode) return;
    try {
      await navigator.clipboard.writeText(responseCode);
      setMessage("Response code copied. Send it only through a channel you trust.");
    } catch {
      setMessage("Copy was unavailable. Select the response code manually.");
    }
  };

  if (!loaded) return <main className="creatorConsentPage"><p>Reading private consent packet…</p></main>;
  if (!packet) {
    return <main className="creatorConsentPage"><section className="creatorConsentCard invalid"><p className="eyebrow">RMT CREATOR CONSENT</p><h1>Invitation unavailable</h1><p>This link is incomplete, malformed, or has been altered. Do not connect a wallet or sign anything. Ask the project creator for a new RMT consent link.</p></section></main>;
  }

  return (
    <main className="creatorConsentPage">
      <section className="creatorConsentCard">
        <header>
          <div><p className="eyebrow">REVISION-BOUND CONSENT</p><h1>Review collaborator invitation</h1></div>
          <span>{registryStatus === "withdrawn" ? "WITHDRAWN" : expired && registryStatus === "pending" ? "EXPIRED" : registryStatus === "accepted" ? "ACCEPTED" : registryStatus === "rejected" ? "REJECTED" : "PRIVATE REVIEW"}</span>
        </header>

        <div className="creatorConsentNotice">
          <strong>Creator-supplied information</strong>
          <p>RMT has validated this packet’s structure and fingerprint. RMT has not verified the creator’s rights, identity, promises, or ability to pay.</p>
        </div>

        <dl className="creatorConsentFacts">
          <div><dt>Project</dt><dd>{packet.invitation.projectSlug}</dd></div>
          <div><dt>Asset</dt><dd>{packet.invitation.assetId}</dd></div>
          <div><dt>Collaborator</dt><dd>{packet.invitation.collaboratorName}</dd></div>
          <div><dt>Role</dt><dd>{packet.invitation.collaboratorRole}</dd></div>
          <div><dt>Proposed share</dt><dd>{share}</dd></div>
          <div><dt>Network</dt><dd>{packet.invitation.chainId === robinhoodChain.id ? robinhoodChain.name : packet.invitation.chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet.name : `Chain ${packet.invitation.chainId}`}</dd></div>
          <div><dt>Invited wallet</dt><dd><code>{short(packet.invitation.collaboratorWallet)}</code></dd></div>
          <div><dt>Expires</dt><dd>{expires}</dd></div>
          <div className="wide"><dt>Rights revision</dt><dd><code>{packet.invitation.draftRevisionHash}</code></dd></div>
          <div className="wide"><dt>Invitation fingerprint</dt><dd><code>{packet.invitationDigest}</code></dd></div>
        </dl>

        <div className="creatorConsentTerms">
          <strong>What the signature means</strong>
          <p>{recognizedTerms ? CREATOR_CONSENT_TERMS : "This invitation references unrecognized terms. Signing is disabled."}</p>
        </div>

        {expired && <p className="creatorConsentError">This invitation expired. A wallet signature cannot reactivate it.</p>}
        {registryStatus === "loading" && <p className="creatorConsentRegistry">Checking current invitation status…</p>}
        {registryStatus === "revoked" && <p className="creatorConsentError">The project creator revoked this invitation. Signing is disabled.</p>}
        {registryStatus === "accepted" && <p className="creatorConsentFinal">RMT recorded this wallet’s acceptance before expiration.</p>}
        {registryStatus === "rejected" && <p className="creatorConsentFinal rejected">RMT recorded this wallet’s rejection before expiration.</p>}
        {registryStatus === "withdrawn" && <p className="creatorConsentFinal rejected">The invited wallet withdrew its recorded acceptance. This invitation no longer satisfies release readiness.</p>}
        {registryStatus === "unavailable" && <p className="creatorConsentError">RMT cannot verify the invitation’s current revocation status. Signing is disabled; request a new link.</p>}
        {!supportedChain && <p className="creatorConsentError">This RMT interface does not support the invitation’s network.</p>}
        {!isConnected && !expired && supportedChain && <div className="creatorConsentConnect"><WalletButton target={target} /><small>Connect the exact invited wallet. Connection alone grants no authority.</small></div>}
        {isConnected && !correctWallet && <p className="creatorConsentError">Wrong wallet connected. Use {short(packet.invitation.collaboratorWallet)}.</p>}
        {isConnected && correctWallet && !correctChain && <p className="creatorConsentError">Switch your wallet to chain {packet.invitation.chainId} before signing.</p>}

        <div className="creatorConsentActions">
          <button type="button" disabled={busy || expired || registryStatus !== "pending" || !recognizedTerms || !supportedChain || !correctWallet || !correctChain} onClick={() => void respond("accept")}>{busy ? "Waiting for wallet…" : "Sign acceptance"}</button>
          <button type="button" className="reject" disabled={busy || expired || registryStatus !== "pending" || !recognizedTerms || !supportedChain || !correctWallet || !correctChain} onClick={() => void respond("reject")}>Sign rejection</button>
          {registryStatus === "accepted" && <button type="button" className="reject" disabled={busy || !supportedChain || !correctWallet || !correctChain} onClick={() => void withdraw()}>{busy ? "Waiting for wallet…" : "Withdraw acceptance"}</button>}
        </div>

        {registryStatus === "accepted" && <div className="creatorConsentTerms"><strong>Withdrawal meaning</strong><p>{CREATOR_CONSENT_WITHDRAWAL_TERMS}</p></div>}

        {responseCode && <div className="creatorConsentResponse"><label>Signed response code<textarea readOnly value={responseCode} onFocus={(event) => event.currentTarget.select()} /></label><button type="button" onClick={() => void copyResponse()}>Copy response code</button><small>Keep this signed code as evidence. RMT changes consent state only after its receipt service verifies the exact invitation and invited wallet.</small></div>}
        {message && <p className="creatorControlMessage" role="status">{message}</p>}

        <footer>No minting · No listing · No transfer · No wallet approval · No payment</footer>
      </section>
    </main>
  );
}
