import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  getAddress,
  zeroAddress,
  type Hex,
  type PublicClient
} from "viem";
import {
  RMT_CURATED_NFT_PROJECTS,
  RMT_NFT_CHAIN_ID,
  activeRmtCuratedNftProjects,
  defineRmtCuratedNftProject,
  rmtCuratedNftProject,
  type RmtNftCollectionRegistryEntry,
  type RmtNftProjectTokenRegistryEntry
} from "./project-registry";
import { verifyRmtNftCollection } from "./collection-verification";
import { verifyRmtNftProjectToken } from "./project-token-verification";
import {
  RMT_ERC721_TRANSFER_TOPIC,
  RMT_ERC1155_TRANSFER_BATCH_TOPIC,
  RMT_ERC1155_TRANSFER_SINGLE_TOPIC,
  compareRmtNftActivityObservations,
  decodeRmtNftActivityLog,
  decodeVerifiedRmtNftActivityLog,
  resolveRmtNftActivityCollection,
  type RmtNftActivityCollectionContext,
  type RmtNftRawLog
} from "./activity-domain";

const CCFF00_COLLECTION = "0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146" as const;
const RECEIVER = getAddress("0x3333333333333333333333333333333333333333");
const SENDER = getAddress("0x4444444444444444444444444444444444444444");
const OPERATOR = getAddress("0x5555555555555555555555555555555555555555");
const ERC1155_FIXTURE = getAddress("0x6666666666666666666666666666666666666666");

function addressTopic(address: string): Hex {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex;
}

function uintTopic(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function rawLog(overrides: Partial<RmtNftRawLog> = {}): RmtNftRawLog {
  return {
    chainId: RMT_NFT_CHAIN_ID,
    address: CCFF00_COLLECTION,
    topics: [
      RMT_ERC721_TRANSFER_TOPIC,
      addressTopic(zeroAddress),
      addressTopic(RECEIVER),
      uintTopic(470n)
    ],
    data: "0x",
    transactionHash: `0x${"11".repeat(32)}`,
    blockHash: `0x${"22".repeat(32)}`,
    blockNumber: 100n,
    logIndex: 7,
    ...overrides
  };
}

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

async function main() {
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

  const exampleProjectToken: RmtNftProjectTokenRegistryEntry = {
    chainId: RMT_NFT_CHAIN_ID,
    contractAddress: "0x2222222222222222222222222222222222222222",
    association: "OWNER_CONFIRMED_PROJECT_TOKEN",
    ownerConfirmedAt: "2026-08-26T12:00:00.000Z",
    verificationStatus: "PENDING"
  };
  const verifiedProjectToken = await verifyRmtNftProjectToken(exampleProjectToken, {
    readIdentity: async (address) => ({ address, symbol: "EXAMPLE", decimals: 18, native: false }),
    now: () => new Date("2026-08-26T12:00:00.000Z")
  });
  assert.equal(verifiedProjectToken.status, "VERIFIED");
  if (verifiedProjectToken.status === "VERIFIED") {
    assert.equal(verifiedProjectToken.verification.association, "OWNER_CONFIRMED_PROJECT_TOKEN");
    assert.equal(verifiedProjectToken.verification.symbol, "EXAMPLE");
  }

  const ccff00ActivityCollection = resolveRmtNftActivityCollection(CCFF00_COLLECTION, "ERC721");
  assert.ok(ccff00ActivityCollection, "CCFF00 must resolve only through the curated registry plus a verified standard.");
  assert.equal(resolveRmtNftActivityCollection(CCFF00_COLLECTION, "ERC1155"), null,
    "A declared ERC721 collection cannot be silently rebound as ERC1155.");

  const ccff00Mint = decodeRmtNftActivityLog(rawLog(), "ERC721");
  assert.equal(ccff00Mint.status, "DECODED");
  if (ccff00Mint.status === "DECODED") {
    assert.equal(ccff00Mint.event.projectId, "ccff00");
    assert.equal(ccff00Mint.event.standard, "ERC721");
    assert.equal(ccff00Mint.event.sourceEvent, "TRANSFER");
    assert.equal(ccff00Mint.event.movements.length, 1);
    assert.equal(ccff00Mint.event.movements[0]?.tokenId, 470n);
    assert.equal(ccff00Mint.event.movements[0]?.amount, 1n);
    assert.equal(ccff00Mint.event.movements[0]?.kind, "MINT");
    assert.equal(ccff00Mint.event.marketMeaning, "NOT_ESTABLISHED",
      "ERC721 Transfer must never be treated as sale evidence by itself.");

    const duplicate = compareRmtNftActivityObservations(ccff00Mint.event, ccff00Mint.event);
    assert.equal(duplicate, "DUPLICATE");

    const replacement = {
      ...ccff00Mint.event,
      blockNumber: ccff00Mint.event.blockNumber + 1n,
      blockHash: `0x${"33".repeat(32)}` as Hex
    };
    assert.equal(compareRmtNftActivityObservations(ccff00Mint.event, replacement), "REORG_REPLACEMENT");
    assert.equal(compareRmtNftActivityObservations(ccff00Mint.event, {
      ...ccff00Mint.event,
      logIndex: ccff00Mint.event.logIndex + 1
    }), "DISTINCT");
  }

  const ccff00Transfer = decodeRmtNftActivityLog(rawLog({
    topics: [
      RMT_ERC721_TRANSFER_TOPIC,
      addressTopic(SENDER),
      addressTopic(RECEIVER),
      uintTopic(470n)
    ]
  }), "ERC721");
  assert.equal(ccff00Transfer.status, "DECODED");
  if (ccff00Transfer.status === "DECODED") assert.equal(ccff00Transfer.event.movements[0]?.kind, "TRANSFER");

  const ccff00Burn = decodeRmtNftActivityLog(rawLog({
    topics: [
      RMT_ERC721_TRANSFER_TOPIC,
      addressTopic(SENDER),
      addressTopic(zeroAddress),
      uintTopic(470n)
    ]
  }), "ERC721");
  assert.equal(ccff00Burn.status, "DECODED");
  if (ccff00Burn.status === "DECODED") assert.equal(ccff00Burn.event.movements[0]?.kind, "BURN");

  const removed = decodeRmtNftActivityLog(rawLog({ removed: true }), "ERC721");
  assert.deepEqual(removed, { status: "IGNORED", reason: "REMOVED_LOG" });
  const missingIdentity = decodeRmtNftActivityLog(rawLog({ blockHash: null }), "ERC721");
  assert.deepEqual(missingIdentity, { status: "IGNORED", reason: "MISSING_LOG_IDENTITY" });
  const wrongActivityChain = decodeRmtNftActivityLog(rawLog({ chainId: 1 }), "ERC721");
  assert.deepEqual(wrongActivityChain, { status: "IGNORED", reason: "WRONG_CHAIN" });
  const unadmitted = decodeRmtNftActivityLog(rawLog({
    address: getAddress("0x7777777777777777777777777777777777777777")
  }), "ERC721");
  assert.deepEqual(unadmitted, { status: "IGNORED", reason: "COLLECTION_NOT_ADMITTED" });

  const erc1155Context: RmtNftActivityCollectionContext = {
    projectId: "erc1155-fixture",
    collectionAddress: ERC1155_FIXTURE,
    standard: "ERC1155"
  };
  const erc1155Single = decodeVerifiedRmtNftActivityLog(rawLog({
    address: ERC1155_FIXTURE,
    topics: [
      RMT_ERC1155_TRANSFER_SINGLE_TOPIC,
      addressTopic(OPERATOR),
      addressTopic(SENDER),
      addressTopic(RECEIVER)
    ],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [9n, 3n]
    )
  }), erc1155Context);
  assert.equal(erc1155Single.status, "DECODED");
  if (erc1155Single.status === "DECODED") {
    assert.equal(erc1155Single.event.sourceEvent, "TRANSFER_SINGLE");
    assert.equal(erc1155Single.event.operator, OPERATOR);
    assert.equal(erc1155Single.event.movements[0]?.tokenId, 9n);
    assert.equal(erc1155Single.event.movements[0]?.amount, 3n);
    assert.equal(erc1155Single.event.movements[0]?.kind, "TRANSFER");
    assert.equal(erc1155Single.event.marketMeaning, "NOT_ESTABLISHED");
  }

  const erc1155Batch = decodeVerifiedRmtNftActivityLog(rawLog({
    address: ERC1155_FIXTURE,
    topics: [
      RMT_ERC1155_TRANSFER_BATCH_TOPIC,
      addressTopic(OPERATOR),
      addressTopic(zeroAddress),
      addressTopic(RECEIVER)
    ],
    data: encodeAbiParameters(
      [{ type: "uint256[]" }, { type: "uint256[]" }],
      [[1n, 2n], [4n, 5n]]
    )
  }), erc1155Context);
  assert.equal(erc1155Batch.status, "DECODED");
  if (erc1155Batch.status === "DECODED") {
    assert.equal(erc1155Batch.event.sourceEvent, "TRANSFER_BATCH");
    assert.deepEqual(erc1155Batch.event.movements.map((item) => item.tokenId), [1n, 2n]);
    assert.deepEqual(erc1155Batch.event.movements.map((item) => item.amount), [4n, 5n]);
    assert.deepEqual(erc1155Batch.event.movements.map((item) => item.kind), ["MINT", "MINT"]);
  }

  const invalidBatch = decodeVerifiedRmtNftActivityLog(rawLog({
    address: ERC1155_FIXTURE,
    topics: [
      RMT_ERC1155_TRANSFER_BATCH_TOPIC,
      addressTopic(OPERATOR),
      addressTopic(SENDER),
      addressTopic(RECEIVER)
    ],
    data: encodeAbiParameters(
      [{ type: "uint256[]" }, { type: "uint256[]" }],
      [[1n, 2n], [4n]]
    )
  }), erc1155Context);
  assert.deepEqual(invalidBatch, { status: "IGNORED", reason: "INVALID_BATCH_LENGTH" });

  console.log("RMT NFT domain keeps admission, technical identity, activity, market meaning, and project-token association separate.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
