import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { withAnvilFork, withRobinhood4663Fork } from "./robinhood-4663-fork-environment.mjs";

const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const {
  createPublicClient, defineChain, encodeAbiParameters, encodeDeployData, encodeFunctionData, erc20Abi,
  getContractAddress, getCreate2Address, http, keccak256, parseAbi, parseEventLogs, parseEther, toHex,
  toFunctionSelector, zeroAddress,
} = requireWeb("viem");
const keyTuple = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const [keyParam] = parseAbi(["function poolKey(" + keyTuple + " key)"])[0].inputs;
const [swapParam] = parseAbi(["function exactInput((" + keyTuple
  + " poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) params)"])[0].inputs;
const managerAbi = parseAbi([
  "function initialize(" + keyTuple + " key,uint160 sqrtPriceX96) returns (int24)",
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);
const positionAbi = parseAbi([
  "function nextTokenId() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns (" + keyTuple + " poolKey,uint256 info)",
  "function transferFrom(address from,address to,uint256 tokenId)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);
const stateAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const quoterAbi = parseAbi(["function quoteExactInputSingle((" + keyTuple
  + " poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const permitAbi = parseAbi([
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
]);

const poolKeyFor = (token, guard) => ({ currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: guard });
const poolIdFor = (key) => keccak256(encodeAbiParameters([keyParam], [key]));
const sameAddress = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const assertAddress = (actual, expected, label) => assert.ok(sameAddress(actual, expected),
  label + ": expected " + expected + ", got " + actual);
const selector = (name) => toFunctionSelector(name + "()");
const receiptInfo = ({ transactionHash, blockNumber, blockHash, gasUsed }) => ({ hash: transactionHash, blockNumber, blockHash, gasUsed });
const gasCost = (receipt) => receipt.effectiveGasPrice * receipt.gasUsed;
const codeAt = async (client, address) => await client.getCode({ address }) ?? "0x";
const rpc = (client, method, params = []) => client.request({ method, params });

function createLocalClient(rpcUrl, chainId) {
  const url = new URL(rpcUrl);
  assert.ok(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port
    && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash,
  "The review lifecycle only accepts private IPv4 loopback.");
  const chain = defineChain({ id: chainId, name: "Local Robinhood review fork",
    nativeCurrency: { name: "Fork ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url.href] } } });
  return createPublicClient({ chain, transport: http(url.href, { retryCount: 0, timeout: 45_000 }), cacheTime: 0 });
}

async function send(client, { from, to, data, value = 0n, gas = 4_000_000n }, expected = "success") {
  const hash = await rpc(client, "eth_sendTransaction", [{ from, ...(to && { to }), data, value: toHex(value), gas: toHex(gas) }]);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 100 });
  assert.equal(receipt.status, expected, "Unexpected local receipt status " + hash);
  const [tx, block] = await Promise.all([client.getTransaction({ hash }), client.getBlock({ blockNumber: receipt.blockNumber })]);
  assert.equal(tx.hash, hash);
  assert.equal(tx.chainId, client.chain.id);
  assertAddress(tx.from, from, "Transaction sender");
  assertAddress(receipt.from, from, "Receipt sender");
  assert.ok(to ? sameAddress(tx.to, to) && sameAddress(receipt.to, to) : tx.to === null && receipt.to === null);
  assert.equal(tx.value, value);
  assert.equal(tx.input, data);
  assert.equal(tx.blockNumber, receipt.blockNumber);
  assert.equal(tx.blockHash, receipt.blockHash);
  assert.equal(block.hash, receipt.blockHash);
  return receipt;
}

function oneEvent(receipt, address, abi, eventName) {
  const logs = parseEventLogs({ abi, eventName, logs: receipt.logs.filter((log) => sameAddress(log.address, address)) });
  assert.equal(logs.length, 1, "Expected one " + eventName + " in " + receipt.transactionHash);
  return logs[0].args;
}

async function callTrace(client, receipt) {
  const result = await rpc(client, "debug_traceTransaction", [receipt.transactionHash, { tracer: "callTracer" }]);
  assert.ok(result?.type, "Missing call trace for " + receipt.transactionHash);
  return result;
}

const flatten = (call) => [call, ...(call.calls ?? []).flatMap(flatten)];

function nativeTransfers(call, from, to, amount) {
  assert.ok(!call.error, "A failed trace cannot prove settlement.");
  const successfulCalls = (frame) => frame.error ? [] : [frame, ...(frame.calls ?? []).flatMap(successfulCalls)];
  const payments = successfulCalls(call).filter((frame) => frame.type === "CALL" && sameAddress(frame.from, from)
    && sameAddress(frame.to, to) && BigInt(frame.value ?? "0x0") > 0n);
  assert.equal(payments.reduce((sum, frame) => sum + BigInt(frame.value), 0n), amount, "Native trace payment");
  return payments.map(({ from, to, value, type }) => ({ from, to, value, type }));
}

async function expectRevert(client, call, errorName, allowEmpty = false) {
  const { value = 0n, ...request } = call;
  try {
    await rpc(client, "eth_call", [{ ...request, value: toHex(value) }, "latest"]);
  } catch (error) {
    for (let detail = error; detail; detail = detail.cause) {
      const data = typeof detail.data === "string" ? detail.data : detail.data?.data;
      if (allowEmpty && data === "0x" && detail.code === 3) {
        return { code: detail.code, message: detail.details ?? detail.message, data };
      }
      if (!data || !/^0x[0-9a-f]+$/i.test(data)) continue;
      if (errorName) {
        const expectedSelector = toFunctionSelector(errorName.includes("(") ? errorName : errorName + "()");
        assert.ok(data.startsWith(expectedSelector), "Expected " + errorName + ", got " + data);
      }
      return data;
    }
    throw error;
  }
  assert.fail("Expected " + (errorName ?? "contract") + " revert.");
}

const sha256 = (hex) => createHash("sha256").update(Buffer.from(hex.slice(2), "hex")).digest("hex");
function verifyTemplate(runtime, artifact, manifest) {
  const bytes = Buffer.from(runtime.slice(2), "hex");
  for (const references of Object.values(manifest.runtimeTemplate.immutableReferences)) {
    for (const { start, length } of references) bytes.fill(0, start, start + length);
  }
  assert.equal(sha256("0x" + bytes.toString("hex")), manifest.runtimeTemplate.sha256);
  assert.equal(sha256(artifact.creationBytecode), manifest.creation.sha256);
  return keccak256(runtime);
}

export async function runWrongChainCheck({ rpcUrl, report, accounts, artifacts }) {
  const client = createLocalClient(rpcUrl, 31337);
  assert.equal(await client.getChainId(), 31337);
  assert.equal((await client.getBlock({ blockNumber: BigInt(report.network.blockNumber) })).hash, report.network.blockHash);
  const [from] = accounts;
  const { abi, creationBytecode } = artifacts.RMTV4LaunchDeploymentV2;
  const blank = toHex(0, { size: 32 });
  const data = encodeDeployData({ abi, bytecode: creationBytecode,
    args: [zeroAddress, zeroAddress, zeroAddress, blank, blank, blank, blank] });
  const revertData = await expectRevert(client, { from, data }, "WrongChain");
  const nonce = await client.getTransactionCount({ address: from });
  const predicted = getContractAddress({ from, nonce: BigInt(nonce) });
  const receipt = await send(client, { from, data }, "reverted");
  // Anvil may report the predicted CREATE address even when its constructor reverts.
  assert.ok(receipt.contractAddress === null || sameAddress(receipt.contractAddress, predicted));
  assert.equal(await codeAt(client, predicted), "0x");
  assert.equal(receipt.logs.length, 0);
  return { chainId: 31337, revertData, predicted, codeAbsent: true, ...receiptInfo(receipt) };
}

export async function runGuardedV2ForkLifecycle({ rpcUrl, report, accounts, artifacts, manifest, onLaunch }) {
  const client = createLocalClient(rpcUrl, 4663);
  assert.equal(await client.getChainId(), 4663);
  assert.equal((await client.getBlock({ blockNumber: BigInt(report.network.blockNumber) })).hash, report.network.blockHash);
  assert.equal(Number((await rpc(client, "anvil_nodeInfo")).forkConfig.forkBlockNumber), Number(report.network.blockNumber));
  const { poolManager, positionManager, permit2: permit, quoter: quote, stateView: state, universalRouter } = report.network.contracts;
  const manager = poolManager.address;
  const positions = positionManager.address;
  const permit2 = permit.address;
  const quoter = quote.address;
  const stateView = state.address;
  const router = universalRouter.address;
  const deployed = artifacts.RMTV4LaunchDeploymentV2;
  const hook = artifacts.RMTV4InitializationGuard;
  const engine = artifacts.RMTV4LaunchFactoryV2;
  const tokenArtifact = artifacts.RMTV4LaunchTokenV1;
  const expected = (manifest ?? report.build.manifest).review.artifacts;
  const [operator, creator, buyer, treasury, reserve, stranger] = accounts;
  assert.equal(new Set([operator, creator, buyer, treasury, reserve, stranger]).size, 6);
  assert.ok([operator, creator, buyer, treasury, reserve, stranger].every(Boolean));

  const nonce = await client.getTransactionCount({ address: operator });
  const deploymentAddress = getContractAddress({ from: operator, nonce: BigInt(nonce) });
  const factory = getContractAddress({ from: deploymentAddress, nonce: 2n });
  const guardInitCodeHash = keccak256(encodeDeployData({
    abi: hook.abi, bytecode: hook.creationBytecode, args: [manager, factory],
  }));
  const guardFor = (salt) => getCreate2Address({ from: deploymentAddress, salt, bytecodeHash: guardInitCodeHash });
  let salt;
  let guard;
  for (let index = 0; index < 1_048_576; index++) {
    const candidate = toHex(index, { size: 32 });
    const predicted = guardFor(candidate);
    if ((BigInt(predicted) & 0x3fffn) === 0x2000n) {
      salt = candidate;
      guard = predicted;
      break;
    }
  }
  assert.ok(salt && guard, "Guard salt search exhausted.");
  assert.equal(await codeAt(client, guard), "0x");
  let wrongSalt = BigInt(salt) + 1n;
  while ((BigInt(guardFor(toHex(wrongSalt, { size: 32 }))) & 0x3fffn) === 0x2000n) wrongSalt++;
  const deploymentArgs = [manager, positions, permit2, poolManager.runtimeHash, positionManager.runtimeHash, permit.runtimeHash, salt];
  const deploymentData = (args) => encodeDeployData({ abi: deployed.abi, bytecode: deployed.creationBytecode, args });
  const wrongSaltRevert = await expectRevert(client, { from: operator,
    data: deploymentData([...deploymentArgs.slice(0, -1), toHex(wrongSalt, { size: 32 })]) }, "InvalidGuardAddress");
  const wrongManagerHash = await expectRevert(client, { from: operator, data: deploymentData([
    manager, positions, permit2, quote.runtimeHash, positionManager.runtimeHash, permit.runtimeHash, salt,
  ]) }, "RuntimeIdentityMismatch");

  const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
  const call = (to, abi, functionName, args, from, value = 0n) => ({ to, from, value,
    data: encodeFunctionData({ abi, functionName, args }) });
  const factoryRead = (name, args = []) => read(factory, engine.abi, name, args);
  const tokenRead = (address, name, args = []) => read(address, tokenArtifact.abi, name, args);
  const positionRead = (name, args = []) => read(positions, positionAbi, name, args);
  const slot = (id) => read(stateView, stateAbi, "getSlot0", [id]);
  const initialize = (key, price) => call(manager, managerAbi, "initialize", [key, price], stranger);
  const policy = { treasury, reserve, creatorBps: 7000, treasuryBps: 2000, reserveBps: 1000 };
  const baseTerms = { name: "Robinhood Fork Review", symbol: "RMT4663", projectURI: "",
    intentId: toHex(1, { size: 32 }), supplyPreset: 0, poolAllocationBps: 8000, nativeAmount: parseEther("1"),
    deadline: (await client.getBlock()).timestamp + 1200n };
  const totalSupplyExpected = parseEther("1000000");
  const predictToken = (terms) => getCreate2Address({
    from: factory,
    salt: keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [creator, terms.intentId])),
    bytecodeHash: keccak256(encodeDeployData({ abi: tokenArtifact.abi, bytecode: tokenArtifact.creationBytecode,
      args: [terms.name, terms.symbol, terms.projectURI, totalSupplyExpected] })),
  });
  const token = predictToken(baseTerms);
  const poolKey = poolKeyFor(token, guard);
  const poolId = poolIdFor(poolKey);
  const alternateKey = poolKeyFor(token, zeroAddress);
  const alternatePoolId = poolIdFor(alternateKey);
  assert.notEqual(poolId, alternatePoolId);
  assert.equal(await codeAt(client, token), "0x");
  const beforeGuard = initialize(poolKey, 1n << 96n);
  const missingHookRevert = await expectRevert(client, beforeGuard, "InvalidHookResponse");
  const initBefore = await send(client, beforeGuard, "reverted");
  assert.equal((await slot(poolId))[0], 0n);
  const deployment = await send(client, { from: operator, data: deploymentData(deploymentArgs), gas: 12_000_000n });
  assertAddress(deployment.contractAddress, deploymentAddress, "Predicted deployer");
  assertAddress(await read(deploymentAddress, deployed.abi, "factory"), factory, "Predicted factory");
  assertAddress(await read(deploymentAddress, deployed.abi, "initializationGuard"), guard, "Predicted guard");
  assertAddress(await factoryRead("initializationGuard"), guard, "Factory guard");
  assertAddress(await factoryRead("poolManager"), manager, "Factory manager");
  assertAddress(await factoryRead("positionManager"), positions, "Factory position manager");
  assertAddress(await factoryRead("permit2"), permit2, "Factory Permit2");
  assertAddress(await read(guard, hook.abi, "factory"), factory, "Guard factory");
  assertAddress(await read(guard, hook.abi, "poolManager"), manager, "Guard manager");
  assert.equal(await factoryRead("CHAIN_ID"), 4663n);
  const permissions = await read(guard, hook.abi, "getHookPermissions");
  assert.ok(permissions.beforeInitialize && Object.values(permissions).filter(Boolean).length === 1);
  const deploymentRuntimeHash = verifyTemplate(await codeAt(client, deploymentAddress), deployed, expected.RMTV4LaunchDeploymentV2);
  const factoryRuntimeHash = verifyTemplate(await codeAt(client, factory), engine, expected.RMTV4LaunchFactoryV2);
  const guardRuntimeHash = verifyTemplate(await codeAt(client, guard), hook, expected.RMTV4InitializationGuard);

  const guardCall = (sender, key, from) => call(guard, hook.abi, "beforeInitialize", [sender, key, 1n], from);
  const wrongManager = await expectRevert(client, guardCall(factory, poolKey, stranger), "UnexpectedManager");
  const wrongInitializer = await expectRevert(client, guardCall(stranger, poolKey, manager), "UnexpectedInitializer");
  const wrongPool = await expectRevert(client, guardCall(factory, alternateKey, manager), "UnexpectedPoolKey");
  const preview = (terms) => factoryRead("preview", [terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount]);
  const [, , price] = await preview(baseTerms);
  const hostile = initialize(poolKey, price / 2n);
  const hostileRevert = await expectRevert(client, hostile);
  assert.ok(hostileRevert.includes(selector("UnexpectedInitializer").slice(2)));
  const initAfter = await send(client, hostile, "reverted");
  const alternate = await send(client, initialize(alternateKey, price / 2n));
  assert.equal(oneEvent(alternate, manager, managerAbi, "Initialize").id, alternatePoolId);
  assert.equal((await slot(poolId))[0], 0n);
  assert.equal((await slot(alternatePoolId))[0], price / 2n);

  const launchCall = (terms, feePolicy = policy) => call(factory, engine.abi, "launchWithLongevity",
    [terms, feePolicy], creator, terms.nativeAmount);
  const badPolicy = await expectRevert(client, launchCall(baseTerms, { ...policy, treasury: reserve }), "InvalidFeePolicy");
  const allowanceAt = (owner, tokenAddress, spender) => read(permit2, permitAbi, "allowance", [owner, tokenAddress, spender]);
  const balanceAt = (address) => client.getBalance({ address });
  const nextPosition = await positionRead("nextTokenId");
  const managerBefore = await balanceAt(manager);
  const originalCall = launchCall(baseTerms);
  const estimate = await client.estimateGas({ account: creator, to: factory, data: originalCall.data, value: originalCall.value });
  let fundingInterruption;
  for (const percent of [95n, 90n, 85n, 80n, 75n, 70n, 65n, 60n]) {
    const gas = estimate * percent / 100n;
    const snapshot = await rpc(client, "evm_snapshot");
    const hash = await rpc(client, "eth_sendTransaction", [{ from: creator, to: factory, data: originalCall.data,
      value: toHex(originalCall.value), gas: toHex(gas) }]);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 100 });
    if (receipt.status === "reverted") {
      const calls = flatten(await callTrace(client, receipt));
      const initialized = calls.find((frame) => sameAddress(frame.to, manager)
        && frame.input?.startsWith(toFunctionSelector(managerAbi[0])) && !frame.error);
      const funding = calls.find((frame) => sameAddress(frame.to, positions)
        && frame.input?.startsWith(toFunctionSelector("modifyLiquidities(bytes,uint256)")) && frame.error);
      if (initialized && funding) {
        assert.equal(receipt.logs.length, 0);
        fundingInterruption = { ...receiptInfo(receipt), gas, receiptStatus: receipt.status,
          initialization: { to: initialized.to, selector: initialized.input.slice(0, 10) },
          funding: { to: funding.to, selector: funding.input.slice(0, 10), error: funding.error } };
        break;
      }
    }
    assert.equal(await rpc(client, "evm_revert", [snapshot]), true);
  }
  assert.ok(fundingInterruption, "No gas-constrained transaction reached and interrupted official position funding.");
  assert.equal(await codeAt(client, token), "0x");
  assertAddress(await factoryRead("launches", [creator, baseTerms.intentId]), zeroAddress, "Rolled-back intent");
  assertAddress((await factoryRead("positions", [token]))[0], zeroAddress, "Rolled-back position");
  assertAddress((await factoryRead("feePolicy", [token]))[0], zeroAddress, "Rolled-back fee commitment");
  assert.equal(await positionRead("nextTokenId"), nextPosition);
  assert.equal(await balanceAt(manager), managerBefore);
  assert.equal((await slot(poolId))[0], 0n);
  assert.deepEqual(await allowanceAt(factory, token, positions), [0n, 0, 0]);

  async function launch(terms) {
    const predicted = predictToken(terms);
    const key = poolKeyFor(predicted, guard);
    const id = poolIdFor(key);
    const [totalSupply, tokenMaximum, sqrtPriceX96, liquidity, nativeAmount, tokenAmount] = await preview(terms);
    assert.equal(totalSupply, totalSupplyExpected);
    assert.equal(tokenMaximum, totalSupply * BigInt(terms.poolAllocationBps) / 10_000n);
    const positionId = await positionRead("nextTokenId");
    const [managerBalance, creatorBalance] = await Promise.all([balanceAt(manager), balanceAt(creator)]);
    const receipt = await send(client, launchCall(terms));
    const created = oneEvent(receipt, factory, engine.abi, "LaunchCreated");
    const initialized = oneEvent(receipt, manager, managerAbi, "Initialize");
    const minted = oneEvent(receipt, positions, positionAbi, "Transfer");
    assertAddress(created.creator, creator, "Launch creator");
    assertAddress(created.token, predicted, "Predicted token");
    assert.equal(created.poolId, id);
    assert.equal(created.intentId, terms.intentId);
    assert.equal(created.positionTokenId, positionId);
    assert.equal(poolIdFor(created.poolKey), id);
    assert.equal(created.sqrtPriceX96, sqrtPriceX96);
    assert.equal(created.liquidity, liquidity);
    assert.equal(created.tickLower, -887220);
    assert.equal(created.tickUpper, 887220);
    assert.equal(created.amount0, nativeAmount);
    assert.equal(created.amount1, tokenAmount);
    assert.equal(created.totalSupply, totalSupply);
    assert.equal(initialized.id, id);
    assert.equal(poolIdFor(initialized), id);
    assert.equal(initialized.sqrtPriceX96, sqrtPriceX96);
    assertAddress(minted.to, factory, "LP recipient");
    assertAddress(minted.from, zeroAddress, "LP mint");
    assert.equal(minted.tokenId, positionId);
    assert.equal(await tokenRead(predicted, "totalSupply"), totalSupply);
    assert.equal(await tokenRead(predicted, "balanceOf", [manager]), tokenAmount);
    assert.equal(await tokenRead(predicted, "balanceOf", [creator]), totalSupply - tokenAmount);
    assert.equal(await tokenRead(predicted, "balanceOf", [factory]), 0n);
    assert.equal(await tokenRead(predicted, "allowance", [factory, permit2]), 0n);
    assert.equal((await allowanceAt(factory, predicted, positions))[0], 0n);
    assert.equal(await balanceAt(manager) - managerBalance, nativeAmount);
    assert.equal(creatorBalance - await balanceAt(creator) - gasCost(receipt), nativeAmount);
    assertAddress(await factoryRead("launches", [creator, terms.intentId]), predicted, "Launch intent");
    assertAddress(await positionRead("ownerOf", [positionId]), factory, "LP custody");
    assert.equal(await positionRead("getPositionLiquidity", [positionId]), liquidity);
    assert.equal(poolIdFor((await positionRead("getPoolAndPositionInfo", [positionId]))[0]), id);
    assert.equal(await read(stateView, stateAbi, "getLiquidity", [id]), liquidity);
    const [priceOnchain, , protocolFee, lpFee] = await slot(id);
    assert.equal(priceOnchain, sqrtPriceX96);
    assert.equal(lpFee, key.fee);
    const refund = terms.nativeAmount - nativeAmount;
    const refundTransfers = nativeTransfers(await callTrace(client, receipt), factory, creator, refund);
    const runtimeHash = verifyTemplate(await codeAt(client, predicted), tokenArtifact, expected.RMTV4LaunchTokenV1);
    return { token: predicted, poolKey: key, poolId: id, launch: { ...receiptInfo(receipt), creator,
      intentId: terms.intentId, positionId, liquidity, totalSupply, tokenMaximum, nativeAmount, tokenAmount,
      creatorAllocation: totalSupply - tokenAmount, refund, refundTransfers, runtimeHash, protocolFee, lpFee } };
  }

  const launched = await launch(baseTerms);
  console.error("Loopback launch confirmed: " + launched.launch.hash + " pool=" + launched.poolId
    + " refundWei=" + launched.launch.refund + " fundingRollback=" + fundingInterruption.hash);
  assertAddress(launched.token, token, "Retry token");
  assert.ok(launched.launch.refund > 0n, "The primary fixture must exercise an actual refund.");
  assert.equal(await balanceAt(factory), 0n);
  assert.equal((await slot(alternatePoolId))[0], price / 2n);
  const duplicateIntent = await expectRevert(client, launchCall(baseTerms, { ...policy, creatorBps: 6000, treasuryBps: 3000 }), "DuplicateIntent");
  const fixedPolicy = await factoryRead("feePolicy", [token]);
  assert.deepEqual(fixedPolicy.map((value) => typeof value === "string" ? value.toLowerCase() : value),
    [creator.toLowerCase(), treasury.toLowerCase(), reserve.toLowerCase(), 7000, 2000, 1000]);
  const policyLog = oneEvent(await client.getTransactionReceipt({ hash: launched.launch.hash }), factory, engine.abi,
    "LongevityPolicyCommitted");
  assertAddress(policyLog.treasury, treasury, "Committed treasury");
  assertAddress(policyLog.reserve, reserve, "Committed reserve");
  assert.deepEqual([policyLog.creatorBps, policyLog.treasuryBps, policyLog.reserveBps], [7000, 2000, 1000]);

function swapData(key, buy, amountIn, minimumOut, deadline, minHopPriceX36 = minimumOut * 10n ** 36n / amountIn) {
    const [currencyIn, currencyOut] = buy ? [key.currency0, key.currency1] : [key.currency1, key.currency0];
    const swap = encodeAbiParameters([swapParam], [{ poolKey: key, zeroForOne: buy, amountIn,
      amountOutMinimum: minimumOut, minHopPriceX36, hookData: "0x" }]);
    const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [currencyIn, amountIn, true]);
    const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyOut, minimumOut]);
    const actions = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060b0f", [swap, settle, take]]);
    return encodeFunctionData({ abi: routerAbi, functionName: "execute", args: ["0x10", [actions], deadline] });
  }

  async function swap(buy, amountIn) {
    const { result: [quoteAmount] } = await client.simulateContract({ account: buyer, address: quoter, abi: quoterAbi,
      functionName: "quoteExactInputSingle", args: [{ poolKey, zeroForOne: buy, exactAmount: amountIn, hookData: "0x" }] });
    const minimumOut = quoteAmount * 99n / 100n;
    assert.ok(minimumOut > 0n && minimumOut * 10n ** 36n / amountIn > 0n);
    const reviewedBlock = await client.getBlock();
    const deadline = reviewedBlock.timestamp + 300n;
    const value = buy ? amountIn : 0n;
    const calldata = swapData(poolKey, buy, amountIn, minimumOut, deadline);
    const request = { from: buyer, to: router, value };
    const expired = await expectRevert(client, { ...request,
      data: swapData(poolKey, buy, amountIn, minimumOut, reviewedBlock.timestamp - 1n) }, "TransactionDeadlinePassed");
    const highMinimum = await expectRevert(client, { ...request,
      data: swapData(poolKey, buy, amountIn, quoteAmount + 1n, deadline, 1n) }, "V4TooLittleReceived(uint256,uint256)");
    const highHopFloor = await expectRevert(client, { ...request,
      data: swapData(poolKey, buy, amountIn, minimumOut, deadline, quoteAmount * 10n ** 36n / amountIn + 1n) },
    "V4TooLittleReceivedPerHopSingle(uint256,uint256)");
    const wrongKey = await expectRevert(client, { ...request,
      data: swapData({ ...poolKey, tickSpacing: 120 }, buy, amountIn, minimumOut, deadline) }, "PoolNotInitialized");
    const shortNative = buy ? await expectRevert(client, { ...request, data: calldata, value: amountIn - 1n }, undefined, true) : undefined;
    const simulation = await rpc(client, "eth_call", [{ ...request, data: calldata, value: toHex(value) }, "latest"]);
    assert.equal(simulation, "0x");
    const [beforeToken, beforeNative] = await Promise.all([tokenRead(token, "balanceOf", [buyer]), balanceAt(buyer)]);
    const receipt = await send(client, { ...request, data: calldata });
    const swapped = oneEvent(receipt, manager, managerAbi, "Swap");
    assertAddress(swapped.sender, router, "Swap sender");
    assert.equal(swapped.id, poolId);
    const actualInput = buy ? -swapped.amount0 : -swapped.amount1;
    const amountOut = buy ? swapped.amount1 : swapped.amount0;
    assert.equal(actualInput, amountIn);
    assert.equal(amountOut, quoteAmount);
    assert.ok(amountOut >= minimumOut);
    const transfer = oneEvent(receipt, token, erc20Abi, "Transfer");
    assertAddress(transfer.from, buy ? manager : buyer, "Token settlement source");
    assertAddress(transfer.to, buy ? buyer : manager, "Token settlement recipient");
    assert.equal(transfer.value, buy ? amountOut : amountIn);
    assert.equal(await tokenRead(token, "balanceOf", [buyer]) - beforeToken, buy ? amountOut : -amountIn);
    assert.equal(await balanceAt(buyer) - beforeNative + gasCost(receipt), buy ? -amountIn : amountOut);
    const nativePayments = nativeTransfers(await callTrace(client, receipt), buy ? router : manager,
      buy ? manager : buyer, buy ? amountIn : amountOut);
    return { ...receiptInfo(receipt), account: buyer, recipient: buyer, amountIn, minimumOut, amountOut,
      deadline: Number(deadline), calldata, value, reviewedBlockNumber: reviewedBlock.number, reviewedBlockHash: reviewedBlock.hash,
      nativeTransfers: nativePayments, negativeReverts: { expired, highMinimum, highHopFloor, wrongKey, shortNative } };
  }

  const buy = await swap(true, parseEther("0.2"));
  console.error("Official Router 2.1.2 buy confirmed: " + buy.hash + " tokenOutAtomic=" + buy.amountOut);
  const sellAmount = buy.amountOut / 2n;
  assert.ok(sellAmount > 0n);
  const sellDeadline = (await client.getBlock()).timestamp + 600n;
  const insufficientAllowance = await expectRevert(client, {
    from: buyer, to: router, data: swapData(poolKey, false, sellAmount, 1n, sellDeadline),
  });
  const erc20Approval = await send(client, call(token, erc20Abi, "approve", [permit2, sellAmount], buyer));
  const routerApproval = await send(client, call(permit2, permitAbi, "approve", [token, router, sellAmount, Number(sellDeadline)], buyer));
  assert.equal(await tokenRead(token, "allowance", [buyer, permit2]), sellAmount);
  const [allowance, expiration] = await allowanceAt(buyer, token, router);
  assert.equal(allowance, sellAmount);
  assert.equal(BigInt(expiration), sellDeadline);
  const excessAllowance = await expectRevert(client, {
    from: buyer, to: router, data: swapData(poolKey, false, sellAmount + 1n, 1n, sellDeadline),
  });
  const sell = await swap(false, sellAmount);
  console.error("Official Router 2.1.2 sell confirmed with native trace: " + sell.hash + " nativeOutWei=" + sell.amountOut);
  assert.equal(await tokenRead(token, "allowance", [buyer, permit2]), 0n);
  assert.equal((await allowanceAt(buyer, token, router))[0], 0n);

  const feeDeadline = (await client.getBlock()).timestamp + 600n;
  const lockedId = launched.launch.positionId;
  const principal = await positionRead("getPositionLiquidity", [lockedId]);
  assert.equal(principal, launched.launch.liquidity);
  const collection = await send(client, call(factory, engine.abi, "collectFees", [token, feeDeadline], stranger));
  const accrued = oneEvent(collection, factory, engine.abi, "LongevityFeesAccrued");
  const collected = oneEvent(collection, factory, engine.abi, "LaunchFeesCollected");
  assertAddress(accrued.token, token, "Accrued token");
  assertAddress(collected.creator, creator, "Collection creator");
  assert.equal(collected.positionTokenId, lockedId);
  assert.ok(accrued.nativeAmount > 0n && accrued.tokenAmount > 0n, "Both actual LP fee assets must accrue.");
  const [nativeAccrued, tokenAccrued, nativeRoundingDust, tokenRoundingDust] = await factoryRead("feeTotals", [token]);
  assert.equal(accrued.nativeAmount, nativeAccrued);
  assert.equal(accrued.tokenAmount, tokenAccrued);
  assert.equal(await balanceAt(factory), nativeAccrued);
  assert.equal(await tokenRead(token, "balanceOf", [factory]), tokenAccrued);
  assert.ok(nativeRoundingDust <= 2n && tokenRoundingDust <= 2n);
  const unauthorizedClaim = await expectRevert(client, call(factory, engine.abi, "withdrawFees", [token, 0], stranger),
    "UnauthorizedFeeRecipient");
  const withdrawals = [];
  for (const [bucket, recipient, share] of [[0, creator, 7000n], [1, treasury, 2000n], [2, reserve, 1000n]]) {
    const [committed, nativeClaimable, tokenClaimable, nativeDistributed, tokenDistributed] = await factoryRead("feeBucket", [token, bucket]);
    assertAddress(committed, recipient, "Immutable fee recipient");
    assert.equal(nativeClaimable, nativeAccrued * share / 10_000n);
    assert.equal(tokenClaimable, tokenAccrued * share / 10_000n);
    assert.equal(nativeDistributed, 0n);
    assert.equal(tokenDistributed, 0n);
    const [beforeNative, beforeToken] = await Promise.all([balanceAt(recipient), tokenRead(token, "balanceOf", [recipient])]);
    const withdrawCall = call(factory, engine.abi, "withdrawFees", [token, bucket], recipient);
    const withdrawal = await send(client, withdrawCall);
    const payout = oneEvent(withdrawal, factory, engine.abi, "LongevityFeesWithdrawn");
    assertAddress(payout.recipient, recipient, "Fee payout");
    assert.equal(payout.bucket, bucket);
    assert.equal(payout.nativeAmount, nativeClaimable);
    assert.equal(payout.tokenAmount, tokenClaimable);
    assert.equal(await balanceAt(recipient) - beforeNative + gasCost(withdrawal), nativeClaimable);
    assert.equal(await tokenRead(token, "balanceOf", [recipient]) - beforeToken, tokenClaimable);
    assert.deepEqual((await factoryRead("feeBucket", [token, bucket])).slice(1), [0n, 0n, nativeClaimable, tokenClaimable]);
    const nativePayments = nativeTransfers(await callTrace(client, withdrawal), factory, recipient, nativeClaimable);
    const duplicateClaim = await expectRevert(client, withdrawCall, "NoClaimableFees");
    withdrawals.push({ ...receiptInfo(withdrawal), bucket, recipient, nativeAmount: nativeClaimable,
      tokenAmount: tokenClaimable, nativeTransfers: nativePayments, duplicateClaim });
  }
  assert.equal(await balanceAt(factory), nativeRoundingDust);
  assert.equal(await tokenRead(token, "balanceOf", [factory]), tokenRoundingDust);
  assert.deepEqual(await factoryRead("feePolicy", [token]), fixedPolicy);
  assertAddress(await positionRead("ownerOf", [lockedId]), factory, "Unchanged principal owner");
  const principalAfter = await positionRead("getPositionLiquidity", [lockedId]);
  assert.equal(principalAfter, principal);
  const blockedPrincipalTransfer = await expectRevert(client, call(positions, positionAbi, "transferFrom",
    [factory, creator, lockedId], creator));

  console.error("Loopback transactions verified: launch=" + launched.launch.hash + " buy=" + buy.hash
    + " sell=" + sell.hash + " collect=" + collection.transactionHash);
  const lifecycle = {
    chainId: 4663, factory, factoryRuntimeHash, guard, guardRuntimeHash, ...launched,
    deployment: { ...receiptInfo(deployment), address: deploymentAddress, runtimeHash: deploymentRuntimeHash,
      operator, nonce, salt, hookMask: "0x2000", guardInitCodeHash },
    guardRejections: { wrongSaltRevert, wrongManagerHash, wrongManager, wrongInitializer, wrongPool, missingHookRevert, hostileRevert,
      initializeBeforeDeployment: receiptInfo(initBefore), initializeAfterDeployment: receiptInfo(initAfter),
      alternatePool: receiptInfo(alternate), alternatePoolId },
    launchRejections: { badPolicy, fundingInterruption, duplicateIntent },
    approvals: { erc20: receiptInfo(erc20Approval), permit2: receiptInfo(routerApproval), amount: sellAmount,
      expiration: sellDeadline, insufficientAllowance, excessAllowance, allowanceAfter: 0n },
    buy, sell,
    feeCollection: { ...receiptInfo(collection), collector: stranger, nativeAccrued, tokenAccrued, nativeRoundingDust,
      tokenRoundingDust, policy: { ...policy, creator }, unauthorizedClaim },
    withdrawals, custody: { owner: factory, principalLiquidityBefore: principal, principalLiquidityAfter: principalAfter, blockedPrincipalTransfer },
  };
  if (onLaunch) {
    lifecycle.publicEvidence = await onLaunch({ rpcUrl, report, artifacts, lifecycle,
      createAnotherLaunch: async () => launch({ ...baseTerms, name: "Robinhood Fork Reorg Probe", symbol: "RMTREORG",
        intentId: toHex(2, { size: 32 }), deadline: (await client.getBlock()).timestamp + 1200n }) });
  }
  return lifecycle;
}

async function main() {
  const { values } = parseArgs({ options: { anvil: { type: "string" }, solc: { type: "string" }, lib: { type: "string" }, archive: { type: "string" } } });
  assert.ok(values.anvil && values.solc, "Supply --anvil and --solc paths, optionally --lib for pinned dependencies and --archive for a listed read provider.");
  const { runPublicEvidence } = await import("../../../apps/web/scripts/launch-4663-public-evidence.ts");
  const output = await withRobinhood4663Fork(values, async (environment) => {
    const lifecycle = await runGuardedV2ForkLifecycle({ ...environment, onLaunch: runPublicEvidence });
    console.error("Launch, five REST/MCP reads, recovery and reorg checks passed.");
    const wrongChain = await withAnvilFork({ anvil: values.anvil, archive: values.archive, chainId: 31337 },
      (wrong) => runWrongChainCheck({ ...wrong, artifacts: environment.artifacts }));
    return { purpose: "loopback-review-fork", network: environment.report.network,
      build: environment.report.build, execution: environment.report.execution,
      archiveBoundary: environment.report.archiveBoundary, lifecycle, wrongChain };
  });
  process.stdout.write(JSON.stringify(output, (_, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
