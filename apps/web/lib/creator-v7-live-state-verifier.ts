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
import type {
  CreatorConsentBoundSplitConfig,
  CreatorV7TransactionSimulation
} from "./creator-v7-transaction-simulation";

export const CREATOR_V7_LIVE_VERIFICATION_SCHEMA_VERSION = 1 as const;
export const RMT_V7_SPLIT_MODULE_KIND = 3;
export const RMT_V7_SPLIT_MODULE_VERSION = 1;
export const RMT_V7_SPLIT_MODULE_INTERFACE_ID = "0xe161dd4b" as Hex;

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
const DEPLOY_SPLIT_SELECTOR = "0xeff78744" as Hex;

const moduleRegistryAbi = parseAbi([
  "function getModule(bytes32 moduleKey) view returns ((uint8 kind, uint32 version, address implementation, bytes4 interfaceId, bytes32 implementationCodeHash, bytes32 policyHash, bytes32 metadataHash, uint64 registeredAt, uint64 deactivatedAt, bool active))",
  "function isModuleActive(bytes32 moduleKey) view returns (bool)",
  "function moduleKeyByKindAndVersion(bytes32 versionKey) view returns (bytes32 moduleKey)"
]);
const releaseRegistryAbi = parseAbi([
  "function moduleRegistry() view returns (address)",
  "function getRelease(bytes32 releaseId) view returns ((address creator, bytes32 projectIdHash, bytes32 assetIdHash, bytes32 rightsRevisionHash, bytes32 metadataHash, bytes32 mediaManifestHash, bytes32 feePolicyHash, bytes32 payoutManifestHash, bytes32 moduleManifestHash, bytes32 mediaEvidenceHash, bytes32 mediaReceiptHash, bytes32 availabilityObservationHash, uint64 createdAt, uint64 frozenAt, uint64 cancelledAt, uint64 evidenceObservedAt, uint64 evidenceValidUntil, uint64 evidenceSignerEpoch, uint8 state))",
  "function isFrozenModuleIntent(bytes32 releaseId, address creator, bytes32 moduleKey, bytes32 configurationHash) view returns (bool)",
  "function isFrozenPayoutManifest(bytes32 releaseId, address creator, bytes32 payoutManifestHash) view returns (bool)"
]);
const splitModuleAbi = parseAbi([
  "function moduleRegistry() view returns (address)",
  "function releaseRegistry() view returns (address)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function splitForRelease(bytes32 releaseId) view returns (address split)",
  "function deploySplit(bytes32 releaseId, (address[] recipients, uint16[] sharesBps, address[] recoveryAddresses, uint64 consentDeadline) config, bytes[] consentSignatures) returns (address split)"
]);

type RuntimeAnchor = {
  address: Address;
  runtimeCodeHash: Hex;
};

export type CreatorV7SplitVerificationAnchors = {
  chainId: number;
  moduleRegistry: RuntimeAnchor;
  releaseRegistry: RuntimeAnchor;
  splitModule: RuntimeAnchor & {
    moduleKey: Hex;
    interfaceId: Hex;
    policyHash: Hex;
    metadataHash: Hex;
  };
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
  action: "deploy_consent_bound_split";
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
    const versionKey = keccak256(encodeAbiParameters(
      [{ type: "uint8" }, { type: "uint32" }],
      [RMT_V7_SPLIT_MODULE_KIND, RMT_V7_SPLIT_MODULE_VERSION]
    ));
    const derivedModuleKey = keccak256(encodeAbiParameters(
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
        anchors.moduleRegistry.address,
        RMT_V7_SPLIT_MODULE_KIND,
        RMT_V7_SPLIT_MODULE_VERSION,
        anchors.splitModule.address,
        anchors.splitModule.interfaceId,
        anchors.splitModule.runtimeCodeHash,
        anchors.splitModule.policyHash,
        anchors.splitModule.metadataHash
      ]
    ));
    const [moduleRecord, moduleActive, registeredModuleKey, supportsInterface] = await Promise.all([
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
        address: anchors.moduleRegistry.address,
        abi: moduleRegistryAbi,
        functionName: "getModule",
        args: [anchors.splitModule.moduleKey]
      }, blockNumber, activeCheckId),
      readAtBlock<boolean>(client, {
        address: anchors.moduleRegistry.address,
        abi: moduleRegistryAbi,
        functionName: "isModuleActive",
        args: [anchors.splitModule.moduleKey]
      }, blockNumber, activeCheckId),
      readAtBlock<Hex>(client, {
        address: anchors.moduleRegistry.address,
        abi: moduleRegistryAbi,
        functionName: "moduleKeyByKindAndVersion",
        args: [versionKey]
      }, blockNumber, activeCheckId),
      readAtBlock<boolean>(client, {
        address: anchors.splitModule.address,
        abi: splitModuleAbi,
        functionName: "supportsInterface",
        args: [anchors.splitModule.interfaceId]
      }, blockNumber, activeCheckId)
    ]);
    assertCheck(
      moduleActive
        && moduleRecord.active
        && moduleRecord.deactivatedAt === 0n
        && moduleRecord.registeredAt > 0n
        && moduleRecord.kind === RMT_V7_SPLIT_MODULE_KIND
        && moduleRecord.version === RMT_V7_SPLIT_MODULE_VERSION
        && equalAddress(moduleRecord.implementation, anchors.splitModule.address)
        && moduleRecord.interfaceId.toLowerCase() === anchors.splitModule.interfaceId
        && moduleRecord.implementationCodeHash === anchors.splitModule.runtimeCodeHash
        && moduleRecord.policyHash === anchors.splitModule.policyHash
        && moduleRecord.metadataHash === anchors.splitModule.metadataHash
        && derivedModuleKey === anchors.splitModule.moduleKey
        && registeredModuleKey === anchors.splitModule.moduleKey
        && supportsInterface,
      activeCheckId,
      "The active split-module registry record does not match the reviewed version."
    );
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
