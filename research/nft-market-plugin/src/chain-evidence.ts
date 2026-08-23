import { ROBINHOOD_CHAIN_ID, canonicalUint256, nftItemId, normalizeAddress, normalizeHash32, positiveAtomic, type NftItemId, type NftStandard } from "./domain.ts";

export type ChainClock = {
  rollupBlockNumber: string;
  rollupBlockHash: string;
  l1BlockNumber: string | null;
};

export type LogIdentity = {
  transactionHash: string;
  logIndex: number;
  subIndex: number;
};

export type NftTransferEvidence = {
  chainId: typeof ROBINHOOD_CHAIN_ID;
  standard: NftStandard;
  item: NftItemId;
  operator: string | null;
  from: string;
  to: string;
  quantityAtomic: string;
  eventKind: "erc721_transfer" | "erc721_consecutive" | "erc1155_single" | "erc1155_batch";
  identity: LogIdentity;
  clock: ChainClock;
};

export type MetadataRefreshEvidence = {
  chainId: typeof ROBINHOOD_CHAIN_ID;
  collection: string;
  tokenIdFrom: string;
  tokenIdTo: string;
  eventKind: "erc4906_metadata_update" | "erc4906_batch_metadata_update" | "erc1155_uri";
  identity: LogIdentity;
  clock: ChainClock;
};

export function logKey(identity: LogIdentity) {
  normalizeHash32(identity.transactionHash);
  if (!Number.isInteger(identity.logIndex) || identity.logIndex < 0) throw new Error("Invalid log index");
  if (!Number.isInteger(identity.subIndex) || identity.subIndex < 0) throw new Error("Invalid sub-index");
  return `${identity.transactionHash.toLowerCase()}:${identity.logIndex}:${identity.subIndex}`;
}

export function assertClock(clock: ChainClock) {
  canonicalUint256(clock.rollupBlockNumber);
  normalizeHash32(clock.rollupBlockHash);
  if (clock.l1BlockNumber !== null) canonicalUint256(clock.l1BlockNumber);
  return true;
}

export function erc721Transfer(input: {
  contract: string;
  tokenId: string;
  from: string;
  to: string;
  identity: LogIdentity;
  clock: ChainClock;
}): NftTransferEvidence {
  assertClock(input.clock);
  logKey(input.identity);
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    standard: "erc721",
    item: nftItemId(input.contract, input.tokenId),
    operator: null,
    from: normalizeAddress(input.from),
    to: normalizeAddress(input.to),
    quantityAtomic: "1",
    eventKind: "erc721_transfer",
    identity: input.identity,
    clock: input.clock
  };
}

export function erc1155Transfers(input: {
  contract: string;
  ids: string[];
  values: string[];
  operator: string;
  from: string;
  to: string;
  identity: Omit<LogIdentity, "subIndex">;
  clock: ChainClock;
}): NftTransferEvidence[] {
  assertClock(input.clock);
  if (input.ids.length === 0 || input.ids.length !== input.values.length) throw new Error("ERC-1155 batch shape mismatch");
  return input.ids.map((tokenId, subIndex) => ({
    chainId: ROBINHOOD_CHAIN_ID,
    standard: "erc1155" as const,
    item: nftItemId(input.contract, tokenId),
    operator: normalizeAddress(input.operator),
    from: normalizeAddress(input.from),
    to: normalizeAddress(input.to),
    quantityAtomic: positiveAtomic(input.values[subIndex]),
    eventKind: input.ids.length === 1 ? "erc1155_single" as const : "erc1155_batch" as const,
    identity: { ...input.identity, subIndex },
    clock: input.clock
  }));
}

export function expandConsecutiveTransfer(input: {
  contract: string;
  fromTokenId: string;
  toTokenId: string;
  from: string;
  to: string;
  identity: Omit<LogIdentity, "subIndex">;
  clock: ChainClock;
  maxExpansion?: number;
}) {
  const from = BigInt(canonicalUint256(input.fromTokenId));
  const to = BigInt(canonicalUint256(input.toTokenId));
  if (to < from) throw new Error("ConsecutiveTransfer range is reversed");
  const count = to - from + 1n;
  const maxExpansion = BigInt(input.maxExpansion ?? 10_000);
  if (count > maxExpansion) throw new Error("ConsecutiveTransfer exceeds bounded expansion; persist as a range job instead");
  const rows: NftTransferEvidence[] = [];
  for (let index = 0n; index < count; index += 1n) {
    rows.push({
      ...erc721Transfer({
        contract: input.contract,
        tokenId: (from + index).toString(),
        from: input.from,
        to: input.to,
        identity: { ...input.identity, subIndex: Number(index) },
        clock: input.clock
      }),
      eventKind: "erc721_consecutive"
    });
  }
  return rows;
}
