import assert from "node:assert/strict";
import { decodeFunctionData, keccak256, parseAbi, zeroAddress, type Address } from "viem";
import { buildCreatorEditionManifest } from "./creator-edition-manifest";
import {
  createConsentBoundSplitDeploymentSimulation,
  createERC1155DeploymentSimulation,
  createERC721DeploymentSimulation,
  createReleaseFreezeSimulation,
  hashCreatorCollectionConfig
} from "./creator-v7-transaction-simulation";

const releaseRegistryAbi = parseAbi([
  "function freezeRelease(bytes32 releaseId, (bytes32 moduleKey, bytes32 configurationHash)[] moduleIntents, (bytes32 receiptHash, bytes32 availabilityObservationHash, uint64 observedAt, uint64 validUntil, uint64 signerEpoch) mediaEvidence, bytes mediaEvidenceSignature) returns (bytes32 moduleManifestHash)"
]);
const erc721ModuleAbi = parseAbi([
  "function deployCollection(bytes32 releaseId, (string name, string symbol, string collectionURI, bytes32 tokenManifestRoot, uint32 maximumSupply, address royaltyReceiver, uint16 royaltyBps) config) returns (address collection)"
]);
const erc1155ModuleAbi = parseAbi([
  "function deployEditions(bytes32 releaseId, (string name, string symbol, string collectionURI, bytes32 editionManifestRoot, uint32 maximumEditionTypes, uint64 maximumTotalSupply, address royaltyReceiver, uint16 royaltyBps) config) returns (address editions)"
]);
const consentBoundSplitModuleAbi = parseAbi([
  "function deploySplit(bytes32 releaseId, (address[] recipients, uint16[] sharesBps, address[] recoveryAddresses, uint64 consentDeadline) config, bytes[] consentSignatures) returns (address split)"
]);

const releaseRegistry = "0x1111111111111111111111111111111111111111";
const erc721Module = "0x2222222222222222222222222222222222222222";
const erc1155Module = "0x3333333333333333333333333333333333333333";
const creator = "0x4444444444444444444444444444444444444444";
const splitModule = "0x5555555555555555555555555555555555555555";
const releaseId = `0x${"55".repeat(32)}` as const;
const erc721ModuleKey = `0x${"66".repeat(32)}` as const;
const erc1155ModuleKey = `0x${"77".repeat(32)}` as const;
const erc721ConfigurationHash = `0x${"88".repeat(32)}` as const;
const erc1155ConfigurationHash = `0x${"99".repeat(32)}` as const;
const nowSeconds = 1_785_283_200;

const moduleIntents = [
  {
    moduleKey: erc1155ModuleKey,
    configurationHash: erc1155ConfigurationHash,
    label: "Limited editions"
  },
  {
    moduleKey: erc721ModuleKey,
    configurationHash: erc721ConfigurationHash,
    label: "Sequential collection"
  }
];
const mediaEvidence = {
  receiptHash: `0x${"aa".repeat(32)}` as const,
  availabilityObservationHash: `0x${"bb".repeat(32)}` as const,
  observedAt: nowSeconds - 60,
  validUntil: nowSeconds + 3_600,
  signerEpoch: 2
};
const mediaEvidenceSignature = `0x${"cc".repeat(64)}1b` as const;

const freeze = createReleaseFreezeSimulation({
  chainId: 46_630,
  releaseRegistry,
  releaseId,
  creator,
  moduleIntents,
  mediaEvidence,
  mediaEvidenceSignature,
  nowSeconds
});
const reorderedFreeze = createReleaseFreezeSimulation({
  chainId: 46_630,
  releaseRegistry,
  releaseId,
  creator,
  moduleIntents: [...moduleIntents].reverse(),
  mediaEvidence,
  mediaEvidenceSignature,
  nowSeconds
});
assert.equal(freeze.action, "freeze_release");
assert.equal(freeze.riskLevel, "high");
assert.equal(freeze.transaction.valueWei, "0");
assert.equal(freeze.contractExecution, "disabled");
assert.equal(freeze.assetMovements.length, 0);
assert.equal(freeze.tokenApprovals.length, 0);
assert.equal(freeze.platformFees.length, 0);
assert.equal(freeze.stateChanges[0]?.reversible, false);
assert.ok(freeze.requiredLiveChecks.every((check) => check.status === "required_unverified"));
assert.equal(freeze.transaction.data, reorderedFreeze.transaction.data);
assert.equal(freeze.simulationId, reorderedFreeze.simulationId);
assert.equal(freeze.transaction.selector, "0x43fc941c");
assert.equal(
  keccak256(freeze.transaction.data),
  "0xd83e4a37c9f4337560269f537f8deff3af833a2e5d7ea9e7caa8b574d364c431"
);
assert.equal(freeze.simulationId, "0x05ea6831978055c1f867d80a0110fad6fc1b0bdc07ecaf13e5c052304a4777c5");

const decodedFreeze = decodeFunctionData({
  abi: releaseRegistryAbi,
  data: freeze.transaction.data
});
assert.equal(decodedFreeze.functionName, "freezeRelease");
assert.equal(decodedFreeze.args[0], releaseId);
assert.equal(decodedFreeze.args[1].length, 2);
assert.equal(decodedFreeze.args[1][0].moduleKey, erc721ModuleKey);
assert.equal(decodedFreeze.args[1][1].moduleKey, erc1155ModuleKey);
assert.equal(decodedFreeze.args[2].receiptHash, mediaEvidence.receiptHash);
assert.equal(decodedFreeze.args[2].observedAt, BigInt(mediaEvidence.observedAt));
assert.equal(decodedFreeze.args[3], mediaEvidenceSignature);

assert.throws(() => createReleaseFreezeSimulation({
  chainId: 46_630,
  releaseRegistry,
  releaseId,
  creator,
  moduleIntents: [moduleIntents[0], { ...moduleIntents[0], label: "Duplicate" }],
  mediaEvidence,
  mediaEvidenceSignature,
  nowSeconds
}), /duplicate module/);
assert.throws(() => createReleaseFreezeSimulation({
  chainId: 46_630,
  releaseRegistry,
  releaseId,
  creator,
  moduleIntents,
  mediaEvidence: { ...mediaEvidence, validUntil: nowSeconds },
  mediaEvidenceSignature,
  nowSeconds
}), /not currently usable/);
assert.throws(() => createReleaseFreezeSimulation({
  chainId: 46_630,
  releaseRegistry,
  releaseId,
  creator,
  moduleIntents,
  mediaEvidence,
  mediaEvidenceSignature: "0x12",
  nowSeconds
}), /65 bytes/);
assert.throws(() => createReleaseFreezeSimulation({
  chainId: 46_630,
  releaseRegistry: zeroAddress,
  releaseId,
  creator,
  moduleIntents,
  mediaEvidence,
  mediaEvidenceSignature,
  nowSeconds
}), /cannot be zero/);

const erc721Config = {
  name: "RMT Creator Collection",
  symbol: "RMTCC",
  collectionURI: "ipfs://bafy-collection/contract.json",
  tokenManifestRoot: `0x${"dd".repeat(32)}` as const,
  maximumSupply: 100,
  royaltyReceiver: creator as Address,
  royaltyBps: 500
};
const erc721 = createERC721DeploymentSimulation({
  chainId: 46_630,
  module: erc721Module,
  moduleKey: erc721ModuleKey,
  releaseId,
  creator,
  config: erc721Config
});
assert.equal(erc721.action, "deploy_erc721_collection");
assert.equal(erc721.transaction.valueWei, "0");
assert.equal(erc721.assetMovements.length, 0);
assert.equal(erc721.tokenApprovals.length, 0);
assert.equal(erc721.platformFees.length, 0);
assert.equal(erc721.transaction.selector, "0x8223704e");
assert.equal(
  keccak256(erc721.transaction.data),
  "0x71f93bb20ff1b95bf5e59e71ff8a5fa28b311f051f2f49866fdbdd849c160519"
);
assert.equal(erc721.simulationId, "0xdbd8ee0916e7c8e6d2da8c60b72adecc3c6bca13698492eec91bde7f31232ff3");
assert.equal(
  hashCreatorCollectionConfig(erc721Config),
  "0x2e96e966a36d2c08aedfd016461fac9b1fd7bf75a3b498686987b49d341609ec"
);
assert.ok(erc721.commitments.some((item) => (
  item.label === "Configuration" && item.value === hashCreatorCollectionConfig(erc721Config)
)));
const decodedERC721 = decodeFunctionData({
  abi: erc721ModuleAbi,
  data: erc721.transaction.data
});
assert.equal(decodedERC721.functionName, "deployCollection");
assert.equal(decodedERC721.args[0], releaseId);
assert.equal(decodedERC721.args[1].name, erc721Config.name);
assert.equal(decodedERC721.args[1].maximumSupply, erc721Config.maximumSupply);
assert.throws(() => createERC721DeploymentSimulation({
  chainId: 46_630,
  module: erc721Module,
  moduleKey: erc721ModuleKey,
  releaseId,
  creator,
  config: { ...erc721Config, royaltyReceiver: zeroAddress }
}), /does not match/);
assert.throws(() => createERC721DeploymentSimulation({
  chainId: 46_630,
  module: zeroAddress,
  moduleKey: erc721ModuleKey,
  releaseId,
  creator,
  config: erc721Config
}), /cannot be zero/);

const editionManifest = buildCreatorEditionManifest({
  name: "RMT Creator Editions",
  symbol: "RMTED",
  collectionURI: "ipfs://bafy-editions/contract.json",
  royaltyReceiver: creator,
  royaltyBps: 500,
  editions: [
    {
      tokenId: 1n,
      tokenURI: "ipfs://bafy-edition-one/metadata.json",
      termsHash: `0x${"01".repeat(32)}`,
      maximumSupply: 3
    },
    {
      tokenId: 2n,
      tokenURI: "ipfs://bafy-edition-two/metadata.json",
      termsHash: `0x${"02".repeat(32)}`,
      maximumSupply: 2
    }
  ]
});
const erc1155 = createERC1155DeploymentSimulation({
  chainId: 46_630,
  module: erc1155Module,
  moduleKey: erc1155ModuleKey,
  releaseId,
  creator,
  config: editionManifest.config
});
assert.equal(erc1155.action, "deploy_erc1155_editions");
assert.equal(erc1155.transaction.valueWei, "0");
assert.equal(erc1155.assetMovements.length, 0);
assert.equal(erc1155.tokenApprovals.length, 0);
assert.equal(erc1155.platformFees.length, 0);
assert.equal(erc1155.transaction.selector, "0x59c29a1b");
assert.equal(
  keccak256(erc1155.transaction.data),
  "0x04c43376d20f7a49bfbdd56990b2b3f64bd12a0dccb0558702268427830441ac"
);
assert.equal(
  erc1155.simulationId,
  "0x6a286b0efcec7433fbbd0e75e32e46bf11e013550154b231bae1aae90defac07"
);
assert.equal(
  editionManifest.configurationHash,
  "0x6bd37c154feb8cc8e37c75867da1fdefd4332accfda4ee03ff7f730fda017816"
);
assert.ok(erc1155.commitments.some((item) => (
  item.label === "Configuration" && item.value === editionManifest.configurationHash
)));
const decodedERC1155 = decodeFunctionData({
  abi: erc1155ModuleAbi,
  data: erc1155.transaction.data
});
assert.equal(decodedERC1155.functionName, "deployEditions");
assert.equal(decodedERC1155.args[0], releaseId);
assert.equal(decodedERC1155.args[1].editionManifestRoot, editionManifest.config.editionManifestRoot);
assert.equal(
  decodedERC1155.args[1].maximumTotalSupply,
  BigInt(editionManifest.config.maximumTotalSupply)
);
assert.notEqual(
  erc1155.simulationId,
  createERC1155DeploymentSimulation({
    chainId: 1,
    module: erc1155Module,
    moduleKey: erc1155ModuleKey,
    releaseId,
    creator,
    config: editionManifest.config
  }).simulationId
);

const splitModuleKey = `0x${"aa".repeat(32)}` as const;
const firstConsentSignature = `0x${"11".repeat(64)}1b` as const;
const secondConsentSignature = `0x${"22".repeat(64)}1c` as const;
const splitConfig = {
  recipients: [
    "0x6666666666666666666666666666666666666666",
    "0x7777777777777777777777777777777777777777"
  ] as Address[],
  sharesBps: [7_000, 3_000],
  recoveryAddresses: [
    "0x8888888888888888888888888888888888888888",
    zeroAddress
  ] as Address[],
  consentDeadline: 1_785_456_000
};
const split = createConsentBoundSplitDeploymentSimulation({
  chainId: 46_630,
  module: splitModule,
  moduleKey: splitModuleKey,
  releaseId,
  creator,
  config: splitConfig,
  consentSignatures: [firstConsentSignature, secondConsentSignature],
  currentTimestamp: nowSeconds
});
assert.equal(split.action, "deploy_consent_bound_split");
assert.equal(split.riskLevel, "high");
assert.equal(split.transaction.valueWei, "0");
assert.equal(split.contractExecution, "disabled");
assert.equal(split.assetMovements.length, 0);
assert.equal(split.tokenApprovals.length, 0);
assert.equal(split.platformFees.length, 0);
assert.equal(split.evidenceValidUntil, splitConfig.consentDeadline);
assert.equal(split.transaction.selector, "0xeff78744");
assert.equal(
  keccak256(split.transaction.data),
  "0x4df7f598d44f775d5480cae628bc1964aa2e99cc4503b0ebe6583f85eb033514"
);
assert.equal(
  split.simulationId,
  "0x6480707afa1ee4422b79fc9fc8004adf6f02a26bdf80d99068b717be48494930"
);
assert.ok(split.commitments.some((item) => (
  item.label === "Configuration"
  && item.value === "0xb45defca079ac16eb7dba2b7faf652df938ed08159603efe048aed76a42c08bf"
)));
assert.ok(split.commitments.some((item) => (
  item.label === "Payout manifest"
  && item.value === "0x1d00b23ba62c530839eb0c21e93f17471fb87015592429f53be547e2898ad499"
)));
assert.ok(split.commitments.some((item) => (
  item.label === "Consent manifest"
  && item.value === "0x210741b1724054dbbf276101b5d6395d3ae1a7968cc64f220ef1462ffaebe346"
)));
assert.ok(split.requiredLiveChecks.every((check) => check.status === "required_unverified"));
const decodedSplit = decodeFunctionData({
  abi: consentBoundSplitModuleAbi,
  data: split.transaction.data
});
assert.equal(decodedSplit.functionName, "deploySplit");
assert.equal(decodedSplit.args[0], releaseId);
assert.deepEqual(decodedSplit.args[1].recipients, splitConfig.recipients);
assert.deepEqual(decodedSplit.args[1].sharesBps, splitConfig.sharesBps);
assert.deepEqual(decodedSplit.args[1].recoveryAddresses, splitConfig.recoveryAddresses);
assert.equal(decodedSplit.args[1].consentDeadline, BigInt(splitConfig.consentDeadline));
assert.deepEqual(decodedSplit.args[2], [firstConsentSignature, secondConsentSignature]);
assert.notEqual(
  split.simulationId,
  createConsentBoundSplitDeploymentSimulation({
    chainId: 46_630,
    module: splitModule,
    moduleKey: splitModuleKey,
    releaseId,
    creator,
    config: splitConfig,
    consentSignatures: [
      `0x${"33".repeat(64)}1b`,
      secondConsentSignature
    ],
    currentTimestamp: nowSeconds
  }).simulationId
);
assert.throws(() => createConsentBoundSplitDeploymentSimulation({
  chainId: 46_630,
  module: splitModule,
  moduleKey: splitModuleKey,
  releaseId,
  creator,
  config: splitConfig,
  consentSignatures: [firstConsentSignature],
  currentTimestamp: nowSeconds
}), /one consent signature/);
assert.throws(() => createConsentBoundSplitDeploymentSimulation({
  chainId: 46_630,
  module: splitModule,
  moduleKey: splitModuleKey,
  releaseId,
  creator,
  config: {
    ...splitConfig,
    sharesBps: [6_999, 3_000]
  },
  consentSignatures: [firstConsentSignature, secondConsentSignature],
  currentTimestamp: nowSeconds
}), /exactly 100%/);
assert.throws(() => createConsentBoundSplitDeploymentSimulation({
  chainId: 46_630,
  module: splitModule,
  moduleKey: splitModuleKey,
  releaseId,
  creator,
  config: {
    ...splitConfig,
    recipients: [splitConfig.recipients[0], splitConfig.recipients[0]]
  },
  consentSignatures: [firstConsentSignature, secondConsentSignature],
  currentTimestamp: nowSeconds
}), /must be unique/);
assert.throws(() => createConsentBoundSplitDeploymentSimulation({
  chainId: 46_630,
  module: splitModule,
  moduleKey: splitModuleKey,
  releaseId,
  creator,
  config: {
    ...splitConfig,
    consentDeadline: nowSeconds
  },
  consentSignatures: [firstConsentSignature, secondConsentSignature],
  currentTimestamp: nowSeconds
}), /within the next 30 days/);
assert.throws(() => createConsentBoundSplitDeploymentSimulation({
  chainId: 46_630,
  module: splitModule,
  moduleKey: splitModuleKey,
  releaseId,
  creator,
  config: splitConfig,
  consentSignatures: ["0x", secondConsentSignature],
  currentTimestamp: nowSeconds
}), /signature 1 is invalid/);

console.log("V7 creator transaction simulation smoke test passed");
