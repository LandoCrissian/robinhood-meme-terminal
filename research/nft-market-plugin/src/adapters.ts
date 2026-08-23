import type { NftCollectionId, NftItemId, NftMarketOrder, VenueAdmission, VenueCapability } from "./domain.ts";

export type SourceIdentityState = "verified" | "candidate" | "unsupported" | "not_deployed";

export type SourceRegistration = {
  sourceId: string;
  displayName: string;
  chainId: 4663;
  admission: VenueAdmission;
  identityState: SourceIdentityState;
  capabilities: VenueCapability[];
  protocol: string | null;
  contractAddresses: string[];
  apiKind: "public_supported" | "private_unsupported" | "onchain" | "catalogue" | "none";
  evidence: string[];
  blockers: string[];
};

export type VenueAdapter = {
  registration: SourceRegistration;
  listCollectionOrders?: (collection: NftCollectionId, cursor?: string | null) => Promise<{ orders: NftMarketOrder[]; nextCursor: string | null }>;
  listItemOrders?: (item: NftItemId, cursor?: string | null) => Promise<{ orders: NftMarketOrder[]; nextCursor: string | null }>;
};

export function assertRegistration(registration: SourceRegistration) {
  if (registration.chainId !== 4663) throw new Error("NFT source is bound to the wrong chain");
  if (!registration.sourceId.trim() || !registration.displayName.trim()) throw new Error("NFT source identity is incomplete");
  if (new Set(registration.capabilities).size !== registration.capabilities.length) throw new Error("NFT source capabilities are duplicated");
  if (registration.admission === "execution_admitted") throw new Error("No NFT execution venue is admitted in research-v1");
  if (registration.identityState !== "verified" && registration.admission === "verification_ready") {
    throw new Error("Verification-ready venue requires verified protocol identity");
  }
  return true;
}
