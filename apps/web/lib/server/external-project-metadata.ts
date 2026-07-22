import { getAddress, type Address, type PublicClient } from "viem";
import type { ExternalMarket, ExternalProjectMetadata } from "../external-market";
import {
  readPonsProjectMetadataBatch,
  type PonsProjectMetadata
} from "./pons-project-metadata";
import {
  readNoxaProjectMetadataBatch,
  type NoxaProjectMetadata
} from "./noxa-project-metadata";

const POSITIVE_CACHE_MS = 5 * 60_000;
const NEGATIVE_CACHE_MS = 60_000;
type KnownProjectMetadata = PonsProjectMetadata | NoxaProjectMetadata;
const projectMetadataCache = new Map<string, {
  expiresAt: number;
  metadata: KnownProjectMetadata | null;
}>();

export function projectMetadataForMarket(
  market: ExternalMarket,
  metadata: KnownProjectMetadata
): ExternalMarket {
  if (getAddress(market.address) !== metadata.token) return market;

  const project: ExternalProjectMetadata = Object.freeze({
    sourceId: metadata.sourceId,
    sourceName: metadata.sourceId === "pons" ? "Pons" : "Noxa",
    provenance: metadata.provenance,
    creator: metadata.creator,
    launchPool: metadata.pool,
    name: metadata.name,
    symbol: metadata.symbol,
    description: metadata.description,
    imageUri: metadata.imageUri,
    socials: metadata.socials
  });
  return {
    ...market,
    name: project.name || market.name,
    symbol: project.symbol || market.symbol,
    project
  };
}

export function ponsMetadataForMarket(market: ExternalMarket, metadata: PonsProjectMetadata) {
  return projectMetadataForMarket(market, metadata);
}

export async function enrichExternalProjectMetadata(
  client: PublicClient,
  markets: readonly ExternalMarket[]
) {
  if (markets.length === 0) return [...markets];
  const now = Date.now();
  const metadata = new Map<string, KnownProjectMetadata>();
  const unresolved: Address[] = [];
  for (const market of markets) {
    if (market.project) continue;
    const token = getAddress(market.address) as Address;
    const cached = projectMetadataCache.get(token.toLowerCase());
    if (cached && cached.expiresAt > now) {
      if (cached.metadata) metadata.set(token.toLowerCase(), cached.metadata);
    } else {
      unresolved.push(token);
    }
  }
  if (unresolved.length > 0) {
    const ponsResolved = await readPonsProjectMetadataBatch(client, unresolved);
    const remaining = unresolved.filter((token) => !ponsResolved.has(token.toLowerCase()));
    const noxaResolved = await readNoxaProjectMetadataBatch(client, remaining);
    for (const token of unresolved) {
      const key = token.toLowerCase();
      const project = ponsResolved.get(key) ?? noxaResolved.get(key) ?? null;
      projectMetadataCache.set(key, {
        metadata: project,
        expiresAt: now + (project ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS)
      });
      if (project) metadata.set(key, project);
    }
  }
  return markets.map((market) => {
    const project = metadata.get(market.address.toLowerCase());
    return project ? projectMetadataForMarket(market, project) : market;
  });
}
