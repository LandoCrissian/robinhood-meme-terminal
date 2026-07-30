import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { hashCreatorSplitConfig } from "./creator-split-manifest";
import { hashCreatorEditionConfig } from "./creator-edition-manifest";
import type {
  CreatorCollectionConfig,
  CreatorConsentBoundSplitConfig,
  CreatorEditionConfig,
  CreatorV7TransactionSimulation
} from "./creator-v7-transaction-simulation";
import { hashCreatorCollectionConfig } from "./creator-v7-transaction-simulation";

export const CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION = 1 as const;
export const RMT_V7_SPLIT_MODULE_KIND = 3;
export const RMT_V7_SPLIT_MODULE_VERSION = 1;
export const RMT_V7_ERC721_MODULE_KIND = 1;
export const RMT_V7_ERC721_MODULE_VERSION = 1;
export const RMT_V7_ERC1155_MODULE_KIND = 2;
export const RMT_V7_ERC1155_MODULE_VERSION = 1;
export const RMT_V7_SPLIT_MODULE_INTERFACE_ID = "0xe161dd4b" as Hex;
export const RMT_V7_ERC721_MODULE_INTERFACE_ID = "0x6c2ba9ae" as Hex;
export const RMT_V7_ERC1155_MODULE_INTERFACE_ID = "0xb96f46b7" as Hex;

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
const FREEZE_RELEASE_SELECTOR = "0x43fc941c" as Hex;
const DEPLOY_ERC721_SELECTOR = "0x8223704e" as Hex;
const DEPLOY_ERC1155_SELECTOR = "0x59c29a1b" as Hex;
const DEPLOY_SPLIT_SELECTOR = "0xeff78744" as Hex;

const moduleRegistryAbi = parseAbi([
  "function getModule(bytes32 moduleKey) view returns ((uint8 kind, uint32 version, address implementation, bytes4 interfaceId, bytes32 implementationCodeHash, bytes32 policyHash, bytes32 metadataHash, uint64 registeredAt, uint64 deactivatedAt, bool active))",
  "function isModuleActive(bytes32 moduleKey) view returns (bool)",
  "function moduleKeyByKindAndVersion(bytes32 versionKey) view returns (bytes32 moduleKey)"
]);
const releaseRegistryAbi = parseAbi([
  "function moduleRegistry() view returns (address)",
  "function mediaEvidenceVerifier() view returns (address)",
  "function getRelease(bytes32 releaseId) view returns ((address creator, bytes32 projectIdHash, bytes32 assetIdHash, bytes32 rightsRevisionHash, bytes32 metadataHash, bytes32 mediaManifestHash, bytes32 feePolicyHash, bytes32 payoutManifestHash, bytes32 moduleManifestHash, bytes32 mediaEvidenceHash, bytes32 mediaReceiptHash, bytes32 availabilityObservationHash, uint64 createdAt, uint64 frozenAt, uint64 cancelledAt, uint64 evidenceObservedAt, uint64 evidenceValidUntil, uint64 evidenceSignerEpoch, uint8 state))",
  "function isFrozenModuleIntent(bytes32 releaseId, address creator, bytes32 moduleKey, bytes32 configurationHash) view returns (bool)",
  "function isFrozenPayoutManifest(bytes32 releaseId, address creator, bytes32 payoutManifestHash) view returns (bool)"
]);
const releaseFreezeAbi = parseAbi([
  "function freezeRelease(bytes32 releaseId, (bytes32 moduleKey, bytes32 configurationHash)[] moduleIntents, (bytes32 receiptHash, bytes32 availabilityObservationHash, uint64 observedAt, uint64 validUntil, uint64 signerEpoch) mediaEvidence, bytes mediaEvidenceSignature) returns (bytes32 moduleManifestHash)"
]);
const mediaEvidenceVerifierAbi = parseAbi([
  "function signerEpoch() view returns (uint64)",
  "function evidenceSigner() view returns (address)",
  "function verifyEvidence(address releaseRegistry, bytes32 releaseId, address creator, bytes32 metadataHash, bytes32 mediaManifestHash, (bytes32 receiptHash, bytes32 availabilityObservationHash, uint64 observedAt, uint64 validUntil, uint64 signerEpoch) evidence, bytes signature) view returns (bytes32 evidenceHash)"
]);
const erc721ModuleAbi = parseAbi([
  "function moduleRegistry() view returns (address)",
  "function releaseRegistry() view returns (address)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function collectionForRelease(bytes32 releaseId) view returns (address collection)",
  "function deployCollection(bytes32 releaseId, (string name, string symbol, string collectionURI, bytes32 tokenManifestRoot, uint32 maximumSupply, address royaltyReceiver, uint16 royaltyBps) config) returns (address collection)"
]);
const erc1155ModuleAbi = parseAbi([
  "function moduleRegistry() view returns (address)",
  "function releaseRegistry() view returns (address)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function editionsForRelease(bytes32 releaseId) view returns (address editions)",
  "function deployEditions(bytes32 releaseId, (string name, string symbol, string collectionURI, bytes32 editionManifestRoot, uint32 maximumEditionTypes, uint64 maximumTotalSupply, address royaltyReceiver, uint16 royaltyBps) config) returns (address editions)"
]);
const erc165Abi = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)"
]);
const moduleTopologyAbi = parseAbi([
  "function moduleRegistry() view returns (address)",
  "function releaseRegistry() view returns (address)"
]);
const splitModuleAbi = parseAbi([
  "function moduleRegistry() view returns (address)",
  "function releaseRegistry() view returns (address)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function splitForRelease(bytes32 releaseId) view returns (address split)",
  "function deploySplit(bytes32 releaseId, (address[] recipients, uint16[] sharesBps, address[] recoveryAddresses, uint64 consentDeadline) config, bytes[] consentSignatures) returns (address split)"
]);

export type CreatorV7RuntimeAnchor = {
  address: Address;
  runtimeCodeHash: Hex;
};

export type CreatorV7SplitVerificationAnchors = {
  chainId: number;
  moduleRegistry: CreatorV7RuntimeAnchor;
  releaseRegistry: CreatorV7RuntimeAnchor;
  splitModule: CreatorV7RuntimeAnchor & {
    moduleKey: Hex;
    interfaceId: Hex;
    policyHash: Hex;
    metadataHash: Hex;
  };
};

export type CreatorV7ReviewedModuleAnchor = CreatorV7RuntimeAnchor & {
  moduleKey: Hex;
  kind: number;
  version: number;
  interfaceId: Hex;
  policyHash: Hex;
  metadataHash: Hex;
};

export type CreatorV7CollectionVerificationAnchors = {
  chainId: number;
  moduleRegistry: CreatorV7RuntimeAnchor;
  releaseRegistry: CreatorV7RuntimeAnchor;
  module: Omit<CreatorV7ReviewedModuleAnchor, "kind" | "version" | "interfaceId">;
};

export type CreatorV7ReleaseFreezeVerificationAnchors = {
  chainId: number;
  moduleRegistry: CreatorV7RuntimeAnchor;
  releaseRegistry: CreatorV7RuntimeAnchor;
  mediaEvidenceVerifier: CreatorV7RuntimeAnchor;
  modules: CreatorV7ReviewedModuleAnchor[];
};

export type CreatorV7LiveVerificationCheck = {
  id: string;
  description: string;
  status: "verified" | "failed";
  evidence: string;
};

export type CreatorV7LiveVerification = {
  schemaVersion: typeof CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION;
  simulationId: Hex;
  verificationId: Hex;
  action:
    | "freeze_release"
    | "deploy_erc721_collection"
    | "deploy_erc1155_editions"
    | "deploy_consent_bound_split";
  status: "verified" | "failed";
  chainId: number | null;
  block: {
    number: string;
    hash: Hex;
    timestamp: string;
  } | null;
  checks: CreatorV7LiveVerificationCheck[];
  failureCheck: string | null;
  readOnlyExecution: "eth_call_only";
  validForSigning: false;
  signing: "disabled";
  broadcasting: "disabled";
};

type VerificationPayload = Omit<CreatorV7LiveVerification, "verificationId">;

class CheckFailure extends Error {
  constructor(
    readonly checkId: string,
    message: string
  ) {
    super(message);
  }
}

function cleanAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new CheckFailure("reviewed_anchors", `${field} is invalid.`);
  }
  const address = getAddress(value);
  if (address === zeroAddress) throw new CheckFailure("reviewed_anchors", `${field} is zero.`);
  return address;
}

function cleanBytes32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new CheckFailure("reviewed_anchors", `${field} is invalid.`);
  }
  const hash = value.toLowerCase() as Hex;
  if (hash === ZERO_BYTES32) throw new CheckFailure("reviewed_anchors", `${field} is zero.`);
  return hash;
}

function cleanBytes4(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(value)) {
    throw new CheckFailure("reviewed_anchors", `${field} is invalid.`);
  }
  const selector = value.toLowerCase() as Hex;
  if (selector === "0x00000000" || selector === "0xffffffff") {
    throw new CheckFailure("reviewed_anchors", `${field} is not reviewable.`);
  }
  return selector;
}

function equalAddress(left: string, right: string) {
  return getAddress(left) === getAddress(right);
}

function assertCheck(condition: unknown, checkId: string, message: string): asserts condition {
  if (!condition) throw new CheckFailure(checkId, message);
}

function runtimeHash(bytecode: Hex | undefined) {
  return bytecode && bytecode !== "0x" ? keccak256(bytecode) : ZERO_BYTES32;
}

function finalize(payload: VerificationPayload): CreatorV7LiveVerification {
  return {
    ...payload,
    verificationId: keccak256(toHex(JSON.stringify(payload)))
  };
}

async function readAtBlock<T>(
  client: PublicClient,
  input: Parameters<PublicClient["readContract"]>[0],
  blockNumber: bigint,
  checkId: string
) {
  try {
    return await client.readContract({ ...input, blockNumber }) as T;
  } catch {
    throw new CheckFailure(checkId, "The pinned contract read failed.");
  }
}

function cleanRuntimeAnchor(anchor: CreatorV7RuntimeAnchor, label: string): CreatorV7RuntimeAnchor {
  return {
    address: cleanAddress(anchor.address, label),
    runtimeCodeHash: cleanBytes32(anchor.runtimeCodeHash, `${label} runtime hash`)
  };
}

function cleanReviewedModuleAnchor(
  anchor: CreatorV7ReviewedModuleAnchor,
  label: string
): CreatorV7ReviewedModuleAnchor {
  assertCheck(
    Number.isSafeInteger(anchor.kind) && anchor.kind > 0
      && Number.isSafeInteger(anchor.version) && anchor.version > 0,
    "reviewed_anchors",
    `${label} kind or version is invalid.`
  );
  return {
    ...cleanRuntimeAnchor(anchor, label),
    moduleKey: cleanBytes32(anchor.moduleKey, `${label} module key`),
    kind: anchor.kind,
    version: anchor.version,
    interfaceId: cleanBytes4(anchor.interfaceId, `${label} interface ID`),
    policyHash: cleanBytes32(anchor.policyHash, `${label} policy hash`),
    metadataHash: cleanBytes32(anchor.metadataHash, `${label} metadata hash`)
  };
}

function deriveReviewedModuleKey(
  chainId: number,
  moduleRegistry: Address,
  module: CreatorV7ReviewedModuleAnchor
) {
  return keccak256(encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "uint8" },
      { type: "uint32" },
      { type: "address" },
      { type: "bytes4" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" }
    ],
    [
      BigInt(chainId),
      moduleRegistry,
      module.kind,
      module.version,
      module.address,
      module.interfaceId,
      module.runtimeCodeHash,
      module.policyHash,
      module.metadataHash
    ]
  ));
}

async function verifyReviewedModuleAtBlock(input: {
  client: PublicClient;
  chainId: number;
  blockNumber: bigint;
  moduleRegistry: Address;
  releaseRegistry: Address;
  module: CreatorV7ReviewedModuleAnchor;
}) {
  const { client, chainId, blockNumber, moduleRegistry, releaseRegistry, module } = input;
  let bytecode: Hex | undefined;
  try {
    bytecode = await client.getBytecode({ address: module.address, blockNumber });
  } catch {
    throw new CheckFailure("module_identity", "The reviewed module runtime could not be read.");
  }
  assertCheck(
    runtimeHash(bytecode) === module.runtimeCodeHash,
    "module_identity",
    "A reviewed module runtime hash does not match."
  );
  const versionKey = keccak256(encodeAbiParameters(
    [{ type: "uint8" }, { type: "uint32" }],
    [module.kind, module.version]
  ));
  const [
    record,
    active,
    registeredModuleKey,
    supportsInterface,
    boundModuleRegistry,
    boundReleaseRegistry
  ] = await Promise.all([
    readAtBlock<{
      kind: number;
      version: number;
      implementation: Address;
      interfaceId: Hex;
      implementationCodeHash: Hex;
      policyHash: Hex;
      metadataHash: Hex;
      registeredAt: bigint;
      deactivatedAt: bigint;
      active: boolean;
    }>(client, {
      address: moduleRegistry,
      abi: moduleRegistryAbi,
      functionName: "getModule",
      args: [module.moduleKey]
    }, blockNumber, "module_identity"),
    readAtBlock<boolean>(client, {
      address: moduleRegistry,
      abi: moduleRegistryAbi,
      functionName: "isModuleActive",
      args: [module.moduleKey]
    }, blockNumber, "module_identity"),
    readAtBlock<Hex>(client, {
      address: moduleRegistry,
      abi: moduleRegistryAbi,
      functionName: "moduleKeyByKindAndVersion",
      args: [versionKey]
    }, blockNumber, "module_identity"),
    readAtBlock<boolean>(client, {
      address: module.address,
      abi: erc165Abi,
      functionName: "supportsInterface",
      args: [module.interfaceId]
    }, blockNumber, "module_identity"),
    readAtBlock<Address>(client, {
      address: module.address,
      abi: moduleTopologyAbi,
      functionName: "moduleRegistry"
    }, blockNumber, "module_identity"),
    readAtBlock<Address>(client, {
      address: module.address,
      abi: moduleTopologyAbi,
      functionName: "releaseRegistry"
    }, blockNumber, "module_identity")
  ]);
  assertCheck(
    active
      && record.active
      && record.deactivatedAt === 0n
      && record.registeredAt > 0n
      && record.kind === module.kind
      && record.version === module.version
      && equalAddress(record.implementation, module.address)
      && record.interfaceId.toLowerCase() === module.interfaceId
      && record.implementationCodeHash === module.runtimeCodeHash
      && record.policyHash === module.policyHash
      && record.metadataHash === module.metadataHash
      && registeredModuleKey === module.moduleKey
      && deriveReviewedModuleKey(chainId, moduleRegistry, module) === module.moduleKey
      && supportsInterface
      && equalAddress(boundModuleRegistry, moduleRegistry)
      && equalAddress(boundReleaseRegistry, releaseRegistry),
    "module_identity",
    "The active module registry record does not match its reviewed anchor."
  );
}

export async function verifyConsentBoundSplitSimulation(input: {
  client: PublicClient;
  simulation: CreatorV7TransactionSimulation;
  anchors: CreatorV7SplitVerificationAnchors;
}): Promise<CreatorV7LiveVerification> {
  const checks: CreatorV7LiveVerificationCheck[] = [];
  let chainId: number | null = null;
  let pinnedBlock: CreatorV7LiveVerification["block"] = null;
  let activeCheckId = "reviewed_anchors";

  const pass = (id: string, description: string, evidence: string) => {
    checks.push({ id, description, status: "verified", evidence });
  };

  try {
    const { client, simulation } = input;
    const { simulationId: claimedSimulationId, ...simulationPayload } = simulation;
    const anchors = {
      chainId: input.anchors.chainId,
      moduleRegistry: {
        address: cleanAddress(input.anchors.moduleRegistry.address, "Module registry"),
        runtimeCodeHash: cleanBytes32(
          input.anchors.moduleRegistry.runtimeCodeHash,
          "Module-registry runtime hash"
        )
      },
      releaseRegistry: {
        address: cleanAddress(input.anchors.releaseRegistry.address, "Release registry"),
        runtimeCodeHash: cleanBytes32(
          input.anchors.releaseRegistry.runtimeCodeHash,
          "Release-registry runtime hash"
        )
      },
      splitModule: {
        address: cleanAddress(input.anchors.splitModule.address, "Split module"),
        runtimeCodeHash: cleanBytes32(
          input.anchors.splitModule.runtimeCodeHash,
          "Split-module runtime hash"
        ),
        moduleKey: cleanBytes32(input.anchors.splitModule.moduleKey, "Split module key"),
        interfaceId: cleanBytes4(input.anchors.splitModule.interfaceId, "Split interface ID"),
        policyHash: cleanBytes32(input.anchors.splitModule.policyHash, "Split policy hash"),
        metadataHash: cleanBytes32(input.anchors.splitModule.metadataHash, "Split metadata hash")
      }
    };
    assertCheck(
      Number.isSafeInteger(anchors.chainId) && anchors.chainId > 0,
      "reviewed_anchors",
      "The reviewed chain is invalid."
    );
    assertCheck(
      new Set([
        anchors.moduleRegistry.address.toLowerCase(),
        anchors.releaseRegistry.address.toLowerCase(),
        anchors.splitModule.address.toLowerCase()
      ]).size === 3,
      "reviewed_anchors",
      "Reviewed V7 contract addresses must be distinct."
    );
    assertCheck(
      simulation.action === "deploy_consent_bound_split"
        && keccak256(toHex(JSON.stringify(simulationPayload))) === claimedSimulationId
        && simulation.transaction.functionName === "deploySplit"
        && simulation.contractExecution === "disabled"
        && simulation.transaction.valueWei === "0"
        && simulation.transaction.selector === DEPLOY_SPLIT_SELECTOR
        && simulation.transaction.data.slice(0, 10) === DEPLOY_SPLIT_SELECTOR
        && equalAddress(simulation.transaction.to, anchors.splitModule.address),
      "simulation_shape",
      "The simulation is not the reviewed split deployment."
    );
    assertCheck(
      anchors.splitModule.interfaceId === RMT_V7_SPLIT_MODULE_INTERFACE_ID,
      "reviewed_anchors",
      "The reviewed split interface ID does not match module version 1."
    );
    pass(
      "simulation_shape",
      "The receipt is an exact non-executable split deployment.",
      simulation.simulationId
    );

    activeCheckId = "connected_chain";
    chainId = await client.getChainId();
    assertCheck(
      chainId === anchors.chainId && chainId === simulation.chainId,
      activeCheckId,
      "The connected chain does not match the reviewed simulation."
    );
    pass(activeCheckId, "The connected chain matches the reviewed chain.", chainId.toString());

    activeCheckId = "pinned_block";
    const block = await client.getBlock({ blockTag: "latest" });
    assertCheck(
      block.number !== null && block.hash !== null && block.timestamp > 0n,
      activeCheckId,
      "The latest block could not be pinned."
    );
    const blockNumber = block.number;
    pinnedBlock = {
      number: blockNumber.toString(),
      hash: block.hash,
      timestamp: block.timestamp.toString()
    };
    pass(activeCheckId, "Every verification read is pinned to one block.", block.hash);

    activeCheckId = "runtime_identity";
    const [moduleRegistryCode, releaseRegistryCode, splitModuleCode] = await Promise.all([
      client.getBytecode({ address: anchors.moduleRegistry.address, blockNumber }),
      client.getBytecode({ address: anchors.releaseRegistry.address, blockNumber }),
      client.getBytecode({ address: anchors.splitModule.address, blockNumber })
    ]);
    assertCheck(
      runtimeHash(moduleRegistryCode) === anchors.moduleRegistry.runtimeCodeHash
        && runtimeHash(releaseRegistryCode) === anchors.releaseRegistry.runtimeCodeHash
        && runtimeHash(splitModuleCode) === anchors.splitModule.runtimeCodeHash,
      activeCheckId,
      "A reviewed contract runtime hash does not match."
    );
    pass(
      activeCheckId,
      "Core registries and split module match their reviewed runtime hashes.",
      anchors.splitModule.runtimeCodeHash
    );

    activeCheckId = "registry_bindings";
    const [releaseModuleRegistry, moduleModuleRegistry, moduleReleaseRegistry] = await Promise.all([
      readAtBlock<Address>(client, {
        address: anchors.releaseRegistry.address,
        abi: releaseRegistryAbi,
        functionName: "moduleRegistry"
      }, blockNumber, activeCheckId),
      readAtBlock<Address>(client, {
        address: anchors.splitModule.address,
        abi: splitModuleAbi,
        functionName: "moduleRegistry"
      }, blockNumber, activeCheckId),
      readAtBlock<Address>(client, {
        address: anchors.splitModule.address,
        abi: splitModuleAbi,
        functionName: "releaseRegistry"
      }, blockNumber, activeCheckId)
    ]);
    assertCheck(
      equalAddress(releaseModuleRegistry, anchors.moduleRegistry.address)
        && equalAddress(moduleModuleRegistry, anchors.moduleRegistry.address)
        && equalAddress(moduleReleaseRegistry, anchors.releaseRegistry.address),
      activeCheckId,
      "The registry and module bindings do not match the reviewed topology."
    );
    pass(activeCheckId, "The release registry and split module use the reviewed topology.", anchors.moduleRegistry.address);

    activeCheckId = "module_identity";
    await verifyReviewedModuleAtBlock({
      client,
      chainId,
      blockNumber,
      moduleRegistry: anchors.moduleRegistry.address,
      releaseRegistry: anchors.releaseRegistry.address,
      module: {
        ...anchors.splitModule,
        kind: RMT_V7_SPLIT_MODULE_KIND,
        version: RMT_V7_SPLIT_MODULE_VERSION
      }
    });
    pass(activeCheckId, "The append-only registry record matches the reviewed active split module.", anchors.splitModule.moduleKey);

    activeCheckId = "exact_calldata";
    const decoded = decodeFunctionData({
      abi: splitModuleAbi,
      data: simulation.transaction.data
    });
    assertCheck(decoded.functionName === "deploySplit", activeCheckId, "The split calldata could not be decoded.");
    const releaseId = decoded.args[0];
    const config: CreatorConsentBoundSplitConfig = {
      recipients: [...decoded.args[1].recipients],
      sharesBps: [...decoded.args[1].sharesBps],
      recoveryAddresses: [...decoded.args[1].recoveryAddresses],
      consentDeadline: Number(decoded.args[1].consentDeadline)
    };
    assertCheck(
      Number.isSafeInteger(config.consentDeadline)
        && decoded.args[2].length === config.recipients.length,
      activeCheckId,
      "The split calldata arrays are not reviewable."
    );
    const hashes = hashCreatorSplitConfig(config);
    pass(activeCheckId, "The complete split calldata decodes to one positional signed manifest.", keccak256(simulation.transaction.data));

    activeCheckId = "consent_deadline";
    assertCheck(
      BigInt(config.consentDeadline) > block.timestamp,
      activeCheckId,
      "The consent deadline has expired at the pinned block."
    );
    pass(activeCheckId, "The consent deadline is live at the pinned block.", config.consentDeadline.toString());

    activeCheckId = "release_state";
    const release = await readAtBlock<{
      creator: Address;
      payoutManifestHash: Hex;
      state: number;
    }>(client, {
      address: anchors.releaseRegistry.address,
      abi: releaseRegistryAbi,
      functionName: "getRelease",
      args: [releaseId]
    }, blockNumber, activeCheckId);
    assertCheck(
      release.state === 2
        && equalAddress(release.creator, simulation.actor)
        && release.payoutManifestHash === hashes.payoutManifestHash,
      activeCheckId,
      "The release creator, frozen state or payout manifest does not match."
    );
    pass(activeCheckId, "The exact creator release is frozen with the reviewed payout manifest.", releaseId);

    activeCheckId = "frozen_intent";
    const [frozenIntent, frozenPayoutManifest] = await Promise.all([
      readAtBlock<boolean>(client, {
        address: anchors.releaseRegistry.address,
        abi: releaseRegistryAbi,
        functionName: "isFrozenModuleIntent",
        args: [
          releaseId,
          simulation.actor,
          anchors.splitModule.moduleKey,
          hashes.configurationHash
        ]
      }, blockNumber, activeCheckId),
      readAtBlock<boolean>(client, {
        address: anchors.releaseRegistry.address,
        abi: releaseRegistryAbi,
        functionName: "isFrozenPayoutManifest",
        args: [releaseId, simulation.actor, hashes.payoutManifestHash]
      }, blockNumber, activeCheckId)
    ]);
    assertCheck(
      frozenIntent && frozenPayoutManifest,
      activeCheckId,
      "The exact split intent or payout manifest is not frozen."
    );
    pass(activeCheckId, "The exact configuration and payout manifest are frozen.", hashes.configurationHash);

    activeCheckId = "not_deployed";
    const existingSplit = await readAtBlock<Address>(client, {
      address: anchors.splitModule.address,
      abi: splitModuleAbi,
      functionName: "splitForRelease",
      args: [releaseId]
    }, blockNumber, activeCheckId);
    assertCheck(existingSplit === zeroAddress, activeCheckId, "A split is already recorded for this release.");
    pass(activeCheckId, "No split is already recorded for this release.", zeroAddress);

    activeCheckId = "recipient_consent";
    let callData: Hex | undefined;
    try {
      const result = await client.call({
        account: simulation.actor,
        to: anchors.splitModule.address,
        data: simulation.transaction.data,
        value: 0n,
        blockNumber
      });
      callData = result.data;
    } catch {
      throw new CheckFailure(activeCheckId, "The exact split deployment reverts at the pinned block.");
    }
    assertCheck(callData !== undefined && callData !== "0x", activeCheckId, "The read-only execution returned no split address.");
    const [predictedSplit] = decodeAbiParameters([{ type: "address" }], callData);
    assertCheck(predictedSplit !== zeroAddress, activeCheckId, "The read-only execution returned a zero split address.");
    pass(
      activeCheckId,
      "The exact calldata succeeds as a read-only call, including every EOA or ERC-1271 consent check.",
      predictedSplit
    );

    activeCheckId = "canonical_block";
    const canonical = await client.getBlock({ blockNumber });
    assertCheck(
      canonical.hash === pinnedBlock.hash,
      activeCheckId,
      "The pinned block changed before verification completed."
    );
    pass(activeCheckId, "The pinned block remained canonical through the final check.", pinnedBlock.hash);

    return finalize({
      schemaVersion: CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION,
      simulationId: simulation.simulationId,
      action: "deploy_consent_bound_split",
      status: "verified",
      chainId,
      block: pinnedBlock,
      checks,
      failureCheck: null,
      readOnlyExecution: "eth_call_only",
      validForSigning: false,
      signing: "disabled",
      broadcasting: "disabled"
    });
  } catch (error) {
    const failure = error instanceof CheckFailure
      ? error
      : new CheckFailure(activeCheckId, "The live-state verification failed closed.");
    checks.push({
      id: failure.checkId,
      description: "Verification stopped at this required check.",
      status: "failed",
      evidence: failure.message
    });
    return finalize({
      schemaVersion: CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION,
      simulationId: input.simulation.simulationId,
      action: "deploy_consent_bound_split",
      status: "failed",
      chainId,
      block: pinnedBlock,
      checks,
      failureCheck: failure.checkId,
      readOnlyExecution: "eth_call_only",
      validForSigning: false,
      signing: "disabled",
      broadcasting: "disabled"
    });
  }
}

type CollectionVerificationSpec = {
  action: "deploy_erc721_collection" | "deploy_erc1155_editions";
  functionName: "deployCollection" | "deployEditions";
  selector: Hex;
  kind: number;
  version: number;
  interfaceId: Hex;
  abi: typeof erc721ModuleAbi | typeof erc1155ModuleAbi;
  deployedGetter: "collectionForRelease" | "editionsForRelease";
  decodeConfiguration: (value: unknown) => {
    configurationHash: Hex;
    evidence: string;
  };
};

async function verifyCollectionDeploymentSimulation(input: {
  client: PublicClient;
  simulation: CreatorV7TransactionSimulation;
  anchors: CreatorV7CollectionVerificationAnchors;
  spec: CollectionVerificationSpec;
}): Promise<CreatorV7LiveVerification> {
  const checks: CreatorV7LiveVerificationCheck[] = [];
  let chainId: number | null = null;
  let pinnedBlock: CreatorV7LiveVerification["block"] = null;
  let activeCheckId = "reviewed_anchors";
  const { simulation, spec } = input;
  const pass = (id: string, description: string, evidence: string) => {
    checks.push({ id, description, status: "verified", evidence });
  };

  try {
    const { simulationId: claimedSimulationId, ...simulationPayload } = simulation;
    assertCheck(
      Number.isSafeInteger(input.anchors.chainId) && input.anchors.chainId > 0,
      "reviewed_anchors",
      "The reviewed chain is invalid."
    );
    const moduleRegistry = cleanRuntimeAnchor(input.anchors.moduleRegistry, "Module registry");
    const releaseRegistry = cleanRuntimeAnchor(input.anchors.releaseRegistry, "Release registry");
    const module = cleanReviewedModuleAnchor({
      ...input.anchors.module,
      kind: spec.kind,
      version: spec.version,
      interfaceId: spec.interfaceId
    }, `${spec.action} module`);
    assertCheck(
      new Set([moduleRegistry.address, releaseRegistry.address, module.address].map(
        (address) => address.toLowerCase()
      )).size === 3,
      "reviewed_anchors",
      "Reviewed V7 contract addresses must be distinct."
    );
    assertCheck(
      simulation.action === spec.action
        && keccak256(toHex(JSON.stringify(simulationPayload))) === claimedSimulationId
        && simulation.transaction.functionName === spec.functionName
        && simulation.contractExecution === "disabled"
        && simulation.transaction.valueWei === "0"
        && simulation.transaction.selector === spec.selector
        && simulation.transaction.data.slice(0, 10) === spec.selector
        && equalAddress(simulation.transaction.to, module.address),
      "simulation_shape",
      "The simulation is not the reviewed collection deployment."
    );
    pass(
      "simulation_shape",
      "The receipt is an exact non-executable collection deployment.",
      simulation.simulationId
    );

    activeCheckId = "connected_chain";
    chainId = await input.client.getChainId();
    assertCheck(
      chainId === input.anchors.chainId && chainId === simulation.chainId,
      activeCheckId,
      "The connected chain does not match the reviewed simulation."
    );
    pass(activeCheckId, "The connected chain matches the reviewed chain.", chainId.toString());

    activeCheckId = "pinned_block";
    const block = await input.client.getBlock({ blockTag: "latest" });
    assertCheck(
      block.number !== null && block.hash !== null && block.timestamp > 0n,
      activeCheckId,
      "The latest block could not be pinned."
    );
    const blockNumber = block.number;
    pinnedBlock = {
      number: blockNumber.toString(),
      hash: block.hash,
      timestamp: block.timestamp.toString()
    };
    pass(activeCheckId, "Every verification read is pinned to one block.", block.hash);

    activeCheckId = "runtime_identity";
    const [moduleRegistryCode, releaseRegistryCode] = await Promise.all([
      input.client.getBytecode({ address: moduleRegistry.address, blockNumber }),
      input.client.getBytecode({ address: releaseRegistry.address, blockNumber })
    ]);
    assertCheck(
      runtimeHash(moduleRegistryCode) === moduleRegistry.runtimeCodeHash
        && runtimeHash(releaseRegistryCode) === releaseRegistry.runtimeCodeHash,
      activeCheckId,
      "A reviewed core-contract runtime hash does not match."
    );
    pass(activeCheckId, "The V7 core registries match reviewed runtime hashes.", releaseRegistry.runtimeCodeHash);

    activeCheckId = "registry_bindings";
    const [releaseModuleRegistry, moduleModuleRegistry, moduleReleaseRegistry] = await Promise.all([
      readAtBlock<Address>(input.client, {
        address: releaseRegistry.address,
        abi: releaseRegistryAbi,
        functionName: "moduleRegistry"
      }, blockNumber, activeCheckId),
      readAtBlock<Address>(input.client, {
        address: module.address,
        abi: spec.abi,
        functionName: "moduleRegistry"
      }, blockNumber, activeCheckId),
      readAtBlock<Address>(input.client, {
        address: module.address,
        abi: spec.abi,
        functionName: "releaseRegistry"
      }, blockNumber, activeCheckId)
    ]);
    assertCheck(
      equalAddress(releaseModuleRegistry, moduleRegistry.address)
        && equalAddress(moduleModuleRegistry, moduleRegistry.address)
        && equalAddress(moduleReleaseRegistry, releaseRegistry.address),
      activeCheckId,
      "The registry and module bindings do not match the reviewed topology."
    );
    pass(activeCheckId, "The module uses the reviewed V7 registry topology.", module.address);

    activeCheckId = "module_identity";
    await verifyReviewedModuleAtBlock({
      client: input.client,
      chainId,
      blockNumber,
      moduleRegistry: moduleRegistry.address,
      releaseRegistry: releaseRegistry.address,
      module
    });
    pass(activeCheckId, "The active append-only registry record matches the reviewed module.", module.moduleKey);

    activeCheckId = "exact_calldata";
    const decoded = decodeFunctionData({
      abi: spec.abi,
      data: simulation.transaction.data
    });
    assertCheck(
      decoded.functionName === spec.functionName,
      activeCheckId,
      "The collection calldata could not be decoded."
    );
    const releaseId = decoded.args[0] as Hex;
    const decodedConfiguration = spec.decodeConfiguration(decoded.args[1]);
    pass(
      activeCheckId,
      "The complete deployment calldata decodes to the reviewed immutable configuration.",
      decodedConfiguration.evidence
    );

    activeCheckId = "release_state";
    const release = await readAtBlock<{ creator: Address; state: number }>(input.client, {
      address: releaseRegistry.address,
      abi: releaseRegistryAbi,
      functionName: "getRelease",
      args: [releaseId]
    }, blockNumber, activeCheckId);
    assertCheck(
      release.state === 2 && equalAddress(release.creator, simulation.actor),
      activeCheckId,
      "The release is not frozen for the exact creator."
    );
    pass(activeCheckId, "The exact creator release is frozen.", releaseId);

    activeCheckId = "frozen_intent";
    const frozenIntent = await readAtBlock<boolean>(input.client, {
      address: releaseRegistry.address,
      abi: releaseRegistryAbi,
      functionName: "isFrozenModuleIntent",
      args: [releaseId, simulation.actor, module.moduleKey, decodedConfiguration.configurationHash]
    }, blockNumber, activeCheckId);
    assertCheck(frozenIntent, activeCheckId, "The exact collection configuration is not frozen.");
    pass(activeCheckId, "The exact module and configuration hash are frozen.", decodedConfiguration.configurationHash);

    activeCheckId = "not_deployed";
    const existing = await readAtBlock<Address>(input.client, {
      address: module.address,
      abi: spec.abi,
      functionName: spec.deployedGetter,
      args: [releaseId]
    }, blockNumber, activeCheckId);
    assertCheck(existing === zeroAddress, activeCheckId, "A collection is already recorded for this release.");
    pass(activeCheckId, "No collection is already recorded for this release.", zeroAddress);

    activeCheckId = "read_only_execution";
    let callData: Hex | undefined;
    try {
      callData = (await input.client.call({
        account: simulation.actor,
        to: module.address,
        data: simulation.transaction.data,
        value: 0n,
        blockNumber
      })).data;
    } catch {
      throw new CheckFailure(activeCheckId, "The exact collection deployment reverts at the pinned block.");
    }
    assertCheck(callData !== undefined && callData !== "0x", activeCheckId, "The read-only execution returned no address.");
    const [predictedCollection] = decodeAbiParameters([{ type: "address" }], callData);
    assertCheck(predictedCollection !== zeroAddress, activeCheckId, "The read-only execution returned a zero address.");
    pass(activeCheckId, "The exact calldata succeeds through eth_call without broadcasting.", predictedCollection);

    activeCheckId = "canonical_block";
    const canonical = await input.client.getBlock({ blockNumber });
    assertCheck(canonical.hash === pinnedBlock.hash, activeCheckId, "The pinned block changed before verification completed.");
    pass(activeCheckId, "The pinned block remained canonical through the final check.", pinnedBlock.hash);

    return finalize({
      schemaVersion: CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION,
      simulationId: simulation.simulationId,
      action: spec.action,
      status: "verified",
      chainId,
      block: pinnedBlock,
      checks,
      failureCheck: null,
      readOnlyExecution: "eth_call_only",
      validForSigning: false,
      signing: "disabled",
      broadcasting: "disabled"
    });
  } catch (error) {
    const failure = error instanceof CheckFailure
      ? error
      : new CheckFailure(activeCheckId, "The live-state verification failed closed.");
    checks.push({
      id: failure.checkId,
      description: "Verification stopped at this required check.",
      status: "failed",
      evidence: failure.message
    });
    return finalize({
      schemaVersion: CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION,
      simulationId: simulation.simulationId,
      action: spec.action,
      status: "failed",
      chainId,
      block: pinnedBlock,
      checks,
      failureCheck: failure.checkId,
      readOnlyExecution: "eth_call_only",
      validForSigning: false,
      signing: "disabled",
      broadcasting: "disabled"
    });
  }
}

export function verifyERC721DeploymentSimulation(input: {
  client: PublicClient;
  simulation: CreatorV7TransactionSimulation;
  anchors: CreatorV7CollectionVerificationAnchors;
}) {
  return verifyCollectionDeploymentSimulation({
    ...input,
    spec: {
      action: "deploy_erc721_collection",
      functionName: "deployCollection",
      selector: DEPLOY_ERC721_SELECTOR,
      kind: RMT_V7_ERC721_MODULE_KIND,
      version: RMT_V7_ERC721_MODULE_VERSION,
      interfaceId: RMT_V7_ERC721_MODULE_INTERFACE_ID,
      abi: erc721ModuleAbi,
      deployedGetter: "collectionForRelease",
      decodeConfiguration: (value) => {
        const config = value as {
          name: string;
          symbol: string;
          collectionURI: string;
          tokenManifestRoot: Hex;
          maximumSupply: number;
          royaltyReceiver: Address;
          royaltyBps: number;
        };
        const cleaned: CreatorCollectionConfig = {
          ...config,
          maximumSupply: Number(config.maximumSupply),
          royaltyBps: Number(config.royaltyBps)
        };
        return {
          configurationHash: hashCreatorCollectionConfig(cleaned),
          evidence: hashCreatorCollectionConfig(cleaned)
        };
      }
    }
  });
}

export function verifyERC1155DeploymentSimulation(input: {
  client: PublicClient;
  simulation: CreatorV7TransactionSimulation;
  anchors: CreatorV7CollectionVerificationAnchors;
}) {
  return verifyCollectionDeploymentSimulation({
    ...input,
    spec: {
      action: "deploy_erc1155_editions",
      functionName: "deployEditions",
      selector: DEPLOY_ERC1155_SELECTOR,
      kind: RMT_V7_ERC1155_MODULE_KIND,
      version: RMT_V7_ERC1155_MODULE_VERSION,
      interfaceId: RMT_V7_ERC1155_MODULE_INTERFACE_ID,
      abi: erc1155ModuleAbi,
      deployedGetter: "editionsForRelease",
      decodeConfiguration: (value) => {
        const config = value as {
          name: string;
          symbol: string;
          collectionURI: string;
          editionManifestRoot: Hex;
          maximumEditionTypes: number;
          maximumTotalSupply: bigint;
          royaltyReceiver: Address;
          royaltyBps: number;
        };
        const cleaned: CreatorEditionConfig = {
          ...config,
          maximumEditionTypes: Number(config.maximumEditionTypes),
          maximumTotalSupply: Number(config.maximumTotalSupply),
          royaltyBps: Number(config.royaltyBps)
        };
        return {
          configurationHash: hashCreatorEditionConfig(cleaned),
          evidence: hashCreatorEditionConfig(cleaned)
        };
      }
    }
  });
}

export async function verifyReleaseFreezeSimulation(input: {
  client: PublicClient;
  simulation: CreatorV7TransactionSimulation;
  anchors: CreatorV7ReleaseFreezeVerificationAnchors;
}): Promise<CreatorV7LiveVerification> {
  const checks: CreatorV7LiveVerificationCheck[] = [];
  let chainId: number | null = null;
  let pinnedBlock: CreatorV7LiveVerification["block"] = null;
  let activeCheckId = "reviewed_anchors";
  const { simulation } = input;
  const pass = (id: string, description: string, evidence: string) => {
    checks.push({ id, description, status: "verified", evidence });
  };

  try {
    const { simulationId: claimedSimulationId, ...simulationPayload } = simulation;
    assertCheck(
      Number.isSafeInteger(input.anchors.chainId) && input.anchors.chainId > 0,
      "reviewed_anchors",
      "The reviewed chain is invalid."
    );
    const moduleRegistry = cleanRuntimeAnchor(input.anchors.moduleRegistry, "Module registry");
    const releaseRegistry = cleanRuntimeAnchor(input.anchors.releaseRegistry, "Release registry");
    const mediaEvidenceVerifier = cleanRuntimeAnchor(
      input.anchors.mediaEvidenceVerifier,
      "Media evidence verifier"
    );
    const modules = input.anchors.modules.map((module, index) => (
      cleanReviewedModuleAnchor(module, `Reviewed module ${index + 1}`)
    ));
    assertCheck(
      modules.length > 0
        && new Set(modules.map((module) => module.moduleKey)).size === modules.length
        && new Set([
          moduleRegistry.address,
          releaseRegistry.address,
          mediaEvidenceVerifier.address,
          ...modules.map((module) => module.address)
        ].map((address) => address.toLowerCase())).size === modules.length + 3,
      "reviewed_anchors",
      "Reviewed V7 anchors are empty, duplicated or overlapping."
    );
    assertCheck(
      simulation.action === "freeze_release"
        && keccak256(toHex(JSON.stringify(simulationPayload))) === claimedSimulationId
        && simulation.transaction.functionName === "freezeRelease"
        && simulation.contractExecution === "disabled"
        && simulation.transaction.valueWei === "0"
        && simulation.transaction.selector === FREEZE_RELEASE_SELECTOR
        && simulation.transaction.data.slice(0, 10) === FREEZE_RELEASE_SELECTOR
        && equalAddress(simulation.transaction.to, releaseRegistry.address),
      "simulation_shape",
      "The simulation is not the reviewed release freeze."
    );
    pass("simulation_shape", "The receipt is an exact non-executable release freeze.", simulation.simulationId);

    activeCheckId = "connected_chain";
    chainId = await input.client.getChainId();
    assertCheck(
      chainId === input.anchors.chainId && chainId === simulation.chainId,
      activeCheckId,
      "The connected chain does not match the reviewed simulation."
    );
    pass(activeCheckId, "The connected chain matches the reviewed chain.", chainId.toString());

    activeCheckId = "pinned_block";
    const block = await input.client.getBlock({ blockTag: "latest" });
    assertCheck(
      block.number !== null && block.hash !== null && block.timestamp > 0n,
      activeCheckId,
      "The latest block could not be pinned."
    );
    const blockNumber = block.number;
    pinnedBlock = {
      number: blockNumber.toString(),
      hash: block.hash,
      timestamp: block.timestamp.toString()
    };
    pass(activeCheckId, "Every verification read is pinned to one block.", block.hash);

    activeCheckId = "runtime_identity";
    const [moduleRegistryCode, releaseRegistryCode, mediaVerifierCode] = await Promise.all([
      input.client.getBytecode({ address: moduleRegistry.address, blockNumber }),
      input.client.getBytecode({ address: releaseRegistry.address, blockNumber }),
      input.client.getBytecode({ address: mediaEvidenceVerifier.address, blockNumber })
    ]);
    assertCheck(
      runtimeHash(moduleRegistryCode) === moduleRegistry.runtimeCodeHash
        && runtimeHash(releaseRegistryCode) === releaseRegistry.runtimeCodeHash
        && runtimeHash(mediaVerifierCode) === mediaEvidenceVerifier.runtimeCodeHash,
      activeCheckId,
      "A reviewed V7 core runtime hash does not match."
    );
    pass(activeCheckId, "The V7 registries and evidence verifier match reviewed runtimes.", mediaEvidenceVerifier.runtimeCodeHash);

    activeCheckId = "registry_bindings";
    const [boundModuleRegistry, boundMediaVerifier] = await Promise.all([
      readAtBlock<Address>(input.client, {
        address: releaseRegistry.address,
        abi: releaseRegistryAbi,
        functionName: "moduleRegistry"
      }, blockNumber, activeCheckId),
      readAtBlock<Address>(input.client, {
        address: releaseRegistry.address,
        abi: releaseRegistryAbi,
        functionName: "mediaEvidenceVerifier"
      }, blockNumber, activeCheckId)
    ]);
    assertCheck(
      equalAddress(boundModuleRegistry, moduleRegistry.address)
        && equalAddress(boundMediaVerifier, mediaEvidenceVerifier.address),
      activeCheckId,
      "The release registry does not use the reviewed module and evidence registries."
    );
    pass(activeCheckId, "The release registry uses the reviewed V7 topology.", releaseRegistry.address);

    activeCheckId = "exact_calldata";
    const decoded = decodeFunctionData({
      abi: releaseFreezeAbi,
      data: simulation.transaction.data
    });
    assertCheck(decoded.functionName === "freezeRelease", activeCheckId, "The freeze calldata could not be decoded.");
    const releaseId = decoded.args[0];
    const moduleIntents = decoded.args[1].map((intent) => ({
      moduleKey: intent.moduleKey,
      configurationHash: intent.configurationHash
    }));
    const evidence = decoded.args[2];
    const signature = decoded.args[3];
    assertCheck(
      moduleIntents.length === modules.length
        && new Set(moduleIntents.map((intent) => intent.moduleKey)).size === moduleIntents.length
        && moduleIntents.every((intent) => (
          modules.some((module) => module.moduleKey === intent.moduleKey)
        )),
      activeCheckId,
      "The calldata module plan does not exactly match the reviewed modules."
    );
    const moduleManifestHash = keccak256(encodeAbiParameters(
      [{
        type: "tuple[]",
        components: [
          { name: "moduleKey", type: "bytes32" },
          { name: "configurationHash", type: "bytes32" }
        ]
      }],
      [moduleIntents]
    ));
    pass(activeCheckId, "The complete freeze calldata matches the reviewed module plan.", moduleManifestHash);

    activeCheckId = "module_identity";
    for (const module of modules) {
      await verifyReviewedModuleAtBlock({
        client: input.client,
        chainId,
        blockNumber,
        moduleRegistry: moduleRegistry.address,
        releaseRegistry: releaseRegistry.address,
        module
      });
    }
    pass(activeCheckId, "Every freeze module matches an active reviewed registry record.", modules.length.toString());

    activeCheckId = "release_state";
    const release = await readAtBlock<{
      creator: Address;
      metadataHash: Hex;
      mediaManifestHash: Hex;
      state: number;
    }>(input.client, {
      address: releaseRegistry.address,
      abi: releaseRegistryAbi,
      functionName: "getRelease",
      args: [releaseId]
    }, blockNumber, activeCheckId);
    assertCheck(
      release.state === 1 && equalAddress(release.creator, simulation.actor),
      activeCheckId,
      "The release is not committed and controlled by the exact creator."
    );
    pass(activeCheckId, "The exact creator release remains committed and unfrozen.", releaseId);

    activeCheckId = "media_evidence";
    assertCheck(
      evidence.validUntil >= block.timestamp && evidence.observedAt <= block.timestamp,
      activeCheckId,
      "The media evidence is not live at the pinned block."
    );
    const [signerEpoch, evidenceSigner] = await Promise.all([
      readAtBlock<bigint>(input.client, {
        address: mediaEvidenceVerifier.address,
        abi: mediaEvidenceVerifierAbi,
        functionName: "signerEpoch"
      }, blockNumber, activeCheckId),
      readAtBlock<Address>(input.client, {
        address: mediaEvidenceVerifier.address,
        abi: mediaEvidenceVerifierAbi,
        functionName: "evidenceSigner"
      }, blockNumber, activeCheckId)
    ]);
    assertCheck(
      signerEpoch === evidence.signerEpoch && evidenceSigner !== zeroAddress,
      activeCheckId,
      "The evidence signer or signer epoch no longer matches."
    );
    const evidenceHash = await readAtBlock<Hex>(input.client, {
      address: mediaEvidenceVerifier.address,
      abi: mediaEvidenceVerifierAbi,
      functionName: "verifyEvidence",
      args: [
        releaseRegistry.address,
        releaseId,
        simulation.actor,
        release.metadataHash,
        release.mediaManifestHash,
        evidence,
        signature
      ]
    }, blockNumber, activeCheckId);
    assertCheck(evidenceHash !== ZERO_BYTES32, activeCheckId, "The media evidence returned a zero hash.");
    pass(activeCheckId, "The exact evidence signature verifies at the pinned signer epoch.", evidenceHash);

    activeCheckId = "read_only_execution";
    let callData: Hex | undefined;
    try {
      callData = (await input.client.call({
        account: simulation.actor,
        to: releaseRegistry.address,
        data: simulation.transaction.data,
        value: 0n,
        blockNumber
      })).data;
    } catch {
      throw new CheckFailure(activeCheckId, "The exact release freeze reverts at the pinned block.");
    }
    assertCheck(callData !== undefined && callData !== "0x", activeCheckId, "The read-only freeze returned no manifest hash.");
    const [returnedManifestHash] = decodeAbiParameters([{ type: "bytes32" }], callData);
    assertCheck(
      returnedManifestHash === moduleManifestHash,
      activeCheckId,
      "The read-only freeze returned an unexpected module manifest."
    );
    pass(activeCheckId, "The exact freeze calldata succeeds through eth_call without broadcasting.", returnedManifestHash);

    activeCheckId = "canonical_block";
    const canonical = await input.client.getBlock({ blockNumber });
    assertCheck(canonical.hash === pinnedBlock.hash, activeCheckId, "The pinned block changed before verification completed.");
    pass(activeCheckId, "The pinned block remained canonical through the final check.", pinnedBlock.hash);

    return finalize({
      schemaVersion: CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION,
      simulationId: simulation.simulationId,
      action: "freeze_release",
      status: "verified",
      chainId,
      block: pinnedBlock,
      checks,
      failureCheck: null,
      readOnlyExecution: "eth_call_only",
      validForSigning: false,
      signing: "disabled",
      broadcasting: "disabled"
    });
  } catch (error) {
    const failure = error instanceof CheckFailure
      ? error
      : new CheckFailure(activeCheckId, "The live-state verification failed closed.");
    checks.push({
      id: failure.checkId,
      description: "Verification stopped at this required check.",
      status: "failed",
      evidence: failure.message
    });
    return finalize({
      schemaVersion: CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION,
      simulationId: simulation.simulationId,
      action: "freeze_release",
      status: "failed",
      chainId,
      block: pinnedBlock,
      checks,
      failureCheck: failure.checkId,
      readOnlyExecution: "eth_call_only",
      validForSigning: false,
      signing: "disabled",
      broadcasting: "disabled"
    });
  }
}
