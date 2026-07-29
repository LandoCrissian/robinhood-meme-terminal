import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMPTY_CREATOR_ASSET,
  normalizeCreatorAsset,
  parseCreatorAsset,
  validateCreatorAsset
} from "./creator-assets";

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
  status: "draft"
});
assert.equal(parsed?.title, "Neon Robin");
assert.equal(parseCreatorAsset("abcdefghijklmnopqrst", {
  ...parsed,
  revenueSplitTotalBps: 9_999
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
