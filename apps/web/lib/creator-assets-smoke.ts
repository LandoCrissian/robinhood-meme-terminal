import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import {
  hashCreatorConsentInvitation,
  validateCreatorConsentInvitation,
  type CreatorConsentInvitation
} from "./creator-consent";

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
assert.match(studioSource, /consent remains unverified/i);
assert.match(studioSource, /Proposed revenue split/);
assert.match(studioSource, /Save private draft/);
assert.doesNotMatch(studioSource, /mintNFT|createListing|executeSplit/);

const cloudSource = readFileSync(new URL("./creator-assets-cloud.ts", import.meta.url), "utf8");
assert.match(cloudSource, /projectAssignments/);
assert.match(cloudSource, /assignment\.ownerId !== verified\.uid/);
assert.match(cloudSource, /status: "draft"/);

console.info("Creator asset and rights foundation smoke test passed");
