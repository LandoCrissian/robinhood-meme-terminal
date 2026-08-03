import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import {
  RMT_V7_ERC1155_MODULE_INTERFACE_ID,
  RMT_V7_ERC1155_MODULE_KIND,
  RMT_V7_ERC1155_MODULE_VERSION,
  RMT_V7_ERC721_MODULE_INTERFACE_ID,
  RMT_V7_ERC721_MODULE_KIND,
  RMT_V7_ERC721_MODULE_VERSION,
  verifyERC1155DeploymentSimulation,
  verifyERC721DeploymentSimulation,
  verifyReleaseFreezeSimulation,
  type CreatorV7ReviewedModuleAnchor
} from "./creator-v7-live-state-verifier";
import {
  createERC1155DeploymentSimulation,
  createERC721DeploymentSimulation,
  createReleaseFreezeSimulation
} from "./creator-v7-transaction-simulation";

const chainId = 46_630;
const blockNumber = 12_345n;
const blockTimestamp = 1_785_283_200n;
const blockHash = `0x${"ab".repeat(32)}` as Hex;
const changedBlockHash = `0x${"cd".repeat(32)}` as Hex;
const moduleRegistry = "0x1111111111111111111111111111111111111111" as Address;
const releaseRegistry = "0x2222222222222222222222222222222222222222" as Address;
const mediaVerifier = "0x3333333333333333333333333333333333333333" as Address;
const erc721Module = "0x4444444444444444444444444444444444444444" as Address;
const erc1155Module = "0x5555555555555555555555555555555555555555" as Address;
const creator = "0x6666666666666666666666666666666666666666" as Address;
const predictedCollection = "0x7777777777777777777777777777777777777777" as Address;
const releaseId = `0x${"88".repeat(32)}` as Hex;
const policyHash721 = `0x${"91".repeat(32)}` as Hex;
const policyHash1155 = `0x${"92".repeat(32)}` as Hex;
const metadataHash721 = `0x${"a1".repeat(32)}` as Hex;
const metadataHash1155 = `0x${"a2".repeat(32)}` as Hex;
const releaseMetadataHash = `0x${"b1".repeat(32)}` as Hex;
const mediaManifestHash = `0x${"b2".repeat(32)}` as Hex;
const evidenceHash = `0x${"b3".repeat(32)}` as Hex;
const moduleRegistryCode = "0x6001600055" as Hex;
const releaseRegistryCode = "0x6002600055" as Hex;
const mediaVerifierCode = "0x6003600055" as Hex;
const erc721ModuleCode = "0x6004600055" as Hex;
const erc1155ModuleCode = "0x6005600055" as Hex;

function moduleKey(input: {
  module: Address;
  code: Hex;
  kind: number;
  version: number;
  interfaceId: Hex;
  policyHash: Hex;
  metadataHash: Hex;
}) {
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
      input.kind,
      input.version,
      input.module,
      input.interfaceId,
      keccak256(input.code),
      input.policyHash,
      input.metadataHash
    ]
  ));
}

const erc721Key = moduleKey({
  module: erc721Module,
  code: erc721ModuleCode,
  kind: RMT_V7_ERC721_MODULE_KIND,
  version: RMT_V7_ERC721_MODULE_VERSION,
  interfaceId: RMT_V7_ERC721_MODULE_INTERFACE_ID,
  policyHash: policyHash721,
  metadataHash: metadataHash721
});
const erc1155Key = moduleKey({
  module: erc1155Module,
  code: erc1155ModuleCode,
  kind: RMT_V7_ERC1155_MODULE_KIND,
  version: RMT_V7_ERC1155_MODULE_VERSION,
  interfaceId: RMT_V7_ERC1155_MODULE_INTERFACE_ID,
  policyHash: policyHash1155,
  metadataHash: metadataHash1155
});

const reviewed721: CreatorV7ReviewedModuleAnchor = {
  address: erc721Module,
  runtimeCodeHash: keccak256(erc721ModuleCode),
  moduleKey: erc721Key,
  kind: RMT_V7_ERC721_MODULE_KIND,
  version: RMT_V7_ERC721_MODULE_VERSION,
  interfaceId: RMT_V7_ERC721_MODULE_INTERFACE_ID,
  policyHash: policyHash721,
  metadataHash: metadataHash721
};
const reviewed1155: CreatorV7ReviewedModuleAnchor = {
  address: erc1155Module,
  runtimeCodeHash: keccak256(erc1155ModuleCode),
  moduleKey: erc1155Key,
  kind: RMT_V7_ERC1155_MODULE_KIND,
  version: RMT_V7_ERC1155_MODULE_VERSION,
  interfaceId: RMT_V7_ERC1155_MODULE_INTERFACE_ID,
  policyHash: policyHash1155,
  metadataHash: metadataHash1155
};
const coreAnchors = {
  chainId,
  moduleRegistry: {
    address: moduleRegistry,
    runtimeCodeHash: keccak256(moduleRegistryCode)
  },
  releaseRegistry: {
    address: releaseRegistry,
    runtimeCodeHash: keccak256(releaseRegistryCode)
  }
};

type CollectionMockState = {
  chainId: number;
  canonicalHash: Hex;
  coreCodeValid: boolean;
  moduleCodeValid: boolean;
  moduleBindingValid: boolean;
  moduleActive: boolean;
  frozenIntent: boolean;
  releaseState: number;
  releaseCreator: Address;
  existingCollection: Address;
  callSucceeds: boolean;
};

function collectionClient(
  module: CreatorV7ReviewedModuleAnchor,
  code: Hex,
  overrides: Partial<CollectionMockState> = {}
) {
  const state: CollectionMockState = {
    chainId,
    canonicalHash: blockHash,
    coreCodeValid: true,
    moduleCodeValid: true,
    moduleBindingValid: true,
    moduleActive: true,
    frozenIntent: true,
    releaseState: 2,
    releaseCreator: creator,
    existingCollection: zeroAddress,
    callSucceeds: true,
    ...overrides
  };
  return {
    getChainId: async () => state.chainId,
    getBlock: async (input: { blockTag?: string; blockNumber?: bigint }) => ({
      number: input.blockTag ? blockNumber : input.blockNumber!,
      hash: input.blockTag ? blockHash : state.canonicalHash,
      timestamp: blockTimestamp
    }),
    getBytecode: async (input: { address: Address }) => {
      const address = getAddress(input.address);
      if (address === getAddress(moduleRegistry)) {
        return state.coreCodeValid ? moduleRegistryCode : "0x6009";
      }
      if (address === getAddress(releaseRegistry)) return releaseRegistryCode;
      if (address === getAddress(module.address)) return state.moduleCodeValid ? code : "0x6008";
      return undefined;
    },
    readContract: async (input: { address: Address; functionName: string }) => {
      const address = getAddress(input.address);
      if (address === getAddress(releaseRegistry)) {
        if (input.functionName === "moduleRegistry") return moduleRegistry;
        if (input.functionName === "getRelease") {
          return { creator: state.releaseCreator, state: state.releaseState };
        }
        if (input.functionName === "isFrozenModuleIntent") return state.frozenIntent;
      }
      if (address === getAddress(module.address)) {
        if (input.functionName === "moduleRegistry") {
          return state.moduleBindingValid ? moduleRegistry : releaseRegistry;
        }
        if (input.functionName === "releaseRegistry") return releaseRegistry;
        if (input.functionName === "supportsInterface") return true;
        if (
          input.functionName === "collectionForRelease"
          || input.functionName === "editionsForRelease"
        ) return state.existingCollection;
      }
      if (address === getAddress(moduleRegistry)) {
        if (input.functionName === "getModule") {
          return {
            kind: module.kind,
            version: module.version,
            implementation: module.address,
            interfaceId: module.interfaceId,
            implementationCodeHash: module.runtimeCodeHash,
            policyHash: module.policyHash,
            metadataHash: module.metadataHash,
            registeredAt: 1n,
            deactivatedAt: 0n,
            active: state.moduleActive
          };
        }
        if (input.functionName === "isModuleActive") return state.moduleActive;
        if (input.functionName === "moduleKeyByKindAndVersion") return module.moduleKey;
      }
      throw new Error(`Unexpected read ${address}.${input.functionName}`);
    },
    call: async () => {
      if (!state.callSucceeds) throw new Error("execution reverted");
      return { data: encodeAbiParameters([{ type: "address" }], [predictedCollection]) };
    }
  } as unknown as PublicClient;
}

const simulation721 = createERC721DeploymentSimulation({
  chainId,
  module: erc721Module,
  moduleKey: erc721Key,
  releaseId,
  creator,
  config: {
    name: "RMT Creator Collection",
    symbol: "RMTCC",
    collectionURI: "ipfs://bafy-collection/contract.json",
    tokenManifestRoot: `0x${"dd".repeat(32)}`,
    maximumSupply: 100,
    royaltyReceiver: creator,
    royaltyBps: 500
  }
});
const simulation1155 = createERC1155DeploymentSimulation({
  chainId,
  module: erc1155Module,
  moduleKey: erc1155Key,
  releaseId,
  creator,
  config: {
    name: "RMT Creator Editions",
    symbol: "RMTED",
    collectionURI: "ipfs://bafy-editions/contract.json",
    editionManifestRoot: `0x${"ee".repeat(32)}`,
    maximumEditionTypes: 2,
    maximumTotalSupply: 5,
    royaltyReceiver: creator,
    royaltyBps: 500
  }
});

async function verify721(overrides: Partial<CollectionMockState> = {}) {
  return verifyERC721DeploymentSimulation({
    client: collectionClient(reviewed721, erc721ModuleCode, overrides),
    simulation: simulation721,
    anchors: { ...coreAnchors, module: reviewed721 }
  });
}

async function verify1155(overrides: Partial<CollectionMockState> = {}) {
  return verifyERC1155DeploymentSimulation({
    client: collectionClient(reviewed1155, erc1155ModuleCode, overrides),
    simulation: simulation1155,
    anchors: { ...coreAnchors, module: reviewed1155 }
  });
}

type FreezeMockState = {
  chainId: number;
  canonicalHash: Hex;
  mediaCodeValid: boolean;
  moduleActive: boolean;
  releaseState: number;
  releaseCreator: Address;
  signerEpoch: bigint;
  evidenceSigner: Address;
  evidenceValid: boolean;
  callSucceeds: boolean;
  returnedManifest: Hex;
};

const freezeEvidence = {
  receiptHash: `0x${"31".repeat(32)}` as Hex,
  availabilityObservationHash: `0x${"32".repeat(32)}` as Hex,
  observedAt: Number(blockTimestamp - 60n),
  validUntil: Number(blockTimestamp + 3_600n),
  signerEpoch: 2
};
const freezeSimulation = createReleaseFreezeSimulation({
  chainId,
  releaseRegistry,
  releaseId,
  creator,
  moduleIntents: [
    { moduleKey: erc721Key, configurationHash: `0x${"41".repeat(32)}`, label: "ERC-721" },
    { moduleKey: erc1155Key, configurationHash: `0x${"42".repeat(32)}`, label: "ERC-1155" }
  ],
  mediaEvidence: freezeEvidence,
  mediaEvidenceSignature: `0x${"51".repeat(64)}1b`,
  nowSeconds: Number(blockTimestamp)
});
const freezeManifest = freezeSimulation.commitments.find(
  (commitment) => commitment.label === "Module manifest"
)!.value as Hex;

function freezeClient(overrides: Partial<FreezeMockState> = {}) {
  const state: FreezeMockState = {
    chainId,
    canonicalHash: blockHash,
    mediaCodeValid: true,
    moduleActive: true,
    releaseState: 1,
    releaseCreator: creator,
    signerEpoch: 2n,
    evidenceSigner: "0x8888888888888888888888888888888888888888",
    evidenceValid: true,
    callSucceeds: true,
    returnedManifest: freezeManifest,
    ...overrides
  };
  const modules = [reviewed721, reviewed1155];
  return {
    getChainId: async () => state.chainId,
    getBlock: async (input: { blockTag?: string; blockNumber?: bigint }) => ({
      number: input.blockTag ? blockNumber : input.blockNumber!,
      hash: input.blockTag ? blockHash : state.canonicalHash,
      timestamp: blockTimestamp
    }),
    getBytecode: async (input: { address: Address }) => {
      const address = getAddress(input.address);
      if (address === getAddress(moduleRegistry)) return moduleRegistryCode;
      if (address === getAddress(releaseRegistry)) return releaseRegistryCode;
      if (address === getAddress(mediaVerifier)) {
        return state.mediaCodeValid ? mediaVerifierCode : "0x6009";
      }
      if (address === getAddress(erc721Module)) return erc721ModuleCode;
      if (address === getAddress(erc1155Module)) return erc1155ModuleCode;
      return undefined;
    },
    readContract: async (input: {
      address: Address;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      const address = getAddress(input.address);
      if (address === getAddress(releaseRegistry)) {
        if (input.functionName === "moduleRegistry") return moduleRegistry;
        if (input.functionName === "mediaEvidenceVerifier") return mediaVerifier;
        if (input.functionName === "getRelease") {
          return {
            creator: state.releaseCreator,
            metadataHash: releaseMetadataHash,
            mediaManifestHash,
            state: state.releaseState
          };
        }
      }
      if (address === getAddress(mediaVerifier)) {
        if (input.functionName === "signerEpoch") return state.signerEpoch;
        if (input.functionName === "evidenceSigner") return state.evidenceSigner;
        if (input.functionName === "verifyEvidence") {
          if (!state.evidenceValid) throw new Error("invalid evidence");
          return evidenceHash;
        }
      }
      if (address === getAddress(moduleRegistry)) {
        const key = input.args?.[0] as Hex | undefined;
        const module = modules.find((item) => (
          item.moduleKey === key
          || keccak256(encodeAbiParameters(
            [{ type: "uint8" }, { type: "uint32" }],
            [item.kind, item.version]
          )) === key
        ));
        if (!module) throw new Error("unknown module");
        if (input.functionName === "getModule") {
          return {
            kind: module.kind,
            version: module.version,
            implementation: module.address,
            interfaceId: module.interfaceId,
            implementationCodeHash: module.runtimeCodeHash,
            policyHash: module.policyHash,
            metadataHash: module.metadataHash,
            registeredAt: 1n,
            deactivatedAt: 0n,
            active: state.moduleActive
          };
        }
        if (input.functionName === "isModuleActive") return state.moduleActive;
        if (input.functionName === "moduleKeyByKindAndVersion") return module.moduleKey;
      }
      if (
        address === getAddress(erc721Module)
        || address === getAddress(erc1155Module)
      ) {
        if (input.functionName === "supportsInterface") return true;
        if (input.functionName === "moduleRegistry") return moduleRegistry;
        if (input.functionName === "releaseRegistry") return releaseRegistry;
      }
      throw new Error(`Unexpected read ${address}.${input.functionName}`);
    },
    call: async () => {
      if (!state.callSucceeds) throw new Error("execution reverted");
      return {
        data: encodeAbiParameters([{ type: "bytes32" }], [state.returnedManifest])
      };
    }
  } as unknown as PublicClient;
}

async function verifyFreeze(overrides: Partial<FreezeMockState> = {}) {
  return verifyReleaseFreezeSimulation({
    client: freezeClient(overrides),
    simulation: freezeSimulation,
    anchors: {
      ...coreAnchors,
      mediaEvidenceVerifier: {
        address: mediaVerifier,
        runtimeCodeHash: keccak256(mediaVerifierCode)
      },
      modules: [reviewed721, reviewed1155]
    }
  });
}

async function main() {
  for (const verify of [verify721, verify1155]) {
    const result = await verify();
    assert.equal(result.status, "verified");
    assert.equal(result.failureCheck, null);
    assert.equal(result.validForSigning, false);
    assert.equal(result.signing, "disabled");
    assert.equal(result.broadcasting, "disabled");
    assert.equal(result.checks.length, 12);
    assert.ok(result.checks.every((check) => check.status === "verified"));
    assert.equal((await verify({ chainId: 1 })).failureCheck, "connected_chain");
    assert.equal((await verify({ coreCodeValid: false })).failureCheck, "runtime_identity");
    assert.equal((await verify({ moduleCodeValid: false })).failureCheck, "module_identity");
    assert.equal((await verify({ moduleBindingValid: false })).failureCheck, "registry_bindings");
    assert.equal((await verify({ moduleActive: false })).failureCheck, "module_identity");
    assert.equal((await verify({ releaseState: 1 })).failureCheck, "release_state");
    assert.equal((await verify({ frozenIntent: false })).failureCheck, "frozen_intent");
    assert.equal(
      (await verify({ existingCollection: predictedCollection })).failureCheck,
      "not_deployed"
    );
    assert.equal((await verify({ callSucceeds: false })).failureCheck, "read_only_execution");
    assert.equal(
      (await verify({ canonicalHash: changedBlockHash })).failureCheck,
      "canonical_block"
    );
  }

  const freeze = await verifyFreeze();
  assert.equal(freeze.status, "verified");
  assert.equal(freeze.failureCheck, null);
  assert.equal(freeze.validForSigning, false);
  assert.equal(freeze.checks.length, 11);
  assert.ok(freeze.checks.every((check) => check.status === "verified"));
  assert.equal((await verifyFreeze({ chainId: 1 })).failureCheck, "connected_chain");
  assert.equal((await verifyFreeze({ mediaCodeValid: false })).failureCheck, "runtime_identity");
  assert.equal((await verifyFreeze({ moduleActive: false })).failureCheck, "module_identity");
  assert.equal((await verifyFreeze({ releaseState: 2 })).failureCheck, "release_state");
  assert.equal((await verifyFreeze({ signerEpoch: 3n })).failureCheck, "media_evidence");
  assert.equal((await verifyFreeze({ evidenceValid: false })).failureCheck, "media_evidence");
  assert.equal((await verifyFreeze({ callSucceeds: false })).failureCheck, "read_only_execution");
  assert.equal(
    (await verifyFreeze({ returnedManifest: `0x${"99".repeat(32)}` })).failureCheck,
    "read_only_execution"
  );
  assert.equal(
    (await verifyFreeze({ canonicalHash: changedBlockHash })).failureCheck,
    "canonical_block"
  );

  console.log("V7 freeze and collection live-state verification smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
