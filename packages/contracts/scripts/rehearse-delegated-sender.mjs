import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { encodeSafeSetup } from "../../../docs/evidence/rmt-task045/operations-safe-initializer.mjs";
import { buildTreasurySafeInitializers } from "../../../docs/evidence/rmt-task046/treasury-safe-initializers.mjs";
import { MOBILE_DEPLOYMENT_PAYER } from "../../../scripts/production-readiness/rpc.mjs";
import { reviewTransactionEvidence, sendFixture, transact } from "./deploy-fixed-supply-fixture.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const viem = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const { concatHex, decodeFunctionResult, encodeFunctionData, getContractAddress, isAddressEqual,
  keccak256, padHex, parseAbi, parseEventLogs, toHex, zeroAddress } = viem;
const readEvidence = (file) => JSON.parse(readFileSync(new URL("../../../docs/evidence/" + file, import.meta.url)));
const observed = readEvidence("mobile-signing/sender-observation-4663.json");
const { factory, singleton, owners, setup } = readEvidence("rmt-task045/operations-safe-policy.json").operations;
const delegate = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B";
const designator = "0xef0100" + delegate.slice(2).toLowerCase();
const delegateRuntimeHash = "0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0";
const proxyRuntimeHash = "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
const expectedBlock = 114549452n;
const expectedHash = "0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710";
const initialNonce = 473;
const funding = 100n * 10n ** 18n;
const factoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy,address singleton)",
]);
const safeAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function masterCopy() view returns (address)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)",
  "function nonce() view returns (uint256)",
  "function approveHash(bytes32 hashToApprove)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
]);
const fallbackSlot = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5";
const guardSlot = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const sentinel = "0x0000000000000000000000000000000000000001";

function assertLoopback(client) {
  const url = new URL(client.transport.url);
  assert.equal(url.href, "http://127.0.0.1:" + url.port + "/");
  assert.ok(url.port);
  assert.equal(client.chain.id, 4663);
}

async function assertDelegatedCode(client, sender, blockNumber) {
  assertLoopback(client);
  assert.equal(await client.getCode({ address: sender, blockNumber }), designator, "Delegation changed or revoked");
  const runtime = await client.getCode({ address: delegate, blockNumber });
  assert.ok(runtime && keccak256(runtime) === delegateRuntimeHash, "Delegated implementation changed");
}

async function syntheticFunds(client, account) {
  assertLoopback(client);
  await client.request({ method: "anvil_setBalance", params: [account, toHex(funding)] });
}

async function type2Envelope(client, sender) {
  await assertDelegatedCode(client, sender);
  const nonce = await client.getTransactionCount({ address: sender });
  assert.equal(await client.getTransactionCount({ address: sender, blockTag: "pending" }), nonce, "Pending nonce drift");
  const { baseFeePerGas } = await client.getBlock();
  assert.ok(baseFeePerGas > 0n);
  return { nonce, maxFeePerGas: baseFeePerGas * 2n, maxPriorityFeePerGas: 0n };
}

async function directReceipt(client, receipt, sender, request, envelope) {
  const tx = await client.getTransaction({ hash: receipt.transactionHash });
  assert.equal(tx.type, "eip1559");
  assert.equal(tx.chainId, 4663);
  assert.deepEqual(tx.accessList, []);
  assert.equal(tx.authorizationList, undefined);
  assert.ok(isAddressEqual(tx.from, sender));
  assert.equal(tx.to?.toLowerCase() ?? null, request.to?.toLowerCase() ?? null);
  assert.equal(tx.input, request.data);
  assert.equal(tx.value, request.value ?? 0n);
  assert.equal(tx.nonce, envelope.nonce);
  assert.equal(tx.maxFeePerGas, envelope.maxFeePerGas);
  assert.equal(tx.maxPriorityFeePerGas, envelope.maxPriorityFeePerGas);
  if (request.gas !== undefined) assert.equal(tx.gas, request.gas);
  assert.ok(receipt.gasUsed > 0n && receipt.gasUsed <= tx.gas);
  assert.ok(receipt.effectiveGasPrice > 0n && receipt.effectiveGasPrice <= tx.maxFeePerGas);
  assert.equal(receipt.type, "eip1559");
  assert.equal(receipt.to?.toLowerCase() ?? null, tx.to?.toLowerCase() ?? null);
  assert.equal(await client.getTransactionCount({ address: sender }), envelope.nonce + 1);
  await assertDelegatedCode(client, sender, receipt.blockNumber);
  if (request.to) assert.equal(receipt.contractAddress, null);
  if (!request.to && receipt.status === "success") {
    assert.ok(isAddressEqual(receipt.contractAddress, getContractAddress({ from: sender, nonce: BigInt(envelope.nonce) })));
  }
  return { ...(await reviewTransactionEvidence(client, receipt)), chainId: tx.chainId, type: tx.type,
    gas: tx.gas, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    effectiveGasPrice: receipt.effectiveGasPrice, accessList: tx.accessList, contractAddress: receipt.contractAddress };
}

async function signAndMineLocalType2(client, account, transaction, status) {
  assertLoopback(client);
  const envelope = await type2Envelope(client, account.address);
  const raw = await account.signTransaction({ ...envelope, type: "eip1559", chainId: 4663,
    ...(transaction.to && { to: transaction.to }), data: transaction.data, value: transaction.value ?? 0n, gas: transaction.gas });
  const hash = keccak256(raw);
  assert.equal(await client.request({ method: "eth_sendRawTransaction", params: [raw] }), hash);
  let receipt = await client.request({ method: "eth_getTransactionReceipt", params: [hash] });
  if (!receipt) {
    await client.request({ method: "evm_mine" });
    for (let i = 0; i < 30 && !receipt; i++) {
      await delay(200);
      receipt = await client.request({ method: "eth_getTransactionReceipt", params: [hash] });
    }
  }
  assert.ok(receipt, "Single raw fixture send did not produce a receipt");
  const canonical = await client.getTransactionReceipt({ hash });
  assert.equal(canonical.status, status);
  assert.equal((await client.getBlock({ blockNumber: canonical.blockNumber })).hash, canonical.blockHash);
  const proof = await directReceipt(client, canonical, account.address, transaction, envelope);
  return proof;
}

async function testSignedDelegatedEnvelope(client) {
  // These disposable fixture keys are never persisted or attributed to the real account.
  const account = privateKeyToAccount(generatePrivateKey());
  assert.notEqual(account.address.toLowerCase(), MOBILE_DEPLOYMENT_PAYER.toLowerCase());
  assert.equal(await client.getCode({ address: account.address }), undefined);
  await syntheticFunds(client, account.address);
  await client.request({ method: "anvil_setCode", params: [account.address, designator] });
  const created = await signAndMineLocalType2(client, account, { data: "0x6001600c60003960016000f300", gas: 90_000n }, "success");
  assert.equal(await client.getCode({ address: created.contractAddress }), "0x00");
  const failedAddress = getContractAddress({ from: account.address, nonce: BigInt(created.nonce) + 1n });
  const reverted = await signAndMineLocalType2(client, account, { data: "0x60006000fd", gas: 90_000n }, "reverted");
  assert.equal(await client.getCode({ address: failedAddress }), undefined);
  assert.equal(await client.getTransactionCount({ address: failedAddress }), 0);
  const nonceAfterRevert = await client.getTransactionCount({ address: account.address });
  const corruptDelegateView = { ...client, getCode: ({ address }) =>
    isAddressEqual(address, delegate) ? Promise.resolve("0x00") : client.getCode({ address }) };
  await assert.rejects(type2Envelope(corruptDelegateView, account.address), /Delegated implementation changed/);
  for (const changedCode of ["0x", "0xef0100" + "5a".repeat(20)]) {
    await client.request({ method: "anvil_setCode", params: [account.address, changedCode] });
    await assert.rejects(type2Envelope(client, account.address), /Delegation changed or revoked/);
    assert.equal(await client.getTransactionCount({ address: account.address }), nonceAfterRevert);
  }
  return { account: account.address, signedTopLevelType2: created, minedRevert: { ...reverted, codeAfter: "0x" },
    revertedDestination: failedAddress, stateRolledBack: true, revertingTransactionConsumedNonce: true,
    revokedRejected: true, changedDelegateRejected: true, changedRuntimeRejected: true, noDelegationMutationToProposedSender: true };
}

async function createPlatformSafes(client, submit) {
  for (const { address, hash } of observed.safes.runtimePins) {
    const code = await client.getCode({ address, blockNumber: expectedBlock });
    assert.ok(code && keccak256(code) === hash, "Pinned Safe dependency changed");
  }
  const initializer = encodeSafeSetup(viem, owners, setup);
  const safes = [];
  for (const proposal of buildTreasurySafeInitializers(viem).proposals) {
    const address = proposal.counterfactualAddress;
    assert.equal(await client.getCode({ address }), undefined, "Platform Safe address is already occupied");
    assert.equal(await client.getTransactionCount({ address }), 0, "Platform Safe address has a nonce");
    assert.equal(keccak256(initializer), proposal.initializerKeccak256);
    const request = transact(factory, factoryAbi, "createProxyWithNonce", [singleton, initializer, BigInt(proposal.saltNonce)]);
    const simulation = await client.call({ account: MOBILE_DEPLOYMENT_PAYER, ...request });
    const predicted = decodeFunctionResult({ abi: factoryAbi, functionName: "createProxyWithNonce", data: simulation.data });
    assert.ok(isAddressEqual(address, predicted));
    const receipt = await submit(client, MOBILE_DEPLOYMENT_PAYER, request);
    const [created] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyCreation",
      logs: receipt.logs.filter((log) => isAddressEqual(log.address, factory)), strict: true });
    assert.ok(created && isAddressEqual(created.args.proxy, address) && isAddressEqual(created.args.singleton, singleton));
    assert.equal(keccak256(await client.getCode({ address })), proxyRuntimeHash);
    const read = async (functionName, args = []) => client.readContract({ address, abi: safeAbi, functionName, args });
    assert.equal(await read("VERSION"), "1.4.1");
    assert.ok(isAddressEqual(await read("masterCopy"), singleton));
    assert.deepEqual((await read("getOwners")).map((owner) => owner.toLowerCase()), owners.map((owner) => owner.toLowerCase()));
    assert.equal(await read("getThreshold"), 2n);
    assert.deepEqual(await read("getModulesPaginated", [sentinel, 1n]), [[], sentinel]);
    assert.equal(BigInt(await client.getStorageAt({ address, slot: guardSlot }) ?? "0x0"), 0n);
    const handler = await client.getStorageAt({ address, slot: fallbackSlot });
    assert.ok(handler && isAddressEqual("0x" + handler.slice(-40), setup.fallbackHandler));
    assert.equal(await read("nonce"), 0n);
    safes.push({ role: proposal.role, address, owners, threshold: 2, version: "1.4.1", initializerHash: proposal.initializerKeccak256,
      saltNonce: proposal.saltNonce, create2Salt: proposal.create2Salt, runtimeHash: proxyRuntimeHash });
  }
  assert.equal(safes.length, 2);
  assert.notEqual(safes[0].address, safes[1].address);
  return safes;
}

export async function rehearseDelegatedSender(client, report, fixtureRelayer) {
  assertLoopback(client);
  assert.equal(await client.getChainId(), 4663);
  assert.equal(report.execution.hardfork, "prague");
  assert.equal(BigInt(report.network.blockNumber), expectedBlock);
  assert.equal((await client.getBlock({ blockNumber: expectedBlock })).hash, expectedHash);
  await assertDelegatedCode(client, MOBILE_DEPLOYMENT_PAYER, expectedBlock);
  const anchoredBalanceWei = await client.getBalance({ address: MOBILE_DEPLOYMENT_PAYER, blockNumber: expectedBlock });
  assert.equal(await client.getTransactionCount({ address: MOBILE_DEPLOYMENT_PAYER, blockNumber: expectedBlock }), initialNonce);
  const signedSmoke = await testSignedDelegatedEnvelope(client);
  await syntheticFunds(client, MOBILE_DEPLOYMENT_PAYER);
  await client.request({ method: "anvil_impersonateAccount", params: [MOBILE_DEPLOYMENT_PAYER] });
  let receipts = [];
  const submit = async (boundClient, from, request, expected = "success") => {
    assert.equal(boundClient, client, "Fixture client substitution");
    if (!isAddressEqual(from, MOBILE_DEPLOYMENT_PAYER)) return sendFixture(client, from, request, expected);
    assert.equal(request.type2, undefined, "Unsafe transaction envelope override");
    assert.equal(request.authorizationList, undefined, "New delegations are forbidden");
    const envelope = await type2Envelope(client, from);
    const receipt = await sendFixture(client, from, { ...request, type2: envelope }, expected);
    receipts.push(await directReceipt(client, receipt, from, request, envelope));
    return receipt;
  };
  assert.equal((await type2Envelope(client, MOBILE_DEPLOYMENT_PAYER)).nonce, initialNonce);
  await assert.rejects(submit(client, MOBILE_DEPLOYMENT_PAYER, { data: "0x", authorizationList: [] }),
    /New delegations are forbidden/);
  assert.equal(await client.getTransactionCount({ address: MOBILE_DEPLOYMENT_PAYER }), initialNonce);
  const safes = await createPlatformSafes(client, submit);
  for (const [index, safe] of safes.entries()) safe.receipt = receipts[index];
  const [operations, reserve] = safes.map(({ address }) => address);
  const checkpoint = await client.request({ method: "evm_snapshot" });
  const recoverSnapshot = async () => {
    assert.equal(await client.request({ method: "evm_revert", params: [checkpoint] }), true);
    assert.equal((await type2Envelope(client, MOBILE_DEPLOYMENT_PAYER)).nonce, initialNonce + 2);
    for (const address of [operations, reserve]) assert.equal(keccak256(await client.getCode({ address })), proxyRuntimeHash);
    receipts = receipts.slice(0, 2);
  };
  const exactClaims = async (address, request) => {
    assert.ok(safes.some((safe) => isAddressEqual(address, safe.address)));
    // Safe's approved-hash path tests exact platform recipients with locally impersonated public
    // owners. No private keys of the three observed owners are present in the rehearsal.
    const approving = owners.slice(0, 2).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const nonce = await client.readContract({ address, abi: safeAbi, functionName: "nonce" });
    const args = [request.to, request.value ?? 0n, request.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress];
    const digest = await client.readContract({ address, abi: safeAbi, functionName: "getTransactionHash", args: [...args, nonce] });
    for (const approver of approving) {
      assert.equal(await client.getCode({ address: approver }), undefined);
      await syntheticFunds(client, approver);
      await client.request({ method: "anvil_impersonateAccount", params: [approver] });
      await sendFixture(client, approver, transact(address, safeAbi, "approveHash", [digest]));
    }
    const signatures = concatHex(approving.map((owner) => concatHex([padHex(owner, { size: 32 }), toHex(0, { size: 32 }), "0x01"])));
    const receipt = await sendFixture(client, fixtureRelayer, transact(address, safeAbi, "execTransaction", [...args, signatures]));
    const [execution] = parseEventLogs({ abi: safeAbi, eventName: "ExecutionSuccess",
      logs: receipt.logs.filter((log) => isAddressEqual(log.address, address)), strict: true });
    assert.equal(execution?.args.txHash, digest);
    return receipt;
  };
  return {
    sender: MOBILE_DEPLOYMENT_PAYER, operations, reserve, governors: owners, safes, submit, recoverSnapshot, exactClaims,
    receipts: () => [...receipts],
    evidence: { status: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false, scope: "LOOPBACK_FIXTURE_ONLY",
      sender: MOBILE_DEPLOYMENT_PAYER, initialNonce, anchoredBalanceWei, delegate, designator, delegateRuntimeHash,
      signedSmoke, platformSafes: safes, ownerKeyControl: "UNVERIFIED", rejectedAuthorizationList: true,
      platformClaimAuthorization: "SAFE_APPROVED_HASHES_WITH_SYNTHETICALLY_IMPERSONATED_EXISTING_OWNERS" },
  };
}
