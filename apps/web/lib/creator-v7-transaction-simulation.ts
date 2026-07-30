import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import {
  MAXIMUM_CREATOR_EDITION_NAME_BYTES,
  MAXIMUM_CREATOR_EDITION_ROYALTY_BPS,
  MAXIMUM_CREATOR_EDITION_SUPPLY,
  MAXIMUM_CREATOR_EDITION_SYMBOL_BYTES,
  MAXIMUM_CREATOR_EDITION_TYPES,
  MAXIMUM_CREATOR_EDITION_URI_BYTES,
  hashCreatorEditionConfig
} from "./creator-edition-manifest";
import {
  MAXIMUM_FREEZE_EVIDENCE_LIFETIME_SECONDS,
  MAXIMUM_FREEZE_OBSERVATION_AGE_SECONDS,
  type CreatorReleaseFreezeEvidence
} from "./creator-release-freeze-evidence";

export const CREATOR_V7_TRANSACTION_SIMULATION_SCHEMA_VERSION = 1 as const;
export const MAXIMUM_CREATOR_COLLECTION_SUPPLY = 100_000;
export const MAXIMUM_CREATOR_COLLECTION_ROYALTY_BPS = 1_000;
export const MAXIMUM_CREATOR_COLLECTION_NAME_BYTES = 100;
export const MAXIMUM_CREATOR_COLLECTION_SYMBOL_BYTES = 20;
export const MAXIMUM_CREATOR_COLLECTION_URI_BYTES = 2_048;
export const MAXIMUM_RELEASE_MODULE_INTENTS = 8;

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

const releaseRegistryAbi = parseAbi([
  "function freezeRelease(bytes32 releaseId, (bytes32 moduleKey, bytes32 configurationHash)[] moduleIntents, (bytes32 receiptHash, bytes32 availabilityObservationHash, uint64 observedAt, uint64 validUntil, uint64 signerEpoch) mediaEvidence, bytes mediaEvidenceSignature) returns (bytes32 moduleManifestHash)"
]);
const erc721ModuleAbi = parseAbi([
  "function deployCollection(bytes32 releaseId, (string name, string symbol, string collectionURI, bytes32 tokenManifestRoot, uint32 maximumSupply, address royaltyReceiver, uint16 royaltyBps) config) returns (address collection)"
]);
const erc1155ModuleAbi = parseAbi([
  "function deployEditions(bytes32 releaseId, (string name, string symbol, string collectionURI, bytes32 editionManifestRoot, uint32 maximumEditionTypes, uint64 maximumTotalSupply, address royaltyReceiver, uint16 royaltyBps) config) returns (address editions)"
]);

export type CreatorV7ModuleIntent = {
  moduleKey: Hex;
  configurationHash: Hex;
  label: string;
};

export type CreatorCollectionConfig = {
  name: string;
  symbol: string;
  collectionURI: string;
  tokenManifestRoot: Hex;
  maximumSupply: number;
  royaltyReceiver: Address;
  royaltyBps: number;
};

export type CreatorEditionConfig = {
  name: string;
  symbol: string;
  collectionURI: string;
  editionManifestRoot: Hex;
  maximumEditionTypes: number;
  maximumTotalSupply: number;
  royaltyReceiver: Address;
  royaltyBps: number;
};

type RequiredLiveCheck = {
  id: string;
  description: string;
  status: "required_unverified";
};

type SimulationPayload = {
  schemaVersion: typeof CREATOR_V7_TRANSACTION_SIMULATION_SCHEMA_VERSION;
  action: "freeze_release" | "deploy_erc721_collection" | "deploy_erc1155_editions";
  chainId: number;
  actor: Address;
  riskLevel: "medium" | "high";
  reviewTitle: string;
  reviewSummary: string;
  transaction: {
    to: Address;
    functionName: "freezeRelease" | "deployCollection" | "deployEditions";
    selector: Hex;
    data: Hex;
    valueWei: "0";
  };
  commitments: Array<{ label: string; value: string }>;
  stateChanges: Array<{
    label: string;
    from: string;
    to: string;
    reversible: false;
  }>;
  assetMovements: [];
  tokenApprovals: [];
  platformFees: [];
  irreversibleChanges: string[];
  requiredLiveChecks: RequiredLiveCheck[];
  warnings: string[];
  evidenceValidUntil: number | null;
  contractExecution: "disabled";
};

export type CreatorV7TransactionSimulation = SimulationPayload & {
  simulationId: Hex;
};

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function cleanChainId(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error("The simulation chain is invalid.");
  }
  return value as number;
}

function cleanAddress(value: unknown, field: string, allowZero = false): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${field} must be an EVM address.`);
  }
  const cleaned = getAddress(value);
  if (!allowZero && cleaned === zeroAddress) throw new Error(`${field} cannot be zero.`);
  return cleaned;
}

function cleanBytes32(value: unknown, field: string, allowZero = false): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be a 32-byte hash.`);
  }
  const cleaned = value.toLowerCase() as Hex;
  if (!allowZero && cleaned === ZERO_BYTES32) throw new Error(`${field} cannot be zero.`);
  return cleaned;
}

function cleanText(value: unknown, field: string, maximumBytes: number) {
  if (typeof value !== "string" || value.length === 0 || byteLength(value) > maximumBytes) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

function cleanUnsignedInteger(value: unknown, field: string, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${field} is invalid.`);
  }
  return value as number;
}

function cleanRoyalty(receiver: unknown, bps: unknown, maximumBps: number) {
  if (!Number.isSafeInteger(bps) || (bps as number) < 0 || (bps as number) > maximumBps) {
    throw new Error("The royalty rate is invalid.");
  }
  const royaltyReceiver = cleanAddress(receiver, "Royalty receiver", true);
  if (
    ((bps as number) === 0 && royaltyReceiver !== zeroAddress)
    || ((bps as number) !== 0 && royaltyReceiver === zeroAddress)
  ) throw new Error("The royalty receiver does not match the royalty rate.");
  return { royaltyReceiver, royaltyBps: bps as number };
}

function createSimulation(payload: SimulationPayload): CreatorV7TransactionSimulation {
  return {
    ...payload,
    simulationId: keccak256(toHex(JSON.stringify(payload)))
  };
}

function transactionDetails(
  to: Address,
  functionName: SimulationPayload["transaction"]["functionName"],
  data: Hex
) {
  return {
    to,
    functionName,
    selector: data.slice(0, 10) as Hex,
    data,
    valueWei: "0" as const
  };
}

function commonDeploymentChecks(kind: "ERC-721" | "ERC-1155"): RequiredLiveCheck[] {
  return [
    {
      id: "connected_chain",
      description: "The wallet is still connected to the reviewed chain.",
      status: "required_unverified"
    },
    {
      id: "creator_wallet",
      description: "The connected wallet still matches the immutable release creator.",
      status: "required_unverified"
    },
    {
      id: "module_identity",
      description: `The active ${kind} module address, interface and runtime code hash match the reviewed registry entry.`,
      status: "required_unverified"
    },
    {
      id: "frozen_intent",
      description: "The release is frozen with this exact module key and configuration hash.",
      status: "required_unverified"
    },
    {
      id: "not_deployed",
      description: "No collection has already been deployed for this release through this module.",
      status: "required_unverified"
    }
  ];
}

export function hashCreatorCollectionConfig(config: CreatorCollectionConfig): Hex {
  const cleaned = cleanCollectionConfig(config);
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint32" },
      { type: "address" },
      { type: "uint16" }
    ],
    [
      keccak256(new TextEncoder().encode(cleaned.name)),
      keccak256(new TextEncoder().encode(cleaned.symbol)),
      keccak256(new TextEncoder().encode(cleaned.collectionURI)),
      cleaned.tokenManifestRoot,
      cleaned.maximumSupply,
      cleaned.royaltyReceiver,
      cleaned.royaltyBps
    ]
  ));
}

function cleanCollectionConfig(input: CreatorCollectionConfig): CreatorCollectionConfig {
  const royalty = cleanRoyalty(
    input.royaltyReceiver,
    input.royaltyBps,
    MAXIMUM_CREATOR_COLLECTION_ROYALTY_BPS
  );
  return {
    name: cleanText(input.name, "Collection name", MAXIMUM_CREATOR_COLLECTION_NAME_BYTES),
    symbol: cleanText(input.symbol, "Collection symbol", MAXIMUM_CREATOR_COLLECTION_SYMBOL_BYTES),
    collectionURI: cleanText(
      input.collectionURI,
      "Collection URI",
      MAXIMUM_CREATOR_COLLECTION_URI_BYTES
    ),
    tokenManifestRoot: cleanBytes32(input.tokenManifestRoot, "Token manifest root"),
    maximumSupply: cleanUnsignedInteger(
      input.maximumSupply,
      "Maximum collection supply",
      MAXIMUM_CREATOR_COLLECTION_SUPPLY
    ),
    ...royalty
  };
}

function cleanEditionConfig(input: CreatorEditionConfig): CreatorEditionConfig {
  const royalty = cleanRoyalty(
    input.royaltyReceiver,
    input.royaltyBps,
    MAXIMUM_CREATOR_EDITION_ROYALTY_BPS
  );
  return {
    name: cleanText(input.name, "Edition name", MAXIMUM_CREATOR_EDITION_NAME_BYTES),
    symbol: cleanText(input.symbol, "Edition symbol", MAXIMUM_CREATOR_EDITION_SYMBOL_BYTES),
    collectionURI: cleanText(
      input.collectionURI,
      "Edition collection URI",
      MAXIMUM_CREATOR_EDITION_URI_BYTES
    ),
    editionManifestRoot: cleanBytes32(input.editionManifestRoot, "Edition manifest root"),
    maximumEditionTypes: cleanUnsignedInteger(
      input.maximumEditionTypes,
      "Maximum edition types",
      MAXIMUM_CREATOR_EDITION_TYPES
    ),
    maximumTotalSupply: cleanUnsignedInteger(
      input.maximumTotalSupply,
      "Maximum edition supply",
      MAXIMUM_CREATOR_EDITION_SUPPLY
    ),
    ...royalty
  };
}

export function createReleaseFreezeSimulation(input: {
  chainId: number;
  releaseRegistry: Address;
  releaseId: Hex;
  creator: Address;
  moduleIntents: CreatorV7ModuleIntent[];
  mediaEvidence: CreatorReleaseFreezeEvidence;
  mediaEvidenceSignature: Hex;
  nowSeconds?: number;
}): CreatorV7TransactionSimulation {
  const chainId = cleanChainId(input.chainId);
  const releaseRegistry = cleanAddress(input.releaseRegistry, "Release registry");
  const releaseId = cleanBytes32(input.releaseId, "Release ID");
  const creator = cleanAddress(input.creator, "Release creator");
  if (
    input.moduleIntents.length === 0
    || input.moduleIntents.length > MAXIMUM_RELEASE_MODULE_INTENTS
  ) throw new Error("The release module plan is invalid.");
  const labels = new Set<string>();
  const keys = new Set<string>();
  const moduleIntents = input.moduleIntents.map((intent) => {
    const moduleKey = cleanBytes32(intent.moduleKey, "Module key");
    const configurationHash = cleanBytes32(intent.configurationHash, "Module configuration hash");
    const label = cleanText(intent.label, "Module label", 100);
    if (keys.has(moduleKey)) throw new Error("The release module plan contains a duplicate module.");
    if (labels.has(label.toLowerCase())) throw new Error("The release module labels must be unique.");
    keys.add(moduleKey);
    labels.add(label.toLowerCase());
    return { moduleKey, configurationHash, label };
  }).sort((left, right) => left.moduleKey.localeCompare(right.moduleKey));

  const evidence = {
    receiptHash: cleanBytes32(input.mediaEvidence.receiptHash, "Media receipt hash"),
    availabilityObservationHash: cleanBytes32(
      input.mediaEvidence.availabilityObservationHash,
      "Availability observation hash"
    ),
    observedAt: cleanUnsignedInteger(
      input.mediaEvidence.observedAt,
      "Media observation time",
      Number.MAX_SAFE_INTEGER
    ),
    validUntil: cleanUnsignedInteger(
      input.mediaEvidence.validUntil,
      "Media evidence expiration",
      Number.MAX_SAFE_INTEGER
    ),
    signerEpoch: cleanUnsignedInteger(
      input.mediaEvidence.signerEpoch,
      "Media evidence signer epoch",
      Number.MAX_SAFE_INTEGER
    )
  };
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (
    !Number.isSafeInteger(nowSeconds)
    || evidence.observedAt > nowSeconds
    || nowSeconds - evidence.observedAt > MAXIMUM_FREEZE_OBSERVATION_AGE_SECONDS
    || evidence.validUntil <= nowSeconds
    || evidence.validUntil <= evidence.observedAt
    || evidence.validUntil - evidence.observedAt > MAXIMUM_FREEZE_EVIDENCE_LIFETIME_SECONDS
  ) throw new Error("The media evidence is not currently usable.");
  if (
    typeof input.mediaEvidenceSignature !== "string"
    || !/^0x[0-9a-fA-F]{130}$/.test(input.mediaEvidenceSignature)
  ) throw new Error("The media evidence signature must contain 65 bytes.");
  const mediaEvidenceSignature = input.mediaEvidenceSignature.toLowerCase() as Hex;
  const contractIntents = moduleIntents.map(({ moduleKey, configurationHash }) => ({
    moduleKey,
    configurationHash
  }));
  const moduleManifestHash = keccak256(encodeAbiParameters(
    [{
      type: "tuple[]",
      components: [
        { name: "moduleKey", type: "bytes32" },
        { name: "configurationHash", type: "bytes32" }
      ]
    }],
    [contractIntents]
  ));
  const data = encodeFunctionData({
    abi: releaseRegistryAbi,
    functionName: "freezeRelease",
    args: [releaseId, contractIntents, {
      receiptHash: evidence.receiptHash,
      availabilityObservationHash: evidence.availabilityObservationHash,
      observedAt: BigInt(evidence.observedAt),
      validUntil: BigInt(evidence.validUntil),
      signerEpoch: BigInt(evidence.signerEpoch)
    }, mediaEvidenceSignature]
  });

  return createSimulation({
    schemaVersion: CREATOR_V7_TRANSACTION_SIMULATION_SCHEMA_VERSION,
    action: "freeze_release",
    chainId,
    actor: creator,
    riskLevel: "high",
    reviewTitle: "Freeze this V7 creator release",
    reviewSummary: `Permanently bind ${moduleIntents.length} module configuration${moduleIntents.length === 1 ? "" : "s"} and the current media evidence to this release.`,
    transaction: transactionDetails(releaseRegistry, "freezeRelease", data),
    commitments: [
      { label: "Release ID", value: releaseId },
      { label: "Module manifest", value: moduleManifestHash },
      { label: "Media receipt", value: evidence.receiptHash },
      { label: "Availability observation", value: evidence.availabilityObservationHash },
      { label: "Evidence observed at", value: evidence.observedAt.toString() },
      { label: "Evidence valid until", value: evidence.validUntil.toString() },
      { label: "Evidence signer epoch", value: evidence.signerEpoch.toString() },
      { label: "Evidence signature", value: keccak256(mediaEvidenceSignature) },
      ...moduleIntents.flatMap((intent) => [
        { label: `${intent.label} module`, value: intent.moduleKey },
        { label: `${intent.label} configuration`, value: intent.configurationHash }
      ])
    ],
    stateChanges: [{
      label: "Release state",
      from: "committed",
      to: "frozen",
      reversible: false
    }],
    assetMovements: [],
    tokenApprovals: [],
    platformFees: [],
    irreversibleChanges: [
      "The module plan and configuration hashes cannot be edited after a successful freeze.",
      "The reviewed media-evidence fingerprints become part of the permanent release record.",
      "A correction requires a new release commitment; this release cannot return to draft."
    ],
    requiredLiveChecks: [
      {
        id: "connected_chain",
        description: "The wallet is still connected to the reviewed chain.",
        status: "required_unverified"
      },
      {
        id: "creator_wallet",
        description: "The connected wallet still matches the immutable release creator.",
        status: "required_unverified"
      },
      {
        id: "release_state",
        description: "The release remains committed, uncancelled and not already frozen.",
        status: "required_unverified"
      },
      {
        id: "module_registry",
        description: "Every module remains active with the reviewed implementation, interface and code hash.",
        status: "required_unverified"
      },
      {
        id: "media_evidence",
        description: "The evidence signer epoch, signature and validity window remain current.",
        status: "required_unverified"
      },
      {
        id: "calldata_match",
        description: "The wallet calldata exactly matches this simulation.",
        status: "required_unverified"
      }
    ],
    warnings: [
      "This simulation does not read the chain and cannot prove that its required live checks pass.",
      "Freezing does not deploy a collection, mint an asset, approve a marketplace or move funds.",
      "Module admission and media evidence are not an audit, copyright determination or RMT endorsement."
    ],
    evidenceValidUntil: evidence.validUntil,
    contractExecution: "disabled"
  });
}

export function createERC721DeploymentSimulation(input: {
  chainId: number;
  module: Address;
  moduleKey: Hex;
  releaseId: Hex;
  creator: Address;
  config: CreatorCollectionConfig;
}): CreatorV7TransactionSimulation {
  const chainId = cleanChainId(input.chainId);
  const module = cleanAddress(input.module, "ERC-721 module");
  const moduleKey = cleanBytes32(input.moduleKey, "ERC-721 module key");
  const releaseId = cleanBytes32(input.releaseId, "Release ID");
  const creator = cleanAddress(input.creator, "Release creator");
  const config = cleanCollectionConfig(input.config);
  const configurationHash = hashCreatorCollectionConfig(config);
  const data = encodeFunctionData({
    abi: erc721ModuleAbi,
    functionName: "deployCollection",
    args: [releaseId, config]
  });

  return createSimulation({
    schemaVersion: CREATOR_V7_TRANSACTION_SIMULATION_SCHEMA_VERSION,
    action: "deploy_erc721_collection",
    chainId,
    actor: creator,
    riskLevel: "medium",
    reviewTitle: "Deploy this V7 ERC-721 collection",
    reviewSummary: `Create the one-of-one or sequential collection “${config.name}” (${config.symbol}) for the frozen release.`,
    transaction: transactionDetails(module, "deployCollection", data),
    commitments: [
      { label: "Release ID", value: releaseId },
      { label: "Module key", value: moduleKey },
      { label: "Configuration", value: configurationHash },
      { label: "Token manifest", value: config.tokenManifestRoot },
      { label: "Maximum lifetime supply", value: config.maximumSupply.toString() },
      { label: "Royalty signal", value: `${config.royaltyBps} bps to ${config.royaltyReceiver}` }
    ],
    stateChanges: [{
      label: "ERC-721 collection for release",
      from: "not deployed",
      to: "deterministically deployed",
      reversible: false
    }],
    assetMovements: [],
    tokenApprovals: [],
    platformFees: [],
    irreversibleChanges: [
      "Only one ERC-721 collection can be recorded for this release through this module.",
      "Collection identity, manifest root, supply ceiling and royalty signal are immutable.",
      "The original creator remains the only mint authority in this module version."
    ],
    requiredLiveChecks: [
      ...commonDeploymentChecks("ERC-721"),
      {
        id: "calldata_match",
        description: "The wallet calldata exactly matches this simulation.",
        status: "required_unverified"
      }
    ],
    warnings: [
      "This simulation does not read the chain and cannot prove that its required live checks pass.",
      "Deployment does not mint, list, approve, sell or transfer any NFT.",
      "ERC-2981 is a royalty preference signal and does not guarantee payment."
    ],
    evidenceValidUntil: null,
    contractExecution: "disabled"
  });
}

export function createERC1155DeploymentSimulation(input: {
  chainId: number;
  module: Address;
  moduleKey: Hex;
  releaseId: Hex;
  creator: Address;
  config: CreatorEditionConfig;
}): CreatorV7TransactionSimulation {
  const chainId = cleanChainId(input.chainId);
  const module = cleanAddress(input.module, "ERC-1155 module");
  const moduleKey = cleanBytes32(input.moduleKey, "ERC-1155 module key");
  const releaseId = cleanBytes32(input.releaseId, "Release ID");
  const creator = cleanAddress(input.creator, "Release creator");
  const config = cleanEditionConfig(input.config);
  const configurationHash = hashCreatorEditionConfig(config);
  const data = encodeFunctionData({
    abi: erc1155ModuleAbi,
    functionName: "deployEditions",
    args: [releaseId, {
      ...config,
      maximumTotalSupply: BigInt(config.maximumTotalSupply)
    }]
  });

  return createSimulation({
    schemaVersion: CREATOR_V7_TRANSACTION_SIMULATION_SCHEMA_VERSION,
    action: "deploy_erc1155_editions",
    chainId,
    actor: creator,
    riskLevel: "medium",
    reviewTitle: "Deploy this V7 ERC-1155 editions collection",
    reviewSummary: `Create the limited-editions collection “${config.name}” (${config.symbol}) for the frozen release.`,
    transaction: transactionDetails(module, "deployEditions", data),
    commitments: [
      { label: "Release ID", value: releaseId },
      { label: "Module key", value: moduleKey },
      { label: "Configuration", value: configurationHash },
      { label: "Edition manifest", value: config.editionManifestRoot },
      { label: "Maximum edition types", value: config.maximumEditionTypes.toString() },
      { label: "Maximum lifetime units", value: config.maximumTotalSupply.toString() },
      { label: "Royalty signal", value: `${config.royaltyBps} bps to ${config.royaltyReceiver}` }
    ],
    stateChanges: [{
      label: "ERC-1155 editions for release",
      from: "not deployed",
      to: "deterministically deployed",
      reversible: false
    }],
    assetMovements: [],
    tokenApprovals: [],
    platformFees: [],
    irreversibleChanges: [
      "Only one ERC-1155 editions contract can be recorded for this release through this module.",
      "Collection identity, edition manifest, type cap, total supply cap and royalty signal are immutable.",
      "Each edition ID permanently binds its URI, terms hash and lifetime supply at first mint."
    ],
    requiredLiveChecks: [
      ...commonDeploymentChecks("ERC-1155"),
      {
        id: "calldata_match",
        description: "The wallet calldata exactly matches this simulation.",
        status: "required_unverified"
      }
    ],
    warnings: [
      "This simulation does not read the chain and cannot prove that its required live checks pass.",
      "Deployment does not mint, list, approve, sell or transfer any edition.",
      "A terms hash records provenance only; it does not prove ownership or grant legal rights by itself."
    ],
    evidenceValidUntil: null,
    contractExecution: "disabled"
  });
}
