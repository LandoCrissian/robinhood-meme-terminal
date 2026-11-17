import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { encodeSafeSetup } from "../../docs/evidence/rmt-task045/operations-safe-initializer.mjs";
import { buildTreasurySafeInitializers } from "../../docs/evidence/rmt-task046/treasury-safe-initializers.mjs";
import { makeReadOnlyRpc, MOBILE_DEPLOYMENT_PAYER, ROBINHOOD_SOURCES } from "./rpc.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const viem = require("viem");
const loadEvidence = (name) => JSON.parse(readFileSync(new URL("../../docs/evidence/" + name, import.meta.url)));
const operation = loadEvidence("rmt-task045/operations-safe-policy.json").operations;
const registry = loadEvidence("rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
const { factory, singleton, owners, setup } = operation;
const pins = [registry.safe_l2, registry.safe_proxy_factory, registry.compatibility_fallback_handler];
const factoryAbi = viem.parseAbi([
  "function proxyCreationCode() pure returns (bytes)",
  "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy,address singleton)",
]);
const safeAbi = viem.parseAbi([
  "function VERSION() view returns (string)",
  "function masterCopy() view returns (address)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)",
  "function getStorageAt(uint256 offset,uint256 length) view returns (bytes)",
]);
const nodeInterface = "0x00000000000000000000000000000000000000c8";
const gasAbi = viem.parseAbi([
  "function gasEstimateComponents(address to,bool contractCreation,bytes data) payable returns (uint64 gasEstimate,uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)",
]);
const sentinel = "0x0000000000000000000000000000000000000001";
const bytes32 = /^0x[0-9a-f]{64}$/i;
const quantity = (value) => {
  assert.ok(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value), "Malformed RPC quantity");
  return BigInt(value);
};
const toValue = (row) => row?.status === "observed" ? row.value : undefined;

function header(raw) {
  assert.ok(raw && bytes32.test(raw.hash) && BigInt(raw.hash) > 0n);
  return { number: quantity(raw.number).toString(), hash: raw.hash.toLowerCase(),
    blockTimeUtc: new Date(Number(quantity(raw.timestamp)) * 1000).toISOString() };
}

const encode = (abi, functionName, args = []) => viem.encodeFunctionData({ abi, functionName, args });
const call = (rpc, tag, to, abi, functionName, args = [], from) =>
  rpc("eth_call", [{ to, data: encode(abi, functionName, args), ...(from && { from, value: "0x0" }) }, tag],
    (data) => viem.decodeFunctionResult({ abi, functionName, data }));

function plans() {
  const initializer = encodeSafeSetup(viem, owners, setup);
  return buildTreasurySafeInitializers(viem).proposals.map((proposal) => {
    assert.equal(viem.keccak256(initializer), proposal.initializerKeccak256);
    const data = encode(factoryAbi, "createProxyWithNonce", [singleton, initializer, BigInt(proposal.saltNonce)]);
    return { ...proposal, initializer, request: { to: factory, data, value: "0x0" } };
  });
}

export function summarizeGas({ total, l1, baseFee, l1BaseFee, estimateGas }) {
  assert.ok(total > 0n && l1 >= 0n && l1 <= total && baseFee > 0n && l1BaseFee >= 0n && estimateGas > 0n,
    "Invalid Nitro gas components");
  const l2 = total - l1;
  return {
    nitroGasEstimate: total.toString(), l2GasUnits: l2.toString(), l1PosterGasUnits: l1.toString(),
    l2BaseFeeWei: baseFee.toString(), l1BaseFeeEstimateWei: l1BaseFee.toString(),
    l2ExecutionWei: (l2 * baseFee).toString(), l1PosterWei: (l1 * baseFee).toString(),
    estimatedTotalWei: (total * baseFee).toString(), estimatedTotalEth: viem.formatEther(total * baseFee),
    rpcEstimateGas: estimateGas.toString(),
  };
}

function safeState(rows) {
  const [chain, latest, code, singletonResult, version, ownerResult, threshold, nonce, modules, fallback, guard] = rows.map(toValue);
  return chain === 4663n && latest &&
    code === "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c" &&
    singletonResult && viem.isAddressEqual(singletonResult, singleton) && version === "1.4.1" &&
    Array.isArray(ownerResult) && ownerResult.length === owners.length && owners.every((owner) =>
      ownerResult.some((item) => viem.isAddressEqual(item, owner))) && threshold === 2n && nonce === 0n &&
    Array.isArray(modules) && modules[0].length === 0 && viem.isAddressEqual(modules[1], sentinel) &&
    fallback?.toLowerCase() === viem.padHex(setup.fallbackHandler, { size: 32 }).toLowerCase() &&
    guard?.toLowerCase() === viem.zeroHash;
}

// Accept a direct creation only after the payer and one of the two frozen salts
// are separately approved. This verifier has no send or signature operation.
export async function verifySafeCreation({ reader, corroboratingReader, role, hash, approvedPayer }) {
  assert.ok(bytes32.test(hash) && BigInt(hash) > 0n && viem.isAddress(approvedPayer) && !viem.isAddressEqual(approvedPayer, viem.zeroAddress));
  const plan = plans().find((proposal) => proposal.role === role);
  assert.ok(plan, "Unknown Safe role");
  const [receiptResult, transactionResult] = await Promise.all([
    reader("eth_getTransactionReceipt", [hash]), reader("eth_getTransactionByHash", [hash]),
  ]);
  const receipt = toValue(receiptResult);
  const tx = toValue(transactionResult);
  const [receiptBlock, eventIndex] = validateSafeReceipt(plan, hash, approvedPayer, receipt, tx);
  const tag = receipt.blockNumber;
  const safe = plan.counterfactualAddress;
  const safeData = (name, args) => call(reader, tag, safe, safeAbi, name, args);
  const slot = (key) => BigInt(viem.keccak256(viem.stringToHex(key)));
  const rows = await Promise.all([
    reader("eth_chainId", [], quantity),
    reader("eth_getBlockByNumber", [tag, false], header),
    reader("eth_getCode", [safe, tag], viem.keccak256),
    safeData("masterCopy"), safeData("VERSION"), safeData("getOwners"), safeData("getThreshold"), safeData("nonce"),
    safeData("getModulesPaginated", [sentinel, 1n]),
    safeData("getStorageAt", [slot("fallback_manager.handler.address"), 1n]),
    safeData("getStorageAt", [slot("guard_manager.guard.address"), 1n]),
  ]);
  assert.ok(safeState(rows), "Safe configuration is incomplete or differs from the approved template");
  const canonical = toValue(rows[1]);
  const [peerChain, peerHeader, peerReceipt, post, pinReads] = await Promise.all([
    corroboratingReader("eth_chainId", [], quantity),
    corroboratingReader("eth_getBlockByNumber", [tag, false], header),
    corroboratingReader("eth_getTransactionReceipt", [hash]),
    reader("eth_getBlockByNumber", [tag, false], header),
    Promise.all(pins.map(({ address }) => reader("eth_getCode", [address, tag], viem.keccak256))),
  ]);
  assert.equal(toValue(peerChain), 4663n, "Corroborator has the wrong chain");
  const independentReceipt = toValue(peerReceipt);
  assert.equal(independentReceipt?.blockHash, receipt.blockHash, "Corroborator did not return the same receipt block");
  assert.deepEqual(validateSafeReceipt(plan, hash, approvedPayer, independentReceipt, tx), [receiptBlock, eventIndex]);
  assert.ok([canonical, toValue(peerHeader), toValue(post)].every((block) =>
    block?.hash === receipt.blockHash.toLowerCase() && block.number === receiptBlock), "Safe receipt block has not been corroborated or was reorged");
  assert.deepEqual(pinReads.map(toValue), pins.map(({ registryRuntimeKeccak256 }) => registryRuntimeKeccak256),
    "Identity of receipt-block Safe infrastructure is unverified");
  return { status: "L2_CREATION_VERIFIED", chainId: 4663, role, safe, hash, receiptBlock, blockHash: canonical.hash,
    logIndex: eventIndex, finality: "L1_UNVERIFIED", beneficiaryBinding: null, broadcastAuthorized: false };
}

function validateSafeReceipt(plan, hash, approvedPayer, receipt, tx) {
  assert.ok(receipt && tx, "Safe receipt or transaction unavailable");
  assert.equal(receipt.status, "0x1");
  assert.ok(receipt.contractAddress == null && bytes32.test(receipt.blockHash));
  const receiptBlock = quantity(receipt.blockNumber).toString();
  assert.ok([receipt.transactionHash, tx.hash].every((value) => value?.toLowerCase() === hash.toLowerCase()));
  assert.equal(tx.blockHash, receipt.blockHash);
  assert.equal(tx.blockNumber, receipt.blockNumber);
  assert.equal(quantity(tx.transactionIndex), quantity(receipt.transactionIndex));
  assert.equal(quantity(tx.chainId), 4663n);
  assert.ok([receipt.from, tx.from].every((value) => viem.isAddressEqual(value, approvedPayer)));
  assert.ok([receipt.to, tx.to].every((value) => viem.isAddressEqual(value, factory)));
  assert.equal(quantity(tx.value), 0n);
  assert.equal(tx.input, plan.request.data, "Safe initializer or salt differs from the reviewed request");
  assert.ok(Array.isArray(receipt.logs) && receipt.logs.length <= 50);
  const eventSignature = viem.toEventSelector("ProxyCreation(address,address)");
  const logs = receipt.logs.filter((log) => viem.isAddressEqual(log.address, factory) && log.topics?.[0] === eventSignature);
  assert.equal(logs.length, 1, "Expected one pinned-factory ProxyCreation event");
  const [log] = logs;
  assert.equal(log.removed, false);
  assert.equal(log.transactionHash, receipt.transactionHash);
  assert.equal(log.blockHash, receipt.blockHash);
  assert.equal(log.blockNumber, receipt.blockNumber);
  assert.equal(quantity(log.transactionIndex), quantity(receipt.transactionIndex));
  const { args } = viem.decodeEventLog({ abi: factoryAbi, eventName: "ProxyCreation", strict: true,
    data: log.data, topics: log.topics });
  assert.ok(viem.isAddressEqual(args.proxy, plan.counterfactualAddress) && viem.isAddressEqual(args.singleton, singleton));
  return [receiptBlock, quantity(log.logIndex).toString()];
}

export async function runSafeProbe({
  mobileSafePayer = false,
  operationsOnly = false,
  readers = Object.fromEntries(Object.entries(ROBINHOOD_SOURCES).map(([name, url]) => [name, makeReadOnlyRpc({ name, url }, { mobileSafePayer })])),
  now = Date.now,
} = {}) {
  const payer = mobileSafePayer === true ? MOBILE_DEPLOYMENT_PAYER : owners[0];
  const observedAt = new Date(now()).toISOString();
  const proposals = plans().filter(({ role }) => !operationsOnly || role === "RMT-OPERATIONS");
  const base = { observedAt, chainId: 4663, safeVersion: "SafeL2 1.4.1", owners, threshold: 2, factory, singleton,
    proposedGasPayer: payer, gasPayerAuthority: "READ_ONLY_ESTIMATION_ONLY", deployments: null, broadcastAuthorized: false };
  const endpoints = Object.entries(readers);
  const latest = await Promise.all(endpoints.map(async ([name, read]) => {
    const [chain, head] = await Promise.all([read("eth_chainId", [], quantity), read("eth_getBlockByNumber", ["latest", false], header)]);
    return { name, chain, head };
  }));
  const eligible = latest.filter(({ chain, head }) => toValue(chain) === 4663n && toValue(head));
  if (eligible.length < 2 || !eligible.some(({ name }) => name === "official")) {
    return { ...base, proposals, status: "UNVERIFIED", reason: "insufficient Robinhood providers", latest };
  }
  const height = eligible.map(({ head }) => BigInt(head.value.number)).reduce((a, b) => a < b ? a : b);
  const tag = viem.numberToHex(height);
  const witnesses = await Promise.all(eligible.map(async ({ name }) =>
    ({ name, header: await readers[name]("eth_getBlockByNumber", [tag, false], header) })));
  const anchor = toValue(witnesses.find(({ name }) => name === "official")?.header);
  const current = anchor && anchor.number === height.toString() &&
    Date.parse(anchor.blockTimeUtc) >= now() - 300_000 && Date.parse(anchor.blockTimeUtc) <= now() + 60_000;
  const matchingPeer = anchor && witnesses.some(({ name, header: result }) =>
    name !== "official" && toValue(result)?.hash === anchor.hash && toValue(result)?.number === anchor.number);
  if (!current || !matchingPeer || witnesses.some(({ header: result }) => toValue(result) && toValue(result).hash !== anchor.hash)) {
    return { ...base, proposals, status: "UNVERIFIED", reason: "unavailable, stale, or conflicting canonical block", witnesses };
  }
  const rpc = readers.official;
  const [runtimePins, creationCode, version] = await Promise.all([
    Promise.all(pins.map(async ({ address, registryRuntimeKeccak256: expected }) =>
      ({ address, expected, read: await rpc("eth_getCode", [address, tag], viem.keccak256) }))),
    call(rpc, tag, factory, factoryAbi, "proxyCreationCode"),
    call(rpc, tag, singleton, safeAbi, "VERSION"),
  ]);
  const proxyCreationCode = toValue(creationCode);
  const initcodeHash = proxyCreationCode ? viem.keccak256(viem.concatHex([proxyCreationCode, viem.padHex(singleton, { size: 32 })])) : null;
  const expectedInitcode = loadEvidence("rmt-task046/treasury-safe-initializers.json").initcodeKeccak256;
  if (!runtimePins.every(({ read, expected }) => toValue(read) === expected) || toValue(version) !== "1.4.1" || initcodeHash !== expectedInitcode) {
    return { ...base, proposals, status: "UNVERIFIED", reason: "Safe runtime or proxy initcode pin mismatch",
      anchor, witnesses, runtimePins, initcodeHash, version };
  }
  const estimates = [];
  for (const proposal of proposals) {
    const address = proposal.counterfactualAddress;
    const peers = witnesses.filter(({ name, header: result }) =>
      name !== "official" && toValue(result)?.hash === anchor.hash && toValue(result)?.number === anchor.number);
    const vacancy = (read) => Promise.all([read("eth_getCode", [address, tag]),
      read("eth_getTransactionCount", [address, tag], (value) => quantity(value).toString()),
      read("eth_getBalance", [address, tag], (value) => quantity(value).toString())]);
    const participants = ["official", ...(operationsOnly ? peers : peers.slice(0, 1)).map(({ name }) => name)];
    const vacancies = Object.fromEntries(await Promise.all(participants.map(async (name) => [name, await vacancy(readers[name])])));
    const officialVacancy = vacancies.official.map(toValue);
    const peerVacancies = participants.slice(1).map((name) => vacancies[name].map(toValue));
    const vacancyMatches = officialVacancy.every((value) => value !== undefined) &&
      peerVacancies.some((peer) => peer.every((value, i) => value === officialVacancy[i]));
    const contradictsVacancy = peerVacancies.some(([code, nonce]) =>
      (code !== undefined && code !== "0x") || (nonce !== undefined && nonce !== "0"));
    const vacant = vacancyMatches && !contradictsVacancy && officialVacancy[0] === "0x" && officialVacancy[1] === "0";
    const observation = { ...proposal, vacancy: { status: vacant ? "VACANT" : "UNVERIFIED_OR_OCCUPIED",
      ...vacancies }, gas: null };
    if (!vacant) { estimates.push(observation); continue; }
    const simulation = await call(rpc, tag, factory, factoryAbi, "createProxyWithNonce",
      [singleton, proposal.initializer, BigInt(proposal.saltNonce)], payer);
    const simulatedAddress = toValue(simulation);
    observation.simulation = simulation;
    if (!simulatedAddress || !viem.isAddressEqual(simulatedAddress, address)) {
      estimates.push(observation);
      continue;
    }
    const [estimate, components] = await Promise.all([
      rpc("eth_estimateGas", [{ ...proposal.request, from: payer }, tag], (value) => quantity(value).toString()),
      call(rpc, tag, nodeInterface, gasAbi, "gasEstimateComponents", [factory, false, proposal.request.data], payer)
        .then((row) => row.status === "observed" ? { ...row, value: row.value.map(String) } : row),
    ]);
    observation.estimateGas = estimate;
    observation.nitroComponents = components;
    if (toValue(estimate) && toValue(components)) {
      const [total, l1, baseFee, l1BaseFee] = components.value.map(BigInt);
      try {
        observation.gas = summarizeGas({ total, l1, baseFee, l1BaseFee, estimateGas: BigInt(estimate.value) });
      } catch { observation.gas = null; }
    }
    estimates.push(observation);
  }
  const post = await rpc("eth_getBlockByNumber", [tag, false], header);
  const anchorRechecked = toValue(post)?.hash === anchor.hash && toValue(post)?.number === anchor.number;
  const complete = anchorRechecked && estimates.every(({ gas }) => gas !== null);
  const totalWei = complete ? estimates.reduce((sum, { gas }) => sum + BigInt(gas.estimatedTotalWei), 0n) : null;
  return {
    ...base, status: complete ? "READ_ONLY_ESTIMATED" : "UNVERIFIED", anchor, witnesses, post, anchorRechecked, runtimePins,
    initcodeHash, proposals: estimates,
    combinedEstimatedWei: complete ? totalWei.toString() : null,
    combinedEstimatedEth: complete ? viem.formatEther(totalWei) : null,
  };
}
