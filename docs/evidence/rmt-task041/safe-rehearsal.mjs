import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Copied into the pinned #594 packages/contracts/scripts directory by the isolated rehearsal.
const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const {
  concatHex, decodeErrorResult, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, parseEventLogs,
  recoverAddress, zeroAddress,
} = requireWeb("viem");
const { generatePrivateKey, privateKeyToAccount } = requireWeb("viem/accounts");

const reviewedFork = {
  number: 114549452n,
  hash: "0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710",
};
const safePins = {
  singleton: ["0x29fcB43b46531BcA003ddC8FCB67FFE91900C762", "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff"],
  factory: ["0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67", "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317"],
  fallback: ["0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99", "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9"],
  proxyHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
};
const factoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);
const safeAbi = parseAbi([
  "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
  "function nonce() view returns (uint256)",
  "function masterCopy() view returns (address)",
  "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
]);
const sentinel = "0x0000000000000000000000000000000000000001";
const guardSlot = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const fallbackSlot = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5";
const same = (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const receiptProof = ({ transactionHash, blockHash, blockNumber, gasUsed }) => ({ transactionHash, blockHash, blockNumber, gasUsed });

function loopback(url) {
  const actual = new URL(url);
  assert.ok(actual.protocol === "http:" && actual.hostname === "127.0.0.1" && actual.port &&
    actual.pathname === "/" && !actual.username && !actual.password && !actual.search && !actual.hash,
  "Safe fixture requires direct IPv4 loopback");
  return actual.href;
}

async function matchRuntime(client, address, expected, blockNumber) {
  const code = await client.getCode({ address, blockNumber });
  assert.ok(code && code !== "0x" && keccak256(code) === expected, "Safe runtime mismatch at " + address);
}

function singleEvent(receipt, address, abi, eventName) {
  const events = parseEventLogs({ abi, eventName, logs: receipt.logs.filter(log => same(log.address, address)), strict: true });
  assert.equal(events.length, 1, "Unexpected " + eventName + " event count");
  return events[0];
}

async function traceTransaction(client, receipt, sender, to) {
  const trace = await client.request({ method: "debug_traceTransaction", params: [receipt.transactionHash, { tracer: "callTracer" }] });
  assert.ok(trace.type === "CALL" && same(trace.from, sender) && same(trace.to, to), "Safe trace root mismatch");
  assert.equal(BigInt(trace.value ?? 0), 0n, "Safe executor paid unexpected value");
  return trace;
}

function matchingCalls(trace, from, to) {
  if (trace.error) return [];
  const children = (trace.calls ?? []).flatMap(frame => matchingCalls(frame, from, to));
  return trace.type === "CALL" && same(trace.from, from) && same(trace.to, to) ? [trace, ...children] : children;
}

export async function setupFixtureSafe({ client, submit, sender, fixtureBlock = reviewedFork.number }) {
  loopback(client.transport.url);
  assert.equal(BigInt(fixtureBlock), reviewedFork.number, "Safe fixture fork head difference");
  assert.equal(client.chain.id, 4663);
  const [node, chainId, block, version] = await Promise.all([
    client.request({ method: "anvil_nodeInfo" }), client.getChainId(), client.getBlock({ blockNumber: reviewedFork.number }),
    client.request({ method: "web3_clientVersion" }),
  ]);
  assert.match(version, /^anvil\//i);
  assert.equal(chainId, 4663);
  assert.equal(block.hash, reviewedFork.hash, "Safe fixture block is unverified");
  assert.equal(BigInt(node.forkConfig.forkBlockNumber), reviewedFork.number);
  loopback(node.forkConfig.forkUrl);

  const [singleton, singletonHash] = safePins.singleton;
  const [factory, factoryHash] = safePins.factory;
  const [fallback, fallbackHash] = safePins.fallback;
  await Promise.all([
    matchRuntime(client, singleton, singletonHash, reviewedFork.number), matchRuntime(client, factory, factoryHash, reviewedFork.number),
    matchRuntime(client, fallback, fallbackHash, reviewedFork.number),
  ]);
  const owners = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()))
    .sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase()));
  const ownerAddresses = owners.map(owner => owner.address);
  assert.equal(new Set(ownerAddresses).size, 3);
  const args = [ownerAddresses, 2n, zeroAddress, "0x", fallback, zeroAddress, 0n, zeroAddress];
  const initializer = encodeFunctionData({ abi: safeAbi, functionName: "setup", args });
  const creation = encodeFunctionData({ abi: factoryAbi, functionName: "createProxyWithNonce", args: [singleton, initializer, 0n] });
  const setup = await submit(sender, { to: factory, data: creation });
  const deployment = singleEvent(setup, factory, factoryAbi, "ProxyCreation");
  assert.ok(same(deployment.args.singleton, singleton));
  const address = getAddress(deployment.args.proxy);
  const read = (functionName, args = []) => client.readContract({ address, abi: safeAbi, functionName, args });
  await matchRuntime(client, address, safePins.proxyHash);
  const [master, release, threshold, configuredOwners, [modules, next], guard, handler] = await Promise.all([
    read("masterCopy"), read("VERSION"), read("getThreshold"), read("getOwners"), read("getModulesPaginated", [sentinel, 1n]),
    client.getStorageAt({ address, slot: guardSlot }), client.getStorageAt({ address, slot: fallbackSlot }),
  ]);
  assert.ok(same(master, singleton) && release === "1.4.1" && threshold === 2n);
  assert.deepEqual(configuredOwners.map(a => a.toLowerCase()).sort(), ownerAddresses.map(a => a.toLowerCase()).sort());
  assert.deepEqual(modules, []);
  assert.ok(same(next, sentinel) && BigInt(guard) === 0n);
  assert.ok(same("0x" + handler.slice(-40), fallback));
  assert.equal(await read("nonce"), 0n);

  // Keep already used signatures private to this process, including the replay check.
  const sent = new WeakMap();
  async function prepare(call) {
    const { to, data = "0x", value = 0n } = call;
    assert.notEqual(to.toLowerCase(), address.toLowerCase(), "Fixture must leave Safe ownership and controls intact");
    const nonce = await read("nonce");
    const fields = [to, value, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress];
    const hash = await read("getTransactionHash", [...fields, nonce]);
    const signatures = [];
    for (const owner of owners.slice(0, 2)) {
      const signature = await owner.sign({ hash });
      assert.equal(signature.length, 132, "Safe EOA signature size");
      assert.ok(same(await recoverAddress({ hash, signature }), owner.address), "Fixture owner signature failed verification");
      signatures.push(signature);
    }
    return { to, data, value, nonce, hash, fields, signatures };
  }

  function encodeExecution(transaction, count = 2) {
    return encodeFunctionData({ abi: safeAbi, functionName: "execTransaction",
      args: [...transaction.fields, concatHex(transaction.signatures.slice(0, count))] });
  }

  async function reject(calldata, nonce, expectedReason) {
    const receipt = await submit(sender, { to: address, data: calldata }, "reverted");
    assert.equal(receipt.logs.length, 0);
    assert.equal(await read("nonce"), nonce);
    const failedTrace = await traceTransaction(client, receipt, sender, address);
    assert.ok(failedTrace.error);
    const reason = failedTrace.revertReason ?? (failedTrace.output?.startsWith("0x08c379a0")
      ? decodeErrorResult({ abi: [], data: failedTrace.output }).args[0] : null);
    assert.equal(reason, expectedReason);
    return { ...receiptProof(receipt), reason: expectedReason };
  }

  return {
    address,
    setup: { ...receiptProof(setup), proxy: address, singleton, fallback, factory, ownerAddresses, threshold,
      runtimeHash: safePins.proxyHash, proxyCreationLogIndex: deployment.logIndex },
    async execute(call) {
      const transaction = await prepare(call);
      const calldata = encodeExecution(transaction);
      const receipt = await submit(sender, { to: address, data: calldata });
      const event = singleEvent(receipt, address, safeAbi, "ExecutionSuccess");
      assert.equal(event.args.txHash, transaction.hash);
      assert.equal(event.args.payment, 0n);
      assert.equal(await read("nonce"), transaction.nonce + 1n);
      const trace = await traceTransaction(client, receipt, sender, address);
      const inner = matchingCalls(trace, address, transaction.to);
      assert.equal(inner.length, 1);
      assert.ok(same(inner[0].input, transaction.data) && BigInt(inner[0].value ?? 0) === transaction.value);
      const result = { receipt, nonce: transaction.nonce, safeTxHash: transaction.hash,
        attribution: { sender, beneficiary: address, target: transaction.to, executionLogIndex: event.logIndex,
          innerCallVerified: true } };
      sent.set(result, calldata);
      return result;
    },
    async rejectInsufficient(call) {
      const transaction = await prepare(call);
      return reject(encodeExecution(transaction, 1), transaction.nonce, "GS020");
    },
    async rejectReplay(execution) {
      const replay = sent.get(execution);
      assert.ok(replay && await read("nonce") === execution.nonce + 1n);
      return reject(replay, execution.nonce + 1n, "GS026");
    },
  };
}

export async function proveSafeSpending({ safe, client, token, spendingWallet, nativeAmount, tokenAmount }) {
  assert.ok(nativeAmount > 0n && tokenAmount > 0n && !same(safe.address, spendingWallet));
  const balances = () => Promise.all([
    client.getBalance({ address: safe.address }), client.getBalance({ address: spendingWallet }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [safe.address] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [spendingWallet] }),
  ]);
  const before = await balances();
  // Leave enough for a second call to establish that authorization, rather than an empty balance, blocks replay.
  assert.ok(before[0] >= 2n * nativeAmount && before[2] >= 2n * tokenAmount);
  const nativeCall = { to: spendingWallet, data: "0x", value: nativeAmount };
  const insufficient = await safe.rejectInsufficient(nativeCall);
  assert.deepEqual(await balances(), before);
  const native = await safe.execute(nativeCall);
  const replay = await safe.rejectReplay(native);
  assert.deepEqual(await balances(), [before[0] - nativeAmount, before[1] + nativeAmount, before[2], before[3]]);
  const tokenCall = { to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [spendingWallet, tokenAmount] }) };
  const asset = await safe.execute(tokenCall);
  const transfer = singleEvent(asset.receipt, token, erc20Abi, "Transfer");
  assert.ok(same(transfer.args.from, safe.address) && same(transfer.args.to, spendingWallet));
  assert.equal(transfer.args.value, tokenAmount);
  const after = await balances();
  assert.deepEqual(after, [before[0] - nativeAmount, before[1] + nativeAmount, before[2] - tokenAmount, before[3] + tokenAmount]);
  return {
    spendingWallet, nativeAmount, tokenAmount, before, after, insufficient, replay,
    native: { ...receiptProof(native.receipt), safeTxHash: native.safeTxHash, ...native.attribution },
    token: { ...receiptProof(asset.receipt), safeTxHash: asset.safeTxHash, ...asset.attribution, transferLogIndex: transfer.logIndex },
  };
}
