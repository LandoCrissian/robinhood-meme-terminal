import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";

const { values } = parseArgs({ options: { checkout: { type: "string" }, solc: { type: "string" } } });
assert.ok(values.checkout && values.solc, "Provide --checkout with pinned viem and --solc with the pinned native compiler");
const { keccak256, getAddress, parseAbi, encodeAbiParameters, encodeFunctionData, decodeFunctionResult, decodeEventLog, toFunctionSelector, numberToHex, toHex, size } = webTools(resolve(values.checkout));
const snapshot = JSON.parse(readFileSync(new URL("../../../apps/launch-website/data/historical-launches-4663.json", import.meta.url)));
const [legacy, official] = [[4, "1"], [6, "0"]].map(([version, launchId]) => {
  const launch = snapshot.launches.find((item) => item.version === version && item.launchId === launchId);
  const factory = snapshot.factories.find((item) => item.version === version);
  assert.ok(launch && factory && launch.factory === factory.factory);
  return { ...launch, deployment: factory };
});

const endpoints = { robinhood: "https://rpc.mainnet.chain.robinhood.com", pocket: "https://robinhood.api.pocket.network" };
const abi = parseAbi([
  "function totalSupply() view returns (uint256)", "function decimals() view returns (uint8)", "function creator() view returns (address)",
  "function owner() view returns (address)", "function mint(address,uint256)", "function initialize(string,string,uint256,address,address,string)",
  "function tokenImplementation() view returns (address)", "function token() view returns (address)",
  "function realEthReserve() view returns (uint256)", "function trackedTokenInventory() view returns (uint256)",
  "function graduationPoolId() view returns (bytes32)", "function feeBps() view returns (uint16)",
  "function graduationTarget() view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function graduated() view returns (bool)", "function liquidityMigrated() view returns (bool)", "function feeSplitter() view returns (address)",
  "function creatorShareBps() view returns (uint16)", "function originalCreator() view returns (address)",
  "function protocolTreasury() view returns (address)", "function creatorPayoutAuthority() view returns (address)",
  "function launchToken() view returns (address)", "function authorizedMarket() view returns (address)",
  "function officialIdentityMigration() view returns (address)", "function officialLegacyToken() view returns (address)",
  "function authorizedFactory() view returns (address)", "function officialLauncher() view returns (address)",
  "function consumed() view returns (bool)", "function activeFactory() view returns (address)", "function activeVersion() view returns (bytes32)",
  "function launchCount() view returns (uint256)", "function launchesPaused() view returns (bool)",
  "function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32) view returns (uint128)", "function poolManager() view returns (address)",
  "function graduationAdapter() view returns (address)", "function hook() view returns (address)",
  "function poolFee() view returns (uint24)", "function tickSpacing() view returns (int24)",
  "function poolIds(address) view returns (bytes32)", "function lockedLiquidity(address) view returns (uint128)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event TokenLaunched(uint256 indexed launchId,address indexed token,address indexed creator,address market,address rewardVault,bytes32 graduationPoolId,string name,string symbol,string metadataURI,uint16[5] rewardBps)",
  "event TokenLaunchedV6(uint256 indexed launchId,address indexed token,address indexed creator,address market,address feeSplitter,bytes32 graduationPoolId,bytes32 policyId,uint32 policyVersion,uint16 curveFeeBps,uint16 creatorFeeShareBps,uint16 protocolFeeShareBps,uint16 postGraduationFeeBps,bool fairStartEnabled,uint64 fairStartDelayBlocks,uint64 fairStartDurationBlocks,uint16 fairStartMaxTxBps,uint16 fairStartMaxWalletBps,uint256 graduationTarget,bool officialMigration,string name,string symbol,string metadataURI)",
  "event OfficialRMTMigrationLaunched(uint256 indexed launchId,address indexed token,address indexed creator,address migrationAuthority,address officialLegacyToken)",
]);
const factoryAbi = (isV6) => parseAbi([
  "function getLaunch(uint256) view returns (address token,address market,address rewardVault,bytes32 graduationPoolId,address creator,"
    + (isV6 ? "bytes32 policyId,uint32 policyVersion,uint64 createdAt,bool officialMigration)" : "uint64 createdAt)"),
]);
const stateView = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
const expectedPoolManager = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const expectedStateViewRuntime = "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6";
const zeroAddress = "0x" + "0".repeat(40);
const trustedSolcHash = "537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const sameAddress = (a, b) => assert.equal(getAddress(a), getAddress(b));
const json = (data) => JSON.stringify(data, (_, value) => typeof value === "bigint" ? value.toString() : value, 2);
const methods = ["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getCode", "eth_call", "eth_getBalance"];

function rpc(url) {
  let id = 0;
  return async (method, params) => {
    assert.ok(methods.includes(method));
    const requestId = ++id;
    const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) });
    assert.ok(response.ok, url + " " + method + " HTTP " + response.status);
    const body = await response.json();
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, requestId);
    return body;
  };
}

function result(reply, method) {
  assert.ok("result" in reply && !reply.error, method + " " + json(reply.error));
  return reply.result;
}

function codeIdentity(code) {
  assert.ok(/^0x(?:[0-9a-f]{2})+$/i.test(code), "Missing runtime code");
  const clone = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
  return { bytes: size(code), keccak256: keccak256(code), ...(clone && { implementation: getAddress("0x" + clone[1]) }) };
}

function compiledToken() {
  const path = "src/clone/CloneFixedSupplyMemeToken.sol";
  const source = readFileSync(new URL("../../../packages/contracts/" + path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  assert.equal(sha256(readFileSync(values.solc)), trustedSolcHash);
  const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun",
    outputSelection: { "*": { "*": ["evm.deployedBytecode.object", "evm.methodIdentifiers"] } } };
  const input = { language: "Solidity", sources: { [path]: { content: source } }, settings };
  const compilation = spawnSync(values.solc, ["--standard-json"], { encoding: "utf8", input: JSON.stringify(input), timeout: 60_000 });
  assert.equal(compilation.status, 0, compilation.stderr);
  const output = JSON.parse(compilation.stdout);
  assert.ok(!output.errors?.some(({ severity }) => severity === "error"), json(output.errors));
  const { evm } = output.contracts[path].CloneFixedSupplyMemeToken;
  return { path, sourceSha256: sha256(source), compilerSha256: trustedSolcHash, settings, methodIdentifiers: evm.methodIdentifiers,
    bytecode: "0x" + evm.deployedBytecode.object };
}

function executable(code) {
  const trailerLength = Number.parseInt(code.slice(-4), 16);
  assert.ok(trailerLength >= 10 && trailerLength <= 512 && code.length > 4 + 2 * trailerLength);
  return code.slice(0, -(4 + 2 * trailerLength));
}

async function observe(read, height, hash, build) {
  const tag = { blockHash: hash, requireCanonical: true };
  const required = async (method, params) => result(await read(method, params), method);
  const code = (address) => required("eth_getCode", [address, tag]);
  const callBody = (to, functionName, args = [], selectedAbi = abi) => [{ to, data: encodeFunctionData({ abi: selectedAbi, functionName, args }) }, tag];
  const call = async (to, functionName, args = [], selectedAbi = abi) => decodeFunctionResult({
    abi: selectedAbi, functionName, data: await required("eth_call", callBody(to, functionName, args, selectedAbi)),
  });
  const rejection = async (to, functionName, args) => {
    const response = await read("eth_call", callBody(to, functionName, args));
    assert.ok(response.error?.code && response.error.message.toLowerCase().includes("revert"), functionName + " did not revert");
    return { code: response.error.code, ...(typeof response.error.data === "string" && { data: response.error.data }) };
  };
  const receiptOf = async (launch) => {
    const record = launch.receipt;
    const [receipt, transaction, block] = await Promise.all([
      required("eth_getTransactionReceipt", [record.transactionHash]),
      required("eth_getTransactionByHash", [record.transactionHash]),
      required("eth_getBlockByNumber", [numberToHex(BigInt(record.blockNumber)), false]),
    ]);
    for (const hashValue of [receipt.blockHash, transaction.blockHash, block.hash]) assert.equal(hashValue, record.blockHash);
    for (const number of [receipt.blockNumber, transaction.blockNumber, block.number]) {
      assert.equal(BigInt(number).toString(), record.blockNumber);
    }
    assert.equal(new Date(Number(block.timestamp) * 1000).toISOString(), record.timestamp);
    assert.equal(receipt.transactionHash, record.transactionHash);
    assert.equal(transaction.hash, record.transactionHash);
    assert.equal(receipt.status, "0x1");
    sameAddress(transaction.to, launch.factory);
    sameAddress(transaction.from, launch.creator);
    const isV6 = launch.version === 6;
    assert.equal(transaction.input.slice(0, 10), toFunctionSelector(isV6 ? "launchOfficialWhilePaused(string)" : "launchCommunity(string,string,string)"));
    const log = receipt.logs.find(({ logIndex }) => Number(logIndex) === record.logIndex);
    assert.ok(log && !log.removed);
    sameAddress(log.address, launch.factory);
    const event = decodeEventLog({ abi, topics: log.topics, data: log.data, eventName: isV6 ? "TokenLaunchedV6" : "TokenLaunched" });
    assert.equal(event.args.launchId.toString(), launch.launchId);
    for (const key of ["token", "creator", "market"]) sameAddress(event.args[key], launch[key]);
    assert.equal(event.args.graduationPoolId, launch.reservedPoolId);
    const mintLog = receipt.logs.filter(({ address, topics }) => getAddress(address) === getAddress(launch.token)
      && topics[0] === keccak256(toHex("Transfer(address,address,uint256)")) && BigInt(topics[1]) === 0n);
    assert.equal(mintLog.length, 1);
    const { args: mint } = decodeEventLog({ abi, topics: mintLog[0].topics, data: mintLog[0].data, eventName: "Transfer" });
    assert.equal(mint.from, zeroAddress);
    sameAddress(mint.to, launch.factory);
    const movement = receipt.logs.filter(({ address, topics }) => getAddress(address) === getAddress(launch.token)
      && topics[0] === keccak256(toHex("Transfer(address,address,uint256)")) && BigInt(topics[1]) !== 0n)
      .map(({topics, data, logIndex}) => ({ ...decodeEventLog({ abi, topics, data, eventName: "Transfer" }).args, logIndex: Number(logIndex) }));
    assert.equal(movement.length, 1);
    sameAddress(movement[0].from, launch.factory);
    sameAddress(movement[0].to, launch.market);
    assert.equal(movement[0].value, mint.value);
    const identityLog = isV6 && receipt.logs.find(({ address, topics }) => getAddress(address) === getAddress(launch.factory)
      && topics[0] === keccak256(toHex("OfficialRMTMigrationLaunched(uint256,address,address,address,address)")));
    let officialIdentityEvent = null;
    if (isV6) {
      assert.ok(identityLog && !identityLog.removed && event.args.officialMigration);
      const { args } = decodeEventLog({ abi, topics: identityLog.topics, data: identityLog.data, eventName: "OfficialRMTMigrationLaunched" });
      sameAddress(args.officialLegacyToken, legacy.token);
      sameAddress(args.token, launch.token);
      sameAddress(args.creator, launch.creator);
      assert.equal(args.launchId.toString(), launch.launchId);
      officialIdentityEvent = { launchId: args.launchId, erc20Address: args.token, creator: args.creator,
        migrationAuthority: args.migrationAuthority, legacyErc20Address: args.officialLegacyToken,
        logIndex: Number(identityLog.logIndex) };
      assert.ok(receipt.logs.every(({ address }) => getAddress(address) !== getAddress(legacy.token)),
        "Legacy token emitted logs in V6 creation receipt");
    }
    return { ...record, from: transaction.from, to: transaction.to, selector: transaction.input.slice(0, 10),
      mint: { ...mint, logIndex: Number(mintLog[0].logIndex) }, inventoryTransfer: movement[0],
      splitterOrRewardVault: event.args.feeSplitter ?? event.args.rewardVault,
      officialIdentityEvent, ...(isV6 && { terms: Object.fromEntries(["curveFeeBps", "creatorFeeShareBps", "protocolFeeShareBps",
        "postGraduationFeeBps", "graduationTarget", "fairStartEnabled"].map((key) => [key, event.args[key]])) }) };
  };
  const v4Receipt = await receiptOf(legacy);
  const v6Receipt = await receiptOf(official);

  const readIssuance = async (launch, receipt) => {
    const isV6 = launch.version === 6;
    const { token, market, factory, creator, reservedPoolId } = launch;
    const [tokenCode, curveCode, factoryCode, deployment, supply, decimals, onChainCreator, factoryImplementation] =
      await Promise.all([code(token), code(market), code(factory), call(factory, "getLaunch", [BigInt(launch.launchId)], factoryAbi(isV6)),
        call(token, "totalSupply"), call(token, "decimals"), call(token, "creator"), call(factory, "tokenImplementation")]);
    const tokenImplementationCode = await code(factoryImplementation);
    const runtime = { token: codeIdentity(tokenCode), curve: codeIdentity(curveCode), factory: codeIdentity(factoryCode),
      tokenImplementation: codeIdentity(tokenImplementationCode) };
    const executableSourceMatch = executable(tokenImplementationCode) === executable(build.bytecode);
    const metadataMatch = tokenImplementationCode === build.bytecode;
    assert.ok(executableSourceMatch, "Compiled token executable does not match " + launch.version);
    sameAddress(runtime.token.implementation, factoryImplementation);
    sameAddress(runtime.curve.implementation, launch.deployment.marketImplementation);
    assert.equal(runtime.factory.keccak256, launch.deployment.runtimeHash);
    sameAddress(deployment[0], token);
    sameAddress(deployment[1], market);
    sameAddress(deployment[2], receipt.splitterOrRewardVault);
    assert.equal(deployment[3], reservedPoolId);
    sameAddress(deployment[4], creator);
    sameAddress(onChainCreator, creator);
    assert.equal(supply, receipt.mint.value);
    assert.equal(supply, 1_000_000_000n * 10n ** 18n);
    assert.equal(decimals, 18);
    if (isV6) assert.equal(deployment[8], true);
    const [realEthReserve, actualEthBalance, inventory, actualTokenBalance, target, feeBps, graduated, liquidityMigrated, curveToken,
      recordedPool, owner, mint, initialize] = await Promise.all([
      call(market, "realEthReserve"), required("eth_getBalance", [market, tag]), isV6 ? call(market, "trackedTokenInventory") : null,
      call(token, "balanceOf", [market]), call(market, "graduationTarget"), call(market, "feeBps"), call(market, "graduated"),
      call(market, "liquidityMigrated"), call(market, "token"), call(market, "graduationPoolId"), rejection(token, "owner", []),
      rejection(token, "mint", [creator, 1n]), rejection(token, "initialize", ["Fixture", "FX", 1n, creator, creator, ""]),
    ]);
    sameAddress(curveToken, token);
    assert.equal(recordedPool, reservedPoolId);
    assert.equal(BigInt(actualEthBalance), realEthReserve);
    if (isV6) assert.equal(actualTokenBalance, inventory);
    assert.equal(initialize.data, toFunctionSelector("AlreadyInitialized()"));
    return { version: launch.version, launchId: launch.launchId, factory, erc20Address: token, market, onChainCreator, supply, decimals, runtime,
      tokenSourceMatch: { executableSourceMatch, metadataMatch, executableKeccak256: keccak256(executable(tokenImplementationCode)) },
      receipt, reservedPoolId, curve: { realEthReserve, actualEthBalance: BigInt(actualEthBalance), inventory, actualTokenBalance,
        target, feeBps, graduated, liquidityMigrated },
      readOnlyPermissionChecks: { owner, mint, initialize } };
  };
  const v4 = await readIssuance(legacy, v4Receipt);
  const v6 = await readIssuance(official, v6Receipt);
  const [helper, legacyToken, registryFactory, registryVersion, launchCount, launchesPaused, splitter, slot0, poolLiquidity, poolManager, adapter] = await Promise.all([
    call(official.factory, "officialIdentityMigration"), call(official.factory, "officialLegacyToken"),
    call(official.deployment.registry, "activeFactory"), call(official.deployment.registry, "activeVersion"),
    call(official.factory, "launchCount"), call(official.factory, "launchesPaused"), call(official.market, "feeSplitter"),
    call(stateView, "getSlot0", [official.reservedPoolId]), call(stateView, "getLiquidity", [official.reservedPoolId]), call(stateView, "poolManager"),
    call(official.market, "graduationAdapter"),
  ]);
  const [helperFactory, helperLegacy, helperLauncher, consumed, creatorShareBps, creatorOriginal, creatorCurrent, treasury,
    payoutAuthority, splitterToken, splitterMarket, splitterRuntime, helperRuntime, curveImplementation, stateViewRuntime] = await Promise.all([
    call(helper, "authorizedFactory"), call(helper, "officialLegacyToken"), call(helper, "officialLauncher"), call(helper, "consumed"),
    call(splitter, "creatorShareBps"), call(splitter, "originalCreator"), call(splitter, "creator"), call(splitter, "protocolTreasury"),
    call(splitter, "creatorPayoutAuthority"), call(splitter, "launchToken"), call(splitter, "authorizedMarket"),
    code(splitter), code(helper), code(v6.runtime.curve.implementation), code(stateView),
  ]);
  sameAddress(helper, v6Receipt.officialIdentityEvent.migrationAuthority);
  sameAddress(legacyToken, legacy.token);
  sameAddress(helperLegacy, legacy.token);
  sameAddress(helperFactory, official.factory);
  sameAddress(helperLauncher, official.creator);
  sameAddress(registryFactory, official.factory);
  sameAddress(splitter, v6Receipt.splitterOrRewardVault);
  sameAddress(splitterMarket, official.market);
  sameAddress(splitterToken, official.token);
  assert.equal(consumed, true);
  assert.equal(registryVersion, official.deployment.versionHash);
  assert.equal(codeIdentity(curveImplementation).keccak256, official.deployment.marketRuntimeHash);
  assert.equal(creatorShareBps, 7000);
  sameAddress(poolManager, expectedPoolManager);
  assert.equal(codeIdentity(stateViewRuntime).keccak256, expectedStateViewRuntime);
  const [adapterManager, hook, fee, tickSpacing, adapterPoolId, lockedLiquidity, adapterRuntime] = await Promise.all([
    call(adapter, "poolManager"), call(adapter, "hook"), call(adapter, "poolFee"), call(adapter, "tickSpacing"),
    call(adapter, "poolIds", [official.token]), call(adapter, "lockedLiquidity", [official.token]), code(adapter),
  ]);
  sameAddress(adapterManager, poolManager);
  const poolKey = { currency0: zeroAddress, currency1: getAddress(official.token), fee, tickSpacing, hooks: hook };
  const derivedPoolId = keccak256(encodeAbiParameters([
    { type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" },
  ], Object.values(poolKey)));
  assert.equal(adapterPoolId, derivedPoolId);
  assert.equal(derivedPoolId, official.reservedPoolId);
  assert.equal(fee, v6Receipt.terms.postGraduationFeeBps * 100);
  assert.equal((await required("eth_getBlockByNumber", [numberToHex(height), false])).hash, hash);
  return { v4, v6, legacyFrozenBindings: {
    registry: official.deployment.registry, registryFactory, registryVersion, launchCount, launchesPaused,
    helper: { address: helper, runtime: codeIdentity(helperRuntime), helperFactory, helperLegacy, helperLauncher, consumed },
    splitter: { address: splitter, runtime: codeIdentity(splitterRuntime), creatorShareBps, protocolShareBps: 10000 - creatorShareBps,
      creatorOriginal, creatorCurrent, treasury, payoutAuthority, splitterAsset: splitterToken, splitterMarket },
    curveImplementation: codeIdentity(curveImplementation),
    reservedV4Pool: { stateView, stateViewRuntime: codeIdentity(stateViewRuntime), poolManager,
      adapter, adapterRuntime: codeIdentity(adapterRuntime), poolId: derivedPoolId, poolKey, slot0,
      poolActiveLiquidity: poolLiquidity, adapterLockedLiquidity: lockedLiquidity },
  } };
}

const build = compiledToken();
const providers = Object.entries(endpoints).map(([name, url]) => ({ name, url, read: rpc(url) }));
const latest = await Promise.all(providers.map(async ({ read }) => {
  assert.equal(result(await read("eth_chainId", []), "eth_chainId"), "0x1237");
  return BigInt(result(await read("eth_getBlockByNumber", ["latest", false]), "eth_getBlockByNumber").number);
}));
const height = latest.reduce((a, b) => a < b ? a : b);
const anchors = await Promise.all(providers.map(async ({ read }) => {
  const block = result(await read("eth_getBlockByNumber", [numberToHex(height), false]), "anchor");
  return { block: height.toString(), hash: block.hash, stateRoot: block.stateRoot, timestamp: new Date(Number(block.timestamp) * 1000).toISOString() };
}));
assert.deepEqual(anchors[0], anchors[1]);
const [anchor] = anchors;
const facts = await Promise.all(providers.map(({ read }) => observe(read, height, anchor.hash, build)));
assert.deepEqual(facts[0], facts[1]);
const { bytecode, ...buildEvidence } = build;
console.log(json({ schemaVersion: 1, chainId: 4663, block: anchor, observedAt: new Date().toISOString(), ethereumL1Finality: "UNVERIFIED",
  providers: Object.fromEntries(providers.map(({ name, url }) => [name, url])), readMethods: methods, broadcastAuthorized: false,
  tokenBuild: { ...buildEvidence, runtime: codeIdentity(bytecode), executableKeccak256: keccak256(executable(bytecode)) },
  ...facts[0] }));
