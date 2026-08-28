import { getAddress, isAddress, type Address } from "viem";

export const RMT_NFT_CHAIN_ID = 4_663 as const;

export const RMT_NFT_PROJECT_STATUSES = [
  "ACTIVE",
  "WATCHING",
  "PAUSED",
  "REMOVED"
] as const;

export type RmtNftProjectStatus = typeof RMT_NFT_PROJECT_STATUSES[number];
export type RmtNftCollectionStandard = "ERC721" | "ERC1155";
export type RmtNftTechnicalVerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";
export type RmtNftProjectTokenAssociation = "OWNER_CONFIRMED_PROJECT_TOKEN";

export type RmtNftOfficialEvidence = {
  kind: "OFFICIAL_WEBSITE" | "OFFICIAL_SOCIAL" | "OWNER_SUPPLIED_REFERENCE";
  url: string;
};

export type RmtNftProjectLink = {
  label: string;
  url: string;
  visibility: "PUBLIC" | "INTERNAL";
};

export type RmtNftCollectionRegistryEntry = {
  chainId: typeof RMT_NFT_CHAIN_ID;
  contractAddress: Address;
  declaredStandard: RmtNftCollectionStandard | null;
  verificationStatus: RmtNftTechnicalVerificationStatus;
};

export type RmtNftProjectTokenRegistryEntry = {
  chainId: typeof RMT_NFT_CHAIN_ID;
  contractAddress: Address;
  association: RmtNftProjectTokenAssociation;
  ownerConfirmedAt: string;
  verificationStatus: RmtNftTechnicalVerificationStatus;
};

export type RmtCuratedNftProject = {
  projectId: string;
  displayName: string;
  status: RmtNftProjectStatus;
  ownerApproved: boolean;
  approvedAt: string;
  officialProjectEvidence: readonly RmtNftOfficialEvidence[];
  links: readonly RmtNftProjectLink[];
  collections: readonly RmtNftCollectionRegistryEntry[];
  projectToken: RmtNftProjectTokenRegistryEntry | null;
};

function requiredProjectId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(normalized)) {
    throw new Error("RMT NFT project ids must be stable lowercase slugs.");
  }
  return normalized;
}

function requiredText(value: string, maximum: number, label: string) {
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function canonicalAddress(value: string, label: string) {
  if (!isAddress(value, { strict: false })) throw new Error(`${label} must be a valid EVM address.`);
  return getAddress(value);
}

function requiredHttpsUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  return url.toString();
}

function requiredTimestamp(value: string, label: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
  return new Date(value).toISOString();
}

export function defineRmtCuratedNftProject(input: RmtCuratedNftProject): RmtCuratedNftProject {
  const projectId = requiredProjectId(input.projectId);
  const displayName = requiredText(input.displayName, 80, "RMT NFT project display name");
  const approvedAt = requiredTimestamp(input.approvedAt, "RMT NFT project approval time");
  if (!RMT_NFT_PROJECT_STATUSES.includes(input.status)) throw new Error("RMT NFT project status is invalid.");
  if (!input.ownerApproved) throw new Error("Only owner-approved NFT projects may enter the RMT curated registry.");
  if (input.collections.length === 0 || input.collections.length > 32) {
    throw new Error("RMT NFT projects must declare between 1 and 32 collection contracts.");
  }

  const collectionAddresses = new Set<string>();
  const collections = input.collections.map((collection) => {
    if (collection.chainId !== RMT_NFT_CHAIN_ID) throw new Error("RMT NFT collections must be on Robinhood Chain 4663.");
    const contractAddress = canonicalAddress(collection.contractAddress, "RMT NFT collection contract");
    const key = contractAddress.toLowerCase();
    if (collectionAddresses.has(key)) throw new Error("RMT NFT projects may not contain duplicate collection contracts.");
    collectionAddresses.add(key);
    if (collection.declaredStandard !== null && collection.declaredStandard !== "ERC721" && collection.declaredStandard !== "ERC1155") {
      throw new Error("RMT NFT collection standard is invalid.");
    }
    if ((input.status === "ACTIVE" || input.status === "WATCHING") && collection.verificationStatus !== "VERIFIED") {
      throw new Error(`${input.status} RMT NFT projects require technically VERIFIED collections.`);
    }
    return { ...collection, contractAddress };
  });

  const officialProjectEvidence = input.officialProjectEvidence.map((evidence) => ({
    ...evidence,
    url: requiredHttpsUrl(evidence.url, "RMT NFT official project evidence")
  }));
  const links = input.links.map((link) => ({
    label: requiredText(link.label, 40, "RMT NFT project link label"),
    url: requiredHttpsUrl(link.url, "RMT NFT project link"),
    visibility: link.visibility
  }));

  const projectToken = input.projectToken ? (() => {
    if (input.projectToken.chainId !== RMT_NFT_CHAIN_ID) throw new Error("RMT NFT project tokens must be on Robinhood Chain 4663.");
    if (input.projectToken.association !== "OWNER_CONFIRMED_PROJECT_TOKEN") {
      throw new Error("RMT does not infer NFT project-token relationships.");
    }
    return {
      ...input.projectToken,
      contractAddress: canonicalAddress(input.projectToken.contractAddress, "RMT NFT project token contract"),
      ownerConfirmedAt: requiredTimestamp(input.projectToken.ownerConfirmedAt, "RMT NFT project token confirmation time")
    };
  })() : null;

  return {
    ...input,
    projectId,
    displayName,
    approvedAt,
    collections,
    officialProjectEvidence,
    links,
    projectToken
  };
}

const CCFF00_COLLECTION = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");

export const RMT_CURATED_NFT_PROJECTS = [
  defineRmtCuratedNftProject({
    projectId: "ccff00",
    displayName: "CCFF00",
    status: "ACTIVE",
    ownerApproved: true,
    approvedAt: "2026-08-26T00:00:00.000Z",
    officialProjectEvidence: [],
    links: [
      {
        label: "OpenSea collection",
        url: "https://opensea.io/collection/ccff00-161927574",
        visibility: "PUBLIC"
      }
    ],
    collections: [
      {
        chainId: RMT_NFT_CHAIN_ID,
        contractAddress: CCFF00_COLLECTION,
        declaredStandard: "ERC721",
        verificationStatus: "VERIFIED"
      }
    ],
    // The collection exposes a ccff00Token() relationship onchain, but the
    // curated registry intentionally leaves projectToken unset until the owner
    // explicitly confirms the project-token relationship for RMT presentation.
    projectToken: null
  }),
  defineRmtCuratedNftProject({
    projectId: "robin-rabbits",
    displayName: "Robin Rabbits",
    status: "WATCHING",
    ownerApproved: true,
    approvedAt: "2026-08-27T00:11:00.000Z",
    officialProjectEvidence: [
      { kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/robin-rabbits-834193084" }
    ],
    links: [
      { label: "OpenSea collection", url: "https://opensea.io/collection/robin-rabbits-834193084", visibility: "PUBLIC" }
    ],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0xb87522e093858d992b7555077ff3541597deb34e",
      declaredStandard: "ERC721",
      verificationStatus: "VERIFIED"
    }],
    projectToken: null
  }),
  defineRmtCuratedNftProject({
    projectId: "gogh-punks",
    displayName: "Gogh Punks",
    status: "WATCHING",
    ownerApproved: true,
    approvedAt: "2026-08-27T00:11:00.000Z",
    officialProjectEvidence: [
      { kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/gogh-punks-255843210" }
    ],
    links: [
      { label: "OpenSea collection", url: "https://opensea.io/collection/gogh-punks-255843210", visibility: "PUBLIC" }
    ],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
      declaredStandard: "ERC721",
      verificationStatus: "VERIFIED"
    }],
    projectToken: null
  })
] as const satisfies readonly RmtCuratedNftProject[];

export function rmtCuratedNftProject(projectId: string) {
  const normalized = projectId.trim().toLowerCase();
  return RMT_CURATED_NFT_PROJECTS.find((project) => project.projectId === normalized) ?? null;
}

export function activeRmtCuratedNftProjects() {
  return RMT_CURATED_NFT_PROJECTS.filter((project) => project.status === "ACTIVE");
}
