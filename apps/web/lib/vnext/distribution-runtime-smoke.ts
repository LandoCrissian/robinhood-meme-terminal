import assert from "node:assert/strict";
import { decodeFunctionData, getAddress, keccak256, type Address, type Hex } from "viem";
import { RMT_DISTRIBUTION_ENGINE_V1_ABI, parseDistributionAuthorizationPlanV1 } from "./distribution-authorization";
import { buildDistributionAuthorizationFixtureSetV1 } from "./distribution-authorization-fixtures";
import {
  parseDistributionDeploymentManifestV1,
  readDistributionRuntimeEvidenceV1,
  verifyDistributionRuntimeV1,
  type DistributionDeploymentManifestV1,
  type DistributionRuntimeEvidenceV1
} from "./distribution-runtime";

const engine = getAddress("0x2222222222222222222222222222222222222222");
const sink = getAddress("0x3333333333333333333333333333333333333333");
const rmt = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");
const HASH_A = `0x${"a".repeat(64)}` as Hex;
const HASH_B = `0x${"b".repeat(64)}` as Hex;
const RMT_HASH = "0x49cd48d0204b35d27e6fca131febe8ce5aff6cd0c2fb6c5c21d5f0ad616e99e9" as Hex;

const manifest: DistributionDeploymentManifestV1 = {
  schemaVersion: 1,
  status: "deployed_not_publicly_activated",
  chainId: 4_663,
  contract: "RMTDistributionEngineV1",
  sinkContract: "RMTRetirementSinkV1",
  sourceCommit: "1".repeat(40),
  compiler: { version: "0.8.26", optimizer: true, optimizerRuns: 200, viaIr: true },
  constructorArguments: {
    rmtToken: rmt,
    retirementSink: sink,
    erc20CostPerRecipientAtomic: "1000000000000000000",
    erc721CostPerRecipientAtomic: "2000000000000000000",
    erc1155CostPerRecipientAtomic: "3000000000000000000"
  },
  deployment: {
    deployer: getAddress("0x1111111111111111111111111111111111111111"),
    transactionHash: `0x${"d".repeat(64)}`,
    blockNumber: "40000000",
    blockHash: `0x${"e".repeat(64)}`,
    engine,
    engineRuntimeHash: HASH_A,
    retirementSink: sink,
    retirementSinkRuntimeHash: HASH_B,
    rmtRuntimeHash: RMT_HASH
  },
  activation: { publicUiAuthorized: false, walletSubmissionEnabled: false, serverSubmissionEnabled: false }
};

const evidence: DistributionRuntimeEvidenceV1 = {
  chainId: 4_663,
  blockNumber: "40000001",
  blockHash: `0x${"f".repeat(64)}`,
  engine,
  engineRuntimeHash: HASH_A,
  retirementSink: sink,
  retirementSinkRuntimeHash: HASH_B,
  rmtToken: rmt,
  rmtRuntimeHash: RMT_HASH,
  engineChainId: "4663",
  engineRmtToken: rmt,
  engineRetirementSink: sink,
  engineRmtRuntimeHash: RMT_HASH,
  engineRetirementSinkRuntimeHash: HASH_B,
  erc20CostPerRecipientAtomic: "1000000000000000000",
  erc721CostPerRecipientAtomic: "2000000000000000000",
  erc1155CostPerRecipientAtomic: "3000000000000000000",
  engineProxyImplementation: null,
  retirementSinkProxyImplementation: null
};

assert.equal(parseDistributionDeploymentManifestV1(manifest).deployment.engine, engine);
const verified = verifyDistributionRuntimeV1(manifest, evidence);
assert.equal(verified.technicalRuntimeVerified, true);
assert.equal(verified.publicActivationEligible, false);
assert.equal(verified.walletSubmissionEnabled, false);
assert.equal(verified.serverSubmissionEnabled, false);

const mutations: Array<[string, unknown]> = [
  ["wrong chain", { ...evidence, chainId: 1 }],
  ["engine address", { ...evidence, engine: rmt }],
  ["engine runtime", { ...evidence, engineRuntimeHash: HASH_B }],
  ["sink address", { ...evidence, retirementSink: engine }],
  ["sink runtime", { ...evidence, retirementSinkRuntimeHash: HASH_A }],
  ["RMT address", { ...evidence, rmtToken: sink }],
  ["RMT runtime", { ...evidence, rmtRuntimeHash: HASH_A }],
  ["engine RMT binding", { ...evidence, engineRmtToken: sink }],
  ["engine sink binding", { ...evidence, engineRetirementSink: engine }],
  ["utility rate", { ...evidence, erc20CostPerRecipientAtomic: "1" }],
  ["proxy drift", { ...evidence, engineProxyImplementation: engine }],
  ["unknown field", { ...evidence, unexpected: true }]
];
for (const [, mutation] of mutations) {
  assert.throws(() => verifyDistributionRuntimeV1(manifest, mutation));
}
assert.throws(() => parseDistributionDeploymentManifestV1({ ...manifest, activation: { ...manifest.activation, walletSubmissionEnabled: true } }));
assert.throws(() => parseDistributionDeploymentManifestV1({ ...manifest, status: "active" }));
assert.throws(() => parseDistributionDeploymentManifestV1({ ...manifest, extra: true }));

const engineCode = "0x6001" as Hex;
const sinkCode = "0x6002" as Hex;
const rmtCode = "0x6003" as Hex;
const liveManifest: DistributionDeploymentManifestV1 = {
  ...manifest,
  deployment: {
    ...manifest.deployment,
    engineRuntimeHash: keccak256(engineCode),
    retirementSinkRuntimeHash: keccak256(sinkCode),
    rmtRuntimeHash: keccak256(rmtCode)
  }
};
const readValues: Record<string, unknown> = {
  CHAIN_ID: 4_663n,
  rmtToken: rmt,
  retirementSink: sink,
  rmtTokenRuntimeHash: keccak256(rmtCode),
  retirementSinkRuntimeHash: keccak256(sinkCode),
  erc20CostPerRecipient: 1_000_000_000_000_000_000n,
  erc721CostPerRecipient: 2_000_000_000_000_000_000n,
  erc1155CostPerRecipient: 3_000_000_000_000_000_000n
};
const codeByAddress = new Map<string, Hex>([
  [engine.toLowerCase(), engineCode], [sink.toLowerCase(), sinkCode], [rmt.toLowerCase(), rmtCode]
]);
const readClient = {
  async getChainId() { return 4_663; },
  async getBlockNumber() { return 40_000_001n; },
  async getBlock({ blockNumber }: { blockNumber: bigint }) {
    return { number: blockNumber, hash: `0x${"f".repeat(64)}` as Hex };
  },
  async getBytecode({ address }: { address: Address; blockNumber: bigint }) {
    return codeByAddress.get(address.toLowerCase());
  },
  async getStorageAt() { return `0x${"0".repeat(64)}` as Hex; },
  async readContract({ functionName }: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; blockNumber: bigint }) {
    return readValues[functionName];
  }
};
async function runRuntimeReadSmoke() {
  const collected = await readDistributionRuntimeEvidenceV1(readClient, liveManifest);
  assert.equal(collected.engineRuntimeHash, liveManifest.deployment.engineRuntimeHash);
  assert.equal(verifyDistributionRuntimeV1(liveManifest, collected).technicalRuntimeVerified, true);
  await assert.rejects(() => readDistributionRuntimeEvidenceV1({ ...readClient, async getChainId() { return 1; } }, liveManifest));
  await assert.rejects(() => readDistributionRuntimeEvidenceV1({
    ...readClient,
    async getStorageAt() { return `0x${"0".repeat(62)}01` as Hex; }
  }, liveManifest));
}

const fixtures = buildDistributionAuthorizationFixtureSetV1();
assert.deepEqual(fixtures.map((fixture) => fixture.actionKind), ["erc20_equal", "erc20_custom", "erc721", "erc1155"]);
for (const fixture of fixtures) {
  const { plan, manifest: fixtureManifest } = fixture;
  assert.equal(plan.walletSubmissionEnabled, false);
  assert.equal(plan.serverSubmissionEnabled, false);
  assert.equal(plan.target, fixtureManifest.infrastructure.engine);
  assert.equal(plan.transactionValueAtomic, "0");
  assert.equal(parseDistributionAuthorizationPlanV1(plan, fixtureManifest).planId, plan.planId);
  const decoded = decodeFunctionData({ abi: RMT_DISTRIBUTION_ENGINE_V1_ABI, data: plan.calldata });
  const expectedFunction = fixture.actionKind === "erc20_equal"
    ? "airdropERC20Equal"
    : fixture.actionKind === "erc20_custom"
      ? "airdropERC20"
      : fixture.actionKind === "erc721"
        ? "airdropERC721"
        : "airdropERC1155";
  assert.equal(decoded.functionName, expectedFunction);
}

runRuntimeReadSmoke()
  .then(() => console.log("RMT Distribution runtime verification and non-submittable authorization fixtures remain fail closed."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
