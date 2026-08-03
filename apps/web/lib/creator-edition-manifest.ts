import {
  concat,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";

export const MAXIMUM_CREATOR_EDITION_TYPES = 10_000;
export const MAXIMUM_CREATOR_EDITION_SUPPLY = 1_000_000_000;
export const MAXIMUM_CREATOR_EDITION_ROYALTY_BPS = 1_000;
export const MAXIMUM_CREATOR_EDITION_NAME_BYTES = 100;
export const MAXIMUM_CREATOR_EDITION_SYMBOL_BYTES = 20;
export const MAXIMUM_CREATOR_EDITION_URI_BYTES = 2_048;

export type CreatorEditionInput = {
  tokenId: bigint;
  tokenURI: string;
  termsHash: Hex;
  maximumSupply: number;
};

export type CreatorEditionManifestItem = CreatorEditionInput & {
  tokenURIHash: Hex;
  leaf: Hex;
  proof: Hex[];
};

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function cleanText(value: unknown, field: string, maximumBytes: number) {
  if (typeof value !== "string" || value.length === 0 || byteLength(value) > maximumBytes) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

function cleanBytes32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be a 32-byte hash.`);
  }
  return value.toLowerCase() as Hex;
}

function cleanNonZeroBytes32(value: unknown, field: string): Hex {
  const cleaned = cleanBytes32(value, field);
  if (cleaned === `0x${"00".repeat(32)}`) throw new Error(`${field} cannot be zero.`);
  return cleaned;
}

function cleanAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${field} must be an EVM address.`);
  }
  return getAddress(value);
}

function hashPair(left: Hex, right: Hex): Hex {
  return left.toLowerCase() < right.toLowerCase()
    ? keccak256(concat([left, right]))
    : keccak256(concat([right, left]));
}

export function hashCreatorEditionManifestLeaf(input: {
  tokenId: bigint;
  tokenURIHash: Hex;
  termsHash: Hex;
  maximumSupply: number;
}): Hex {
  if (input.tokenId <= 0n) throw new Error("Edition token ID must be positive.");
  if (
    !Number.isSafeInteger(input.maximumSupply)
    || input.maximumSupply < 1
    || input.maximumSupply > MAXIMUM_CREATOR_EDITION_SUPPLY
  ) throw new Error("Edition supply is invalid.");
  const encodedHash = keccak256(encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint64" }
    ],
    [
      input.tokenId,
      cleanBytes32(input.tokenURIHash, "Edition URI hash"),
      cleanBytes32(input.termsHash, "Edition terms hash"),
      BigInt(input.maximumSupply)
    ]
  ));
  return keccak256(encodedHash);
}

function buildMerkleProofs(leaves: Hex[]) {
  const proofs = leaves.map(() => [] as Hex[]);
  let nodes = leaves.map((hash, index) => ({ hash, indexes: [index] }));
  while (nodes.length > 1) {
    const next: Array<{ hash: Hex; indexes: number[] }> = [];
    for (let index = 0; index < nodes.length; index += 2) {
      const left = nodes[index];
      const right = nodes[index + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      for (const leafIndex of left.indexes) proofs[leafIndex].push(right.hash);
      for (const leafIndex of right.indexes) proofs[leafIndex].push(left.hash);
      next.push({
        hash: hashPair(left.hash, right.hash),
        indexes: [...left.indexes, ...right.indexes]
      });
    }
    nodes = next;
  }
  return { root: nodes[0].hash, proofs };
}

export function verifyCreatorEditionProof(leaf: Hex, proof: Hex[], root: Hex) {
  return proof.reduce((computed, sibling) => hashPair(computed, sibling), leaf) === root;
}

export function hashCreatorEditionConfig(config: {
  name: string;
  symbol: string;
  collectionURI: string;
  editionManifestRoot: Hex;
  maximumEditionTypes: number;
  maximumTotalSupply: number;
  royaltyReceiver: Address;
  royaltyBps: number;
}): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint32" },
      { type: "uint64" },
      { type: "address" },
      { type: "uint16" }
    ],
    [
      keccak256(new TextEncoder().encode(config.name)),
      keccak256(new TextEncoder().encode(config.symbol)),
      keccak256(new TextEncoder().encode(config.collectionURI)),
      cleanBytes32(config.editionManifestRoot, "Edition manifest root"),
      config.maximumEditionTypes,
      BigInt(config.maximumTotalSupply),
      cleanAddress(config.royaltyReceiver, "Royalty receiver"),
      config.royaltyBps
    ]
  ));
}

export function buildCreatorEditionManifest(input: {
  name: string;
  symbol: string;
  collectionURI: string;
  royaltyReceiver: Address;
  royaltyBps: number;
  editions: CreatorEditionInput[];
}) {
  const name = cleanText(input.name, "Edition name", MAXIMUM_CREATOR_EDITION_NAME_BYTES);
  const symbol = cleanText(input.symbol, "Edition symbol", MAXIMUM_CREATOR_EDITION_SYMBOL_BYTES);
  const collectionURI = cleanText(
    input.collectionURI,
    "Edition collection URI",
    MAXIMUM_CREATOR_EDITION_URI_BYTES
  );
  if (input.editions.length === 0 || input.editions.length > MAXIMUM_CREATOR_EDITION_TYPES) {
    throw new Error("Edition type count is invalid.");
  }
  if (
    !Number.isSafeInteger(input.royaltyBps)
    || input.royaltyBps < 0
    || input.royaltyBps > MAXIMUM_CREATOR_EDITION_ROYALTY_BPS
  ) throw new Error("Edition royalty is invalid.");
  const royaltyReceiver = cleanAddress(input.royaltyReceiver, "Royalty receiver");
  if (
    (input.royaltyBps === 0 && royaltyReceiver !== zeroAddress)
    || (input.royaltyBps !== 0 && royaltyReceiver === zeroAddress)
  ) throw new Error("Edition royalty receiver does not match the royalty rate.");

  const seenTokenIds = new Set<string>();
  let maximumTotalSupply = 0;
  const prepared = [...input.editions]
    .sort((left, right) => left.tokenId < right.tokenId ? -1 : left.tokenId > right.tokenId ? 1 : 0)
    .map((edition) => {
      const tokenIdKey = edition.tokenId.toString();
      if (edition.tokenId <= 0n || seenTokenIds.has(tokenIdKey)) {
        throw new Error("Edition token IDs must be unique positive integers.");
      }
      seenTokenIds.add(tokenIdKey);
      const tokenURI = cleanText(
        edition.tokenURI,
        "Edition token URI",
        MAXIMUM_CREATOR_EDITION_URI_BYTES
      );
      if (
        !Number.isSafeInteger(edition.maximumSupply)
        || edition.maximumSupply < 1
        || edition.maximumSupply > MAXIMUM_CREATOR_EDITION_SUPPLY
      ) throw new Error("Edition supply is invalid.");
      maximumTotalSupply += edition.maximumSupply;
      if (maximumTotalSupply > MAXIMUM_CREATOR_EDITION_SUPPLY) {
        throw new Error("Combined edition supply exceeds the collection limit.");
      }
      const termsHash = cleanNonZeroBytes32(edition.termsHash, "Edition terms hash");
      const tokenURIHash = keccak256(new TextEncoder().encode(tokenURI));
      return {
        tokenId: edition.tokenId,
        tokenURI,
        termsHash,
        maximumSupply: edition.maximumSupply,
        tokenURIHash,
        leaf: hashCreatorEditionManifestLeaf({
          tokenId: edition.tokenId,
          tokenURIHash,
          termsHash,
          maximumSupply: edition.maximumSupply
        })
      };
    });

  const { root, proofs } = buildMerkleProofs(prepared.map((edition) => edition.leaf));
  const config = {
    name,
    symbol,
    collectionURI,
    editionManifestRoot: root,
    maximumEditionTypes: prepared.length,
    maximumTotalSupply,
    royaltyReceiver,
    royaltyBps: input.royaltyBps
  };
  const items: CreatorEditionManifestItem[] = prepared.map((edition, index) => ({
    ...edition,
    proof: proofs[index]
  }));
  return {
    config,
    configurationHash: hashCreatorEditionConfig(config),
    items,
    contractExecution: "disabled" as const
  };
}
