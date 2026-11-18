import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { receiptEvidence, reviewTransactionEvidence, transact, verifyRuntime } from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeDeployData, erc20Abi, keccak256, parseAbi, parseAbiParameters, parseEventLogs, zeroAddress, zeroHash } = require("viem");
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const curveAbi = parseAbi(["function graduated() view returns(bool)"]);
const coreAbi = parseAbi(["function curveForToken(address) view returns(address)"]);
const engineAbi = parseAbi(["function canonicalPoolKey(address) view returns((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
  "function positions(address) view returns(uint256 tokenId,uint128 liquidity)", "function positionManager() view returns(address)", "function poolManager() view returns(address)"]);
const positionAbi = parseAbi(["function ownerOf(uint256) view returns(address)", "function getPositionLiquidity(uint256) view returns(uint128)"]);

/** Extends the original real chain-31337 treasury journey. This prototype never
 * receives spend authority, makes a purchase or pretends a test observation is
 * an admitted oracle. Parent fixture owns all synthetic signatures and writes. */
export async function createPurchaseV2Review({ client, read, send, creator, project, treasury, treasuryAbi, deployed, compilation, out, sourceIdentity }) {
  assert.equal(await client.getChainId(), 31337);
  assert.equal(new URL(client.transport.url).hostname, "127.0.0.1", "Only the existing loopback fixture is admitted");
  const prototypeArtifact = compilation.artifacts.RMTTreasuryPurchaseV2Prototype;
  const factoryArtifact = compilation.artifacts.RMTTreasuryPurchaseV2PrototypeFactory;
  assert.ok(prototypeArtifact && factoryArtifact);
  const evidence = { schemaVersion: 1, profile: "rmt-project-treasury-purchase-v2-prototype", status: "incomplete",
    readiness: "NOT_EXECUTABLE", chainId: 31337, scope: "LOCAL_SYNTHETIC_NO_SPENDING_AUTHORITY",
    sourceIdentity, compiler: compilation.manifest, purchaseTransactions: 0, receipts: [], rejections: [], checks: {},
    independentReferenceAdmitted: false, productionExecution: false, physicalIPhoneAcceptance: false };
  const save = () => writeFileSync(join(out, "purchase-v2-acceptance.json"), json(evidence));
  const codeHash = async address => {
    const code = await client.getCode({ address }); assert.ok(code && code !== "0x", "Missing exact fixture runtime"); return keccak256(code);
  };
  const balances = async () => ({ treasuryNative: await client.getBalance({ address: treasury }),
    treasuryToken: await read(project.token, erc20Abi, "balanceOf", [treasury]),
    prototypeNative: evidence.prototype ? await client.getBalance({ address: evidence.prototype }) : 0n,
    prototypeToken: evidence.prototype ? await read(project.token, erc20Abi, "balanceOf", [evidence.prototype]) : 0n });
  const binding = { treasury, treasuryHash: await codeHash(treasury), factory: deployed.factory,
    factoryHash: await codeHash(deployed.factory), token: project.token, tokenHash: await codeHash(project.token),
    curve: project.curve, curveHash: await codeHash(project.curve), poolManager: zeroAddress, poolId: zeroHash };
  const creatorCode = await client.getCode({ address: creator.address }) ?? "0x";
  evidence.binding = binding; evidence.creator = creator.address; evidence.creatorRuntimeHash = keccak256(creatorCode);
  evidence.creatorAccount = creatorCode === "0x" ? "EOA" : creatorCode.startsWith("0xef0100") ? "EIP-7702" : "OTHER_CODE";
  const before = await balances(); evidence.initialBalances = before; save();

  async function record(action, request) {
    const receipt = await send(creator.address, request);
    const transaction = await reviewTransactionEvidence(client, receipt);
    assert.ok(same(transaction.from, creator.address)); assert.equal(transaction.valueWei, "0");
    evidence.receipts.push({ action, ...receiptEvidence(receipt), transaction }); save(); return receipt;
  }
  async function rejects(name, functionName, args, expectedError, expectedArgs, account = creator.address, address = evidence.prototype, abi = prototypeArtifact.abi) {
    await assert.rejects(client.simulateContract({ account, address, abi, functionName, args }), error => {
      const reverted = error && typeof error.walk === "function" ? error.walk(item => !!item?.data?.errorName) : null;
      assert.equal(reverted?.data?.errorName, expectedError, `${name}: expected exact custom error`);
      if (expectedArgs) assert.deepEqual(reverted.data.args, expectedArgs, `${name}: exact reason differs`);
      evidence.rejections.push({ name, functionName, error: expectedError, ...(expectedArgs && { args: expectedArgs }), simulationOnly: true }); save(); return true;
    });
  }

  const deployedFactory = await record("deploy-local-prototype-factory", { data: encodeDeployData({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode }) });
  const factory = deployedFactory.contractAddress; assert.ok(factory);
  evidence.prototypeFactory = factory; evidence.factoryRuntimeHash = await verifyRuntime(client, factory, factoryArtifact);
  const predicted = await read(factory, factoryArtifact.abi, "predict", [binding]);
  const vacantCode = await client.getCode({ address: predicted });
  assert.ok(vacantCode === undefined || vacantCode === "0x", "Fresh predicted prototype must be vacant");
  const salt = await read(factory, factoryArtifact.abi, "saltFor", [treasury]);
  const creation = await record("create2-local-prototype", transact(factory, factoryArtifact.abi, "create", [binding]));
  const logs = parseEventLogs({ abi: factoryArtifact.abi, eventName: "PrototypeCreated", strict: true,
    logs: creation.logs.filter(log => same(log.address, factory)) });
  assert.equal(logs.length, 1); assert.ok(same(logs[0].args.creator, creator.address) && same(logs[0].args.treasury, treasury));
  assert.ok(same(logs[0].args.prototype, predicted)); assert.equal(logs[0].args.salt, salt);
  assert.ok(same(await read(factory, factoryArtifact.abi, "prototypeForTreasury", [treasury]), predicted));
  evidence.prototype = predicted; evidence.salt = salt;
  evidence.prototypeRuntimeHash = await verifyRuntime(client, predicted, prototypeArtifact);
  const intentId = await read(treasury, treasuryAbi, "intentId");
  const routeHash = keccak256(encodeAbiParameters(parseAbiParameters("string,uint256,address,address,bytes32,address,bytes32,address,bytes32"),
    ["RMT_TREASURY_CURVE_ROUTE_V2_PROTOTYPE", 31337n, treasury, binding.factory, binding.factoryHash, binding.token, binding.tokenHash, binding.curve, binding.curveHash]));
  const immutableValues = { deploymentFactory: factory, intentId, curveRouteHash: routeHash }, materialized = Buffer.from(prototypeArtifact.runtime.slice(2), "hex");
  const names = [];
  for (const [id, slots] of Object.entries(prototypeArtifact.immutableOffsets)) {
    const name = compilation.immutableNames[id]; assert.ok(Object.hasOwn(immutableValues, name), "Unknown prototype immutable: " + name); names.push(name);
    const value = BigInt(immutableValues[name]).toString(16).padStart(64, "0");
    for (const { start, length } of slots) { assert.equal(length, 32); Buffer.from(value, "hex").copy(materialized, start); }
  }
  assert.deepEqual([...new Set(names)].sort(), Object.keys(immutableValues).sort());
  assert.equal(await client.getCode({ address: predicted }), "0x" + materialized.toString("hex"), "All materialized prototype immutable bytes must match");
  assert.ok(same(await read(predicted, prototypeArtifact.abi, "deploymentFactory"), factory));
  assert.equal(await read(predicted, prototypeArtifact.abi, "intentId"), intentId);
  assert.equal(await read(predicted, prototypeArtifact.abi, "curveRouteHash"), routeHash);
  assert.deepEqual((await read(predicted, prototypeArtifact.abi, "binding")).map(value => typeof value === "string" ? value.toLowerCase() : value),
    Object.values(binding).map(value => typeof value === "string" ? value.toLowerCase() : value));
  assert.equal(await read(predicted, prototypeArtifact.abi, "purchaseExecutionAvailable"), false);
  assert.equal(await read(predicted, prototypeArtifact.abi, "spendingAuthority"), false);
  assert.equal(await read(predicted, prototypeArtifact.abi, "purchasesEnabled"), false);
  await rejects("duplicate CREATE2 treasury binding", "create", [binding], "InvalidCreation", undefined, creator.address, factory, factoryArtifact.abi);
  const policy = { minimumWei: 10n ** 14n, perTransactionWei: 10n ** 15n, perPeriodWei: 2n * 10n ** 15n,
    cooldownSeconds: 60, periodSeconds: 3600, maxSlippageBps: 100, maxImpactBps: 100 };
  await record("record-local-intent-only", transact(predicted, prototypeArtifact.abi, "setPurchaseIntent", [policy, true]));
  assert.equal(await read(predicted, prototypeArtifact.abi, "purchasesEnabled"), true);
  const quote = await read(predicted, prototypeArtifact.abi, "readCurveQuote", [policy.minimumWei]);
  assert.ok(quote.tokensOut > 0n && quote.grossUsed <= policy.minimumWei && quote.refund === policy.minimumWei - quote.grossUsed && quote.fee <= quote.grossUsed);
  const latest = await client.getBlock(), previous = await client.getBlock({ blockNumber: latest.number - 1n });
  const request = { amountWei: policy.minimumWei, minimumTokenOut: quote.tokensOut, deadline: Number(latest.timestamp + 120n),
    controllerEpoch: await read(treasury, treasuryAbi, "controllerEpoch"), policyEpoch: await read(predicted, prototypeArtifact.abi, "policyEpoch"),
    routeHash, quotedSlippageBps: 0, quotedImpactBps: 0 };
  // These fields deliberately test rejection of CALLER ASSERTIONS. Neither the
  // address nor supplied liquidity/history is verified independent market data.
  const claimedReference = { chainId: 31337n, token: project.token, quoteAsset: zeroAddress, source: creator.address,
    originMarket: factory, originPoolId: zeroHash, blockNumber: previous.number, blockHash: previous.hash,
    observedAt: Number(previous.timestamp), historySeconds: 86400, nativeLiquidity: 2n * 10n ** 18n, tokensPerEth: 10n ** 18n };
  assert.deepEqual(await read(predicted, prototypeArtifact.abi, "reviewRequest", [request]), quote);
  assert.equal(await read(predicted, prototypeArtifact.abi, "inspectReference", [claimedReference]), 0);
  await rejects("purported independent reference is unadmitted", "executePurchase", [request, claimedReference], "NoIndependentReference", [0]);
  await rejects("same-curve reference is not independent", "executePurchase", [request, { ...claimedReference, source: project.curve }], "NoIndependentReference", [6]);
  await rejects("stale reference is rejected", "executePurchase", [request, { ...claimedReference, observedAt: Number(latest.timestamp - 61n) }], "NoIndependentReference", [4]);
  for (const [name, patch] of [["cap", { amountWei: policy.perTransactionWei + 1n }], ["minimum-output", { minimumTokenOut: quote.tokensOut + 1n }],
    ["route", { routeHash: keccak256("0x01") }], ["impact", { quotedImpactBps: 101 }], ["slippage", { quotedSlippageBps: 101 }],
    ["expiry", { deadline: Number(latest.timestamp - 1n) }], ["controller-epoch", { controllerEpoch: request.controllerEpoch + 1n }]]) {
    await rejects("invalid " + name, "reviewRequest", [{ ...request, ...patch }], "InvalidRequest");
  }
  await record("revoke-local-intent", transact(predicted, prototypeArtifact.abi, "disablePurchases"));
  assert.equal(await read(predicted, prototypeArtifact.abi, "purchasesEnabled"), false);
  await rejects("prepared execution stopped after revocation", "executePurchase", [request, claimedReference], "IntentDisabled");
  await record("record-intent-for-controller-epoch-test", transact(predicted, prototypeArtifact.abi, "setPurchaseIntent", [policy, true]));
  assert.equal(await read(predicted, prototypeArtifact.abi, "purchasesEnabled"), true);
  assert.deepEqual(await balances(), before, "Prototype deployment, policy changes and simulations cannot move treasury assets");
  evidence.curveQuote = quote; evidence.request = request;
  evidence.claimedReference = { ...claimedReference, provenance: "Caller-supplied synthetic assertion; NOT independently admitted evidence" };
  evidence.checks = { create2AndAllRuntimeBytes: true, offByDefault: true, noSpendingAuthority: true,
    claimedReferenceCannotAuthorize: true, curveQuoteIsNotIndependentReference: true, revocationStopsPreparedRequest: true, noTreasuryAssetDelta: true };
  evidence.phase = "curve-bound"; save();

  return {
    async afterMigration(migrated) {
      assert.ok(!same(migrated.curve, binding.curve));
      assert.ok(same(await read(binding.factory, coreAbi, "curveForToken", [binding.token]), migrated.curve));
      await rejects("old pinned curve cannot follow migration silently", "readCurveQuote", [policy.minimumWei], "UnsupportedRoute");
      assert.ok(same((await read(predicted, prototypeArtifact.abi, "binding"))[7], binding.curveHash));
      evidence.migration = { originalCurve: binding.curve, actualSuccessor: migrated.curve, successorRuntimeHash: await codeHash(migrated.curve),
        sourceIdentityUnchanged: true, entitlementMigration: false, routeStatus: "UNSUPPORTED_AFTER_MIGRATION" };
      evidence.checks.migrationFailsClosedWithoutSilentRouteUpgrade = true; evidence.phase = "migrated"; save();
    },
    async afterControllerRotation(safe) {
      assert.ok(same(await read(treasury, treasuryAbi, "controller"), safe));
      const epoch = await read(treasury, treasuryAbi, "controllerEpoch"); assert.ok(epoch > request.controllerEpoch);
      assert.equal(await read(predicted, prototypeArtifact.abi, "purchasesEnabled"), false);
      await rejects("removed controller cannot change prototype intent", "setPurchaseIntent", [policy, true], "Unauthorized");
      evidence.rotation = { controller: safe, epoch, currentControllerProfile: "Parent fixture genuine 2-of-3 Safe execution", oldIntentEffective: false };
      evidence.checks.actualSafeRotationInvalidatesOldIntent = true; evidence.phase = "controller-rotated"; save();
    },
    async afterGraduation(graduated) {
      assert.equal(await read(graduated.curve, curveAbi, "graduated"), true);
      const key = await read(deployed.graduationEngine, engineAbi, "canonicalPoolKey", [binding.token]);
      assert.ok(same(key.currency0, zeroAddress) && same(key.currency1, binding.token)); assert.equal(key.fee, 3000);
      const poolId = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
      const [tokenId, liquidity] = await read(deployed.graduationEngine, engineAbi, "positions", [binding.token]);
      const manager = await read(deployed.graduationEngine, engineAbi, "positionManager");
      assert.ok(tokenId > 0n && liquidity > 0n);
      assert.ok(same(await read(manager, positionAbi, "ownerOf", [tokenId]), deployed.graduationEngine));
      assert.equal(await read(manager, positionAbi, "getPositionLiquidity", [tokenId]), liquidity);
      assert.equal(await read(predicted, prototypeArtifact.abi, "purchaseExecutionAvailable"), false);
      assert.equal(await read(predicted, prototypeArtifact.abi, "spendingAuthority"), false);
      assert.equal(await client.getBalance({ address: predicted }), 0n); assert.equal(await read(binding.token, erc20Abi, "balanceOf", [predicted]), 0n);
      await rejects("graduation does not admit a v4 purchase route", "readCurveQuote", [policy.minimumWei], "UnsupportedRoute");
      evidence.graduation = { poolManager: await read(deployed.graduationEngine, engineAbi, "poolManager"), poolKey: key, poolId,
        positionManager: manager, tokenId, liquidity, positionOwner: deployed.graduationEngine,
        scope: "Parent real synthetic graduation and v4 swaps; no prototype swap or independent price admission" };
      evidence.checks.actualV4DoesNotGrantPrototypeSpending = true; evidence.phase = "graduated"; evidence.status = "NOT_EXECUTABLE"; save();
    },
  };
}
