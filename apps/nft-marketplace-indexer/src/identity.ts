import { getAddress, isAddress, isAddressEqual } from "viem";
import type { RmtNftActivitySource } from "@rmt/shared/nft/activity-sources";
import type { RmtNftCollectionMarketplaceIdentity } from "@rmt/shared/nft/marketplace-evidence";
import { evidenceDigest } from "./evidence-utils.js";
import { OPENSEA_CHAIN } from "./constants.js";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
export class MarketplaceIdentityUnavailableError extends Error {
  constructor(message: string) {
    super(`MARKETPLACE_IDENTITY_UNAVAILABLE: ${message}`);
  }
}
export function assertRobinhoodChainSupported(raw: unknown) {
  if (!record(raw) || !Array.isArray(raw.chains))
    throw new Error("OpenSea chain response is malformed.");
  const supported = raw.chains.some(
    (entry) =>
      record(entry) &&
      (entry.identifier === OPENSEA_CHAIN ||
        entry.chain === OPENSEA_CHAIN ||
        entry.name === OPENSEA_CHAIN),
  );
  if (!supported)
    throw new Error("OpenSea does not report Robinhood as a supported chain.");
}
export function resolveOpenSeaIdentity(
  source: RmtNftActivitySource,
  contractRaw: unknown,
  collectionRaw: unknown,
  retrievedAt: string,
): RmtNftCollectionMarketplaceIdentity {
  if (!record(contractRaw))
    throw new MarketplaceIdentityUnavailableError(
      "contract lookup returned no usable record.",
    );
  if (contractRaw.chain !== OPENSEA_CHAIN)
    throw new Error("OpenSea contract identity returned the wrong chain.");
  if (
    typeof contractRaw.address !== "string" ||
    !isAddress(contractRaw.address, { strict: false }) ||
    !isAddressEqual(contractRaw.address, source.collectionAddress)
  )
    throw new Error("OpenSea contract identity returned the wrong address.");
  if (
    typeof contractRaw.collection !== "string" ||
    !contractRaw.collection.trim()
  )
    throw new MarketplaceIdentityUnavailableError(
      "contract has no OpenSea collection slug.",
    );
  if (
    !record(collectionRaw) ||
    collectionRaw.collection !== contractRaw.collection ||
    !Array.isArray(collectionRaw.contracts)
  )
    throw new Error(
      "OpenSea collection reverse identity is malformed or ambiguous.",
    );
  const providerMembers: { chain: string; address: ReturnType<typeof getAddress> }[] = [];
  const seen = new Set<string>();
  for (const member of collectionRaw.contracts) {
    if (
      !record(member) ||
      typeof member.chain !== "string" ||
      !member.chain.trim() ||
      typeof member.address !== "string" ||
      !isAddress(member.address, { strict: false })
    )
      throw new Error(
        "OpenSea collection contains a malformed provider contract member.",
      );
    const normalized = {
      chain: member.chain.trim().toLowerCase(),
      address: getAddress(member.address),
    };
    const key = `${normalized.chain}:${normalized.address.toLowerCase()}`;
    if (seen.has(key))
      throw new Error(
        "OpenSea collection contains ambiguous duplicate provider members.",
      );
    seen.add(key);
    providerMembers.push(normalized);
  }
  if (
    !providerMembers.some(
      (member) =>
        member.chain === OPENSEA_CHAIN &&
        isAddressEqual(member.address, source.collectionAddress),
    )
  )
    throw new Error(
      "OpenSea collection reverse identity omits the admitted contract.",
    );
  return {
    provider: "OPENSEA",
    chainId: 4663,
    projectId: source.projectId,
    collectionAddress: getAddress(source.collectionAddress),
    collectionStandard: source.standard,
    providerChain: OPENSEA_CHAIN,
    providerCollectionSlug: contractRaw.collection,
    scope:
      providerMembers.length === 1
        ? "EXACT_CONTRACT_SCOPE"
        : "MULTI_CONTRACT_COLLECTION_SCOPE",
    providerMembers,
    verifiedAt: new Date(retrievedAt).toISOString(),
    provenance: {
      provider: "OPENSEA",
      retrievedAt: new Date(retrievedAt).toISOString(),
      rawEvidenceDigest: evidenceDigest({
        contract: contractRaw,
        collection: collectionRaw,
      }),
    },
  };
}
export function assertSlugReplacement(
  previous: RmtNftCollectionMarketplaceIdentity | null,
  next: RmtNftCollectionMarketplaceIdentity,
  revalidated: boolean,
) {
  if (
    previous &&
    previous.providerCollectionSlug !== next.providerCollectionSlug &&
    !revalidated
  )
    throw new Error(
      "OpenSea slug replacement requires fresh bidirectional revalidation.",
    );
}
