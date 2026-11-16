import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { backing, creationFee, profile, supply } from "./fixed-supply-profile.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { createPublicClient, defineChain, encodeDeployData, encodeFunctionData, getContractAddress, getCreate2Address,
  http, isAddressEqual, keccak256, toHex } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

export async function localFixtureClient(url, chainId) {
  const endpoint = new URL(url);
  assert.equal(endpoint.href, "http://127.0.0.1:" + endpoint.port + "/", "Fixture client requires an exact loopback port");
  assert.ok(endpoint.port && [31337, 4663].includes(chainId), "Unsupported fixture network");
  const chain = defineChain({ id: chainId, name: "Isolated Anvil", nativeCurrency: { name: "Synthetic ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [endpoint.href] } } });
  const client = createPublicClient({ chain, transport: http(endpoint.href, { retryCount: 0, timeout: 90_000 }), cacheTime: 0 });
  assert.equal(await client.getChainId(), chainId);
  assert.match(await client.request({ method: "web3_clientVersion" }), /^anvil Version|^anvil\//i);
  return client;
}

export const call = (client, address, abi, functionName, args = [], blockNumber) =>
  client.readContract({ address, abi, functionName, args, blockNumber });
export const transact = (address, abi, functionName, args = []) =>
  ({ to: address, data: encodeFunctionData({ abi, functionName, args }) });

export async function sendFixture(client, from, { to, data, value = 0n, gas = 8_000_000n }, expected = "success") {
  const hash = await client.request({ method: "eth_sendTransaction", params: [{
    from, ...(to ? { to } : {}), data, value: toHex(value), gas: toHex(gas),
  }] });
  const receipt = await client.waitForTransactionReceipt({ hash, checkReplacement: false, timeout: 90_000, pollingInterval: 250 });
  assert.equal(receipt.transactionHash, hash);
  assert.equal(receipt.status, expected, "Unexpected isolated receipt status for " + hash);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(block.hash, receipt.blockHash, "Noncanonical fixture receipt");
  assert.ok(isAddressEqual(receipt.from, from));
  return receipt;
}

export const receiptEvidence = ({ transactionHash, blockNumber, blockHash, gasUsed, status }) =>
  ({ transactionHash, blockNumber, blockHash, gasUsed, status });

export async function verifyRuntime(client, address, artifact, blockNumber) {
  const actual = await client.getCode({ address, blockNumber });
  assert.ok(actual && actual !== "0x", "Fixture runtime absent: " + address);
  const template = Buffer.from(artifact.runtime.slice(2), "hex");
  const observed = Buffer.from(actual.slice(2), "hex");
  assert.equal(observed.length, template.length);
  // Compare every compiled byte outside the immutable slots. Binding getters below verify the constructor values.
  for (const { start, length } of artifact.immutableReferences) observed.fill(0, start, start + length);
  assert.deepEqual(observed, template, "Unexpected fixture runtime " + address);
  return keccak256(actual);
}

export async function deployFixedSupplyFixture(client, artifacts, pins, { operator, operations, reserve }) {
  assert.ok(!isAddressEqual(operations, reserve), "Fixture platform roles must be distinct");
  for (const { address, runtimeHash } of Object.values(pins)) {
    const code = await client.getCode({ address });
    assert.ok(code && keccak256(code) === runtimeHash, "Incorrect dependency runtime " + address);
  }
  const factoryArtifact = artifacts.RMTLaunchCurveFactoryV2;
  const deploymentArtifact = artifacts.RMTLaunchCurveDeploymentV2;
  const graduationArtifact = artifacts.RMTV4CurveGraduationV1;
  const guardArtifact = artifacts.RMTV4CurveInitializationGuardV1;
  const directoryArtifact = artifacts.RMTLaunchCurveDirectoryV2;
  const registryArtifact = artifacts.RMTLaunchProjectRegistryV3;
  const deployerArtifact = artifacts.RMTLaunchCurveSuccessorDeployerV1;
  const successorArtifact = artifacts.RMTLaunchCurveSuccessorDeployerV2;
  const signerAccounts = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
  const deploy = async (artifact, args = []) => {
    const receipt = await sendFixture(client, operator, { data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args }) });
    const address = receipt.contractAddress;
    assert.ok(address);
    return { address, runtimeHash: await verifyRuntime(client, address, artifact, receipt.blockNumber), receipt: receiptEvidence(receipt) };
  };
  const directory = await deploy(directoryArtifact, signerAccounts.map((signer) => signer.address));
  const registry = await deploy(registryArtifact, [directory.address]);
  const v2 = await deploy(deployerArtifact);
  const v3 = await deploy(successorArtifact);
  const deployerNonce = await client.getTransactionCount({ address: operator });
  const bootstrap = getContractAddress({ from: operator, nonce: BigInt(deployerNonce) });
  const engine = getContractAddress({ from: bootstrap, nonce: 2n });
  const factory = getContractAddress({ from: bootstrap, nonce: 3n });
  const guardCode = encodeDeployData({ abi: guardArtifact.abi, bytecode: guardArtifact.bytecode, args: [pins.poolManager.address, engine] });
  const guardCodeHash = keccak256(guardCode);
  let guard;
  let guardSalt;
  for (let i = 0n; i < 250_000n; i++) {
    const salt = toHex(i, { size: 32 });
    const derived = getCreate2Address({ from: bootstrap, salt, bytecodeHash: guardCodeHash });
    if ((BigInt(derived) & 0x3fffn) === 0x2000n) {
      guard = derived;
      guardSalt = salt;
      break;
    }
  }
  assert.ok(guardSalt, "No bootstrap hook salt found");
  const dep = { poolManager: pins.poolManager.address, positionManager: pins.positionManager.address, permit2: pins.permit2.address,
    poolManagerHash: pins.poolManager.runtimeHash, positionManagerHash: pins.positionManager.runtimeHash, permit2Hash: pins.permit2.runtimeHash };
  const data = encodeDeployData({ abi: deploymentArtifact.abi, bytecode: deploymentArtifact.bytecode, args: [
    dep, guardSalt, operations, reserve, registry.address, v2.address, v2.runtimeHash, creationFee,
  ] });
  const initcodeBytes = (data.length - 2) / 2;
  assert.ok(initcodeBytes <= 49_152);
  assert.equal(await client.getTransactionCount({ address: operator, blockTag: "pending" }), deployerNonce);
  const deployed = await sendFixture(client, operator, { data, gas: 14_000_000n });
  assert.ok(isAddressEqual(deployed.contractAddress, bootstrap));
  for (const [getter, expected] of [["factory", factory], ["graduationEngine", engine], ["initializationGuard", guard]]) {
    assert.ok(isAddressEqual(await call(client, bootstrap, deploymentArtifact.abi, getter), expected));
  }
  const factoryRuntimeHash = await verifyRuntime(client, factory, factoryArtifact);
  const graduationRuntimeHash = await verifyRuntime(client, engine, graduationArtifact);
  const guardRuntimeHash = await verifyRuntime(client, guard, guardArtifact);
  const bootstrapRuntimeHash = await verifyRuntime(client, bootstrap, deploymentArtifact);
  const readFactory = (name) => call(client, factory, factoryArtifact.abi, name);
  for (const [getter, expected] of [["operatingRecipient", operations], ["futureReserveRecipient", reserve],
    ["projectRegistry", registry.address], ["graduationEngine", engine], ["successorDeployer", v2.address]]) {
    assert.ok(isAddressEqual(await readFactory(getter), expected), "Incorrect factory binding " + getter);
  }
  assert.equal(await readFactory("successorDeployerRuntimeHash"), v2.runtimeHash);
  assert.equal(await readFactory("creationFeeWei"), creationFee);
  assert.equal(await readFactory("tokenSupply"), supply);
  assert.ok(isAddressEqual(await call(client, engine, graduationArtifact.abi, "factory"), factory));
  assert.ok(isAddressEqual(await call(client, engine, graduationArtifact.abi, "initializationGuard"), guard));
  assert.ok(isAddressEqual(await call(client, guard, guardArtifact.abi, "graduationEngine"), engine));
  assert.ok(isAddressEqual(await call(client, registry.address, registryArtifact.abi, "directory"), directory.address));
  const readDirectory = (name, args) => call(client, directory.address, directoryArtifact.abi, name, args);

  // Test-only time advancement honors the full governance notice for each action.
  const publish = async (kind, version, target, runtimeHash) => {
    const action = { kind, version, factory: target, runtimeHash, nonce: await readDirectory("nonce"),
      signerSetEpoch: await readDirectory("signerSetEpoch"), deadline: Number((await client.getBlock()).timestamp) + 4 * 86400 };
    const digest = await readDirectory("actionDigest", [action]);
    const signatures = await Promise.all(signerAccounts.slice(0, 2).map((signer) => signer.sign({ hash: digest })));
    const scheduled = await sendFixture(client, operator, transact(directory.address, directoryArtifact.abi, "schedule", [action, ...signatures]));
    await client.request({ method: "evm_increaseTime", params: [2 * 86400] });
    const executed = await sendFixture(client, operator, transact(directory.address, directoryArtifact.abi, "execute", [action]));
    return { scheduled: receiptEvidence(scheduled), executed: receiptEvidence(executed) };
  };
  const factoryVersion = await readFactory("engineVersion");
  const publication = await publish(0, factoryVersion, factory, factoryRuntimeHash);
  const templatePublication = await publish(4, 3, v3.address, v3.runtimeHash);
  const current = await readDirectory("currentFactory");
  assert.ok(isAddressEqual(current.factory, factory));
  assert.equal(current.runtimeHash, factoryRuntimeHash);
  const migrationPin = await readDirectory("migrationTemplates", [3]);
  assert.ok(isAddressEqual(migrationPin[0], v3.address) && migrationPin[1] === v3.runtimeHash);

  return {
    profile, fixedSupplyWei: supply.toString(), chainId: client.chain.id, creationFeeWei: creationFee.toString(),
    terms: { backingWei: backing.toString() }, factory, factoryRuntimeHash, projectRegistry: registry.address,
    registryRuntimeHash: registry.runtimeHash, graduationEngine: engine, graduationRuntimeHash, guard, guardRuntimeHash,
    directory: directory.address, directoryRuntimeHash: directory.runtimeHash, deployBlock: deployed.blockNumber,
    deployment: { ...receiptEvidence(deployed), address: bootstrap, blockHash: deployed.blockHash, bootstrapRuntimeHash,
      operatingRecipient: operations, futureReserveRecipient: reserve, guardSalt, guardCodeHash, initcodeBytes, deployerNonce,
      publication, templatePublication, constructors: { directory, registry, v2, v3 } },
  };
}
