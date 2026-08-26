import {
  getAddress,
  isAddressEqual,
  zeroAddress,
  type Address
} from "viem";
import type {
  RmtNftActivityEvent,
  RmtNftTokenMovement
} from "./activity-domain";

export type RmtErc721Ownership = {
  collectionAddress: Address;
  tokenId: bigint;
  owner: Address;
};

export type RmtErc1155Balance = {
  collectionAddress: Address;
  tokenId: bigint;
  account: Address;
  balance: bigint;
};

export type RmtNftOwnershipProjection = {
  erc721Owners: ReadonlyMap<string, RmtErc721Ownership>;
  erc1155Balances: ReadonlyMap<string, RmtErc1155Balance>;
};

export function createRmtNftOwnershipProjection(): RmtNftOwnershipProjection {
  return {
    erc721Owners: new Map(),
    erc1155Balances: new Map()
  };
}

function canonicalAddress(address: Address) {
  return getAddress(address);
}

function erc721Key(collectionAddress: Address, tokenId: bigint) {
  return `${collectionAddress.toLowerCase()}:${tokenId.toString()}`;
}

function erc1155Key(collectionAddress: Address, tokenId: bigint, account: Address) {
  return `${collectionAddress.toLowerCase()}:${tokenId.toString()}:${account.toLowerCase()}`;
}

function requireNonZeroEndpoint(address: Address, label: string) {
  if (isAddressEqual(address, zeroAddress)) throw new Error(`${label} cannot be the zero address.`);
  return canonicalAddress(address);
}

function applyErc721Movement(
  owners: Map<string, RmtErc721Ownership>,
  collectionAddress: Address,
  movement: RmtNftTokenMovement
) {
  if (movement.amount !== 1n) throw new Error("ERC721 activity must move exactly one token instance.");
  const key = erc721Key(collectionAddress, movement.tokenId);
  const existing = owners.get(key);

  if (movement.kind === "MINT") {
    if (existing) throw new Error("ERC721 mint conflicts with an already-owned token id.");
    const owner = requireNonZeroEndpoint(movement.to, "ERC721 mint recipient");
    owners.set(key, { collectionAddress, tokenId: movement.tokenId, owner });
    return;
  }

  const from = requireNonZeroEndpoint(movement.from, "ERC721 transfer sender");
  if (!existing || !isAddressEqual(existing.owner, from)) {
    throw new Error("ERC721 ownership history is incomplete or conflicts with the transfer sender.");
  }

  if (movement.kind === "BURN") {
    owners.delete(key);
    return;
  }

  const owner = requireNonZeroEndpoint(movement.to, "ERC721 transfer recipient");
  owners.set(key, { collectionAddress, tokenId: movement.tokenId, owner });
}

function currentErc1155Balance(
  balances: Map<string, RmtErc1155Balance>,
  collectionAddress: Address,
  tokenId: bigint,
  account: Address
) {
  return balances.get(erc1155Key(collectionAddress, tokenId, account))?.balance ?? 0n;
}

function setErc1155Balance(
  balances: Map<string, RmtErc1155Balance>,
  collectionAddress: Address,
  tokenId: bigint,
  account: Address,
  balance: bigint
) {
  if (balance < 0n) throw new Error("ERC1155 balances cannot become negative.");
  const canonicalAccount = canonicalAddress(account);
  const key = erc1155Key(collectionAddress, tokenId, canonicalAccount);
  if (balance === 0n) {
    balances.delete(key);
    return;
  }
  balances.set(key, {
    collectionAddress,
    tokenId,
    account: canonicalAccount,
    balance
  });
}

function applyErc1155Movement(
  balances: Map<string, RmtErc1155Balance>,
  collectionAddress: Address,
  movement: RmtNftTokenMovement
) {
  if (movement.amount < 0n) throw new Error("ERC1155 activity amount cannot be negative.");

  if (movement.kind === "MINT") {
    const to = requireNonZeroEndpoint(movement.to, "ERC1155 mint recipient");
    setErc1155Balance(
      balances,
      collectionAddress,
      movement.tokenId,
      to,
      currentErc1155Balance(balances, collectionAddress, movement.tokenId, to) + movement.amount
    );
    return;
  }

  const from = requireNonZeroEndpoint(movement.from, "ERC1155 transfer sender");
  const fromBalance = currentErc1155Balance(balances, collectionAddress, movement.tokenId, from);
  if (fromBalance < movement.amount) {
    throw new Error("ERC1155 ownership history is incomplete or would underflow the sender balance.");
  }
  setErc1155Balance(
    balances,
    collectionAddress,
    movement.tokenId,
    from,
    fromBalance - movement.amount
  );

  if (movement.kind === "BURN") return;

  const to = requireNonZeroEndpoint(movement.to, "ERC1155 transfer recipient");
  setErc1155Balance(
    balances,
    collectionAddress,
    movement.tokenId,
    to,
    currentErc1155Balance(balances, collectionAddress, movement.tokenId, to) + movement.amount
  );
}

export function applyRmtNftActivityToOwnership(
  projection: RmtNftOwnershipProjection,
  event: RmtNftActivityEvent
): RmtNftOwnershipProjection {
  const collectionAddress = canonicalAddress(event.collectionAddress);
  const erc721Owners = new Map(projection.erc721Owners);
  const erc1155Balances = new Map(projection.erc1155Balances);

  for (const movement of event.movements) {
    if (event.standard === "ERC721") {
      applyErc721Movement(erc721Owners, collectionAddress, movement);
    } else {
      applyErc1155Movement(erc1155Balances, collectionAddress, movement);
    }
  }

  return { erc721Owners, erc1155Balances };
}

export function rmtNftOwnerOf(
  projection: RmtNftOwnershipProjection,
  collectionAddress: Address,
  tokenId: bigint
) {
  return projection.erc721Owners.get(erc721Key(canonicalAddress(collectionAddress), tokenId))?.owner ?? null;
}

export function rmtNftBalanceOf(
  projection: RmtNftOwnershipProjection,
  collectionAddress: Address,
  tokenId: bigint,
  account: Address
) {
  return projection.erc1155Balances.get(
    erc1155Key(canonicalAddress(collectionAddress), tokenId, canonicalAddress(account))
  )?.balance ?? 0n;
}
