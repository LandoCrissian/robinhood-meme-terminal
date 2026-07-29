import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import {
  EMPTY_CREATOR_ASSET,
  hashCreatorAssetDraft,
  normalizeCreatorAsset,
  parseCreatorAsset,
  validateCreatorAsset
} from "./creator-assets";
import {
  createMarketplaceEconomicsPolicy,
  validateMarketplaceEconomicsPolicy
} from "./creator-economics";
import { evaluateCreatorReleaseReadiness } from "./creator-release-readiness";
import {
  CREATOR_CONSENT_TERMS_HASH,
  creatorConsentResponseTypedData,
  decodeCreatorConsentInvitationPacket,
  decodeCreatorConsentResponsePacket,
  encodeCreatorConsentPacket,
  hashCreatorConsentInvitation,
  verifyCreatorConsentResponse,
  validateCreatorConsentInvitation,
  type CreatorConsentInvitation,
  type CreatorConsentInvitationRecord,
  type CreatorConsentPublicStatus
} from "./creator-consent";
import {
  CreatorConsentReceiptError,
  evaluateCreatorConsentReceipt
} from "./server/creator-consent-receipt";

const validArtwork = {
  ...EMPTY_CREATOR_ASSET,
  title: "Neon Robin",
  description: "An original AI-assisted artwork prepared for a future limited edition.",
  primaryMediaUri: "ipfs://bafyneonrobin",
  creationMethod: "ai_assisted" as const,
  aiTools: ["OpenAI"],
  aiDisclosure: "AI produced composition studies; the creator selected and finished the final work.",
  rightsStatement: "The project creator produced the final work and controls the rights required for this draft.",
  rightsConfirmed: true,
  editionMode: "limited" as const,
  editionSupply: 100,
  collaborators: [{
    name: "RMT Studio",
    role: "artist" as const,
    walletAddress: "",
    consentStatus: "unverified" as const
  }],
  revenueSplits: [{
    label: "RMT Studio",
    walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shareBps: 10_000
  }]
};

assert.equal(validateCreatorAsset(validArtwork), null);
assert.equal(normalizeCreatorAsset({
  ...validArtwork,
  editionMode: "one_of_one",
  editionSupply: 999
}).editionSupply, 1);
assert.equal(normalizeCreatorAsset({
  ...validArtwork,
  editionMode: "open",
  editionSupply: 999
}).editionSupply, 0);
assert.equal(normalizeCreatorAsset({
  ...validArtwork,
  secondaryRoyaltyBps: 1_500
}).secondaryRoyaltyBps, 1_000);
assert.match(validateCreatorAsset({
  ...validArtwork,
  secondaryRoyaltyBps: 1_001
}) ?? "", /between 0% and 10%/);
assert.notEqual(
  hashCreatorAssetDraft(validArtwork),
  hashCreatorAssetDraft({ ...validArtwork, secondaryRoyaltyBps: 500 })
);
assert.deepEqual(normalizeCreatorAsset({
  ...validArtwork,
  creationMethod: "human",
  aiTools: ["should be removed"],
  aiDisclosure: "should be removed"
}).aiTools, []);
assert.match(validateCreatorAsset({
  ...validArtwork,
  creationMethod: "ai_generated",
  aiTools: [],
  aiDisclosure: ""
}) ?? "", /AI tool/);
assert.match(validateCreatorAsset({
  ...validArtwork,
  rightsConfirmed: false
}) ?? "", /control the rights/);
assert.match(validateCreatorAsset({
  ...validArtwork,
  containsThirdPartyMaterial: true,
  thirdPartyRightsConfirmed: false
}) ?? "", /third-party/);
assert.match(validateCreatorAsset({
  ...validArtwork,
  revenueSplits: [
    { label: "Artist", walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", shareBps: 5_000 },
    { label: "Producer", walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", shareBps: 4_999 }
  ]
}) ?? "", /exactly 100%/);
assert.match(validateCreatorAsset({
  ...validArtwork,
  revenueSplits: [
    { label: "Artist", walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", shareBps: 5_000 },
    { label: "Duplicate", walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", shareBps: 5_000 }
  ]
}) ?? "", /unique/);
assert.match(validateCreatorAsset({
  ...validArtwork,
  assetType: "music_release",
  creationMethod: "human",
  aiTools: [],
  aiDisclosure: "",
  masterRightsConfirmed: false,
  compositionRightsConfirmed: true
}) ?? "", /master-recording/);

const parsed = parseCreatorAsset("abcdefghijklmnopqrst", {
  ...validArtwork,
  schemaVersion: 1,
  assetId: "abcdefghijklmnopqrst",
  projectSlug: "runner-studio",
  collaboratorConsentStatus: "unverified",
  revenueSplitTotalBps: 10_000,
  draftRevisionHash: hashCreatorAssetDraft(validArtwork),
  status: "draft"
});
assert.equal(parsed?.title, "Neon Robin");
const { secondaryRoyaltyBps: _legacyRoyaltyPreference, ...legacyArtwork } = validArtwork;
assert.equal(parseCreatorAsset("legacyassetdraft1234", {
  ...legacyArtwork,
  schemaVersion: 1,
  assetId: "legacyassetdraft1234",
  projectSlug: "runner-studio",
  collaboratorConsentStatus: "unverified",
  revenueSplitTotalBps: 10_000,
  draftRevisionHash: hashCreatorAssetDraft(validArtwork),
  status: "draft"
})?.secondaryRoyaltyBps, 0);
assert.equal(parseCreatorAsset("abcdefghijklmnopqrst", {
  ...parsed,
  revenueSplitTotalBps: 9_999
}), null);

const economicsPolicy = createMarketplaceEconomicsPolicy({
  policyName: "RMT marketplace economics draft",
  marketplaceFeeBps: 250,
  allocation: {
    platformOperationsBps: 4_000,
    tokenFlywheelBps: 2_500,
    creatorEcosystemBps: 2_500,
    safetyReserveBps: 1_000
  },
  tokenFlywheelMode: "governance_proposal",
  disclosure: "A disclosed 2.50% platform fee is allocated by this draft policy; token-directed actions require governance and do not guarantee returns."
});
assert.match(economicsPolicy.policyHash, /^0x[0-9a-f]{64}$/);
assert.equal(economicsPolicy.status, "draft");
assert.match(validateMarketplaceEconomicsPolicy({
  ...economicsPolicy,
  allocation: {
    ...economicsPolicy.allocation,
    safetyReserveBps: 999
  }
}) ?? "", /exactly 100%/);
assert.match(validateMarketplaceEconomicsPolicy({
  ...economicsPolicy,
  tokenFlywheelMode: "none"
}) ?? "", /governance proposal/);

const releaseCandidate = {
  ...validArtwork,
  collaborators: [],
  secondaryRoyaltyBps: 500
};
const releaseReadiness = evaluateCreatorReleaseReadiness(releaseCandidate, {
  savedRevisionHash: hashCreatorAssetDraft(releaseCandidate),
  economicsPolicy
});
assert.equal(releaseReadiness.status, "attention");
assert.equal(releaseReadiness.checks.find((candidate) => candidate.id === "revision")?.status, "ready");
assert.equal(releaseReadiness.checks.find((candidate) => candidate.id === "royalty")?.status, "attention");
assert.match(
  releaseReadiness.checks.find((candidate) => candidate.id === "royalty")?.detail ?? "",
  /cannot force external marketplaces/
);
assert.equal(evaluateCreatorReleaseReadiness({
  ...releaseCandidate,
  rightsConfirmed: false
}, {
  economicsPolicy
}).status, "blocked");

const nowSeconds = 2_000_000_000;
const consentInvitation: CreatorConsentInvitation = {
  schemaVersion: 1,
  projectSlug: "runner-studio",
  assetId: "abcdefghijklmnopqrst",
  draftRevisionHash: hashCreatorAssetDraft(validArtwork),
  collaboratorName: "RMT Studio",
  collaboratorRole: "artist",
  collaboratorWallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  shareBps: 2_500,
  chainId: 46_663,
  expiresAt: nowSeconds + 86_400,
  termsHash: `0x${"1".repeat(64)}`,
  nonce: `0x${"2".repeat(64)}`
};
assert.equal(validateCreatorConsentInvitation(consentInvitation, nowSeconds), null);
const consentDigest = hashCreatorConsentInvitation(consentInvitation);
assert.match(consentDigest, /^0x[0-9a-f]{64}$/);
assert.notEqual(hashCreatorConsentInvitation({
  ...consentInvitation,
  shareBps: 2_501
}), consentDigest);
assert.notEqual(hashCreatorConsentInvitation({
  ...consentInvitation,
  draftRevisionHash: `0x${"3".repeat(64)}`
}), consentDigest);
assert.match(validateCreatorConsentInvitation({
  ...consentInvitation,
  expiresAt: nowSeconds - 1
}, nowSeconds) ?? "", /expired/);

const collaboratorAccount = privateKeyToAccount(`0x${"4".repeat(64)}`);
const signedInvitation: CreatorConsentInvitation = {
  ...consentInvitation,
  collaboratorWallet: collaboratorAccount.address.toLowerCase() as `0x${string}`,
  termsHash: CREATOR_CONSENT_TERMS_HASH
};
const invitationPacket = {
  kind: "rmt_creator_consent_invitation" as const,
  invitation: signedInvitation,
  invitationDigest: hashCreatorConsentInvitation(signedInvitation)
};
const invitationCode = encodeCreatorConsentPacket(invitationPacket);
assert.deepEqual(decodeCreatorConsentInvitationPacket(invitationCode), invitationPacket);
assert.equal(decodeCreatorConsentInvitationPacket(`${invitationCode}tampered`), null);

async function testSignedConsentResponse() {
  const respondedAt = nowSeconds + 60;
  const signature = await collaboratorAccount.signTypedData(
    creatorConsentResponseTypedData(signedInvitation, "accept", respondedAt)
  );
  const responsePacket = {
    kind: "rmt_creator_consent_response" as const,
    response: {
      schemaVersion: 1 as const,
      invitationDigest: invitationPacket.invitationDigest,
      action: "accept" as const,
      collaboratorWallet: signedInvitation.collaboratorWallet,
      respondedAt,
      signature
    }
  };
  const responseCode = encodeCreatorConsentPacket(responsePacket);
  assert.deepEqual(decodeCreatorConsentResponsePacket(responseCode), responsePacket);
  assert.equal(await verifyCreatorConsentResponse(signedInvitation, responsePacket.response), true);
  assert.equal(await verifyCreatorConsentResponse({
    ...signedInvitation,
    nonce: `0x${"5".repeat(64)}`
  }, responsePacket.response).catch(() => false), false);
  assert.equal(decodeCreatorConsentResponsePacket(encodeCreatorConsentPacket({
    ...responsePacket,
    response: { ...responsePacket.response, signature: "0x1234" }
  } as never)), null);

  const invitationRecord: CreatorConsentInvitationRecord = {
    ...signedInvitation,
    invitationId: invitationPacket.invitationDigest.slice(2),
    invitationDigest: invitationPacket.invitationDigest,
    status: "pending",
    revokedAt: null,
    responseAction: null,
    responseSignature: null,
    respondedAt: null,
    signerWallet: null,
    receivedAt: null
  };
  const publicStatus: CreatorConsentPublicStatus = {
    schemaVersion: 1,
    invitationId: invitationRecord.invitationId,
    invitationDigest: invitationRecord.invitationDigest,
    projectSlug: invitationRecord.projectSlug,
    assetId: invitationRecord.assetId,
    status: "pending",
    expiresAt: invitationRecord.expiresAt
  };
  const evaluated = await evaluateCreatorConsentReceipt({
    asset: parsed,
    invitation: invitationRecord,
    nowSeconds: respondedAt,
    publicStatus,
    response: responsePacket.response
  });
  assert.deepEqual(evaluated, { status: "accepted", action: "accept", idempotent: false });

  const finalRecord: CreatorConsentInvitationRecord = {
    ...invitationRecord,
    status: "accepted",
    responseAction: "accept",
    responseSignature: responsePacket.response.signature,
    respondedAt,
    signerWallet: signedInvitation.collaboratorWallet,
    receivedAt: {}
  };
  assert.deepEqual(await evaluateCreatorConsentReceipt({
    asset: parsed,
    invitation: finalRecord,
    nowSeconds: respondedAt + 1,
    publicStatus: { ...publicStatus, status: "accepted" },
    response: responsePacket.response
  }), { status: "accepted", action: "accept", idempotent: true });

  async function expectReceiptFailure(
    code: CreatorConsentReceiptError["code"],
    overrides: Partial<Parameters<typeof evaluateCreatorConsentReceipt>[0]>
  ) {
    await assert.rejects(
      evaluateCreatorConsentReceipt({
        asset: parsed,
        invitation: invitationRecord,
        nowSeconds: respondedAt,
        publicStatus,
        response: responsePacket.response,
        ...overrides
      }),
      (error: unknown) => error instanceof CreatorConsentReceiptError && error.code === code
    );
  }
  await expectReceiptFailure("revoked", {
    invitation: { ...invitationRecord, status: "revoked", revokedAt: {} },
    publicStatus: { ...publicStatus, status: "revoked" }
  });
  await expectReceiptFailure("expired", { nowSeconds: invitationRecord.expiresAt });
  await expectReceiptFailure("stale_revision", {
    asset: { ...parsed!, draftRevisionHash: `0x${"6".repeat(64)}` }
  });
  await expectReceiptFailure("conflict", {
    invitation: finalRecord,
    publicStatus: { ...publicStatus, status: "accepted" },
    response: { ...responsePacket.response, respondedAt: respondedAt + 1 }
  });
  await expectReceiptFailure("invalid", {
    invitation: finalRecord,
    publicStatus: { ...publicStatus, status: "rejected" }
  });
  await expectReceiptFailure("invalid", {
    response: { ...responsePacket.response, respondedAt: respondedAt + 301 },
    nowSeconds: respondedAt
  });

  const attacker = privateKeyToAccount(`0x${"7".repeat(64)}`);
  const attackerSignature = await attacker.signTypedData(
    creatorConsentResponseTypedData(signedInvitation, "accept", respondedAt)
  );
  await expectReceiptFailure("wrong_signer", {
    response: { ...responsePacket.response, signature: attackerSignature }
  });

  const consentReadyDraft = {
    ...validArtwork,
    collaborators: [{
      name: signedInvitation.collaboratorName,
      role: signedInvitation.collaboratorRole,
      walletAddress: signedInvitation.collaboratorWallet,
      consentStatus: "unverified" as const
    }],
    revenueSplits: [{
      label: signedInvitation.collaboratorName,
      walletAddress: signedInvitation.collaboratorWallet,
      shareBps: signedInvitation.shareBps
    }, {
      label: "Creator",
      walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      shareBps: 10_000 - signedInvitation.shareBps
    }]
  };
  const consentReadyRevision = hashCreatorAssetDraft(consentReadyDraft);
  const matchingReceipt = {
    ...finalRecord,
    draftRevisionHash: consentReadyRevision
  };
  assert.equal(
    evaluateCreatorReleaseReadiness(consentReadyDraft, {
      savedRevisionHash: consentReadyRevision,
      economicsPolicy,
      consentRecords: [matchingReceipt]
    }).checks.find((candidate) => candidate.id === "consent")?.status,
    "ready"
  );
}
assert.equal(parseCreatorAsset("abcdefghijklmnopqrst", {
  ...parsed,
  title: "Changed without a new revision hash"
}), null);
assert.equal(parseCreatorAsset("abcdefghijklmnopqrst", {
  ...parsed,
  status: "published"
}), null);

const studioSource = readFileSync(new URL("../app/creator-asset-studio.tsx", import.meta.url), "utf8");
assert.match(studioSource, /No minting\. No marketplace\. No payouts\./);
assert.match(studioSource, /revision-bound/i);
assert.match(studioSource, /Proposed revenue split/);
assert.match(studioSource, /Save private draft/);
assert.match(studioSource, /RELEASE PASSPORT · PRIVATE/);
assert.match(studioSource, /ERC-2981 can signal this preference/);
assert.doesNotMatch(studioSource, /mintNFT|createListing|executeSplit/);

const consentPageSource = readFileSync(new URL("../app/creator-consent/page.tsx", import.meta.url), "utf8");
assert.match(consentPageSource, /Creator-supplied information/);
assert.match(consentPageSource, /trusted receipt service/);
assert.match(consentPageSource, /No minting · No listing · No transfer/);
assert.match(consentPageSource, /current revocation status/);

const cloudSource = readFileSync(new URL("./creator-assets-cloud.ts", import.meta.url), "utf8");
assert.match(cloudSource, /projectAssignments/);
assert.match(cloudSource, /assignment\.ownerId !== verified\.uid/);
assert.match(cloudSource, /status: "draft"/);

const consentCloudSource = readFileSync(new URL("./creator-consent-cloud.ts", import.meta.url), "utf8");
assert.match(consentCloudSource, /creatorConsentStatuses/);
assert.match(consentCloudSource, /status: "pending"/);
assert.match(consentCloudSource, /status: "revoked"/);
assert.doesNotMatch(consentCloudSource, /status: "accepted"/);

const consentReceiptSource = readFileSync(
  new URL("../app/api/creator-consent/receipt/route.ts", import.meta.url),
  "utf8"
);
assert.match(consentReceiptSource, /runTransaction/);
assert.match(consentReceiptSource, /FieldValue\.serverTimestamp/);
assert.match(consentReceiptSource, /evaluateCreatorConsentReceipt/);
assert.doesNotMatch(consentReceiptSource, /console\.(log|info|debug)/);

void testSignedConsentResponse().then(() => {
  console.info("Creator asset and rights foundation smoke test passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
