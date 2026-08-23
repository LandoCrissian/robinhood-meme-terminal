import { getAddress, type Address } from "viem";

export const PROJECT_PAGE_SCHEMA_VERSION = 1 as const;

export type ProjectModuleId = "token" | "nft" | "marketplace" | "music";
export type ProjectModuleStatus = "live" | "planned";

export type ProjectModule = Readonly<{
  id: ProjectModuleId;
  label: string;
  status: ProjectModuleStatus;
  description: string;
}>;

export type VerifiedTokenProject = Readonly<{
  projectId: string;
  schemaVersion: typeof PROJECT_PAGE_SCHEMA_VERSION;
  chainId: number;
  token: Address;
  onchainCreator: Address;
  official: boolean;
  controllerStatus: "review-required";
  modules: readonly ProjectModule[];
}>;

const TOKEN_MODULE: ProjectModule = Object.freeze({
  id: "token",
  label: "Token",
  status: "live",
  description: "Verified token identity, live market data, trading, rewards, and permanent launch rules."
});

const FUTURE_MODULES: readonly ProjectModule[] = Object.freeze([
  Object.freeze({
    id: "nft",
    label: "NFT collection",
    status: "planned",
    description: "Creator-controlled collections, AI-art provenance, editions, licenses, and collaborator splits."
  }),
  Object.freeze({
    id: "marketplace",
    label: "Marketplace",
    status: "planned",
    description: "Optional owner activation for listings, offers, settlement, and transparent marketplace fees."
  }),
  Object.freeze({
    id: "music",
    label: "Music",
    status: "planned",
    description: "Optional releases for artists and AI-music creators with explicit rights and revenue splits."
  })
]);

export function buildVerifiedTokenProject(input: {
  chainId: number;
  token: Address;
  creator: Address;
  officialMigration: boolean;
}): VerifiedTokenProject {
  const token = getAddress(input.token);
  // A historical launchpad migration flag is provenance, not a current
  // Terminal endorsement or a distinguished product-market identity.
  const official = false;

  return Object.freeze({
    projectId: `rmt:${input.chainId}:${token.toLowerCase()}`,
    schemaVersion: PROJECT_PAGE_SCHEMA_VERSION,
    chainId: input.chainId,
    token,
    onchainCreator: getAddress(input.creator),
    official,
    controllerStatus: "review-required",
    modules: Object.freeze([TOKEN_MODULE, ...FUTURE_MODULES])
  });
}
