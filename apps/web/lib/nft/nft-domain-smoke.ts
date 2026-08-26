import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import {
  RMT_CURATED_NFT_PROJECTS,
  RMT_NFT_CHAIN_ID,
  activeRmtCuratedNftProjects,
  defineRmtCuratedNftProject,
  rmtCuratedNftProject,
  type RmtNftCollectionRegistryEntry
} from "./project-registry";
import { verifyRmtNftCollection } from "./collection-verification";

const CCFF00_COLLECTION = "0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146" as const;

assert.equal(RMT_CURATED_NFT_PROJECTS.length, 1, "The initial RMT NFT registry must contain only owner-supplied projects.");
assert.equal(activeRmtCuratedNftProjects().length, 1);
assert.equal(rmtCuratedNftProject("CCFF00")?.displayName, "CCFF00");
assert.equal(rmtCuratedNftProject("ccff00")?.collections[0]?.contractAddress, CCFF00_COLLECTION);
assert.equal(rmtCuratedNftProject("ccff00")?.projectToken, null,
  "Onchain token hints must not become an RMT project-token association without owner confirmation.");
assert.equal(
  RMT_CURATED_NFT_PROJECTS.flatMap((project) => project.links).some((link) => /hoodstreet/i.test(link.url)),
  false,
  "The independent RMT registry must not imply a HoodStreet relationship."
);

assert.throws(() => defineRmtCuratedNftProject({
  projectId: "not-approved",
  displayName: "Not Approved",
  status: "WATCHING",
  ownerApproved: false,
  approvedAt: "2026-08-26T00:00:00.000Z",
  officialProjectEvidence: [],
  links: [],
  collections: [{
    chainId: RMT_NFT_CHAIN_ID,
    contractAddress: "0x1111111111111111111111111111111111111111",
    declaredStandard: "ERC721",
    verificationStatus: "PENDING"
  }],
  projectToken: null
}), /owner-approved/);

assert.throws(() => defineRmtCuratedNftProject({
  projectId: "duplicate-contracts",
  displayName: "Duplicate contracts",
  status: "ACTIVE",
  ownerApproved: true,
  approvedAt: "2026-08-26T00:00:00.000Z",
  officialProjectEvidence: [],
  links: [],
  collections: [
    {
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0x1111111111111111111111111111111111111111",
      declaredStandard: "ERC721",
      verificationStatus: "PENDING"
    },
    {
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0x1111111111111111111111111111111111111111",
      declaredStandard: "ERC721",
      verificationStatus: "PENDING"
    }
  ],
  projectToken: null
}), /duplicate collection contracts/);

const collection: RmtNftCollectionRegistryEntry = {
  chainId: RMT_NFT_CHAIN_ID,
  contractAddress: CCFF00_COLLECTION,
  declaredStandard: "ERC721",
  verificationStatus: "PENDING"
};

function fakeClient(options: {
  chainId?: number;
  bytecode?: `0x${string}` | undefined;
  erc721?: boolean;
  erc721Metadata?: boolean;
  erc1155?: boolean;
  erc1155Metadata?: boolean;
}) {
  return {
    getChainId: async () => options.chainId ?? RMT_NFT_CHAIN_ID,
    getBytecode: async () => options.bytecode === undefined ? "0x60016001" : options.bytecode,
    readContract: async (request: { functionName?: string; args?: readonly unknown[] }) => {
      if (request.functionName === "supportsInterface") {
        switch (request.args?.[0]) {
          case "0x80ac58cd": return options.erc721 ?? true;
          case "0x5b5e139f": return options.erc721Metadata ?? true;
          case "0xd9b67a26": return options.erc1155 ?? false;
          case "0x0e89341c": return options.erc1155Metadata ?? false;
          default: return false;
        }
      }
      if (request.functionName === "name") return "CCFF00";
      if (request.functionName === "symbol") return "CCFF00";
      throw new Error("Unexpected fake contract read.");
    }
  } as unknown as PublicClient;
}

const verified = await verifyRmtNftCollection(collection, {
  client: fakeClient({}),
  readActivityEvidence: async () => ({
    status: "OBSERVED",
    transactionHash: `0x${"11".repeat(32)}`,
    blockNumber: "1"
  }),
  now: () => new Date("2026-08-26T12:00:00.000Z")
});
assert.equal(verified.status, "VERIFIED");
if (verified.status === "VERIFIED") {
  assert.equal(verified.verification.chainId, 4_663);
  assert.equal(verified.verification.standard, "ERC721");
  assert.equal(verified.verification.name, "CCFF00");
  assert.equal(verified.verification.symbol, "CCFF00");
  assert.equal(verified.verification.metadataCapability, "ERC721_METADATA");
  assert.equal(verified.verification.activityEvidence.status, "OBSERVED");
}

const wrongChain = await verifyRmtNftCollection(collection, { client: fakeClient({ chainId: 1 }) });
assert.equal(wrongChain.status, "REJECTED");
if (wrongChain.status === "REJECTED") assert.equal(wrongChain.verification.reason, "WRONG_CHAIN");

const noCode = await verifyRmtNftCollection(collection, { client: fakeClient({ bytecode: "0x" }) });
assert.equal(noCode.status, "REJECTED");
if (noCode.status === "REJECTED") assert.equal(noCode.verification.reason, "NO_CONTRACT_CODE");

const noStandard = await verifyRmtNftCollection(collection, {
  client: fakeClient({ erc721: false, erc1155: false })
});
assert.equal(noStandard.status, "REJECTED");
if (noStandard.status === "REJECTED") assert.equal(noStandard.verification.reason, "UNSUPPORTED_NFT_STANDARD");

const standardMismatch = await verifyRmtNftCollection(collection, {
  client: fakeClient({ erc721: false, erc1155: true, erc1155Metadata: true })
});
assert.equal(standardMismatch.status, "REJECTED");
if (standardMismatch.status === "REJECTED") assert.equal(standardMismatch.verification.reason, "DECLARED_STANDARD_MISMATCH");

console.log("RMT NFT domain keeps curated admission, technical collection identity, and project-token association separate.");
