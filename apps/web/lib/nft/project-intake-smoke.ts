import assert from "node:assert/strict";
import {
  RMT_NFT_PROJECT_INTAKE,
  defineRmtNftProjectIntakeCatalog,
  defineRmtNftProjectIntakeRecord,
  readyRmtNftProjectIntakeRecords,
  rmtNftProjectIntakeRecord
} from "./project-intake";
import { RMT_NFT_CHAIN_ID } from "./project-registry";

const HOPIUM_ASSET_ADDRESS = "0xb6ce51925c2e397ebf1a443b343d19267b3d4225";
const PEEPS_ASSET_ADDRESS = "0xf202de51bb42a0073948b0971707d14c54ef5f44";

function intakeAddress(projectId: string) {
  return rmtNftProjectIntakeRecord(projectId)?.collections[0]?.contractAddress?.toLowerCase() ?? null;
}

assert.equal(RMT_NFT_PROJECT_INTAKE.length, 8);
assert.equal(readyRmtNftProjectIntakeRecords().length, 6);

assert.equal(intakeAddress("hopium-machines"), "0x7da15c761409cb921a81f0e003704cff418b700b");
const hopiumAssociation = rmtNftProjectIntakeRecord("hopium-machines")?.projectToken;
assert.equal(hopiumAssociation?.status, "CONFIRMED");
if (hopiumAssociation?.status === "CONFIRMED") {
  assert.equal(hopiumAssociation.contractAddress.toLowerCase(), HOPIUM_ASSET_ADDRESS);
  assert.equal(hopiumAssociation.association, "OWNER_CONFIRMED_PROJECT_TOKEN");
  assert.ok(hopiumAssociation.evidence.length >= 1);
}

assert.equal(intakeAddress("robin-rabbits"), "0xb87522e093858d992b7555077ff3541597deb34e");
assert.equal(intakeAddress("cannacats"), "0x289c8ce652f38029867842048068b39bd0464a3f");
assert.equal(intakeAddress("pixel-hood-minis"), "0x8215824669c453136cabe59a079c32aca2f87cd5");
assert.equal(intakeAddress("gogh-punks"), "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6");
assert.equal(intakeAddress("clay-stonkz"), "0xde0acefc89d4cf5f4ce45a4fb8a51aa355091b44");

const worldWeedSeeds = rmtNftProjectIntakeRecord("world-weed-seeds");
assert.equal(worldWeedSeeds?.state, "NEEDS_COLLECTION_RESOLUTION");
assert.equal(worldWeedSeeds?.collections[0]?.contractAddress, null);

const peeps = rmtNftProjectIntakeRecord("peeps");
assert.equal(peeps?.state, "WAITING_FOR_COLLECTION");
assert.equal(peeps?.collections.length, 0);
assert.equal(peeps?.projectToken.status, "CONFIRMED");
if (peeps?.projectToken.status === "CONFIRMED") {
  assert.equal(peeps.projectToken.contractAddress.toLowerCase(), PEEPS_ASSET_ADDRESS);
  assert.ok(peeps.projectToken.evidence.some((item) => item.url.startsWith("https://peeps.wtf/")));
}

for (const projectId of ["robin-rabbits", "cannacats", "pixel-hood-minis", "gogh-punks", "clay-stonkz"]) {
  assert.equal(
    rmtNftProjectIntakeRecord(projectId)?.projectToken.status,
    "UNCONFIRMED",
    `${projectId} must not gain a project-token association from ticker/name similarity.`
  );
}

assert.equal(
  RMT_NFT_PROJECT_INTAKE.flatMap((record) => record.references).some((reference) => /hoodstreet/i.test(reference.url)),
  false,
  "RMT project intake must not imply HoodStreet involvement."
);

assert.throws(() => defineRmtNftProjectIntakeRecord({
  projectId: "not-approved",
  displayName: "Not approved",
  state: "WAITING_FOR_COLLECTION",
  ownerApproved: false,
  approvedAt: "2026-08-27T00:11:00.000Z",
  references: [],
  collections: [],
  projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
} as never), /owner approval/);

assert.throws(() => defineRmtNftProjectIntakeRecord({
  projectId: "unresolved-ready",
  displayName: "Unresolved Ready",
  state: "READY_FOR_TECHNICAL_VERIFICATION",
  ownerApproved: true,
  approvedAt: "2026-08-27T00:11:00.000Z",
  references: [],
  collections: [{
    chainId: RMT_NFT_CHAIN_ID,
    contractAddress: null,
    declaredStandard: null,
    verificationStatus: "PENDING",
    referenceUrl: "https://example.com/collection"
  }],
  projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
}), /resolved collection contract/);

assert.throws(() => defineRmtNftProjectIntakeRecord({
  projectId: "waiting-with-contract",
  displayName: "Waiting With Contract",
  state: "WAITING_FOR_COLLECTION",
  ownerApproved: true,
  approvedAt: "2026-08-27T00:11:00.000Z",
  references: [],
  collections: [{
    chainId: RMT_NFT_CHAIN_ID,
    contractAddress: "0x1111111111111111111111111111111111111111",
    declaredStandard: "ERC721",
    verificationStatus: "PENDING",
    referenceUrl: "https://example.com/collection"
  }],
  projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
}), /must not claim a collection contract/);

assert.throws(() => defineRmtNftProjectIntakeRecord({
  projectId: "token-without-evidence",
  displayName: "Token Without Evidence",
  state: "WAITING_FOR_COLLECTION",
  ownerApproved: true,
  approvedAt: "2026-08-27T00:11:00.000Z",
  references: [],
  collections: [],
  projectToken: {
    status: "CONFIRMED",
    chainId: RMT_NFT_CHAIN_ID,
    contractAddress: "0x2222222222222222222222222222222222222222",
    association: "OWNER_CONFIRMED_PROJECT_TOKEN",
    verificationStatus: "PENDING",
    evidence: []
  }
}), /require association evidence/);

const duplicate = rmtNftProjectIntakeRecord("cannacats");
assert.ok(duplicate);
assert.throws(() => defineRmtNftProjectIntakeCatalog([duplicate!, duplicate!]), /Duplicate RMT NFT intake project id/);

console.log("RMT NFT project intake is owner-controlled, evidence-bound, and safe for staged post-live additions.");
