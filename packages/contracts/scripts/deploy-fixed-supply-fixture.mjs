import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { backing, creationFee, profile, supply } from "./fixed-supply-profile.mjs";
import { buildLoopbackType2Envelope } from "./delegated-mobile-transaction.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { createPublicClient, defineChain, encodeDeployData, encodeFunctionData, getContractAddress, getCreate2Address,
  http, isAddressEqual, keccak256, toHex } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const verifiedFixtureClients = new WeakSet();

export async function localFixtureClient(url, chainId) {
  const endpoint = new URL(url);
  assert.equal(endpoint.href, "http://127.0.0.1:" + endpoint.port + "/", "Fixture client requires an exact loopback port");
  assert.ok(endpoint.port && [31337, 4663].includes(chainId), "Unsupported fixture network");
  const chain = defineChain({ id: chainId, name: "Isolated Anvil", nativeCurrency: { name: "Synthetic ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [endpoint.href] } } });
  const client = createPublicClient({ chain, transport: http(endpoint.href, { retryCount: 0, timeout: 90_000 }), cacheTime: 0 });
  assert.equal(await client.getChainId(), chainId);
  assert.match(await client.request({ method: "web3_clientVersion" }), /^anvil Version|^anvil\//i);
  verifiedFixtureClients.add(client);
  return client;
}

export const call = (client, address, abi, functionName, args = [], blockNumber) =>
  client.readContract({ address, abi, functionName, args, blockNumber });
export const transact = (address, abi, functionName, args = []) =>
  ({ to: address, data: encodeFunctionData({ abi, functionName, args }) });

export async function sendFixture(client, from, { to, data, value = 0n, gas = 8_000_000n, type2 }, expected = "success") {
  assert.ok(verifiedFixtureClients.has(client), "Fixture writes require a verified loopback Anvil client");
  const envelope = type2
    ? buildLoopbackType2Envelope({ endpoint: client.transport.url, chainId: client.chain.id, from, to, data, value, gas,
      nonce: type2.nonce, maxFeePerGas: type2.maxFeePerGas, maxPriorityFeePerGas: type2.maxPriorityFeePerGas })
    : { from, ...(to ? { to } : {}), data, value: toHex(value), gas: toHex(gas) };
  const hash = await client.request({ method: "eth_sendTransaction", params: [envelope] });
  const observed = await client.request({ method: "eth_getTransactionReceipt", params: [hash] });
  if (!observed) {
    const pending = await client.request({ method: "eth_getTransactionByHash", params: [hash] });
    if (pending?.blockNumber === null && pending.hash === hash) await client.request({ method: "evm_mine" });
  }
  const receipt = await client.waitForTransactionReceipt({ hash, checkReplacement: false, timeout: 90_000, pollingInterval: 250 })
    .catch((cause) => {
      throw new Error("Isolated receipt unavailable for " + (to ?? "CREATE") + " " + data.slice(0, 10) + " " + hash, { cause });
    });
  assert.equal(receipt.transactionHash, hash);
  assert.equal(receipt.status, expected, "Unexpected isolated receipt status for " + hash);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(block.hash, receipt.blockHash, "Noncanonical fixture receipt");
  assert.ok(isAddressEqual(receipt.from, from));
  return receipt;
}

export const receiptEvidence = ({ transactionHash, blockNumber, blockHash, gasUsed, status }) =>
  ({ transactionHash, blockNumber, blockHash, gasUsed, status });

export async function reviewTransactionEvidence(client, receipt) {
  const transaction = await client.getTransaction({ hash: receipt.transactionHash });
  assert.equal(transaction.hash, receipt.transactionHash);
  assert.equal(transaction.blockHash, receipt.blockHash);
  assert.equal(transaction.blockNumber, receipt.blockNumber);
  assert.equal(transaction.transactionIndex, receipt.transactionIndex);
  assert.ok(isAddressEqual(transaction.from, receipt.from));
  assert.equal(transaction.to, receipt.to);
  return { ...receiptEvidence(receipt), from: transaction.from, to: transaction.to, nonce: transaction.nonce.toString(),
    valueWei: transaction.value.toString(), calldataHash: keccak256(transaction.input) };
}

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

export async function deployFixedSupplyFixture(client, artifacts, pins, {
  operator, operations, reserve, observeConstructor, exerciseRotation = false, fixtureMigrationAuthority = exerciseRotation,
  send = sendFixture, observedGovernors,
}) {
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
  const signerAccounts = observedGovernors ? [] : Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
  const governors = observedGovernors ?? signerAccounts.map((signer) => signer.address);
  const deploy = async (name, artifact, args = []) => {
    const nonce = await client.getTransactionCount({ address: operator, blockTag: "pending" });
    const derived = getContractAddress({ from: operator, nonce: BigInt(nonce) });
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const receipt = await send(client, operator, { data });
    const address = receipt.contractAddress;
    assert.ok(address && isAddressEqual(address, derived));
    const runtimeHash = await verifyRuntime(client, address, artifact, receipt.blockNumber);
    observeConstructor?.({ name, nonce, from: operator, data, address, runtimeHash,
      chainId: client.chain.id, value: "0", scope: "LOOPBACK_FIXTURE_ONLY", broadcastAuthorized: false });
    return { address, runtimeHash, receipt: receiptEvidence(receipt) };
  };
  const directory = await deploy("directory", directoryArtifact, governors);
  const registry = await deploy("registry", registryArtifact, [directory.address]);
  const v2 = await deploy("successor-v2", deployerArtifact);
  const v3 = await deploy("successor-v3", successorArtifact);
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
  const deployed = await send(client, operator, { data, gas: 14_000_000n });
  assert.ok(isAddressEqual(deployed.contractAddress, bootstrap));
  for (const [getter, expected] of [["factory", factory], ["graduationEngine", engine], ["initializationGuard", guard]]) {
    assert.ok(isAddressEqual(await call(client, bootstrap, deploymentArtifact.abi, getter), expected));
  }
  const factoryRuntimeHash = await verifyRuntime(client, factory, factoryArtifact);
  const graduationRuntimeHash = await verifyRuntime(client, engine, graduationArtifact);
  const guardRuntimeHash = await verifyRuntime(client, guard, guardArtifact);
  const bootstrapRuntimeHash = await verifyRuntime(client, bootstrap, deploymentArtifact);
  observeConstructor?.({ name: "bootstrap", nonce: deployerNonce, from: operator, data, address: bootstrap,
    runtimeHash: bootstrapRuntimeHash, chainId: client.chain.id, value: "0", scope: "LOOPBACK_FIXTURE_ONLY",
    broadcastAuthorized: false });
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
    const scheduled = await send(client, operator, transact(directory.address, directoryArtifact.abi, "schedule", [action, ...signatures]));
    await client.request({ method: "evm_increaseTime", params: [2 * 86400] });
    // Apply the local time jump in a block before submitting the notice execution.
    await client.request({ method: "evm_mine" });
    const executed = await send(client, operator, transact(directory.address, directoryArtifact.abi, "execute", [action]));
    return { scheduled: await reviewTransactionEvidence(client, scheduled), executed: await reviewTransactionEvidence(client, executed),
      reviewAction: action, actionDigest: digest };
  };
  const summary = {
    profile, fixedSupplyWei: supply.toString(), chainId: client.chain.id, creationFeeWei: creationFee.toString(),
    terms: { backingWei: backing.toString() }, factory, factoryRuntimeHash, projectRegistry: registry.address,
    registryRuntimeHash: registry.runtimeHash, graduationEngine: engine, graduationRuntimeHash, guard, guardRuntimeHash,
    directory: directory.address, directoryRuntimeHash: directory.runtimeHash, deployBlock: deployed.blockNumber,
    deployment: { ...receiptEvidence(deployed), address: bootstrap, blockHash: deployed.blockHash, bootstrapRuntimeHash,
      operatingRecipient: operations, futureReserveRecipient: reserve, guardSalt, guardCodeHash, initcodeBytes, deployerNonce,
      constructors: { directory, registry, v2, v3 } },
  };
  if (observedGovernors) {
    assert.equal(await readDirectory("latestVersion"), 0);
    for (const governor of governors) assert.equal(await readDirectory("isSigner", [governor]), true);
    return summary;
  }

  const factoryVersion = await readFactory("engineVersion");
  const publication = await publish(0, factoryVersion, factory, factoryRuntimeHash);
  const templatePublication = await publish(4, 3, v3.address, v3.runtimeHash);
  const current = await readDirectory("currentFactory");
  assert.ok(isAddressEqual(current.factory, factory));
  assert.equal(current.runtimeHash, factoryRuntimeHash);
  const migrationPin = await readDirectory("migrationTemplates", [3]);
  assert.ok(isAddressEqual(migrationPin[0], v3.address) && migrationPin[1] === v3.runtimeHash);

  const rotation = exerciseRotation
    ? await rehearseRotation({ client, operator, directory: directory.address, abi: directoryArtifact.abi,
      signers: signerAccounts, factoryPin: current })
    : undefined;

  // Local rehearsal only. Expose quorum approval without returning signer keys.
  const scheduleFixtureMigration = fixtureMigrationAuthority ? async (token) => {
    const digest = await call(client, registry.address, registryArtifact.abi, "migrationDigest", [token]);
    const signatures = await Promise.all(signerAccounts.slice(0, 2).map((signer) => signer.sign({ hash: digest })));
    const scheduled = await send(client, operator, transact(registry.address, registryArtifact.abi, "scheduleMigration", [token, ...signatures]));
    return receiptEvidence(scheduled);
  } : undefined;

  Object.assign(summary.deployment, { publication, templatePublication, rotation });
  return { scheduleFixtureMigration, ...summary };
}


async function rehearseRotation({ client, operator, directory, abi, signers, factoryPin }) {
  assert.equal(client.chain.id, 4663, "Rotation evidence uses the target chain fork");
  const read = (name, args) => call(client, directory, abi, name, args);
  const send = (name, args, status) => sendFixture(client, operator, transact(directory, abi, name, args), status);
  const [retainedA, retainedB, departing] = signers;
  const incoming = privateKeyToAccount(generatePrivateKey());
  const beforeEpoch = await read("signerSetEpoch");
  const nonce = await read("rotationNonce");
  const rotation = { departingSigner: departing.address, incomingSigner: incoming.address, signerSetEpoch: beforeEpoch,
    nonce, deadline: Number((await client.getBlock()).timestamp) + 4 * 86400 };
  const digest = await read("signerRotationDigest", [rotation]);
  const [first, second, acceptance] = await Promise.all([
    retainedA.sign({ hash: digest }), retainedB.sign({ hash: digest }),
    read("rotationAcceptanceDigest", [digest]).then((hash) => incoming.sign({ hash })),
  ]);
  const oneSigner = await send("scheduleSignerRotation", [rotation, first, first, acceptance], "reverted");
  const missingAcceptance = await send("scheduleSignerRotation", [rotation, first, second, first], "reverted");
  const scheduled = await send("scheduleSignerRotation", [rotation, first, second, acceptance]);
  const premature = await send("executeSignerRotation", [rotation], "reverted");
  await client.request({ method: "evm_increaseTime", params: [2 * 86400] });
  await client.request({ method: "evm_mine" });
  const rotated = await send("executeSignerRotation", [rotation]);
  const replay = await send("executeSignerRotation", [rotation], "reverted");
  assert.equal(await read("signerSetEpoch"), beforeEpoch + 1n);
  assert.equal(await read("rotationNonce"), nonce + 1n);
  assert.equal(await read("isSigner", [departing.address]), false);
  assert.equal(await read("isSigner", [incoming.address]), true);
  assert.deepEqual(await read("currentFactory"), factoryPin);
  return { beforeEpoch, afterEpoch: beforeEpoch + 1n, departing: departing.address, incoming: incoming.address,
    oneSigner: receiptEvidence(oneSigner), missingAcceptance: receiptEvidence(missingAcceptance),
    scheduled: receiptEvidence(scheduled), premature: receiptEvidence(premature), executed: receiptEvidence(rotated),
    replay: receiptEvidence(replay) };
}
