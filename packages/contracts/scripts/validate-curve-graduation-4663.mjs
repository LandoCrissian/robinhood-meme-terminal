import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { withAnvilFork } from "./robinhood-4663-fork-environment.mjs";

const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { createPublicClient, defineChain, encodeAbiParameters, encodeDeployData, encodeFunctionData, erc20Abi,
  getAddress, getContractAddress, getCreate2Address, http, keccak256, parseAbi, parseEventLogs, parseEther, toHex,
  zeroAddress } = requireWeb("viem");
const { privateKeyToAccount } = requireWeb("viem/accounts");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const existingInputs = JSON.parse(readFileSync(join(root, "scripts/launch-4663-review-inputs.json"), "utf8"));
const { baseSepolia } = JSON.parse(readFileSync(join(root, "test/fixtures/rmt-v4-deployment-identities.json"), "utf8"));
const solcHashes = {
  "darwin-x64": "0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
  "linux-x64": "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
  "win32-x64": "537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67",
};
// Exact deployment review scope. The standalone 31337 replacement-token
// escrow has no deployment edge here and remains in the full Foundry/Slither tree.
const contractNames = [
  "RMTLaunchCurveDeploymentV1", "RMTLaunchCurveFactoryV1", "RMTLaunchCurveTokenV1", "RMTLaunchBondingCurveV1",
  "RMTLaunchCurveRevenueLedgerV1", "RMTV4CurveGraduationV1", "RMTV4CurveInitializationGuardV1",
  "RMTLaunchCurveDirectoryV1", "RMTLaunchProjectRegistryV1", "RMTLaunchBondingCurveV2",
  "RMTLaunchCurveSuccessorDeployerV1", "RMTLaunchBondingCurveV3", "RMTLaunchCurveSuccessorDeployerV2",
  "RMTLaunchCurveLpFeeLedgerV1",
];
const sourceFiles = {
  RMTLaunchCurveSuccessorDeployerV1: "src/RMTLaunchBondingCurveV2.sol",
  RMTLaunchCurveSuccessorDeployerV2: "src/RMTLaunchBondingCurveV3.sol",
};
const governanceDependencyHashes = {
  "utils/cryptography/ECDSA.sol": "37828cb50b47bcc51c7b770bde15d5885d871ef1e67028057a0b788c3568726e",
  "utils/cryptography/EIP712.sol": "27dac0732a0154f432c0a7a1d1f067ab51116105e157d0e5d68d040fd83954d5",
  "utils/cryptography/MessageHashUtils.sol": "2fd5c641cf452efd15f784827cb2835664970d7fbc166bf80824ed27011cc374",
  "utils/ShortStrings.sol": "ddd52921d2996abf2e3d9c1c4f6d00194a3e3b278a164948f995862371444a55",
  "utils/Strings.sol": "0519199dbc635f98ce2e4537986604ee618bca665c65e9a1738702dfacf72010",
  "utils/StorageSlot.sol": "b4a5fb7ab93bfeda06509eafbd5f71fde0e0de84b6d9129553bd535a42166c15",
  "utils/math/SignedMath.sol": "768c28e3a33c3312e57ae8a1caaec2893bc89ac6e386621de018f85e9a2d6e99",
  "interfaces/IERC5267.sol": "efd1ebd1e04b6ef9c3b8781a097588f83da954323f438d54a71dc06508e6c7b8",
};
const feeEvidenceDependencyHashes = {
  "lib/v4-core/src/libraries/StateLibrary.sol": "eebdbc1b6e431072ce5521b9e1b603d43831e3b6e062743e6665e070d5cf8a1a",
  "lib/v4-core/src/libraries/Position.sol": "3dc4e2ad1564fa94eddf3ff06ce9ac592c9d578ea64ca194050382da454c8fcb",
  "lib/v4-core/src/libraries/FixedPoint128.sol": "1ca2f55160697b73bd66fd27c8724d79a57108121ce1e8a0ab8b79f38bb58fbb",
  "lib/v4-core/src/libraries/LiquidityMath.sol": "67a39e58732340af4870342ba9230691f35501d89ed8725ca1b338deaa0eb26a",
  "lib/v4-periphery/src/libraries/PositionInfoLibrary.sol": "5c889e1d5f259291045413e28069101eba1e7b8b72df6586bf54e4de5e525099",
};
const chainGates = [
  ["RMTLaunchCurveFactoryV1", "block.chainid != 31_337", "block.chainid != 4_663", 2],
  ["RMTV4CurveGraduationV1", "CHAIN_ID = 31_337", "CHAIN_ID = 4_663", 1],
];
const allowedBacking = new Set(["1000000000000000000", "2000000000000000000", "4200000000000000000"]);
const baselineBacking = parseEther("1");
const ownerBacking = parseEther("2");
const ownerTestAccounts = [0x31337023n, 0x31337024n, 0x31337025n]
  .map((address) => getAddress(toHex(address, { size: 20 })));
// Illustrative reference of $2,500 per ETH. This is a fixed fixture parameter, with no price feed.
const fixtureCreationFee = parseEther("0.0004");
const keyTuple = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const [keyParam] = parseAbi(["function params(" + keyTuple + " poolKey)"])[0].inputs;
const [swapParam] = parseAbi(["function params((" + keyTuple
  + " poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) swap)"])[0].inputs;
const managerAbi = parseAbi([
  "function initialize(" + keyTuple + " key,uint160 sqrtPriceX96) returns (int24)",
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);
const stateAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const positionAbi = parseAbi([
  "function nextTokenId() view returns(uint256)",
  "function ownerOf(uint256 id) view returns(address)",
  "function getPositionLiquidity(uint256 id) view returns(uint128)",
  "function getPoolAndPositionInfo(uint256 id) view returns(" + keyTuple + " poolKey,uint256 info)",
  "function transferFrom(address from,address to,uint256 id)",
  "function getApproved(uint256 id) view returns(address)",
  "function approve(address approved,uint256 id)",
  "function modifyLiquidities(bytes unlockData,uint256 deadline) payable",
]);
const permitAbi = parseAbi([
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
]);
const quoterAbi = parseAbi(["function quoteExactInputSingle((" + keyTuple
  + " poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hexSha = (value) => sha(Buffer.from(value.slice(2), "hex"));
const addressEq = (a, b) => getAddress(a) === getAddress(b);
const poolIdFor = (key) => keccak256(encodeAbiParameters([keyParam], [key]));
const normalizedSource = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function compile({ solc, lib }, chainId, backing) {
  const compiler = resolve(solc);
  const executableSha256 = sha(readFileSync(compiler));
  assert.equal(executableSha256, solcHashes[process.platform + "-" + process.arch], "Solidity 0.8.26 executable pin mismatch");
  const sources = {};
  const outputSelection = {};
  for (const name of contractNames) {
    const file = sourceFiles[name] ?? "src/" + name + ".sol";
    sources[file] = { content: normalizedSource(join(root, file)) };
    outputSelection[file] ??= {};
    outputSelection[file][name] = ["abi", "evm.bytecode.object", "evm.deployedBytecode"];
  }
  for (const file of ["src/interfaces/IRMTV4CurveGraduationV1.sol", "src/interfaces/IRMTLaunchCurveExecution.sol",
    "src/RMTLaunchCurveMathV1.sol"]) {
    sources[file] = { content: normalizedSource(join(root, file)) };
  }
  const sourceSha256 = Object.fromEntries(Object.entries(sources).map(([file, { content }]) => [file, sha(content)]));
  const dependencyRoot = lib ? resolve(lib) : join(root, "lib");
  const dependencyPins = { ...existingInputs.dependencySourceSha256, ...feeEvidenceDependencyHashes };
  for (const [file, hash] of Object.entries(governanceDependencyHashes)) {
    dependencyPins["lib/v4-core/lib/openzeppelin-contracts/contracts/" + file] = hash;
  }
  for (const [file, expected] of Object.entries(dependencyPins)) {
    const content = normalizedSource(join(dependencyRoot, file.slice(4)));
    assert.equal(sha(content), expected, "Pinned source mismatch: " + file);
    sources[file] = { content };
  }
  const sourceChanges = [];
  if (chainId === 4663) {
    for (const [name, from, to, count] of chainGates) {
      const file = "src/" + name + ".sol";
      assert.equal(sources[file].content.split(from).length, count + 1, "Unexpected chain guard: " + file);
      sources[file].content = sources[file].content.replaceAll(from, to);
      sourceChanges.push({ file, occurrences: count, from, to, inputSha256: sha(sources[file].content) });
    }
  } else {
    assert.equal(chainId, 31337, "Only local 31337 and the internal 4663 review profile can compile");
  }
  if (backing !== baselineBacking) {
    assert.ok(chainId === 4663 || backing === ownerBacking,
      "Local 31337 supports only the 1 ETH regression and 2 ETH owner profiles");
    const file = "src/RMTLaunchCurveMathV1.sol";
    const replacements = [
      ["2ether-virtual-eth;60%-sold;1ether-backing", (backing * 2n) + "wei-virtual-eth;60%-sold;" + backing + "wei-backing"],
      ["VIRTUAL_ETH = 2 ether", "VIRTUAL_ETH = " + (backing * 2n)],
      ["GRADUATION_BACKING = 1 ether", "GRADUATION_BACKING = " + backing],
    ];
    for (const [from, to] of replacements) {
      assert.equal(sources[file].content.split(from).length, 2, "Unexpected source literal: " + from);
      sources[file].content = sources[file].content.replace(from, to);
    }
    sourceChanges.push({ file, replacements, inputSha256: sha(sources[file].content) });
  }
  const input = JSON.stringify({ language: "Solidity", sources, settings: {
    evmVersion: "cancun", viaIR: true, optimizer: { enabled: true, runs: 200 },
    metadata: { bytecodeHash: "ipfs", appendCBOR: true, useLiteralContent: false },
    remappings: ["@openzeppelin/=lib/v4-core/lib/openzeppelin-contracts/", "@uniswap/v4-core/=lib/v4-core/",
      "@uniswap/v4-periphery/=lib/v4-periphery/"],
    outputSelection,
  } });
  const output = JSON.parse(execFileSync(compiler, ["--standard-json", "--no-import-callback"], {
    cwd: root, input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180_000,
    env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
  }));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
  assert.equal(errors.length, 0, errors.map(({ formattedMessage }) => formattedMessage).join("\n"));
  const artifacts = {};
  const templates = {};
  for (const name of contractNames) {
    const { abi, evm } = output.contracts[sourceFiles[name] ?? "src/" + name + ".sol"][name];
    const bytecode = "0x" + evm.bytecode.object;
    const runtime = "0x" + evm.deployedBytecode.object;
    assert.ok(/^0x(?:[a-f0-9]{2})+$/.test(bytecode) && /^0x(?:[a-f0-9]{2})+$/.test(runtime), "Unlinked bytecode");
    const immutableReferences = Object.values(evm.deployedBytecode.immutableReferences ?? {}).flat();
    const runtimeBytes = (runtime.length - 2) / 2;
    const creationBytes = (bytecode.length - 2) / 2;
    assert.ok(runtimeBytes <= 24_576, "EIP-170 runtime too large: " + name);
    let constructorBytes = 1024;
    if (name === "RMTLaunchCurveDeploymentV1") {
      // All bootstrap constructor fields have static ABI widths. Measure their
      // encoded size with the compiled ABI instead of estimating the arguments.
      const sampleHash = toHex(0, { size: 32 });
      const example = encodeDeployData({ abi, bytecode, args: [{
        poolManager: zeroAddress, positionManager: zeroAddress, permit2: zeroAddress,
        poolManagerHash: sampleHash, positionManagerHash: sampleHash, permit2Hash: sampleHash,
      }, sampleHash, zeroAddress, zeroAddress, zeroAddress, zeroAddress, sampleHash, fixtureCreationFee] });
      constructorBytes = (example.length - bytecode.length) / 2;
    }
    assert.ok(creationBytes + constructorBytes <= 49_152,
      `EIP-3860 creation too large: ${name} (${creationBytes} + ${constructorBytes} bytes)`);
    artifacts[name] = { abi, bytecode, runtime, immutableReferences };
    templates[name] = { creationBytes, runtimeBytes, creationSha256: hexSha(bytecode), runtimeSha256: hexSha(runtime) };
  }
  return { artifacts, manifest: { chainId, executableSha256, inputSha256: sha(input), sourceSha256, sourceChanges, templates } };
}

function localClient(rpcUrl, chainId) {
  const url = new URL(rpcUrl);
  assert.ok(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.pathname === "/"
    && !url.username && !url.password && !url.search && !url.hash, "Only direct IPv4 loopback is supported");
  const chain = defineChain({ id: chainId, name: "Isolated curve review",
    nativeCurrency: { name: "Fork ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url.href] } } });
  return createPublicClient({ chain, transport: http(url.href, { retryCount: 0, timeout: 35_000 }), cacheTime: 0 });
}

const request = (address, abi, functionName, args = []) => ({ to: address, data: encodeFunctionData({ abi, functionName, args }) });
const read = (client, address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });

async function send(client, from, { to, data, value = 0n, gas = 8_000_000n }, status = "success") {
  const hash = await client.request({ method: "eth_sendTransaction",
    params: [{ from, ...(to ? { to } : {}), data, value: toHex(value), gas: toHex(gas) }] });
  const receipt = await readExactReceipt(client, hash);
  assert.equal(receipt.status, status, "Unexpected transaction outcome: " + hash);
  const [transaction, block] = await Promise.all([client.getTransaction({ hash }), client.getBlock({ blockNumber: receipt.blockNumber })]);
  assert.equal(transaction.chainId, client.chain.id);
  assert.ok(addressEq(transaction.from, from) && addressEq(receipt.from, from));
  assert.ok(to ? addressEq(transaction.to, to) && addressEq(receipt.to, to) : transaction.to === null && receipt.to === null);
  assert.equal(transaction.value, value);
  assert.equal(transaction.input, data);
  assert.equal(transaction.blockHash, receipt.blockHash);
  assert.equal(block.hash, receipt.blockHash);
  return receipt;
}

async function readExactReceipt(client, hash) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (error) {
      if (error.name !== "TransactionReceiptNotFoundError") throw error;
      if (attempt === 9) {
        const pending = await client.getTransaction({ hash }).catch(() => null);
        throw new Error("Exact loopback receipt unavailable: " + hash
          + (pending ? " (transaction known at block " + pending.blockNumber + ")" : " (transaction also unavailable)"), { cause: error });
      }
      // A submitted fixture transaction can remain in Anvil's local queue after a time jump.
      // Advance the isolated chain without broadcasting the transaction again.
      if (attempt === 2) await client.request({ method: "evm_mine" });
      await delay(250);
    }
  }
  throw new Error("Exact loopback receipt unavailable: " + hash);
}

function oneEvent(receipt, address, abi, eventName) {
  const logs = parseEventLogs({ abi, eventName, logs: receipt.logs.filter((log) => addressEq(log.address, address)) });
  assert.equal(logs.length, 1, "Unexpected " + eventName + " count");
  return { args: logs[0].args, logIndex: logs[0].logIndex };
}

function receiptEvidence({ transactionHash, blockNumber, blockHash, gasUsed }) {
  return { transactionHash, blockNumber, blockHash, gasUsed };
}

function executionCost(receipt, call, from) {
  assert.ok(receipt.gasUsed > 0n && receipt.effectiveGasPrice > 0n);
  return { ...receiptEvidence(receipt), from, to: call.to, calldata: call.data,
    effectiveGasPrice: receipt.effectiveGasPrice, loopbackExecutionWei: receipt.gasUsed * receipt.effectiveGasPrice };
}

async function verifiedRuntime(client, address, template) {
  const code = await client.getCode({ address });
  assert.ok(code && code !== "0x");
  const masked = Buffer.from(code.slice(2), "hex");
  for (const { start, length } of template.immutableReferences) masked.fill(0, start, start + length);
  assert.equal("0x" + masked.toString("hex"), template.runtime, "Contract runtime differs from compiled template");
  return keccak256(code);
}

function fixtureSigners() {
  // Deterministic, publicly derivable fixture keys sign EIP-712 evidence only.
  return [1101n, 1102n, 1103n].map((value) => privateKeyToAccount(toHex(value, { size: 32 })));
}

async function warp(client, seconds) {
  await client.request({ method: "evm_increaseTime", params: [Number(seconds)] });
  await client.request({ method: "evm_mine" });
}

async function deployGovernance(client, operator, artifacts) {
  const signers = fixtureSigners();
  const directoryArtifact = artifacts.RMTLaunchCurveDirectoryV1;
  const registryArtifact = artifacts.RMTLaunchProjectRegistryV1;
  const directoryReceipt = await send(client, operator, {
    data: encodeDeployData({ abi: directoryArtifact.abi, bytecode: directoryArtifact.bytecode, args: signers.map(({ address }) => address) }),
  });
  const directory = directoryReceipt.contractAddress;
  const registryReceipt = await send(client, operator, {
    data: encodeDeployData({ abi: registryArtifact.abi, bytecode: registryArtifact.bytecode, args: [directory] }),
  });
  const projectRegistry = registryReceipt.contractAddress;
  const [directoryRuntimeHash, registryRuntimeHash] = await Promise.all([
    verifiedRuntime(client, directory, directoryArtifact), verifiedRuntime(client, projectRegistry, registryArtifact),
  ]);
  return { directory, directoryRuntimeHash, projectRegistry, registryRuntimeHash };
}

async function publishDirectoryPin(client, operator, artifacts, directory, kind, version, target, runtimeHash) {
  const abi = artifacts.RMTLaunchCurveDirectoryV1.abi;
  const now = (await client.getBlock()).timestamp;
  const nonce = await read(client, directory, abi, "nonce");
  const action = { kind, nonce, version, factory: target, runtimeHash, deadline: Number(now + 3n * 86400n) };
  const digest = await read(client, directory, abi, "actionDigest", [action]);
  const [first, second] = await Promise.all(fixtureSigners().slice(0, 2).map((signer) => signer.sign({ hash: digest })));
  const scheduled = await send(client, operator, request(directory, abi, "schedule", [action, first, second]));
  await warp(client, 2n * 86400n);
  const executed = await send(client, operator, request(directory, abi, "execute", [action]));
  return { scheduled: receiptEvidence(scheduled), executed: receiptEvidence(executed) };
}

async function migrateCurve(client, creator, operator, artifacts, deployed, token, holders = [],
  submitProposal = (transaction) => send(client, creator, transaction)) {
  const { projectRegistry, factory } = deployed;
  const abi = artifacts.RMTLaunchProjectRegistryV1.abi;
  const factoryAbi = artifacts.RMTLaunchCurveFactoryV1.abi;
  const curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
  const curve = await read(client, factory, factoryAbi, "curveForToken", [token]);
  const ledger = await read(client, curve, curveAbi, "revenueLedger");
  const fromVersion = await read(client, curve, curveAbi, "executionVersion");
  const toVersion = fromVersion + 1;
  assert.ok(toVersion === 2 || toVersion === 3, "Fixture supports only the reviewed V2 and V3 templates");
  const prepared = await send(client, operator, request(factory, factoryAbi, "prepareMigration", [token, toVersion]));
  const nextEngine = await read(client, factory, factoryAbi, "migrationCandidate", [token, toVersion]);
  const runtimeHash = await verifiedRuntime(client, nextEngine, artifacts["RMTLaunchBondingCurveV" + toVersion]);
  const previousProject = await read(client, projectRegistry, abi, "project", [token]);
  const migrationHistoryIndex = previousProject[4] + 1n;
  const deadline = Number((await client.getBlock()).timestamp + 4n * 86400n);
  const proposal = await submitProposal(request(projectRegistry, abi, "proposeMigration", [token, nextEngine, runtimeHash, deadline]));
  const digest = await read(client, projectRegistry, abi, "migrationDigest", [token]);
  const [first, second] = await Promise.all(fixtureSigners().slice(0, 2).map((signer) => signer.sign({ hash: digest })));
  const scheduled = await send(client, operator, request(projectRegistry, abi, "scheduleMigration", [token, first, second]));
  const execution = request(projectRegistry, abi, "executeMigration", [token]);
  const premature = await send(client, operator, execution, "reverted");
  const ledgerAbi = artifacts.RMTLaunchCurveRevenueLedgerV1.abi;
  const beneficiaries = [creator, ...await Promise.all(["treasury", "operatingRecipient", "futureReserveRecipient"]
    .map((name) => read(client, curve, curveAbi, name)))];
  const checkedHolders = [...new Set([creator, ...holders].map((holder) => getAddress(holder)))];
  const snapshot = (target) => Promise.all([
    read(client, target, curveAbi, "backingReserve"), read(client, target, curveAbi, "sold"),
    read(client, token, erc20Abi, "balanceOf", [target]), read(client, token, erc20Abi, "totalSupply"),
    read(client, ledger, ledgerAbi, "totalAccrued"), read(client, ledger, ledgerAbi, "totalClaimed"),
    ...[0n, 1n, 2n, 3n].map((bucket) => read(client, ledger, ledgerAbi, "bucketAccrued", [bucket])),
    ...beneficiaries.map((beneficiary) => read(client, ledger, ledgerAbi, "claimable", [beneficiary])),
    read(client, target, curveAbi, "quoteBuy", [parseEther("0.01")]),
    read(client, target, curveAbi, "economicRules"), client.getBalance({ address: target }),
    read(client, target, curveAbi, "migrationCommitment"), client.getBalance({ address: ledger }),
    ...checkedHolders.map((holder) => read(client, token, erc20Abi, "balanceOf", [holder])),
  ]);
  const before = await snapshot(curve);
  await warp(client, 2n * 86400n);
  const interrupted = await send(client, operator, { ...execution, gas: 60_000n }, "reverted");
  assert.equal(interrupted.logs.length, 0);
  assert.deepEqual(await snapshot(curve), before);
  assert.ok(addressEq(await read(client, factory, factoryAbi, "curveForToken", [token]), curve));
  assert.equal(await read(client, token, erc20Abi, "balanceOf", [nextEngine]), 0n);
  const migrated = await send(client, operator, execution);
  assert.deepEqual(await snapshot(nextEngine), before);
  assert.equal(await client.getBalance({ address: curve }), 0n);
  assert.equal(await read(client, token, erc20Abi, "balanceOf", [curve]), 0n);
  assert.equal(await read(client, curve, curveAbi, "active"), false);
  assert.ok(addressEq(await read(client, ledger, ledgerAbi, "activeCurve"), nextEngine));
  assert.equal((await read(client, curve, curveAbi, "quoteBuy", [parseEther("0.01")]))[0], 0n);
  assert.ok(addressEq(await read(client, nextEngine, curveAbi, "revenueLedger"), ledger));
  assert.ok(addressEq(await read(client, factory, factoryAbi, "curveForToken", [token]), nextEngine));
  const project = await read(client, projectRegistry, abi, "project", [token]);
  assert.ok(addressEq(project[0], deployed.factory) && addressEq(project[1], nextEngine));
  assert.equal(project[2], toVersion);
  assert.ok(addressEq(project[3], nextEngine));
  assert.equal(project[4], migrationHistoryIndex);
  const history = await read(client, projectRegistry, abi, "migration", [token, migrationHistoryIndex]);
  assert.ok(addressEq(history[2], curve) && addressEq(history[3], nextEngine));
  assert.equal(history[4], runtimeHash);
  return { originCurve: curve, activeCurve: nextEngine, fromVersion, toVersion, migrationHistoryIndex,
    runtimeHash, prepared: receiptEvidence(prepared),
    proposal: receiptEvidence(proposal), scheduled: receiptEvidence(scheduled), premature: receiptEvidence(premature),
    interrupted: receiptEvidence(interrupted), migrated: receiptEvidence(migrated), backingInventoryFeesAndQuotesUnchanged: true };
}

async function deploy(client, accounts, pins, artifacts) {
  const [operator, operatingRecipient, futureReserveRecipient] = accounts;
  const governance = await deployGovernance(client, operator, artifacts);
  const { projectRegistry } = governance;
  const bootstrap = artifacts.RMTLaunchCurveDeploymentV1;
  const guard = artifacts.RMTV4CurveInitializationGuardV1;
  const graduation = artifacts.RMTV4CurveGraduationV1;
  const factoryArtifact = artifacts.RMTLaunchCurveFactoryV1;
  const successorDeployerArtifact = artifacts.RMTLaunchCurveSuccessorDeployerV1;
  const helperReceipt = await send(client, operator, { data: encodeDeployData({
    abi: successorDeployerArtifact.abi, bytecode: successorDeployerArtifact.bytecode,
  }) });
  const successorDeployer = helperReceipt.contractAddress;
  const successorDeployerRuntimeHash = await verifiedRuntime(client, successorDeployer, successorDeployerArtifact);
  const manager = pins.poolManager.address;
  const nonce = await client.getTransactionCount({ address: operator });
  const deployer = getContractAddress({ from: operator, nonce: BigInt(nonce) });
  const engine = getContractAddress({ from: deployer, nonce: 2n });
  const factory = getContractAddress({ from: deployer, nonce: 3n });
  const guardCode = encodeDeployData({ abi: guard.abi, bytecode: guard.bytecode, args: [manager, engine] });
  const bytecodeHash = keccak256(guardCode);
  let guardAddress;
  let guardSalt;
  for (let salt = 0n; salt < 200_000n; salt++) {
    const candidate = toHex(salt, { size: 32 });
    const predicted = getCreate2Address({ from: deployer, salt: candidate, bytecodeHash });
    if ((BigInt(predicted) & 0x3fffn) === 0x2000n) {
      guardAddress = predicted;
      guardSalt = candidate;
      break;
    }
  }
  assert.ok(guardAddress && guardSalt, "Guard salt search exhausted");
  const dependencies = {
    poolManager: manager, positionManager: pins.positionManager.address, permit2: pins.permit2.address,
    poolManagerHash: pins.poolManager.runtimeHash, positionManagerHash: pins.positionManager.runtimeHash,
    permit2Hash: pins.permit2.runtimeHash,
  };
  const data = encodeDeployData({ abi: bootstrap.abi, bytecode: bootstrap.bytecode,
    args: [dependencies, guardSalt, operatingRecipient, futureReserveRecipient, projectRegistry,
      successorDeployer, successorDeployerRuntimeHash, fixtureCreationFee] });
  assert.ok((data.length - 2) / 2 <= 49_152, "Encoded bootstrap exceeds the EIP-3860 initcode limit");
  const receipt = await send(client, operator, { data, gas: 14_000_000n });
  assert.ok(addressEq(receipt.contractAddress, deployer));
  assert.ok(addressEq(await read(client, deployer, bootstrap.abi, "factory"), factory));
  assert.ok(addressEq(await read(client, deployer, bootstrap.abi, "graduationEngine"), engine));
  assert.ok(addressEq(await read(client, deployer, bootstrap.abi, "initializationGuard"), guardAddress));
  assert.ok(addressEq(await read(client, factory, factoryArtifact.abi, "graduationEngine"), engine));
  assert.ok(addressEq(await read(client, factory, factoryArtifact.abi, "successorDeployer"), successorDeployer));
  assert.equal(await read(client, factory, factoryArtifact.abi, "successorDeployerRuntimeHash"), successorDeployerRuntimeHash);
  assert.equal(await read(client, factory, factoryArtifact.abi, "creationFeeWei"), fixtureCreationFee);
  assert.ok(addressEq(await read(client, engine, graduation.abi, "factory"), factory));
  assert.ok(addressEq(await read(client, engine, graduation.abi, "initializationGuard"), guardAddress));
  assert.ok(addressEq(await read(client, guardAddress, guard.abi, "graduationEngine"), engine));
  const [factoryRuntimeHash, graduationRuntimeHash, guardRuntimeHash, deploymentRuntimeHash] = await Promise.all([
    verifiedRuntime(client, factory, factoryArtifact), verifiedRuntime(client, engine, graduation),
    verifiedRuntime(client, guardAddress, guard), verifiedRuntime(client, deployer, bootstrap),
  ]);
  const deployed = {
    chainId: client.chain.id, factory, factoryRuntimeHash, graduationEngine: engine, graduationRuntimeHash,
    guard: guardAddress, guardRuntimeHash, deployBlock: receipt.blockNumber, router: pins.universalRouter,
    deployment: { ...receiptEvidence(receipt), address: deployer, deploymentRuntimeHash, operator, nonce,
      dependencies, operatingRecipient, futureReserveRecipient, projectRegistry, guardSalt, guardCodeHash: bytecodeHash,
      successorDeployer, successorDeployerRuntimeHash, successorDeployerReceipt: receiptEvidence(helperReceipt) },
  };
  const directoryAbi = artifacts.RMTLaunchCurveDirectoryV1.abi;
  const factoryPublication = await publishDirectoryPin(client, operator, artifacts, governance.directory, 0, 1, factory, factoryRuntimeHash);
  const pin = await read(client, governance.directory, directoryAbi, "currentFactory");
  assert.ok(addressEq(pin.factory, factory));
  assert.equal(pin.runtimeHash, factoryRuntimeHash);
  const v3Helper = artifacts.RMTLaunchCurveSuccessorDeployerV2;
  const v3Receipt = await send(client, operator, { data: encodeDeployData({ abi: v3Helper.abi, bytecode: v3Helper.bytecode }) });
  const v3Deployer = v3Receipt.contractAddress;
  const v3DeployerHash = await verifiedRuntime(client, v3Deployer, v3Helper);
  const v3Publication = await publishDirectoryPin(client, operator, artifacts, governance.directory, 4, 3, v3Deployer, v3DeployerHash);
  const template = await read(client, governance.directory, directoryAbi, "migrationTemplates", [3]);
  assert.ok(addressEq(template[0], v3Deployer));
  assert.equal(template[1], v3DeployerHash);
  return { ...deployed, ...governance, creationFeeWei: fixtureCreationFee, factoryPublication,
    v3Template: { deployer: v3Deployer, runtimeHash: v3DeployerHash, deployed: receiptEvidence(v3Receipt), ...v3Publication } };
}

async function withLocalImpersonation(client, address, run) {
  await client.request({ method: "anvil_impersonateAccount", params: [address] });
  try {
    return await run();
  } finally {
    await client.request({ method: "anvil_stopImpersonatingAccount", params: [address] });
  }
}

async function verifiedLocalProfile({ rpc, operator, creator, factory, "owner-test": ownerTest,
  "migrate-token": migrateToken }, artifacts, backing) {
  const client = localClient(rpc, 31337);
  assert.equal(await client.getChainId(), 31337);
  assert.match(await client.request({ method: "web3_clientVersion" }), /^anvil\//i);
  assert.equal((await client.getBlock({ blockNumber: BigInt(baseSepolia.block) })).hash, baseSepolia.blockHash);
  const pins = { poolManager: baseSepolia.poolManager, positionManager: baseSepolia.positionManager,
    permit2: baseSepolia.permit2, universalRouter: baseSepolia.universalRouter212, quoter: baseSepolia.quoter, stateView: baseSepolia.stateView };
  for (const { address, runtimeHash } of Object.values(pins)) {
    const code = await client.getCode({ address });
    assert.ok(code && keccak256(code) === runtimeHash, "Base Sepolia fork runtime mismatch for " + address);
  }
  const accounts = (await client.request({ method: "eth_accounts" })).map((address) => getAddress(address));
  const economicRules = keccak256(toHex(backing === baselineBacking
    ? "RMTLaunchCurveV1:180%-virtual-token;2ether-virtual-eth;60%-sold;1ether-backing;100bps-gross-ceil"
    : "RMTLaunchCurveV1:180%-virtual-token;" + (backing * 2n) + "wei-virtual-eth;60%-sold;" + backing + "wei-backing;100bps-gross-ceil"));
  const terms = { backingWei: backing, virtualEthWei: backing * 2n, economicRules };
  const sender = ownerTest ? ownerTestAccounts[0] : getAddress(operator);
  if (ownerTest) {
    assert.equal(accounts.length, 0, "Owner test Anvil must start with zero unlocked accounts");
  } else {
    assert.ok(accounts.includes(sender), "Operator must be a local unlocked fixture account");
  }
  if (migrateToken) {
    const proposer = getAddress(creator);
    const token = getAddress(migrateToken);
    const artifact = artifacts.RMTLaunchCurveFactoryV1;
    const factoryAddress = getAddress(factory);
    await verifiedRuntime(client, factoryAddress, artifact);
    const projectRegistry = await read(client, factoryAddress, artifact.abi, "projectRegistry");
    await verifiedRuntime(client, projectRegistry, artifacts.RMTLaunchProjectRegistryV1);
    const active = await read(client, factoryAddress, artifact.abi, "curveForToken", [token]);
    const curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
    assert.equal(await read(client, active, curveAbi, "economicRules"), economicRules);
    assert.ok(addressEq(await read(client, active, curveAbi, "creator"), proposer), "Creator does not match the active curve");
    const deployed = { factory: factoryAddress, projectRegistry };
    if (ownerTest) {
      assert.ok(!ownerTestAccounts.includes(proposer), "Owner test creator must be distinct from the fixture operator and recipients");
      const code = await client.getCode({ address: proposer });
      assert.ok(!code || code === "0x", "Use a fresh externally owned test wallet for the creator");
      const result = await withLocalImpersonation(client, sender, () => migrateCurve(client, proposer, sender, artifacts, deployed,
        token, [], (transaction) => withLocalImpersonation(client, proposer, () => send(client, proposer, transaction))));
      assert.deepEqual(await client.request({ method: "eth_accounts" }), []);
      return { ...result, terms, ownerTest, simulatedCreatorAuthorization: true };
    }
    assert.ok(accounts.includes(proposer), "Creator must be a local unlocked fixture account");
    return { ...await migrateCurve(client, proposer, sender, artifacts, deployed, token), terms };
  }
  if (ownerTest) {
    const latest = await client.getBlock();
    assert.equal(latest.number, BigInt(baseSepolia.block), "Start a fresh pinned Anvil fork before owner fixture deployment");
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (latest.timestamp < now) {
      await client.request({ method: "evm_setNextBlockTimestamp", params: [Number(now)] });
      await client.request({ method: "evm_mine" });
    }
    await client.request({ method: "anvil_setBalance", params: [sender, toHex(parseEther("2"))] });
    const result = await withLocalImpersonation(client, sender, () => deploy(client, ownerTestAccounts, pins, artifacts));
    assert.deepEqual(await client.request({ method: "eth_accounts" }), []);
    return { ...result, terms, ownerTest };
  }
  assert.ok(accounts.length >= 3, "Local fixture needs separate simulated revenue recipients");
  return { ...await deploy(client, [sender, ...accounts.filter((address) => address !== sender).slice(0, 2)], pins, artifacts), terms };
}

function routerCall(router, key, buy, amountIn, minimumOut, deadline) {
  const [currencyIn, currencyOut] = buy ? [key.currency0, key.currency1] : [key.currency1, key.currency0];
  const hopFloor = minimumOut * 10n ** 36n / amountIn;
  assert.ok(hopFloor > 0n);
  const swap = encodeAbiParameters([swapParam], [{ poolKey: key, zeroForOne: buy,
    amountIn, amountOutMinimum: minimumOut, minHopPriceX36: hopFloor, hookData: "0x" }]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [currencyIn, amountIn, true]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyOut, minimumOut]);
  const actions = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060b0f", [swap, settle, take]]);
  return { ...request(router, routerAbi, "execute", ["0x10", [actions], deadline]), value: buy ? amountIn : 0n };
}

async function proveSwap(client, pins, key, trader, buy, amountIn) {
  const { universalRouter: { address: router }, quoter: { address: quoter }, poolManager: { address: manager },
    permit2: { address: permit2 } } = pins;
  const token = key.currency1;
  const deadline = (await client.getBlock()).timestamp + 600n;
  if (!buy) {
    await send(client, trader, request(token, erc20Abi, "approve", [permit2, amountIn]));
    await send(client, trader, request(permit2, permitAbi, "approve", [token, router, amountIn, Number(deadline)]));
  }
  const { result: [quote] } = await client.simulateContract({ account: trader, address: quoter, abi: quoterAbi,
    functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: buy, exactAmount: amountIn, hookData: "0x" }] });
  const minimumOut = quote * 99n / 100n;
  assert.ok(minimumOut > 0n);
  const call = routerCall(router, key, buy, amountIn, minimumOut, deadline);
  await client.call({ account: trader, ...call });
  const tokenBefore = await read(client, token, erc20Abi, "balanceOf", [trader]);
  const nativeBefore = await client.getBalance({ address: trader });
  const receipt = await send(client, trader, call);
  const { args: swap } = oneEvent(receipt, manager, managerAbi, "Swap");
  const { args: transfer } = oneEvent(receipt, token, erc20Abi, "Transfer");
  const output = buy ? swap.amount1 : swap.amount0;
  assert.equal(swap.id, poolIdFor(key));
  assert.ok(addressEq(swap.sender, router));
  assert.equal(buy ? -swap.amount0 : -swap.amount1, amountIn);
  assert.equal(output, quote);
  assert.ok(addressEq(transfer.from, buy ? manager : trader) && addressEq(transfer.to, buy ? trader : manager));
  assert.equal(transfer.value, buy ? output : amountIn);
  assert.equal(await read(client, token, erc20Abi, "balanceOf", [trader]) - tokenBefore, buy ? output : -amountIn);
  assert.equal(await client.getBalance({ address: trader }) - nativeBefore + receipt.gasUsed * receipt.effectiveGasPrice,
    buy ? -amountIn : output);
  const trace = await client.request({ method: "debug_traceTransaction", params: [receipt.transactionHash, { tracer: "callTracer" }] });
  const successful = (frame) => frame.error ? [] : [frame, ...(frame.calls ?? []).flatMap(successful)];
  const payments = successful(trace).filter((frame) => frame.type === "CALL" && frame.from && frame.to
    && addressEq(frame.from, buy ? router : manager) && addressEq(frame.to, buy ? manager : trader) && BigInt(frame.value ?? 0) > 0n);
  assert.equal(payments.reduce((sum, frame) => sum + BigInt(frame.value), 0n), buy ? amountIn : output);
  if (!buy) {
    assert.equal(await read(client, token, erc20Abi, "allowance", [trader, permit2]), 0n);
    assert.equal((await read(client, permit2, permitAbi, "allowance", [trader, token, router]))[0], 0n);
  }
  return { ...receiptEvidence(receipt), trader, amountIn, minimumOut, output,
    settlement: payments.map(({ from, to, value }) => ({ from, to, value })) };
}

async function proveLpFees(client, pins, artifacts, deployment, position, creator, collector) {
  const { token, positionTokenId, liquidity, poolKey } = position;
  const { graduationEngine: engine } = deployment;
  const { address: manager } = pins.poolManager;
  const { address: positions } = pins.positionManager;
  const engineAbi = artifacts.RMTV4CurveGraduationV1.abi;
  const ledgerArtifact = artifacts.RMTLaunchCurveLpFeeLedgerV1;
  const ledger = await read(client, engine, engineAbi, "lpFeeLedger", [token]);
  const ledgerRuntimeHash = await verifiedRuntime(client, ledger, ledgerArtifact);
  const abi = ledgerArtifact.abi;
  const preview = await read(client, engine, engineAbi, "previewLpFees", [token]);
  const [nativeFee, tokenFee] = preview;
  assert.ok(nativeFee > 0n && tokenFee > 0n);
  assert.deepEqual(await read(client, ledger, abi, "totalAccrued"), [0n, 0n]);
  const startBalances = await Promise.all([client.getBalance({ address: ledger }), read(client, token, erc20Abi, "balanceOf", [ledger])]);
  const deadline = (await client.getBlock()).timestamp + 300n;
  const collection = request(engine, engineAbi, "collectLpFees", [token, deadline]);
  await client.call({ account: collector, ...collection });
  const receipt = await send(client, collector, collection);
  const { args, logIndex } = oneEvent(receipt, engine, engineAbi, "LpFeesCollected");
  assert.ok(addressEq(args.token, token) && addressEq(args.ledger, ledger));
  assert.equal(args.positionTokenId, positionTokenId);
  assert.equal(args.nativeAmount, nativeFee);
  assert.equal(args.tokenAmount, tokenFee);
  assert.deepEqual(await read(client, ledger, abi, "totalAccrued"), preview);
  assert.deepEqual(await read(client, engine, engineAbi, "previewLpFees", [token]), [0n, 0n]);
  assert.equal((await client.getBalance({ address: ledger })) - startBalances[0], nativeFee);
  assert.equal((await read(client, token, erc20Abi, "balanceOf", [ledger])) - startBalances[1], tokenFee);
  const { args: transfer } = oneEvent(receipt, token, erc20Abi, "Transfer");
  assert.ok(addressEq(transfer.from, manager) && addressEq(transfer.to, ledger));
  assert.equal(transfer.value, tokenFee);
  const trace = await client.request({ method: "debug_traceTransaction", params: [receipt.transactionHash, { tracer: "callTracer" }] });
  const successful = (frame) => frame.error ? [] : [frame, ...(frame.calls ?? []).flatMap(successful)];
  const nativePayments = successful(trace).filter((frame) => frame.type === "CALL" && frame.from && frame.to
    && addressEq(frame.from, manager) && addressEq(frame.to, ledger) && BigInt(frame.value ?? 0) > 0n);
  assert.equal(nativePayments.reduce((sum, frame) => sum + BigInt(frame.value), 0n), nativeFee);
  const duplicateCollection = await send(client, collector, collection, "reverted");
  assert.deepEqual(await read(client, ledger, abi, "totalAccrued"), preview);
  const credits = await read(client, ledger, abi, "claimable", [creator]);
  const split = (amount) => {
    const platform = amount / 10n;
    return [amount - platform, 0n, platform / 2n, platform - platform / 2n];
  };
  for (const [index, recipient] of [creator, zeroAddress, deployment.deployment.operatingRecipient,
    deployment.deployment.futureReserveRecipient].entries()) {
    assert.deepEqual(await read(client, ledger, abi, "claimable", [recipient]), [split(nativeFee)[index], split(tokenFee)[index]]);
  }
  const creatorTokenBefore = await read(client, token, erc20Abi, "balanceOf", [creator]);
  const creatorNativeBefore = await client.getBalance({ address: creator });
  const combinedCall = request(ledger, abi, "claim");
  const claim = await send(client, creator, combinedCall);
  const { args: claimed } = oneEvent(claim, ledger, abi, "LpFeesClaimed");
  assert.ok(addressEq(claimed.recipient, creator));
  assert.deepEqual([claimed.nativeAmount, claimed.tokenAmount], credits);
  assert.equal((await read(client, token, erc20Abi, "balanceOf", [creator])) - creatorTokenBefore, credits[1]);
  assert.equal((await client.getBalance({ address: creator })) - creatorNativeBefore + claim.gasUsed * claim.effectiveGasPrice, credits[0]);
  assert.deepEqual(await read(client, ledger, abi, "totalClaimed"), credits);
  assert.deepEqual(await read(client, ledger, abi, "claimable", [creator]), [0n, 0n]);
  const operating = deployment.deployment.operatingRecipient;
  const claimCosts = { combined: executionCost(claim, combinedCall, creator) };
  for (const [name, native, index] of [["native", true, 0], ["token", false, 1]]) {
    const before = await read(client, ledger, abi, "claimable", [operating]);
    assert.ok(before[index] > 0n);
    const requestAsset = request(ledger, abi, "claimAsset", [native]);
    const paid = await send(client, operating, requestAsset);
    const { args: payment } = oneEvent(paid, ledger, abi, "LpFeesClaimed");
    assert.ok(addressEq(payment.recipient, operating));
    assert.deepEqual([payment.nativeAmount, payment.tokenAmount], native ? [before[0], 0n] : [0n, before[1]]);
    assert.deepEqual(await read(client, ledger, abi, "claimable", [operating]), native ? [0n, before[1]] : [before[0], 0n]);
    claimCosts[name] = executionCost(paid, requestAsset, operating);
  }
  assert.equal(await read(client, positions, positionAbi, "getPositionLiquidity", [positionTokenId]), liquidity);
  assert.ok(addressEq(await read(client, positions, positionAbi, "ownerOf", [positionTokenId]), engine));
  assert.ok(addressEq(await read(client, positions, positionAbi, "getApproved", [positionTokenId]), zeroAddress));
  assert.equal(poolIdFor((await read(client, positions, positionAbi, "getPoolAndPositionInfo", [positionTokenId]))[0]), poolIdFor(poolKey));
  const approvalDenied = await send(client, creator, request(positions, positionAbi, "approve", [creator, positionTokenId]), "reverted");
  return { ledger, ledgerRuntimeHash, collected: { ...receiptEvidence(receipt), nativeFee, tokenFee, logIndex },
    claim: { ...receiptEvidence(claim), native: credits[0], token: credits[1] },
    duplicateCollection: receiptEvidence(duplicateCollection), approvalDenied: receiptEvidence(approvalDenied),
    principalAndCustodyUnchanged: true, feeCosts: { collection: executionCost(receipt, collection, collector), ...claimCosts } };
}

async function proveOutsideLiquidity(client, pins, artifacts, engine, position, provider, trader) {
  const { token, poolKey, liquidity, positionTokenId, nativeUsed, tokenUsed } = position;
  const { address: manager } = pins.poolManager;
  const { address: positionManager } = pins.positionManager;
  const { address: permit2 } = pins.permit2;
  const abi = artifacts.RMTV4CurveGraduationV1.abi;
  const originalFees = () => read(client, engine, abi, "previewLpFees", [token]);
  const [nativeBefore, tokenBefore] = await originalFees();
  const tokenBudget = await read(client, token, erc20Abi, "balanceOf", [provider]);
  assert.ok(tokenBudget > tokenUsed / 4n, "Outside provider has insufficient earned tokens");
  const nativeBudget = nativeUsed / 2n;
  const addedLiquidity = liquidity / 4n;
  const deadline = (await client.getBlock()).timestamp + 300n;
  const nextPositionId = await read(client, positionManager, positionAbi, "nextTokenId");
  await send(client, provider, request(token, erc20Abi, "approve", [permit2, tokenBudget]));
  await send(client, provider, request(permit2, permitAbi, "approve", [token, positionManager, tokenBudget, Number(deadline)]));
  const mint = encodeAbiParameters([
    keyParam, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" },
    { type: "address" }, { type: "bytes" },
  ], [poolKey, -887220, 887220, addedLiquidity, nativeBudget, tokenBudget, provider, "0x"]);
  const pair = encodeAbiParameters([{ type: "address" }, { type: "address" }], [poolKey.currency0, poolKey.currency1]);
  const refund = encodeAbiParameters([{ type: "address" }, { type: "address" }], [poolKey.currency0, provider]);
  const encodeActions = (actions, parameters) =>
    encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, parameters]);
  const outside = await send(client, provider, {
    ...request(positionManager, positionAbi, "modifyLiquidities", [encodeActions("0x020d14", [mint, pair, refund]), deadline]),
    value: nativeBudget,
  });
  await send(client, provider, request(permit2, permitAbi, "approve", [token, positionManager, 0n, 0]));
  await send(client, provider, request(token, erc20Abi, "approve", [permit2, 0n]));
  assert.ok(addressEq(await read(client, positionManager, positionAbi, "ownerOf", [nextPositionId]), provider));
  assert.equal(await read(client, positionManager, positionAbi, "getPositionLiquidity", [nextPositionId]), addedLiquidity);
  assert.deepEqual(await originalFees(), [nativeBefore, tokenBefore]);
  const swap = await proveSwap(client, pins, poolKey, trader, true, parseEther("0.05"));
  const [nativeAfter, tokenAfter] = await originalFees();
  assert.equal(tokenAfter, tokenBefore);
  const addedOriginalNativeFees = nativeAfter - nativeBefore;
  const grossLpFees = swap.amountIn * BigInt(poolKey.fee) / 1_000_000n;
  const modeledOriginalFees = grossLpFees * liquidity / (liquidity + addedLiquidity);
  assert.ok(addedOriginalNativeFees > 0n && addedOriginalNativeFees < grossLpFees);
  assert.ok(addedOriginalNativeFees === modeledOriginalFees || addedOriginalNativeFees + 1n === modeledOriginalFees);
  assert.equal(await read(client, positionManager, positionAbi, "getPositionLiquidity", [positionTokenId]), liquidity);
  assert.ok(addressEq(await read(client, positionManager, positionAbi, "ownerOf", [positionTokenId]), engine));
  assert.equal(swap.settlement[0].to.toLowerCase(), manager.toLowerCase());
  return { mint: receiptEvidence(outside), outsidePositionTokenId: nextPositionId, outsideLiquidity: addedLiquidity,
    swap, grossLpFees, addedOriginalNativeFees };
}

async function proveCreation(client, deployment, factoryAbi, creator, args, refund) {
  const { factory, creationFeeWei } = deployment;
  const recipient = deployment.deployment.operatingRecipient;
  const call = request(factory, factoryAbi, "create", args);
  const priorFees = await read(client, factory, factoryAbi, "creationFeesAccrued");
  const priorBalance = await client.getBalance({ address: factory });
  const rejected = await send(client, creator, { ...call, value: creationFeeWei - 1n }, "reverted");
  assert.equal(rejected.logs.length, 0);
  assert.ok(addressEq(await read(client, factory, factoryAbi, "tokenForIntent", [creator, args[6]]), zeroAddress));
  assert.equal(await read(client, factory, factoryAbi, "creationFeesAccrued"), priorFees);

  const creatorBalance = await client.getBalance({ address: creator });
  const launch = await send(client, creator, { ...call, value: creationFeeWei + refund });
  const created = oneEvent(launch, factory, factoryAbi, "CurveCreated");
  const fee = oneEvent(launch, factory, factoryAbi, "CreationFeePaid");
  assert.ok(addressEq(fee.args.token, created.args.token) && addressEq(fee.args.creator, creator)
    && addressEq(fee.args.recipient, recipient));
  assert.equal(fee.args.fee, creationFeeWei);
  assert.equal(fee.args.refund, refund);
  assert.equal(creatorBalance - await client.getBalance({ address: creator }) - launch.gasUsed * launch.effectiveGasPrice,
    creationFeeWei);
  assert.equal(await read(client, factory, factoryAbi, "creationFeesAccrued"), priorFees + creationFeeWei);
  assert.equal(await client.getBalance({ address: factory }), priorBalance + creationFeeWei);
  const trace = await client.request({ method: "debug_traceTransaction", params: [launch.transactionHash, { tracer: "callTracer" }] });
  assert.ok(!trace.error && addressEq(trace.from, creator) && addressEq(trace.to, factory));
  const refundPayments = (trace.calls ?? []).filter((frame) => !frame.error && frame.type === "CALL" &&
    addressEq(frame.from, factory) && addressEq(frame.to, creator) && BigInt(frame.value ?? 0) > 0n);
  assert.equal(refundPayments.length, refund === 0n ? 0 : 1);
  assert.equal(refundPayments.reduce((sum, frame) => sum + BigInt(frame.value), 0n), refund);
  const refundSettlement = refundPayments.map(({ from, to, value }) => ({ from, to, value }));
  return { launch, created, fee: { ...fee.args, logIndex: fee.logIndex, refundSettlement }, insufficient: receiptEvidence(rejected) };
}

async function proveCreationClaim(client, deployment, factoryAbi, caller) {
  const { factory, creationFeeWei } = deployment;
  const recipient = deployment.deployment.operatingRecipient;
  assert.ok(!addressEq(caller, recipient));
  const call = request(factory, factoryAbi, "claimCreationFees");
  const accrued = await read(client, factory, factoryAbi, "creationFeesAccrued");
  assert.equal(accrued, creationFeeWei * 2n);
  const recipientBefore = await client.getBalance({ address: recipient });
  const receipt = await send(client, caller, call);
  const { args } = oneEvent(receipt, factory, factoryAbi, "CreationFeesClaimed");
  assert.ok(addressEq(args.recipient, recipient));
  assert.equal(args.amount, accrued);
  assert.equal(await client.getBalance({ address: recipient }) - recipientBefore, accrued);
  assert.equal(await read(client, factory, factoryAbi, "creationFeesAccrued"), 0n);
  assert.equal(await client.getBalance({ address: factory }), 0n);
  return { ...receiptEvidence(receipt), recipient, amount: accrued };
}

async function review({ rpcUrl, accounts, report }, artifacts, backing) {
  const client = localClient(rpcUrl, 4663);
  assert.equal(await client.getChainId(), 4663);
  const pins = report.network.contracts;
  const { address: manager } = pins.poolManager;
  const { address: positions } = pins.positionManager;
  const { address: stateView } = pins.stateView;
  const [operator, operating, reserve, creator, trader, graduateCaller] = accounts;
  const deployment = await deploy(client, [operator, operating, reserve], pins, artifacts);
  const { factory, graduationEngine: engine, guard } = deployment;
  const factoryAbi = artifacts.RMTLaunchCurveFactoryV1.abi;
  const curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
  const engineAbi = artifacts.RMTV4CurveGraduationV1.abi;
  let deadline = (await client.getBlock()).timestamp + 900n;
  const { launch, created, fee: creationFee, insufficient } = await proveCreation(client, deployment, factoryAbi, creator,
    ["Robinhood Curve Review", "RCR", "", 0, zeroAddress, 0, toHex(1, { size: 32 }), deadline], 0n);
  const { token, curve: originCurve, revenueLedger, supply } = created.args;
  let curve = originCurve;
  const [tokenRuntimeHash, curveRuntimeHash, ledgerRuntimeHash] = await Promise.all([
    verifiedRuntime(client, token, artifacts.RMTLaunchCurveTokenV1), verifiedRuntime(client, curve, artifacts.RMTLaunchBondingCurveV1),
    verifiedRuntime(client, revenueLedger, artifacts.RMTLaunchCurveRevenueLedgerV1),
  ]);
  assert.equal(await read(client, token, erc20Abi, "totalSupply"), supply);
  assert.equal(await read(client, token, erc20Abi, "balanceOf", [curve]), supply);
  assert.equal(await read(client, token, erc20Abi, "balanceOf", [creator]), 0n);
  assert.equal(await client.getBalance({ address: curve }), 0n);
  assert.equal(await client.getBalance({ address: revenueLedger }), 0n);

  const key = await read(client, engine, engineAbi, "canonicalPoolKey", [token]);
  assert.ok(addressEq(key.hooks, guard));
  const poolId = poolIdFor(key);
  const blocked = await send(client, graduateCaller,
    request(manager, managerAbi, "initialize", [key, 1n << 96n]), "reverted");
  assert.equal(blocked.logs.length, 0);
  assert.equal((await read(client, stateView, stateAbi, "getSlot0", [poolId]))[0], 0n);

  const firstBudget = parseEther("0.1");
  const [firstBuy] = await read(client, curve, curveAbi, "quoteBuy", [firstBudget]);
  const curveBuy = await send(client, trader, { ...request(curve, curveAbi, "buy", [firstBuy, deadline]), value: firstBudget });
  const sellSize = firstBuy / 2n;
  const [firstSell] = await read(client, curve, curveAbi, "quoteSell", [sellSize]);
  await send(client, trader, request(token, erc20Abi, "approve", [curve, sellSize]));
  const curveSell = await send(client, trader, request(curve, curveAbi, "sell", [sellSize, firstSell, deadline]));
  assert.equal(await read(client, token, erc20Abi, "allowance", [trader, curve]), 0n);

  const migration = await migrateCurve(client, creator, operator, artifacts, deployment, token, [creator, trader]);
  const successorDeadline = (await client.getBlock()).timestamp + 900n;
  const [v2Fill] = await read(client, migration.activeCurve, curveAbi, "quoteBuy", [firstBudget]);
  const v2Trade = await send(client, trader, {
    ...request(migration.activeCurve, curveAbi, "buy", [v2Fill, successorDeadline]), value: firstBudget,
  });
  assert.equal(oneEvent(v2Trade, migration.activeCurve, curveAbi, "CurveTrade").args.tokenAmount, v2Fill);
  const successorMigration = await migrateCurve(client, creator, operator, artifacts, deployment, token, [creator, trader]);
  curve = successorMigration.activeCurve;
  assert.ok(addressEq(await read(client, factory, factoryAbi, "originCurveForToken", [token]), originCurve));
  deadline = (await client.getBlock()).timestamp + 900n;
  const budget = backing * 2n;
  const [finalBuy, grossUsed, fee, refund] = await read(client, curve, curveAbi, "quoteBuy", [budget]);
  assert.ok(refund > 0n && grossUsed + refund === budget && fee > 0n);
  const thresholdBuy = await send(client, trader, { ...request(curve, curveAbi, "buy", [finalBuy, deadline]), value: budget });
  const finalTrade = oneEvent(thresholdBuy, curve, curveAbi, "CurveTrade").args;
  assert.equal(finalTrade.nativeRefund, refund);
  assert.equal(finalTrade.grossNative, grossUsed);
  const nativeReserve = await read(client, curve, curveAbi, "backingReserve");
  const tokenReserve = await read(client, token, erc20Abi, "balanceOf", [curve]);
  assert.equal(nativeReserve, backing);
  assert.equal(tokenReserve, supply * 2n / 5n);
  assert.equal(await client.getBalance({ address: curve }), nativeReserve);

  const graduate = request(curve, curveAbi, "graduate", [deadline]);
  const interrupted = await send(client, graduateCaller, { ...graduate, gas: 160_000n }, "reverted");
  assert.equal(interrupted.logs.length, 0);
  assert.equal(await read(client, curve, curveAbi, "backingReserve"), nativeReserve);
  assert.equal(await read(client, token, erc20Abi, "balanceOf", [curve]), tokenReserve);
  assert.equal(await read(client, curve, curveAbi, "graduated"), false);
  assert.equal((await read(client, stateView, stateAbi, "getSlot0", [poolId]))[0], 0n);

  const managerNativeBefore = await client.getBalance({ address: manager });
  const managerTokenBefore = await read(client, token, erc20Abi, "balanceOf", [manager]);
  await client.call({ account: graduateCaller, ...graduate });
  const completion = await send(client, graduateCaller, graduate);
  const settled = oneEvent(completion, engine, engineAbi, "CurveGraduated");
  const curveSettled = oneEvent(completion, curve, curveAbi, "CurveGraduated");
  const { sqrtPriceX96, liquidity, nativeUsed, tokenUsed, nativeDust, tokenDust, positionTokenId } = settled.args;
  assert.ok(addressEq(settled.args.token, token) && addressEq(settled.args.curve, curve));
  assert.equal(settled.args.poolId, poolId);
  assert.equal(curveSettled.args.poolId, poolId);
  assert.equal(curveSettled.args.positionTokenId, positionTokenId);
  assert.equal(poolIdFor(settled.args.poolKey), poolId);
  assert.equal(nativeUsed + nativeDust, nativeReserve);
  assert.equal(tokenUsed + tokenDust, tokenReserve);
  assert.equal(await client.getBalance({ address: manager }) - managerNativeBefore, nativeUsed);
  assert.equal(await read(client, token, erc20Abi, "balanceOf", [manager]) - managerTokenBefore, tokenUsed);
  assert.equal(await client.getBalance({ address: curve }), nativeDust);
  assert.equal(await read(client, token, erc20Abi, "balanceOf", [curve]), tokenDust);
  assert.equal(await read(client, curve, curveAbi, "backingReserve"), 0n);
  assert.equal(await read(client, token, erc20Abi, "totalSupply"), supply);
  const q192 = (supply * 6n / 5n << 192n) / (backing * 3n);
  assert.ok(sqrtPriceX96 ** 2n <= q192 && (sqrtPriceX96 + 1n) ** 2n > q192);
  const [chainPrice,,, poolFee] = await read(client, stateView, stateAbi, "getSlot0", [poolId]);
  assert.equal(chainPrice, sqrtPriceX96);
  assert.equal(poolFee, 3000);
  assert.equal(await read(client, stateView, stateAbi, "getLiquidity", [poolId]), liquidity);
  assert.equal(poolIdFor((await read(client, positions, positionAbi, "getPoolAndPositionInfo", [positionTokenId]))[0]), poolId);
  assert.ok(addressEq(await read(client, positions, positionAbi, "ownerOf", [positionTokenId]), engine));
  assert.equal(await read(client, positions, positionAbi, "getPositionLiquidity", [positionTokenId]), liquidity);
  const blockedTransfer = await send(client, creator,
    request(positions, positionAbi, "transferFrom", [engine, creator, positionTokenId]), "reverted");

  const buy = await proveSwap(client, pins, key, trader, true, parseEther("0.1"));
  const sell = await proveSwap(client, pins, key, trader, false, buy.output / 2n);
  const lpFees = await proveLpFees(client, pins, artifacts, deployment, settled.args, creator, graduateCaller);
  const provider = graduateCaller;
  await send(client, trader, request(token, erc20Abi, "transfer", [provider, settled.args.tokenUsed / 3n]));
  const outsideLiquidity = await proveOutsideLiquidity(client, pins, artifacts, engine, settled.args, provider, trader);
  assert.equal(await read(client, positions, positionAbi, "getPositionLiquidity", [positionTokenId]), liquidity);
  assert.ok(addressEq(await read(client, positions, positionAbi, "ownerOf", [positionTokenId]), engine));
  assert.equal(await read(client, token, erc20Abi, "totalSupply"), supply);

  const second = await proveCreation(client, deployment, factoryAbi, creator,
    ["Atomic Graduation", "ATOMIC", "", 1, zeroAddress, 0, toHex(2, { size: 32 }), deadline], 123_456n);
  const { token: secondToken, curve: secondCurve, supply: secondSupply } = second.created.args;
  const [atomicOut] = await read(client, secondCurve, curveAbi, "quoteBuy", [budget]);
  const atomic = await send(client, trader, { ...request(secondCurve, curveAbi, "buyAndGraduate", [atomicOut, deadline]), value: budget });
  const atomicSettled = oneEvent(atomic, engine, engineAbi, "CurveGraduated");
  assert.ok(addressEq(atomicSettled.args.token, secondToken));
  assert.equal(await read(client, secondCurve, curveAbi, "graduated"), true);
  assert.equal(await read(client, secondToken, erc20Abi, "totalSupply"), secondSupply);
  const creationFeeClaim = await proveCreationClaim(client, deployment, factoryAbi, graduateCaller);

  return { report, deployment, migration, successorMigration, terms: { backingWei: backing, virtualEthWei: backing * 2n,
    expectedThresholdTradeGross: (backing * 10_000n + 9_899n) / 9_900n },
  creation: { ...receiptEvidence(launch), ...created.args, logIndex: created.logIndex,
    tokenRuntimeHash, curveRuntimeHash, ledgerRuntimeHash, fee: creationFee, insufficient,
    overpayment: { ...receiptEvidence(second.launch), ...second.fee }, claim: creationFeeClaim },
  curve: { buy: receiptEvidence(curveBuy), sell: receiptEvidence(curveSell), v2Buy: receiptEvidence(v2Trade),
    thresholdBuy: { ...receiptEvidence(thresholdBuy), refund },
    preinitializationBlocked: receiptEvidence(blocked) },
  graduation: { ...receiptEvidence(completion), ...settled.args, logIndex: settled.logIndex,
    rejectedFunding: receiptEvidence(interrupted), blockedTransfer: receiptEvidence(blockedTransfer), principalUnchangedAfterSwaps: true },
  atomicGraduation: { ...receiptEvidence(atomic), token: secondToken, curve: secondCurve, poolId: atomicSettled.args.poolId },
  v4Trades: { buy, sell }, lpFees, outsideLiquidity, feeCosts: lpFees.feeCosts };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { anvil: { type: "string" }, solc: { type: "string" },
      lib: { type: "string" }, archive: { type: "string" }, rpc: { type: "string" }, operator: { type: "string" },
      "migrate-token": { type: "string" }, creator: { type: "string" }, factory: { type: "string" },
      "backing-wei": { type: "string" }, "owner-test": { type: "boolean" }, "simulate-creator": { type: "boolean" } } });
    const ownerTest = values["owner-test"];
    const migration = values["migrate-token"];
    assert.ok(values.solc && (values.rpc ? !values.anvil && !values.archive && (ownerTest ? !values.operator : values.operator)
      : values.anvil && !values.operator && !ownerTest),
      "Supply --solc and --anvil for the 4663 fork, or --solc and --rpc with --operator or --owner-test for local 31337");
    assert.ok(migration ? values.rpc && values.creator && values.factory : !values.creator && !values.factory,
      "Migration needs local 31337, --migrate-token, --creator and --factory");
    assert.equal(Boolean(values["simulate-creator"]), Boolean(ownerTest && migration),
      "Owner test migration requires explicit --simulate-creator for local impersonation");
    const threshold = values["backing-wei"];
    assert.ok(threshold === undefined || allowedBacking.has(threshold), "Backing must be exactly 1, 2 or 4.20 ETH in wei");
    const backing = threshold === undefined ? baselineBacking : BigInt(threshold);
    assert.ok(!ownerTest || backing === ownerBacking, "Owner test requires the explicit 2 ETH review backing");
    const { artifacts, manifest } = compile(values, values.rpc ? 31337 : 4663, backing);
    const result = values.rpc ? await verifiedLocalProfile(values, artifacts, backing)
      : await withAnvilFork(values, (context) => review(context, artifacts, backing));
    console.log(JSON.stringify({ ...result, manifest }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
