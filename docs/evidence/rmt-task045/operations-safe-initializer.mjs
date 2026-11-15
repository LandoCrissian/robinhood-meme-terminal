import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { verifiedRelease } from "../rmt-task041-closeout/verify-release.mjs";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { normalizeGovernanceWallets, proposals } from "../rmt-task044/governance-wallets.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const sourceCommit = "0611b8aeaee0ab882345e0391c0a5051634163ca";
const fixtureSaltLabel = "RMT Task 045 / synthetic Operations Safe / 4663 / SafeL2 1.4.1";
const officialRpc = "https://rpc.mainnet.chain.robinhood.com";
const abi = [{
  type: "function",
  name: "setup",
  stateMutability: "nonpayable",
  inputs: [
    { name: "owners", type: "address[]" },
    { name: "threshold", type: "uint256" },
    { name: "to", type: "address" },
    { name: "data", type: "bytes" },
    { name: "fallbackHandler", type: "address" },
    { name: "paymentToken", type: "address" },
    { name: "payment", type: "uint256" },
    { name: "paymentReceiver", type: "address" },
  ],
  outputs: [],
}];

function encodeSafeSetup(viem, owners, setup) {
  return viem.encodeFunctionData({
    abi, functionName: "setup",
    args: [owners, 2n, setup.to, setup.data, setup.fallbackHandler, setup.paymentToken, 0n, setup.paymentReceiver],
  });
}

export function buildOperationsSafeInitializer(viem, policy = read("./operations-safe-policy.json")) {
  const release = verifiedRelease();
  const previous = read("../rmt-task044/safe-treasury-plans.json");
  const infrastructure = read("../rmt-task044/safe-infrastructure-4663.json");
  const [operations, reserve] = previous.treasuries;
  const pins = infrastructure.registry.contracts["1.4.1"];
  const owners = normalizeGovernanceWallets(proposals, viem.getAddress).map(({ address }) => address);
  assert.deepEqual(owners, read("../rmt-task044/provisional-owner-inputs.json").ownerOverrides.governanceSigners);
  const setup = {
    to: viem.zeroAddress, data: "0x", fallbackHandler: pins.compatibility_fallback_handler.address,
    paymentToken: viem.zeroAddress, paymentWei: "0", paymentReceiver: viem.zeroAddress,
    enabledModules: [], guard: null,
  };
  assert.deepEqual(policy, {
    schema: "rmt-launch-operations-safe-policy-v1",
    approvalReference: "https://github.com/LandoCrissian/robinhood-meme-terminal/issues/619",
    baseCommit: sourceCommit,
    chainId: release.chainId,
    candidateCommit: release.candidateCommit,
    releaseManifestSha256Lf: release.releaseManifestSha256Lf,
    state: release.state,
    approval: "APPROVED_FOR_PREPARATION_ONLY",
    broadcastAuthorized: false,
    operations: {
      name: operations.name, safeProfile: "SafeL2 1.4.1", factory: pins.safe_proxy_factory.address,
      factoryMethod: "createProxyWithNonce", singleton: pins.safe_l2.address, owners, threshold: 2, setup,
      safeAddress: null, deploymentSaltNonce: null, gasPayer: null,
      creationFeeShareBps: operations.creationFeeShareBps,
      eligibleCurveAndOriginalLpFeeShareBps: operations.eligibleCurveAndOriginalLpFeeShareBps,
    },
    reserve: {
      name: reserve.name, approval: "UNASSIGNED", safeProfile: null, owners: null, threshold: null,
      safeAddress: null, deploymentSaltNonce: null, gasPayer: null,
      creationFeeShareBps: reserve.creationFeeShareBps,
      eligibleCurveAndOriginalLpFeeShareBps: reserve.eligibleCurveAndOriginalLpFeeShareBps,
    },
    deployer: null,
    economicsApprovalReference: null,
  }, "Policy differs from the exact preparation-only approval");
  assert.equal(release.releaseGate.status, "FAIL_HIGH");
  assert.equal(release.releaseGate.findings.High, 22);

  const initializer = encodeSafeSetup(viem, owners, setup);
  const decoded = viem.decodeFunctionData({ abi, data: initializer });
  assert.equal(decoded.functionName, "setup");
  assert.deepEqual(decoded.args,
    [owners, 2n, setup.to, setup.data, setup.fallbackHandler, setup.paymentToken, 0n, setup.paymentReceiver]);

  const baseline = read("../rmt-task044/4663-platform-safe-rehearsal.json");
  const synthetic = baseline.platformSafes.find(({ role }) => role === "operations");
  assert.equal(synthetic.threshold, "2");
  assert.equal(new Set(synthetic.ownerAddresses).size, 3);
  assert.ok(synthetic.ownerAddresses.every((address) => !owners.includes(viem.getAddress(address))));
  const syntheticInitializer = encodeSafeSetup(viem, synthetic.ownerAddresses, setup);
  const fixtureSaltNonce = viem.keccak256(viem.stringToHex(fixtureSaltLabel));
  const fixtureInitcodeHash = infrastructure.fees.readOnlyFixtureProfiles["1.4.1"].proxyInitcodeKeccak256;
  const fixtureCreate2Salt = viem.keccak256(viem.encodePacked(
    ["bytes32", "uint256"], [viem.keccak256(syntheticInitializer), BigInt(fixtureSaltNonce)],
  ));
  const fixtureAddress = viem.getContractAddress({
    from: policy.operations.factory, opcode: "CREATE2", salt: fixtureCreate2Salt, bytecodeHash: fixtureInitcodeHash,
  });
  assert.ok(![...owners, ...baseline.platformSafes.map(({ proxy }) => proxy)].includes(fixtureAddress));
  return {
    approved: {
      initializerKeccak256: viem.keccak256(initializer), initializerBytes: viem.size(initializer),
      safeAddress: null, deploymentSaltNonce: null, broadcastAuthorized: false,
    },
    fixture: {
      scope: "ILLUSTRATIVE_SYNTHETIC_ONLY", ownerAddresses: synthetic.ownerAddresses,
      initializerKeccak256: viem.keccak256(syntheticInitializer),
      saltLabel: fixtureSaltLabel, saltNonce: fixtureSaltNonce, create2Salt: fixtureCreate2Salt,
      initcodeKeccak256: fixtureInitcodeHash, fixtureAddress,
    },
  };
}

async function observeIllustrativeFixture(viem, policy, fixture) {
  const pins = read("../rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
  const client = viem.createPublicClient({ transport: viem.http(officialRpc, { timeout: 8_000, retryCount: 0 }) });
  const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock({ blockTag: "latest" })]);
  assert.equal(chainId, policy.chainId);
  const blockNumber = block.number;
  const tag = viem.numberToHex(blockNumber);
  const components = [pins.safe_l2, pins.safe_proxy_factory, pins.compatibility_fallback_handler];
  const runtimePins = await Promise.all(components.map(async ({ address, registryRuntimeKeccak256 }) => {
    const code = await client.request({ method: "eth_getCode", params: [address, tag] });
    assert.equal(viem.keccak256(code), registryRuntimeKeccak256);
    return { address, runtimeKeccak256: registryRuntimeKeccak256 };
  }));
  const { factory, singleton, setup } = policy.operations;
  const factoryAbi = viem.parseAbi([
    "function proxyCreationCode() pure returns (bytes)",
    "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  ]);
  const [proxyCreationCode, fixtureCode, fixtureNonce] = await Promise.all([
    client.readContract({ address: factory, abi: factoryAbi, functionName: "proxyCreationCode", blockNumber }),
    client.request({ method: "eth_getCode", params: [fixture.fixtureAddress, tag] }),
    client.getTransactionCount({ address: fixture.fixtureAddress, blockNumber }),
  ]);
  assert.equal(viem.keccak256(viem.concatHex([proxyCreationCode, viem.padHex(singleton, { size: 32 })])),
    fixture.initcodeKeccak256, "Factory proxy initcode differs");
  assert.equal(fixtureCode, "0x", "Illustrative fixture address already has code");
  assert.equal(fixtureNonce, 0, "Illustrative fixture address already has a nonce");
  const syntheticInitializer = encodeSafeSetup(viem, fixture.ownerAddresses, setup);
  const data = viem.encodeFunctionData({ abi: factoryAbi, functionName: "createProxyWithNonce",
    args: [singleton, syntheticInitializer, BigInt(fixture.saltNonce)] });
  const result = await client.call({ account: viem.zeroAddress, to: factory, data, value: 0n, blockNumber });
  assert.equal(viem.decodeFunctionResult({ abi: factoryAbi, functionName: "createProxyWithNonce", data: result.data }),
    fixture.fixtureAddress, "Read-only factory simulation disagrees with the CREATE2 derivation");
  assert.equal((await client.getBlock({ blockNumber })).hash, block.hash, "Observation block changed");
  return {
    scope: fixture.scope, provider: officialRpc, chainId, blockNumber: blockNumber.toString(),
    blockHash: block.hash, blockTimeUtc: new Date(Number(block.timestamp) * 1000).toISOString(),
    runtimePins, fixtureCode, fixtureNonce, simulatedAddress: fixture.fixtureAddress,
    writeMethodsCalled: false, broadcastAuthorized: false,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { checkout: { type: "string" }, "observe-fixture": { type: "boolean" } } });
  assert.ok(values.checkout, "Provide --checkout with pinned viem installed");
  const viem = webTools(resolve(values.checkout));
  const policy = read("./operations-safe-policy.json");
  const result = buildOperationsSafeInitializer(viem, policy);
  if (values["observe-fixture"]) result.fixtureObservation = await observeIllustrativeFixture(viem, policy, result.fixture);
  console.log(JSON.stringify(result, null, 2));
}
