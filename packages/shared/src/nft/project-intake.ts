import { getAddress, isAddress, type Address } from "viem";
import {
  RMT_NFT_CHAIN_ID,
  type RmtNftCollectionStandard,
  type RmtNftTechnicalVerificationStatus
} from "./project-registry";

export const RMT_NFT_INTAKE_STATES = [
  "READY_FOR_TECHNICAL_VERIFICATION",
  "TECHNICALLY_VERIFIED",
  "NEEDS_COLLECTION_RESOLUTION",
  "WAITING_FOR_COLLECTION"
] as const;

export type RmtNftProjectIntakeState = typeof RMT_NFT_INTAKE_STATES[number];

export type RmtNftIntakeReference = {
  kind: "OWNER_SUPPLIED_REFERENCE" | "PROJECT_PUBLISHED_REFERENCE" | "TECHNICAL_REFERENCE";
  url: string;
};

export type RmtNftProjectIntakeCollectionCandidate = {
  chainId: typeof RMT_NFT_CHAIN_ID;
  contractAddress: Address | null;
  declaredStandard: RmtNftCollectionStandard | null;
  verificationStatus: RmtNftTechnicalVerificationStatus;
  referenceUrl: string;
};

export type RmtNftProjectIntakeTokenAssociation =
  | {
      status: "CONFIRMED";
      chainId: typeof RMT_NFT_CHAIN_ID;
      contractAddress: Address;
      association: "OWNER_CONFIRMED_PROJECT_TOKEN";
      verificationStatus: RmtNftTechnicalVerificationStatus;
      evidence: readonly RmtNftIntakeReference[];
    }
  | {
      status: "UNCONFIRMED";
      contractAddress: null;
      evidence: readonly [];
    };

export type RmtNftProjectIntakeRecord = {
  projectId: string;
  displayName: string;
  state: RmtNftProjectIntakeState;
  ownerApproved: true;
  approvedAt: string;
  references: readonly RmtNftIntakeReference[];
  collections: readonly RmtNftProjectIntakeCollectionCandidate[];
  projectToken: RmtNftProjectIntakeTokenAssociation;
};

function requiredSlug(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(normalized)) {
    throw new Error("RMT NFT intake project ids must be stable lowercase slugs.");
  }
  return normalized;
}

function requiredText(value: string, maximum: number, label: string) {
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredHttpsUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  return parsed.toString();
}

function requiredTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("RMT NFT intake approval time must be an ISO timestamp.");
  return new Date(value).toISOString();
}

function canonicalAddress(value: string, label: string) {
  if (!isAddress(value, { strict: false })) throw new Error(`${label} must be a valid EVM address.`);
  return getAddress(value);
}

function validatedReference(reference: RmtNftIntakeReference): RmtNftIntakeReference {
  return {
    ...reference,
    url: requiredHttpsUrl(reference.url, "RMT NFT intake reference")
  };
}

export function defineRmtNftProjectIntakeRecord(input: RmtNftProjectIntakeRecord): RmtNftProjectIntakeRecord {
  if (!RMT_NFT_INTAKE_STATES.includes(input.state)) throw new Error("RMT NFT intake state is invalid.");
  if (input.ownerApproved !== true) throw new Error("RMT NFT intake requires explicit owner approval.");
  if (input.collections.length > 32) throw new Error("RMT NFT intake supports at most 32 collection candidates per project.");

  const collections = input.collections.map((collection) => {
    if (collection.chainId !== RMT_NFT_CHAIN_ID) throw new Error("RMT NFT intake collections must use Robinhood Chain 4663.");
    if (collection.declaredStandard !== null && collection.declaredStandard !== "ERC721" && collection.declaredStandard !== "ERC1155") {
      throw new Error("RMT NFT intake collection standard is invalid.");
    }
    return {
      ...collection,
      contractAddress: collection.contractAddress === null
        ? null
        : canonicalAddress(collection.contractAddress, "RMT NFT intake collection contract"),
      referenceUrl: requiredHttpsUrl(collection.referenceUrl, "RMT NFT intake collection reference")
    };
  });

  if (input.state === "READY_FOR_TECHNICAL_VERIFICATION") {
    if (collections.length === 0 || collections.some((collection) => collection.contractAddress === null)) {
      throw new Error("Ready RMT NFT intake projects require at least one resolved collection contract.");
    }
  }
  if (input.state === "TECHNICALLY_VERIFIED" && (
    collections.length === 0 || collections.some((collection) =>
      collection.contractAddress === null || collection.verificationStatus !== "VERIFIED"
    )
  )) {
    throw new Error("Technically verified RMT NFT intake projects require VERIFIED collection contracts.");
  }
  if (input.state === "WAITING_FOR_COLLECTION" && collections.some((collection) => collection.contractAddress !== null)) {
    throw new Error("A project waiting for its collection must not claim a collection contract yet.");
  }

  const projectToken = input.projectToken.status === "CONFIRMED" ? {
    ...input.projectToken,
    contractAddress: canonicalAddress(input.projectToken.contractAddress, "RMT NFT intake project token contract"),
    evidence: input.projectToken.evidence.map(validatedReference)
  } : input.projectToken;

  if (projectToken.status === "CONFIRMED") {
    if (projectToken.chainId !== RMT_NFT_CHAIN_ID) throw new Error("RMT NFT intake project tokens must use Robinhood Chain 4663.");
    if (projectToken.association !== "OWNER_CONFIRMED_PROJECT_TOKEN") {
      throw new Error("RMT NFT intake must not infer project-token associations.");
    }
    if (projectToken.evidence.length === 0) throw new Error("Confirmed RMT NFT project tokens require association evidence.");
  }

  return {
    ...input,
    projectId: requiredSlug(input.projectId),
    displayName: requiredText(input.displayName, 80, "RMT NFT intake display name"),
    approvedAt: requiredTimestamp(input.approvedAt),
    references: input.references.map(validatedReference),
    collections,
    projectToken
  };
}

export function defineRmtNftProjectIntakeCatalog(
  inputs: readonly RmtNftProjectIntakeRecord[]
): readonly RmtNftProjectIntakeRecord[] {
  const projectIds = new Set<string>();
  const collectionAddresses = new Set<string>();
  const records = inputs.map((input) => defineRmtNftProjectIntakeRecord(input));

  for (const record of records) {
    if (projectIds.has(record.projectId)) throw new Error(`Duplicate RMT NFT intake project id: ${record.projectId}`);
    projectIds.add(record.projectId);
    for (const collection of record.collections) {
      if (collection.contractAddress === null) continue;
      const key = collection.contractAddress.toLowerCase();
      if (collectionAddresses.has(key)) throw new Error(`Duplicate RMT NFT intake collection contract: ${collection.contractAddress}`);
      collectionAddresses.add(key);
    }
  }

  return records;
}

const APPROVED_AT = "2026-08-27T00:11:00.000Z";
const HOPIUM_ASSET_ADDRESS = getAddress("0xB6cE51925C2e397eBF1a443b343d19267B3D4225");
const PEEPS_ASSET_ADDRESS = getAddress("0xf202de51bb42a0073948b0971707d14c54ef5f44");

function blockscoutAddressReference(address: Address) {
  return `https://robinhoodchain.blockscout.com/address/${address}`;
}

function dexScreenerAssetReference(address: Address) {
  return `https://dexscreener.com/robinhood/${address}`;
}

export const RMT_NFT_PROJECT_INTAKE = defineRmtNftProjectIntakeCatalog([
  {
    projectId: "hopium-machines",
    displayName: "Hopium Machines",
    state: "READY_FOR_TECHNICAL_VERIFICATION",
    ownerApproved: true,
    approvedAt: APPROVED_AT,
    references: [
      { kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/hopium-machines" },
      { kind: "PROJECT_PUBLISHED_REFERENCE", url: "https://x.com/HopiumMachines" }
    ],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0x7da15c761409cb921a81f0e003704cff418b700b",
      declaredStandard: "ERC721",
      verificationStatus: "PENDING",
      referenceUrl: "https://opensea.io/collection/hopium-machines"
    }],
    projectToken: {
      status: "CONFIRMED",
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: HOPIUM_ASSET_ADDRESS,
      association: "OWNER_CONFIRMED_PROJECT_TOKEN",
      verificationStatus: "PENDING",
      evidence: [
        { kind: "PROJECT_PUBLISHED_REFERENCE", url: "https://x.com/HopiumMachines" },
        { kind: "TECHNICAL_REFERENCE", url: blockscoutAddressReference(HOPIUM_ASSET_ADDRESS) }
      ]
    }
  },
  {
    projectId: "robin-rabbits",
    displayName: "Robin Rabbits",
    state: "TECHNICALLY_VERIFIED",
    ownerApproved: true,
    approvedAt: APPROVED_AT,
    references: [{ kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/robin-rabbits-834193084" }],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0xb87522e093858d992b7555077ff3541597deb34e",
      declaredStandard: "ERC721",
      verificationStatus: "VERIFIED",
      referenceUrl: "https://opensea.io/collection/robin-rabbits-834193084"
    }],
    projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
  },
  {
    projectId: "cannacats",
    displayName: "CannaCats",
    state: "READY_FOR_TECHNICAL_VERIFICATION",
    ownerApproved: true,
    approvedAt: APPROVED_AT,
    references: [{ kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/cannacats" }],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0x289c8ce652f38029867842048068b39bd0464a3f",
      declaredStandard: "ERC721",
      verificationStatus: "PENDING",
      referenceUrl: "https://opensea.io/collection/cannacats"
    }],
    projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
  },
  {
    projectId: "pixel-hood-minis",
    displayName: "Pixel Hood Minis",
    state: "READY_FOR_TECHNICAL_VERIFICATION",
    ownerApproved: true,
    approvedAt: APPROVED_AT,
    references: [{ kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/pixelhoodminis" }],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0x8215824669c453136cabe59a079c32aca2f87cd5",
      declaredStandard: "ERC721",
      verificationStatus: "PENDING",
      referenceUrl: "https://opensea.io/collection/pixelhoodminis"
    }],
    projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
  },
  {
    projectId: "world-weed-seeds",
    displayName: "World Weed Seeds",
    state: "NEEDS_COLLECTION_RESOLUTION",
    ownerApproved: true,
    approvedAt: APPROVED_AT,
    references: [{ kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/world-weed-seeds" }],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: null,
      declaredStandard: null,
      verificationStatus: "PENDING",
      referenceUrl: "https://opensea.io/collection/world-weed-seeds"
    }],
    projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
  },
  {
    projectId: "peeps",
    displayName: "Peeps",
    state: "WAITING_FOR_COLLECTION",
    ownerApproved: true,
    approvedAt: APPROVED_AT,
    references: [
      { kind: "OWNER_SUPPLIED_REFERENCE", url: "https://x.com/peepzonrh" },
      { kind: "PROJECT_PUBLISHED_REFERENCE", url: "https://peeps.wtf/" }
    ],
    collections: [],
    projectToken: {
      status: "CONFIRMED",
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: PEEPS_ASSET_ADDRESS,
      association: "OWNER_CONFIRMED_PROJECT_TOKEN",
      verificationStatus: "PENDING",
      evidence: [
        { kind: "PROJECT_PUBLISHED_REFERENCE", url: "https://peeps.wtf/" },
        { kind: "TECHNICAL_REFERENCE", url: dexScreenerAssetReference(PEEPS_ASSET_ADDRESS) }
      ]
    }
  },
  {
    projectId: "gogh-punks",
    displayName: "Gogh Punks",
    state: "TECHNICALLY_VERIFIED",
    ownerApproved: true,
    approvedAt: APPROVED_AT,
    references: [{ kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/gogh-punks-255843210" }],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
      declaredStandard: "ERC721",
      verificationStatus: "VERIFIED",
      referenceUrl: "https://opensea.io/collection/gogh-punks-255843210"
    }],
    projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
  },
  {
    projectId: "clay-stonkz",
    displayName: "Clay StonKz",
    state: "READY_FOR_TECHNICAL_VERIFICATION",
    ownerApproved: true,
    approvedAt: APPROVED_AT,
    references: [{ kind: "OWNER_SUPPLIED_REFERENCE", url: "https://opensea.io/collection/claystonkz" }],
    collections: [{
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress: "0xde0acefc89d4cf5f4ce45a4fb8a51aa355091b44",
      declaredStandard: "ERC721",
      verificationStatus: "PENDING",
      referenceUrl: "https://opensea.io/collection/claystonkz"
    }],
    projectToken: { status: "UNCONFIRMED", contractAddress: null, evidence: [] }
  }
] as const satisfies readonly RmtNftProjectIntakeRecord[]);

export function rmtNftProjectIntakeRecord(projectId: string) {
  const normalized = projectId.trim().toLowerCase();
  return RMT_NFT_PROJECT_INTAKE.find((record) => record.projectId === normalized) ?? null;
}

export function readyRmtNftProjectIntakeRecords() {
  return RMT_NFT_PROJECT_INTAKE.filter((record) => record.state === "READY_FOR_TECHNICAL_VERIFICATION");
}
