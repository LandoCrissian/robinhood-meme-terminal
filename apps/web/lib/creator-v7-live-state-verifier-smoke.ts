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
  RMT_V7_SPLIT_MODULE_INTERFACE_ID,
  verifyConsentBoundSplitSimulation
} from "./creator-v7-live-state-verifier";
import { createConsentBoundSplitDeploymentSimulation } from "./creator-v7-transaction-simulation";

const moduleRegistry = "0x1111111111111111111111111111111111111111" as Address;
const releaseRegistry = "0x2222222222222222222222222222222222222222" as Address;
const splitModule = "0x3333333333333333333333333333333333333333" as Address;
const creator = "0x4444444444444444444444444444444444444444" as Address;
const firstRecipient = "0x5555555555555555555555555555555555555555" as Address;
const secondRecipient = "0x6666666666666666666666666666666666666666" as Address;
const recovery = "0x7777777777777777777777777777777777777777" as Address;
const predictedSplit = "0x8888888888888888888888888888888888888888" as Address;
const releaseId = `0x${"88".repeat(32)}` as Hex;
const policyHash = `0x${"aa".repeat(32)}` as Hex;
const metadataHash = `0x${"bb".repeat(32)}` as Hex;
const moduleRegistryCode = "0x6001600055" as Hex;
const releaseRegistryCode = "0x6002600055" as Hex;
const splitModuleCode = "0x6003600055" as Hex;
const moduleKey = keccak256(encodeAbiParameters(
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
    46_630n,
    moduleRegistry,
    3,
    1,
    splitModule,
    RMT_V7_SPLIT_MODULE_INTERFACE_ID,
    keccak256(splitModuleCode),
    policyHash,
    metadataHash
  ]
));
const blockHash = `0x${"cc".repeat(32)}` as Hex;
const changedBlockHash = `0x${"dd".repeat(32)}` as Hex;
const blockNumber = 12_345n;
const blockTimestamp = 1_785_283_200n;
const consentDeadline = 1_785_456_000;

const simulation = createConsentBoundSplitDeploymentSimulation({
  chainId: 46_630,
  module: splitModule,
  moduleKey,
  releaseId,
  creator,
  currentTimestamp: Number(blockTimestamp),
  config: {
    recipients: [firstRecipient, secondRecipient],
    sharesBps: [7_000, 3_000],
    recoveryAddresses: [recovery, zeroAddress],
    consentDeadline
  },
  consentSignatures: [
    `0x${"11".repeat(64)}1b`,
    `0x${"22".repeat(64)}1c`
  ]
});
const payoutManifest = simulation.commitments.find((item) => item.label === "Payout manifest")!.value as Hex;

const anchors = {
  chainId: 46_630,
  moduleRegistry: {
    address: moduleRegistry,
    runtimeCodeHash: keccak256(moduleRegistryCode)
  },
  releaseRegistry: {
    address: releaseRegistry,
    runtimeCodeHash: keccak256(releaseRegistryCode)
  },
  splitModule: {
    address: splitModule,
    runtimeCodeHash: keccak256(splitModuleCode),
    moduleKey,
    interfaceId: RMT_V7_SPLIT_MODULE_INTERFACE_ID,
    policyHash,
    metadataHash
  }
};

type MockState = {
  chainId: number;
  blockTimestamp: bigint;
  canonicalHash: Hex;
  moduleRegistryCode: Hex;
  releaseRegistryCode: Hex;
  splitModuleCode: Hex;
  releaseModuleRegistry: Address;
  moduleModuleRegistry: Address;
  moduleReleaseRegistry: Address;
  moduleActive: boolean;
  modulePolicyHash: Hex;
  moduleMetadataHash: Hex;
  registeredModuleKey: Hex;
  supportsInterface: boolean;
  releaseCreator: Address;
  releaseState: number;
  releasePayoutManifest: Hex;
  frozenIntent: boolean;
  frozenPayout: boolean;
  existingSplit: Address;
  callSucceeds: boolean;
};

function mockClient(overrides: Partial<MockState> = {}) {
  const state: MockState = {
    chainId: 46_630,
    blockTimestamp,
    canonicalHash: blockHash,
    moduleRegistryCode,
    releaseRegistryCode,
    splitModuleCode,
    releaseModuleRegistry: moduleRegistry,
    moduleModuleRegistry: moduleRegistry,
    moduleReleaseRegistry: releaseRegistry,
    moduleActive: true,
    modulePolicyHash: policyHash,
    moduleMetadataHash: metadataHash,
    registeredModuleKey: moduleKey,
    supportsInterface: true,
    releaseCreator: creator,
    releaseState: 2,
    releasePayoutManifest: payoutManifest,
    frozenIntent: true,
    frozenPayout: true,
    existingSplit: zeroAddress,
    callSucceeds: true,
    ...overrides
  };

  return {
    getChainId: async () => state.chainId,
    getBlock: async (input: { blockTag?: string; blockNumber?: bigint }) => ({
      number: input.blockTag ? blockNumber : input.blockNumber!,
      hash: input.blockTag ? blockHash : state.canonicalHash,
      timestamp: state.blockTimestamp
    }),
    getBytecode: async (input: { address: Address }) => {
      const address = getAddress(input.address);
      if (address === getAddress(moduleRegistry)) return state.moduleRegistryCode;
      if (address === getAddress(releaseRegistry)) return state.releaseRegistryCode;
      if (address === getAddress(splitModule)) return state.splitModuleCode;
      return undefined;
    },
    readContract: async (input: {
      address: Address;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      const address = getAddress(input.address);
      if (address === getAddress(releaseRegistry)) {
        if (input.functionName === "moduleRegistry") return state.releaseModuleRegistry;
        if (input.functionName === "getRelease") {
          return {
            creator: state.releaseCreator,
            payoutManifestHash: state.releasePayoutManifest,
            state: state.releaseState
          };
        }
        if (input.functionName === "isFrozenModuleIntent") return state.frozenIntent;
        if (input.functionName === "isFrozenPayoutManifest") return state.frozenPayout;
      }
      if (address === getAddress(splitModule)) {
        if (input.functionName === "moduleRegistry") return state.moduleModuleRegistry;
        if (input.functionName === "releaseRegistry") return state.moduleReleaseRegistry;
        if (input.functionName === "supportsInterface") return state.supportsInterface;
        if (input.functionName === "splitForRelease") return state.existingSplit;
      }
      if (address === getAddress(moduleRegistry)) {
        if (input.functionName === "getModule") {
          return {
            kind: 3,
            version: 1,
            implementation: splitModule,
            interfaceId: RMT_V7_SPLIT_MODULE_INTERFACE_ID,
            implementationCodeHash: keccak256(state.splitModuleCode),
            policyHash: state.modulePolicyHash,
            metadataHash: state.moduleMetadataHash,
            registeredAt: 1n,
            deactivatedAt: 0n,
            active: state.moduleActive
          };
        }
        if (input.functionName === "isModuleActive") return state.moduleActive;
        if (input.functionName === "moduleKeyByKindAndVersion") return state.registeredModuleKey;
      }
      throw new Error(`Unexpected read ${address}.${input.functionName}`);
    },
    call: async () => {
      if (!state.callSucceeds) throw new Error("execution reverted");
      return {
        data: encodeAbiParameters([{ type: "address" }], [predictedSplit])
      };
    }
  } as unknown as PublicClient;
}

async function verify(overrides: Partial<MockState> = {}) {
  return verifyConsentBoundSplitSimulation({
    client: mockClient(overrides),
    simulation,
    anchors
  });
}

async function main() {
  const verified = await verify();
  assert.equal(verified.status, "verified");
  assert.equal(verified.failureCheck, null);
  assert.equal(verified.chainId, 46_630);
  assert.equal(verified.block?.number, blockNumber.toString());
  assert.equal(verified.block?.hash, blockHash);
  assert.equal(verified.readOnlyExecution, "eth_call_only");
  assert.equal(verified.validForSigning, false);
  assert.equal(verified.signing, "disabled");
  assert.equal(verified.broadcasting, "disabled");
  assert.equal(verified.checks.length, 13);
  assert.ok(verified.checks.every((check) => check.status === "verified"));
  assert.equal(verified.verificationId, (await verify()).verificationId);

  assert.equal((await verify({ chainId: 1 })).failureCheck, "connected_chain");
  assert.equal(
    (await verify({ splitModuleCode: "0x6004600055" })).failureCheck,
    "runtime_identity"
  );
  assert.equal(
    (await verify({ moduleReleaseRegistry: moduleRegistry })).failureCheck,
    "registry_bindings"
  );
  assert.equal(
    (await verify({ moduleActive: false })).failureCheck,
    "module_identity"
  );
  assert.equal(
    (await verify({ modulePolicyHash: `0x${"01".repeat(32)}` })).failureCheck,
    "module_identity"
  );
  assert.equal(
    (await verify({ blockTimestamp: BigInt(consentDeadline + 1) })).failureCheck,
    "consent_deadline"
  );
  assert.equal(
    (await verify({ releaseCreator: firstRecipient })).failureCheck,
    "release_state"
  );
  assert.equal(
    (await verify({ releasePayoutManifest: `0x${"02".repeat(32)}` })).failureCheck,
    "release_state"
  );
  assert.equal(
    (await verify({ frozenIntent: false })).failureCheck,
    "frozen_intent"
  );
  assert.equal(
    (await verify({ existingSplit: predictedSplit })).failureCheck,
    "not_deployed"
  );
  assert.equal(
    (await verify({ callSucceeds: false })).failureCheck,
    "recipient_consent"
  );
  assert.equal(
    (await verify({ canonicalHash: changedBlockHash })).failureCheck,
    "canonical_block"
  );

  const tamperedSimulation = {
    ...simulation,
    reviewSummary: "Trust this altered receipt."
  };
  const tampered = await verifyConsentBoundSplitSimulation({
    client: mockClient(),
    simulation: tamperedSimulation,
    anchors
  });
  assert.equal(tampered.failureCheck, "simulation_shape");
  assert.equal(tampered.validForSigning, false);

  const wrongInterface = await verifyConsentBoundSplitSimulation({
    client: mockClient(),
    simulation,
    anchors: {
      ...anchors,
      splitModule: {
        ...anchors.splitModule,
        interfaceId: "0x12345678"
      }
    }
  });
  assert.equal(wrongInterface.failureCheck, "reviewed_anchors");

  console.log("V7 live-state verifier smoke test passed");
}

void main();
