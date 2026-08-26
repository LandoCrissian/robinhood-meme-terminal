import assert from "node:assert/strict";
import {
  getAddress,
  zeroAddress,
  type Hex
} from "viem";
import type { RmtNftActivityEvent } from "./activity-domain";
import {
  applyRmtNftActivityToOwnership,
  createRmtNftOwnershipProjection,
  rmtNftBalanceOf,
  rmtNftOwnerOf
} from "./ownership-projection";

const COLLECTION_721 = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
const COLLECTION_1155 = getAddress("0x6666666666666666666666666666666666666666");
const ALICE = getAddress("0x3333333333333333333333333333333333333333");
const BOB = getAddress("0x4444444444444444444444444444444444444444");

function hash(byte: string): Hex {
  return `0x${byte.repeat(64)}` as Hex;
}

function activity(overrides: Partial<RmtNftActivityEvent>): RmtNftActivityEvent {
  return {
    schemaVersion: 1,
    chainId: 4_663,
    projectId: "fixture",
    collectionAddress: COLLECTION_721,
    standard: "ERC721",
    transactionHash: hash("1"),
    logIndex: 0,
    blockNumber: 1n,
    blockHash: hash("2"),
    sourceEvent: "TRANSFER",
    operator: null,
    movements: [],
    marketMeaning: "NOT_ESTABLISHED",
    ...overrides
  };
}

let projection = createRmtNftOwnershipProjection();
projection = applyRmtNftActivityToOwnership(projection, activity({
  movements: [{ tokenId: 470n, amount: 1n, from: zeroAddress, to: ALICE, kind: "MINT" }]
}));
assert.equal(rmtNftOwnerOf(projection, COLLECTION_721, 470n), ALICE);

projection = applyRmtNftActivityToOwnership(projection, activity({
  transactionHash: hash("3"),
  blockNumber: 2n,
  blockHash: hash("4"),
  movements: [{ tokenId: 470n, amount: 1n, from: ALICE, to: BOB, kind: "TRANSFER" }]
}));
assert.equal(rmtNftOwnerOf(projection, COLLECTION_721, 470n), BOB);

projection = applyRmtNftActivityToOwnership(projection, activity({
  transactionHash: hash("5"),
  blockNumber: 3n,
  blockHash: hash("6"),
  movements: [{ tokenId: 470n, amount: 1n, from: BOB, to: zeroAddress, kind: "BURN" }]
}));
assert.equal(rmtNftOwnerOf(projection, COLLECTION_721, 470n), null);

assert.throws(() => applyRmtNftActivityToOwnership(projection, activity({
  transactionHash: hash("7"),
  blockNumber: 4n,
  blockHash: hash("8"),
  movements: [{ tokenId: 999n, amount: 1n, from: ALICE, to: BOB, kind: "TRANSFER" }]
})), /incomplete or conflicts/,
"A complete-history ERC721 projection must fail closed when the sender does not own the token.");

let multi = createRmtNftOwnershipProjection();
multi = applyRmtNftActivityToOwnership(multi, activity({
  collectionAddress: COLLECTION_1155,
  standard: "ERC1155",
  sourceEvent: "TRANSFER_BATCH",
  operator: ALICE,
  movements: [
    { tokenId: 1n, amount: 5n, from: zeroAddress, to: ALICE, kind: "MINT" },
    { tokenId: 2n, amount: 8n, from: zeroAddress, to: ALICE, kind: "MINT" }
  ]
}));
assert.equal(rmtNftBalanceOf(multi, COLLECTION_1155, 1n, ALICE), 5n);
assert.equal(rmtNftBalanceOf(multi, COLLECTION_1155, 2n, ALICE), 8n);

multi = applyRmtNftActivityToOwnership(multi, activity({
  collectionAddress: COLLECTION_1155,
  standard: "ERC1155",
  transactionHash: hash("9"),
  blockNumber: 2n,
  blockHash: hash("a"),
  sourceEvent: "TRANSFER_SINGLE",
  operator: ALICE,
  movements: [{ tokenId: 1n, amount: 3n, from: ALICE, to: BOB, kind: "TRANSFER" }]
}));
assert.equal(rmtNftBalanceOf(multi, COLLECTION_1155, 1n, ALICE), 2n);
assert.equal(rmtNftBalanceOf(multi, COLLECTION_1155, 1n, BOB), 3n);

multi = applyRmtNftActivityToOwnership(multi, activity({
  collectionAddress: COLLECTION_1155,
  standard: "ERC1155",
  transactionHash: hash("b"),
  blockNumber: 3n,
  blockHash: hash("c"),
  sourceEvent: "TRANSFER_SINGLE",
  operator: BOB,
  movements: [{ tokenId: 1n, amount: 3n, from: BOB, to: zeroAddress, kind: "BURN" }]
}));
assert.equal(rmtNftBalanceOf(multi, COLLECTION_1155, 1n, BOB), 0n);

assert.throws(() => applyRmtNftActivityToOwnership(multi, activity({
  collectionAddress: COLLECTION_1155,
  standard: "ERC1155",
  transactionHash: hash("d"),
  blockNumber: 4n,
  blockHash: hash("e"),
  sourceEvent: "TRANSFER_SINGLE",
  operator: BOB,
  movements: [{ tokenId: 2n, amount: 9n, from: ALICE, to: BOB, kind: "TRANSFER" }]
})), /underflow/,
"A complete-history ERC1155 projection must reject impossible balance movement.");

console.log("RMT NFT ownership projection reconstructs ERC721 ownership and ERC1155 balances from transfer activity only.");
