import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { backing, supply } from "../../packages/contracts/scripts/fixed-supply-profile.mjs";
import { call, localFixtureClient, receiptEvidence, transact } from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";
import { proveFundedMigrations } from "../../packages/contracts/scripts/prove-fixed-supply-funded-migrations.mjs";
import { createTreasuryProjectsFromForm, claimCurveThroughTreasuryPage, exerciseTreasuryPage } from "./browser-integration.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { concatHex, encodeAbiParameters, encodeFunctionData, erc20Abi, hashTypedData, keccak256,
  parseAbi, parseAbiParameters, parseEventLogs, toHex, zeroAddress } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const safeAbi = parseAbi(["function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns(bytes32)",
  "function nonce() view returns(uint256)", "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)"]);
const safeFactoryAbi = parseAbi(["function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns(address)",
  "event ProxyCreation(address indexed proxy,address singleton)"]);
const safeTypes = { SafeTx: parseAbiParameters("address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce") };
const positionAbi = parseAbi(["function ownerOf(uint256) view returns(address)", "function getPositionLiquidity(uint256) view returns(uint128)"]);

/** This is the same website, chain, PostgreSQL and authoritative fixture writer
 * as the creator/claims acceptance. No production account or key can submit. */
export async function testProjectTreasuryJourney({ browserEngine, rpcUrl, rpc, artifacts, deployed, anchor, treasuryCompilation,
  treasuryDeployment, creatorAccount, operatorAccount, site, workerOrigin, indexReadKey, out, pg, waitFor, mine, ready, restart,
  hideReceipt, hideNativeProof }) {
  const client = await localFixtureClient(rpcUrl, 31337);
  assert.equal(await client.getChainId(), 31337); assert.equal(new URL(site).hostname, "127.0.0.1");
  const creator = creatorAccount, relayer = privateKeyToAccount(generatePrivateKey());
  const owners = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey())).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const signers = new Map([creator, relayer, ...owners].map(account => [account.address.toLowerCase(), account]));
  const evidence = { schemaVersion: 1, profile: "rmt-project-treasury-acceptance-v1", chainId: 31337,
    scope: "LOCAL_SYNTHETIC_NOT_PRODUCTION_OR_PHYSICAL_IPHONE", productionExecution: false, status: "incomplete",
    receipts: [], safeExecutions: [], checks: {}, purchaseTransactions: 0 };
  const save = () => writeFileSync(join(out, "project-treasury-acceptance.json"), json(evidence));
  const deadline = async seconds => (await client.getBlock()).timestamp + BigInt(seconds ?? 300);
  async function send(from, request, expected = "success") {
    const account = signers.get(from.toLowerCase()); assert.ok(account, "Only fresh fixture-controlled synthetic signers can submit");
    assert.ok(!request.authorizationList, "No delegation change is authorized");
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    if (request.nonce !== undefined) assert.equal(BigInt(request.nonce), BigInt(nonce));
    const gas = request.gas ? BigInt(request.gas) : expected === "reverted" ? 8_000_000n
      : (await client.estimateGas({ account: account.address, to: request.to, data: request.data, value: BigInt(request.value ?? 0) })) * 125n / 100n;
    const base = (await client.getBlock()).baseFeePerGas ?? 1n;
    const signed = await account.signTransaction({ chainId: 31337, type: "eip1559", to: request.to, data: request.data,
      value: BigInt(request.value ?? 0), nonce, gas, maxFeePerGas: BigInt(request.maxFeePerGas ?? base * 2n + 1n),
      maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGas ?? 0) });
    const hash = keccak256(signed); assert.equal(await rpc("eth_sendRawTransaction", [signed]), hash);
    const receipt = await client.waitForTransactionReceipt({ hash, checkReplacement: false, pollingInterval: 100, timeout: 30_000 });
    assert.equal(receipt.status, expected); assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
    evidence.receipts.push(receiptEvidence(receipt)); save(); return receipt;
  }
  function event(receipt, address, abi, name) {
    const logs = parseEventLogs({ abi, eventName: name, strict: true, logs: receipt.logs.filter(log => same(log.address, address)) });
    assert.equal(logs.length, 1, name); return logs[0].args;
  }
  for (const account of [relayer, ...owners]) await rpc("anvil_setBalance", [account.address, toHex(20n * 10n ** 18n)]);
  const delegate = JSON.parse(gunzipSync(readFileSync(new URL("../../apps/launch-website/lib/server/claim-delegate-runtime.test.json.gz", import.meta.url)))).delegate;
  assert.equal(keccak256(delegate.code), delegate.runtimeHash); await rpc("anvil_setCode", [delegate.address, delegate.code]);
  await rpc("anvil_setCode", [creator.address, "0xef0100" + delegate.address.slice(2).toLowerCase()]);
  evidence.delegation = { kind: "ANVIL_STATE_FIXTURE_NOT_AUTHORIZATION_SIGNATURE", address: delegate.address, runtimeHash: delegate.runtimeHash };
  const factoryAbi = artifacts.RMTLaunchCurveFactoryV2.abi, curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
  const ledgerAbi = artifacts.RMTLaunchCurveRevenueLedgerV1.abi, lpAbi = artifacts.RMTLaunchCurveLpFeeLedgerV1.abi;
  const engineAbi = artifacts.RMTV4CurveGraduationV1.abi, treasuryAbi = treasuryCompilation.artifacts.RMTProjectTreasuryV1.abi;
  const read = (address, abi, name, args = []) => call(client, address, abi, name, args);
  const ownerCall = (treasury, name, args = [], value = 0n) => send(creator.address, { ...transact(treasury, treasuryAbi, name, args), value });
  try {
    const session = await createTreasuryProjectsFromForm({ browserEngine, site, out, rpc, client, creator: creator.address,
      treasuryDeployment, factoryAbi, treasuryAbi, send, event, mine, ready, waitFor, hideReceipt, hideNativeProof });
    const { optedOut, optedIn } = session; evidence.browser = session.evidence;
    assert.notEqual(optedOut.token.toLowerCase(), optedIn.token.toLowerCase());
    assert.equal(await read(optedOut.curve, curveAbi, "treasury"), zeroAddress);
    assert.equal(await read(optedOut.curve, curveAbi, "treasuryShareBps"), 0);
    assert.equal(await read(treasuryDeployment.treasuryFactory, treasuryCompilation.artifacts.RMTProjectTreasuryFactoryV1.abi,
      "treasuryForIntent", [creator.address, optedOut.intentId]), zeroAddress, "Opting out must not create a treasury");
    const project = { ...optedIn, creator: creator.address }; const treasury = optedIn.treasury;
    assert.ok(same(await read(project.curve, curveAbi, "treasury"), treasury));
    assert.equal(await read(project.curve, curveAbi, "treasuryShareBps"), 2250);
    assert.equal(await read(project.token, erc20Abi, "totalSupply"), supply);
    assert.equal(await read(project.curve, curveAbi, "backingReserve"), 0n);
    assert.equal(await read(project.token, erc20Abi, "balanceOf", [project.curve]), supply);
    await assert.rejects(client.simulateContract({ account: creator.address, address: treasuryDeployment.treasuryFactory,
      abi: treasuryCompilation.artifacts.RMTProjectTreasuryFactoryV1.abi, functionName: "create",
      args: [optedIn.intentId, creator.address, 2250, treasuryCompilation.artifacts.RMTProjectTreasuryV1.bytecode] }), "A completed treasury intent cannot deploy twice");
    const otherPrediction = await read(treasuryDeployment.treasuryFactory, treasuryCompilation.artifacts.RMTProjectTreasuryFactoryV1.abi,
      "predict", [relayer.address, optedIn.intentId, creator.address, 2250, treasuryCompilation.artifacts.RMTProjectTreasuryV1.bytecode]);
    assert.equal(same(otherPrediction, treasury), false, "Another creator cannot reserve this project's CREATE2 identity");
    evidence.projects = { optedOut, optedIn }; evidence.checks.newFormOptOutAndTwoStepOptIn = true; save();
    const [firstQuote] = await read(project.curve, curveAbi, "quoteBuy", [10n ** 17n]);
    await send(creator.address, { ...transact(project.curve, curveAbi, "buy", [firstQuote, await deadline()]), value: 10n ** 17n });
    const treasuryDue = await read(project.revenueLedger, ledgerAbi, "claimable", [treasury]);
    assert.equal(treasuryDue, 225_000_000_000_000n);
    const nonceBeforeGasRejection = await client.getTransactionCount({ address: creator.address, blockTag: "pending" });
    await assert.rejects(send(creator.address, { ...transact(treasury, treasuryAbi, "claimCurve"), gas: 21_000n }), /gas|intrinsic/i);
    assert.equal(await client.getTransactionCount({ address: creator.address, blockTag: "pending" }), nonceBeforeGasRejection);
    assert.equal(await read(project.revenueLedger, ledgerAbi, "claimable", [treasury]), treasuryDue);
    evidence.checks.insufficientGasCannotConsumeClaimOrNonce = true;
    const uiClaim = await claimCurveThroughTreasuryPage({ session, treasury, ledger: project.revenueLedger, site, mine, ready, hideNativeProof });
    evidence.curveClaimFromDashboard = uiClaim;
    assert.equal(await read(project.revenueLedger, ledgerAbi, "claimable", [treasury]), 0n);
    assert.equal((await read(treasury, treasuryAbi, "totals", [zeroAddress]))[3], treasuryDue);
    await ownerCall(treasury, "depositNative", [], 5n * 10n ** 15n);
    const royaltySource = keccak256("0x746573742d6465636c617265642d726f79616c7479");
    await ownerCall(treasury, "depositRoyaltyNative", [royaltySource], 2n * 10n ** 15n);
    await send(creator.address, { to: treasury, value: 10n ** 15n });
    for (const [amount, method, args] of [[10n ** 18n, "depositToken", [project.token, 10n ** 18n]],
      [2n * 10n ** 18n, "depositRoyaltyToken", [project.token, 2n * 10n ** 18n, royaltySource]]]) {
      await send(creator.address, transact(project.token, erc20Abi, "approve", [treasury, amount]));
      await ownerCall(treasury, method, args);
      assert.equal(await read(project.token, erc20Abi, "allowance", [creator.address, treasury]), 0n);
    }
    await send(creator.address, transact(project.token, erc20Abi, "transfer", [treasury, 3n * 10n ** 18n]));
    await ownerCall(treasury, "reconcile", [project.token]);
    const nativeFunding = await read(treasury, treasuryAbi, "totals", [zeroAddress]);
    const tokenFunding = await read(treasury, treasuryAbi, "totals", [project.token]);
    assert.deepEqual(nativeFunding.slice(0, 4), [5n * 10n ** 15n, 2n * 10n ** 15n, 10n ** 15n, treasuryDue]);
    assert.deepEqual(tokenFunding.slice(0, 3), [10n ** 18n, 2n * 10n ** 18n, 3n * 10n ** 18n]);
    evidence.funding = { native: nativeFunding, token: tokenFunding, source: royaltySource,
      classification: "Sender-declared test funding, not independently proven marketplace royalties" };
    const policy = { perTransactionWei: 10n ** 15n, perPeriodWei: 2n * 10n ** 15n, minimumWei: 10n ** 14n,
      cooldownSeconds: 60, periodSeconds: 3600, maxSlippageBps: 100, maxImpactBps: 100 };
    assert.equal(await read(treasury, treasuryAbi, "purchasesEnabled"), false);
    await ownerCall(treasury, "setPurchasePolicy", [policy, true]);
    assert.equal(await read(treasury, treasuryAbi, "purchasesEnabled"), true);
    assert.equal(await read(treasury, treasuryAbi, "purchaseExecutionAvailable"), false);
    const heldBefore = [await client.getBalance({ address: treasury }), await read(project.token, erc20Abi, "balanceOf", [treasury])];
    const quoteBlock = await client.getBlock();
    const purchase = { amountWei: policy.minimumWei, minimumTokenOut: 1n, deadline: Number(quoteBlock.timestamp + 120n),
      quoteObservedAt: Number(quoteBlock.timestamp), quoteBlock: quoteBlock.number - 1n,
      policyEpoch: await read(treasury, treasuryAbi, "purchasePolicyEpoch"), routeHash: keccak256("0x01"), referenceHash: keccak256("0x02"),
      quotedSlippageBps: 50, quotedImpactBps: 50 };
    for (const request of [purchase, { ...purchase, amountWei: policy.perTransactionWei + 1n },
      { ...purchase, quotedSlippageBps: 101 }, { ...purchase, quoteObservedAt: Number(quoteBlock.timestamp - 61n) }]) {
      await assert.rejects(client.simulateContract({ account: creator.address, address: treasury, abi: treasuryAbi,
        functionName: "executePurchase", args: [request] }), "Unsupported pricing, caps, slippage and stale observations must refuse execution");
    }
    await ownerCall(treasury, "disablePurchases");
    assert.equal(await read(treasury, treasuryAbi, "purchasesEnabled"), false);
    assert.deepEqual([await client.getBalance({ address: treasury }), await read(project.token, erc20Abi, "balanceOf", [treasury])], heldBefore);
    await ownerCall(treasury, "depositNative", [], 7n);
    assert.equal(await client.getBalance({ address: treasury }), heldBefore[0] + 7n, "Disabled purchasing cannot freeze incoming funding");
    evidence.checks.purchaseToggleNeverSpendsAndUnsupportedPriceRefused = true;
    const migrated = await proveFundedMigrations(client, artifacts, { ...deployed, scheduleFixtureMigration: async token => {
      await rpc("anvil_impersonateAccount", [operatorAccount.address]);
      try { return await deployed.scheduleFixtureMigration(token); }
      finally { await rpc("anvil_stopImpersonatingAccount", [operatorAccount.address]); }
    } }, send, transact, { ...project, beneficiaries: [creator.address, treasury,
      deployed.deployment.operatingRecipient, deployed.deployment.futureReserveRecipient] });
    project.originalCurve = project.curve; project.curve = migrated.curve; evidence.migrations = migrated;
    assert.equal(await read(treasury, treasuryAbi, "curveLedger"), project.revenueLedger);
    assert.deepEqual(await rpc("eth_accounts"), []); evidence.checks.originalLedgerV1V2V3 = true;
    // Queue after the migration time advances, so it is still unexpired after
    // controller acceptance. Rejection then proves epoch invalidation rather
    // than accidentally proving only an already expired withdrawal.
    const oldWithdrawal = await ownerCall(treasury, "queueWithdrawal", [project.token, creator.address, 10n ** 18n, await deadline(4 * 86400)]);
    const queuedId = event(oldWithdrawal, treasury, treasuryAbi, "WithdrawalQueued").id;
    await send(relayer.address, transact(treasury, treasuryAbi, "executeWithdrawal", [queuedId]), "reverted");

    const safeRuntime = JSON.parse(readFileSync(new URL("../../packages/contracts/test/fixtures/safe-1.4.1/runtime.json", import.meta.url)));
    for (const item of Object.values(safeRuntime.contracts)) { assert.equal(keccak256(item.code), item.runtimeKeccak256); await rpc("anvil_setCode", [item.address, item.code]); }
    const safeFactory = safeRuntime.contracts.safe_proxy_factory.address;
    const setup = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [owners.map(owner => owner.address), 2n, zeroAddress,
      "0x", safeRuntime.contracts.compatibility_fallback_handler.address, zeroAddress, 0n, zeroAddress] });
    const safeReceipt = await send(relayer.address, transact(safeFactory, safeFactoryAbi, "createProxyWithNonce", [safeRuntime.contracts.safe_l2.address, setup, 76n]));
    const safe = event(safeReceipt, safeFactory, safeFactoryAbi, "ProxyCreation").proxy;
    async function safeCall(name, args = [], count = 2, expected = "success") {
      const data = encodeFunctionData({ abi: treasuryAbi, functionName: name, args });
      const nonce = await read(safe, safeAbi, "nonce");
      const message = { to: treasury, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
        gasToken: zeroAddress, refundReceiver: zeroAddress, nonce };
      const digest = hashTypedData({ domain: { chainId: 31337, verifyingContract: safe }, types: safeTypes, primaryType: "SafeTx", message });
      const argsSafe = [treasury, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress];
      assert.equal(await read(safe, safeAbi, "getTransactionHash", [...argsSafe, nonce]), digest);
      const signatures = concatHex(await Promise.all(owners.slice(0, count).map(owner => owner.sign({ hash: digest }))));
      const receipt = await send(relayer.address, transact(safe, safeAbi, "execTransaction", [...argsSafe, signatures]), expected);
      if (expected === "success") { const success = event(receipt, safe, safeAbi, "ExecutionSuccess"); assert.equal(success.txHash, digest); assert.equal(success.payment, 0n); }
      else assert.equal(await read(safe, safeAbi, "nonce"), nonce);
      evidence.safeExecutions.push({ operation: name, count, digest, safe, receipt: receiptEvidence(receipt) }); save(); return receipt;
    }
    await ownerCall(treasury, "proposeController", [safe, await deadline(4 * 86400)]);
    await safeCall("acceptController", [], 2, "reverted");
    await rpc("evm_increaseTime", [2 * 86400]); await mine();
    await safeCall("acceptController", [], 1, "reverted");
    await safeCall("acceptController");
    assert.ok(same(await read(treasury, treasuryAbi, "controller"), safe));
    const priorNotice = await read(treasury, treasuryAbi, "withdrawals", [queuedId]), rotationTime = (await client.getBlock()).timestamp;
    assert.ok(BigInt(priorNotice[3]) <= rotationTime && rotationTime <= BigInt(priorNotice[4]), "The original withdrawal is mature and unexpired");
    assert.notEqual(priorNotice[5], await read(treasury, treasuryAbi, "controllerEpoch"));
    await send(relayer.address, transact(treasury, treasuryAbi, "executeWithdrawal", [queuedId]), "reverted");
    await safeCall("cancelWithdrawal", [queuedId]);
    assert.equal(await read(treasury, treasuryAbi, "reserved", [project.token]), 0n);
    assert.equal(await read(treasury, treasuryAbi, "purchasesEnabled"), false);
    await send(creator.address, transact(treasury, treasuryAbi, "claimCurve"), "reverted");
    evidence.checks.genuineSafeControllerRotationAndOneOwnerRejection = true;
    const [closing] = await read(project.curve, curveAbi, "quoteBuy", [3n * 10n ** 18n]);
    await send(creator.address, { ...transact(project.curve, curveAbi, "buy", [closing, await deadline()]), value: 3n * 10n ** 18n });
    assert.equal(await read(project.curve, curveAbi, "backingReserve"), backing);
    await safeCall("claimCurve");
    const graduated = await send(creator.address, transact(project.curve, curveAbi, "graduate", [await deadline()]));
    const position = event(graduated, deployed.graduationEngine, engineAbi, "CurveGraduated"); evidence.graduation = { ...position, receipt: receiptEvidence(graduated) };
    const custody = async () => { assert.equal(await read(anchor.positionManager.address, positionAbi, "ownerOf", [position.positionTokenId]), deployed.graduationEngine);
      assert.equal(await read(anchor.positionManager.address, positionAbi, "getPositionLiquidity", [position.positionTokenId]), position.liquidity); };
    await custody();
    await generateV4Fees({ client, send, creator, token: project.token, engine: deployed.graduationEngine, engineAbi, anchor, deadline });
    await safeCall("collectLpFees", [await deadline()]);
    const lpLedger = await read(deployed.graduationEngine, engineAbi, "lpFeeLedger", [project.token]);
    const lpDue = await read(lpLedger, lpAbi, "claimable", [treasury]); assert.ok(lpDue[0] > 0n && lpDue[1] > 0n);
    const beforeNativeClaim = await client.getBalance({ address: treasury });
    await safeCall("claimLp", [1]);
    assert.equal(await client.getBalance({ address: treasury }) - beforeNativeClaim, lpDue[0]);
    assert.deepEqual(await read(lpLedger, lpAbi, "claimable", [treasury]), [0n, lpDue[1]]);
    const beforeTokenClaim = await read(project.token, erc20Abi, "balanceOf", [treasury]);
    const reorg = await rpc("evm_snapshot");
    const claimed = await safeCall("claimLp", [2]);
    assert.equal(await read(project.token, erc20Abi, "balanceOf", [treasury]) - beforeTokenClaim, lpDue[1]);
    await custody(); await mine(); await ready();
    evidence.lpClaims = { treasury, ledger: lpLedger, nativeWei: lpDue[0], tokenWei: lpDue[1] };
    const readIndexed = async () => {
      const url = new URL("/project-treasuries", workerOrigin); url.searchParams.set("address", treasury);
      const response = await fetch(url, { headers: { "X-RMT-Fixture-Key": indexReadKey }, signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200); const result = await response.json();
      assert.equal(result.chainId, 31337); assert.equal(result.profile, "rmt-project-treasury-v1");
      assert.ok(result.treasuries.some(row => same(row.treasury, treasury))); return result;
    };
    evidence.indexed = await readIndexed(); await restart(); evidence.afterRestart = await readIndexed();
    await rpc("evm_revert", [reorg]); await rpc("evm_increaseTime", [79]); await mine(); await ready();
    assert.equal(await read(project.token, erc20Abi, "balanceOf", [treasury]), beforeTokenClaim);
    await waitFor("orphan treasury claim removed", async () => !(await readIndexed()).events.some(row => same(row.transactionHash, claimed.transactionHash)));
    assert.deepEqual(await read(lpLedger, lpAbi, "claimable", [treasury]), [0n, lpDue[1]]); await custody();
    evidence.checks.nativeTokenClaimsAndPrincipal = true; evidence.checks.restartReorgRestoresCredit = true;
    const withdrawal = await safeCall("queueWithdrawal", [project.token, creator.address, 10n ** 18n, await deadline(4 * 86400)]);
    const withdrawalId = event(withdrawal, treasury, treasuryAbi, "WithdrawalQueued").id;
    await rpc("evm_increaseTime", [2 * 86400]); await mine();
    const priorHolding = await read(project.token, erc20Abi, "balanceOf", [creator.address]);
    await send(relayer.address, transact(treasury, treasuryAbi, "executeWithdrawal", [withdrawalId]));
    assert.equal(await read(project.token, erc20Abi, "balanceOf", [creator.address]) - priorHolding, 10n ** 18n);
    assert.equal(await read(treasury, treasuryAbi, "reserved", [project.token]), 0n); await custody();
    evidence.checks.timelockedTokenRecoveryAndRotationInvalidation = true;
    await mine(); await ready();
    await exerciseTreasuryPage({ session, project, treasury, safe, site, out, evidence, mine, ready, save });
    evidence.status = "passed"; save(); await session.close();
  } catch (error) { evidence.failure = error instanceof Error ? error.stack : String(error); save(); throw error; }
}

async function generateV4Fees({ client, send, creator, token, engine, engineAbi, anchor, deadline }) {
  const key = await call(client, engine, engineAbi, "canonicalPoolKey", [token]);
  const quoter = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)"]);
  const router = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
  const permit = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
  const swapTypes = [{ type: "tuple", components: parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData") }];
  async function swap(buy, amount, expires) {
    const quote = await client.simulateContract({ account: creator.address, address: anchor.quoter.address, abi: quoter,
      functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: buy, exactAmount: amount, hookData: "0x" }] });
    const minimum = quote.result[0] * 99n / 100n; assert.ok(minimum > 0n);
    const route = encodeAbiParameters(parseAbiParameters("bytes actions,bytes[] inputs"), ["0x060b0f", [encodeAbiParameters(swapTypes,
      [{ poolKey: key, zeroForOne: buy, amountIn: amount, amountOutMinimum: minimum, minHopPriceX36: minimum * 10n ** 36n / amount, hookData: "0x" }]),
    encodeAbiParameters(parseAbiParameters("address currency,uint256 amount,bool payerIsUser"), [buy ? key.currency0 : key.currency1, amount, true]),
    encodeAbiParameters(parseAbiParameters("address currency,uint256 minimum"), [buy ? key.currency1 : key.currency0, minimum])]]);
    return send(creator.address, { ...transact(anchor.universalRouter212.address, router, "execute", ["0x10", [route], expires]), value: buy ? amount : 0n });
  }
  await swap(true, 10n ** 16n, await deadline());
  const amount = 100n * 10n ** 18n, expires = await deadline();
  await send(creator.address, transact(token, erc20Abi, "approve", [anchor.permit2.address, amount]));
  await send(creator.address, transact(anchor.permit2.address, permit, "approve", [token, anchor.universalRouter212.address, amount, Number(expires)]));
  await swap(false, amount, expires);
  assert.equal(await call(client, token, erc20Abi, "allowance", [creator.address, anchor.permit2.address]), 0n);
}
