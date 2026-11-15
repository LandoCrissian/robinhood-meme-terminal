import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
const { encodeDeployData, erc20Abi, parseEther, toHex, zeroAddress } =
  createRequire(new URL("../../../apps/web/package.json", import.meta.url))("viem");
// The original harness and its archive proxy come from the disposable #594 checkout.
const { withAnvilFork } = await import(new URL("./robinhood-4663-fork-environment.mjs", import.meta.url));
const {
  compile, localClient, deploy, migrateCurve, proveCreation, proveSwap, send, read, request,
  verifiedRuntime, oneEvent, receiptEvidence, poolIdFor, positionAbi, stateAbi,
} = await import(new URL("./validate-curve-graduation-4663.mjs", import.meta.url));
const terms = JSON.parse(readFileSync(new URL("./4663-treasury-review-manifest.json", import.meta.url), "utf8"));
const backing = BigInt(terms.provisionalTerms.graduationBackingWei);
const same = (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const sum = (values) => values.reduce((total, value) => total + value, 0n);
const subtract = (left, right) => left.map((value, i) => value - right[i]);
const balances = (client, token, account) => Promise.all([
  client.getBalance({ address: account }), read(client, token, erc20Abi, "balanceOf", [account]),
]);

function split(amount, bps) {
  const platform = amount / 10n;
  const project = amount - platform;
  const treasury = project * BigInt(bps) / 9_000n;
  return [project - treasury, treasury, platform / 2n, platform - platform / 2n];
}

async function nativeSettlement(client, receipt, ledger, payee, amount) {
  const root = await client.request({
    method: "debug_traceTransaction", params: [receipt.transactionHash, { tracer: "callTracer" }],
  });
  assert.ok(!root.error && same(root.from, receipt.from) && same(root.to, receipt.to));
  const collect = (frame) => frame.error ? [] : [frame, ...(frame.calls ?? []).flatMap(collect)];
  const payments = collect(root).filter((frame) => frame.type === "CALL" && same(frame.from, ledger)
    && same(frame.to, payee) && BigInt(frame.value ?? 0) > 0n);
  assert.equal(sum(payments.map((frame) => BigInt(frame.value))), amount);
  assert.equal(payments.length, Number(amount > 0n));
  return payments.map(({ from, to, value }) => ({ from, to, value }));
}

async function deployRejectingTreasury(client, controller, solc) {
  const content = readFileSync(new URL("./RejectingTreasury.sol", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const input = JSON.stringify({ language: "Solidity", sources: { "RejectingTreasury.sol": { content } },
    settings: { evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } });
  const output = JSON.parse(execFileSync(resolve(solc), ["--standard-json", "--no-import-callback"], {
    input, encoding: "utf8", timeout: 15_000, windowsHide: true,
  }));
  const fixture = output.contracts["RejectingTreasury.sol"].RejectingTreasury;
  const receipt = await send(client, controller, { data: encodeDeployData({
    abi: fixture.abi, bytecode: "0x" + fixture.evm.bytecode.object, args: [controller],
  }) });
  const address = receipt.contractAddress;
  const invoke = (call, status = "success") =>
    send(client, controller, request(address, fixture.abi, "invoke", [call.to, call.data]), status);
  return { address, kind: "rejecting-fixture", setup: receiptEvidence(receipt), invoke,
    allowNative: () => send(client, controller, request(address, fixture.abi, "allowNative")) };
}

async function assertBuckets(client, ledger, abi, recipients, bps, total, claimed, lp) {
  const assetTotals = lp ? total : [total];
  const expected = assetTotals.map((amount) => split(amount, bps));
  const accrued = await read(client, ledger, abi, "totalAccrued");
  assert.deepEqual(accrued, total);
  assert.deepEqual(await read(client, ledger, abi, "totalClaimed"), lp
    ? [sum(claimed.map((value) => value[0])), sum(claimed.map((value) => value[1]))] : sum(claimed));
  for (const [index, recipient] of recipients.entries()) {
    const bucket = expected.map((value) => value[index]);
    assert.deepEqual(await read(client, ledger, abi, "bucketAccrued", [BigInt(index)]), lp ? bucket : bucket[0]);
    const remaining = lp ? subtract(bucket, claimed[index]) : bucket[0] - claimed[index];
    assert.deepEqual(await read(client, ledger, abi, "claimable", [recipient]), remaining);
  }
  return expected;
}

async function proveClaim(client, token, ledger, abi, account, mode, expected, execute) {
  const lp = mode !== "curve";
  const call = mode === "native" || mode === "token"
    ? request(ledger, abi, "claimAsset", [mode === "native"]) : request(ledger, abi, "claim");
  const initial = await balances(client, token, account);
  const execution = await execute(call);
  const receipt = execution.receipt ?? execution;
  const { args, logIndex } = oneEvent(receipt, ledger, abi, lp ? "LpFeesClaimed" : "CurveFeeClaimed");
  assert.ok(same(args.recipient, account));
  assert.deepEqual(lp ? [args.nativeAmount, args.tokenAmount] : [args.amount, 0n], expected);
  const settled = subtract(await balances(client, token, account), initial);
  if (same(account, receipt.from)) settled[0] += receipt.gasUsed * receipt.effectiveGasPrice;
  assert.deepEqual(settled, expected);
  if (expected[1] > 0n) {
    const { args: transfer } = oneEvent(receipt, token, erc20Abi, "Transfer");
    assert.ok(same(transfer.from, ledger) && same(transfer.to, account));
    assert.equal(transfer.value, expected[1]);
  }
  const nativeProof = await nativeSettlement(client, receipt, ledger, account, expected[0]);
  return { ...receiptEvidence(receipt), mode, beneficiary: account, submitter: receipt.from, logIndex,
    nativeAmount: expected[0], tokenAmount: expected[1], nativeProof,
    ...(execution.receipt ? { safeTxHash: execution.safeTxHash, safeNonce: execution.nonce,
      safeAttribution: execution.attribution, safeAuthorization: execution.authorization } : {}) };
}

async function proveRejected(client, token, ledger, abi, account, invoke, lp) {
  const snapshot = () => Promise.all([
    read(client, ledger, abi, "claimable", [account]), read(client, ledger, abi, "totalClaimed"),
    balances(client, token, ledger), balances(client, token, account),
  ]);
  const before = await snapshot();
  const receipt = await invoke(request(ledger, abi, "claim"), "reverted");
  assert.equal(receipt.logs.length, 0);
  assert.deepEqual(await snapshot(), before);
  return { ...receiptEvidence(receipt), beneficiary: account, unchanged: before, stream: lp ? "lp" : "curve" };
}

async function harvest(client, token, position, ledger, engine, artifacts, pins, collector) {
  const abi = artifacts.RMTV4CurveGraduationV1.abi;
  const ledgerAbi = artifacts.RMTLaunchCurveLpFeeLedgerV1.abi;
  const collected = await read(client, ledger, ledgerAbi, "totalAccrued");
  const expected = await read(client, engine, abi, "previewLpFees", [token]);
  assert.ok(expected.every((fee) => fee > 0n));
  const previous = await balances(client, token, ledger);
  const deadline = (await client.getBlock()).timestamp + 300n;
  const call = request(engine, abi, "collectLpFees", [token, deadline]);
  const receipt = await send(client, collector, call);
  const { args, logIndex } = oneEvent(receipt, engine, abi, "LpFeesCollected");
  assert.ok(same(args.token, token) && same(args.ledger, ledger));
  assert.equal(args.positionTokenId, position.positionTokenId);
  assert.deepEqual([args.nativeAmount, args.tokenAmount], expected);
  assert.deepEqual(subtract(await balances(client, token, ledger), previous), expected);
  const { args: transfer } = oneEvent(receipt, token, erc20Abi, "Transfer");
  assert.ok(same(transfer.from, pins.poolManager.address) && same(transfer.to, ledger));
  assert.equal(transfer.value, expected[1]);
  const nativeProof = await nativeSettlement(client, receipt, pins.poolManager.address, ledger, expected[0]);
  const next = collected.map((amount, index) => amount + expected[index]);
  assert.deepEqual(await read(client, engine, abi, "previewLpFees", [token]), [0n, 0n]);
  const empty = await send(client, collector, call, "reverted");
  assert.equal(empty.logs.length, 0);
  return { ...receiptEvidence(receipt), nativeProof, amount: expected, cumulative: next, logIndex,
    repeatRejected: receiptEvidence(empty) };
}

async function verifyPosition(client, pins, position, engine) {
  const args = [position.positionTokenId];
  const positions = pins.positionManager.address;
  const [owner, liquidity, [key], approved] = await Promise.all([
    read(client, positions, positionAbi, "ownerOf", args),
    read(client, positions, positionAbi, "getPositionLiquidity", args),
    read(client, positions, positionAbi, "getPoolAndPositionInfo", args),
    read(client, positions, positionAbi, "getApproved", args),
  ]);
  assert.ok(same(owner, engine) && same(approved, zeroAddress));
  assert.equal(liquidity, position.liquidity);
  assert.equal(poolIdFor(key), position.poolId);
  return { owner, liquidity, poolId: position.poolId, key, approved };
}

async function launchCase(client, accounts, artifacts, pins, deployment, test, ordinal) {
  const [operator, operating, reserve, creator, trader, collector] = accounts;
  const { factory, graduationEngine: engine, guard } = deployment;
  const { percent, treasury } = test;
  const bps = percent * 90;
  const recipients = [creator, treasury.address, operating, reserve];
  assert.equal(new Set(recipients.map((address) => address.toLowerCase())).size, 4);
  const treasuryExec = treasury.execute
    ? (call) => treasury.execute(call) : treasury.invoke
      ? (call) => treasury.invoke(call) : (call) => send(client, treasury.address, call);
  const senders = recipients.map((account, i) => i === 1 ? treasuryExec : (call) => send(client, account, call));
  const factoryAbi = artifacts.RMTLaunchCurveFactoryV1.abi;
  const curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
  const revenueAbi = artifacts.RMTLaunchCurveRevenueLedgerV1.abi;
  const lpAbi = artifacts.RMTLaunchCurveLpFeeLedgerV1.abi;
  const engineAbi = artifacts.RMTV4CurveGraduationV1.abi;
  const deadline = () => client.getBlock().then((block) => block.timestamp + 900n);
  const creation = await proveCreation(client, deployment, factoryAbi, creator,
    ["Treasury " + ordinal, "TRY" + ordinal, "", 0, treasury.address, bps, toHex(ordinal, { size: 32 }), await deadline()], 17n);
  const { token, curve: origin, revenueLedger, supply } = creation.created.args;
  assert.ok(same(creation.created.args.creator, creator));
  assert.equal(await read(client, token, erc20Abi, "totalSupply"), supply);
  assert.deepEqual(await balances(client, token, origin), [0n, supply]);
  assert.deepEqual(await balances(client, token, revenueLedger), [0n, 0n]);
  const policy = async (ledger, abi) => {
    const addresses = await Promise.all(["creator", "treasury", "operatingRecipient", "futureReserveRecipient"]
      .map((name) => read(client, ledger, abi, name)));
    assert.ok(addresses.every((address, i) => same(address, recipients[i])));
    assert.equal(await read(client, ledger, abi, "treasuryShareBps"), bps);
  };
  await policy(revenueLedger, revenueAbi);

  let accrued = 0n;
  const claimed = [0n, 0n, 0n, 0n];
  const curveTrades = [];
  async function checkTrade(receipt, curve) {
    const { args, logIndex } = oneEvent(receipt, revenueLedger, revenueAbi, "CurveFeesAccrued");
    const trade = oneEvent(receipt, curve, curveAbi, "CurveTrade").args;
    const fee = trade.isBuy ? trade.grossNative - (trade.grossNative * 9_900n / 10_000n)
      : (trade.grossNative * 100n + 9_999n) / 10_000n;
    assert.equal(args.fee, fee);
    const previous = split(accrued, bps);
    accrued += args.fee;
    assert.deepEqual([args.creatorAmount, args.treasuryAmount, args.operatingAmount, args.futureReserveAmount],
      subtract(split(accrued, bps), previous));
    await assertBuckets(client, revenueLedger, revenueAbi, recipients, bps, accrued, claimed, false);
    curveTrades.push({ ...receiptEvidence(receipt), logIndex, grossNative: trade.grossNative, ...args });
  }
  async function curveBuy(curve, budget) {
    const [quote] = await read(client, curve, curveAbi, "quoteBuy", [budget]);
    assert.ok(quote > 0n);
    const receipt = await send(client, trader, { ...request(curve, curveAbi, "buy", [quote, await deadline()]), value: budget });
    await checkTrade(receipt, curve);
    return { quote, receipt };
  }
  const { quote } = await curveBuy(origin, parseEther("0.1") + 1_987n);
  const sellSize = quote / 2n;
  const [nativeOut] = await read(client, origin, curveAbi, "quoteSell", [sellSize]);
  await send(client, trader, request(token, erc20Abi, "approve", [origin, sellSize]));
  await checkTrade(await send(client, trader, request(origin, curveAbi, "sell", [sellSize, nativeOut, await deadline()])), origin);
  const curveClaims = [];
  const rejectPayout = [];
  if (treasury.kind === "rejecting-fixture") {
    rejectPayout.push(await proveRejected(client, token, revenueLedger, revenueAbi, treasury.address, treasury.invoke, false));
  }
  const migrations = [];
  let curve = origin;
  for (const version of [2, 3]) {
    const migration = await migrateCurve(client, creator, operator, artifacts, deployment, token, [trader]);
    assert.equal(migration.toVersion, version);
    migrations.push(migration);
    curve = migration.activeCurve;
    await policy(revenueLedger, revenueAbi);
    await assertBuckets(client, revenueLedger, revenueAbi, recipients, bps, accrued, claimed, false);
    if (version === 2) await curveBuy(curve, parseEther("0.025") + 297n);
  }
  // Diverted credits are already earned while the curve is live. The rejecting
  // fixture leaves theirs pending until token-only LP recovery has been proven.
  for (const [i, recipient] of recipients.entries()) {
    const amount = split(accrued, bps)[i];
    if (amount === 0n || (i === 1 && treasury.kind === "rejecting-fixture")) continue;
    curveClaims.push(await proveClaim(client, token, revenueLedger, revenueAbi, recipient, "curve", [amount, 0n], senders[i]));
    claimed[i] += amount;
  }
  const final = await curveBuy(curve, backing * 2n);
  const curveTrade = oneEvent(final.receipt, curve, curveAbi, "CurveTrade").args;
  assert.ok(curveTrade.nativeRefund > 0n);
  assert.equal(await read(client, curve, curveAbi, "backingReserve"), backing);
  assert.deepEqual(await balances(client, token, curve), [backing, supply * 2n / 5n]);
  assert.ok(same(await read(client, factory, factoryAbi, "originCurveForToken", [token]), origin));

  const positionKey = await read(client, engine, engineAbi, "canonicalPoolKey", [token]);
  assert.ok(same(positionKey.hooks, guard));
  const poolId = poolIdFor(positionKey);
  const state = pins.stateView.address;
  assert.equal((await read(client, state, stateAbi, "getSlot0", [poolId]))[0], 0n);
  const graduate = request(curve, curveAbi, "graduate", [await deadline()]);
  const interrupted = await send(client, collector, { ...graduate, gas: 160_000n }, "reverted");
  assert.equal(interrupted.logs.length, 0);
  assert.deepEqual(await balances(client, token, curve), [backing, supply * 2n / 5n]);
  assert.equal((await read(client, state, stateAbi, "getSlot0", [poolId]))[0], 0n);
  const manager = pins.poolManager.address;
  const beforeFunding = await balances(client, token, manager);
  const completion = await send(client, collector, graduate);
  const { args: position, logIndex: graduationLogIndex } = oneEvent(completion, engine, engineAbi, "CurveGraduated");
  assert.ok(same(position.token, token) && same(position.curve, curve));
  assert.equal(position.poolId, poolId);
  assert.equal(position.nativeUsed + position.nativeDust, backing);
  assert.equal(position.tokenUsed + position.tokenDust, supply * 2n / 5n);
  assert.deepEqual(subtract(await balances(client, token, manager), beforeFunding), [position.nativeUsed, position.tokenUsed]);
  const custody = await verifyPosition(client, pins, position, engine);
  const deniedTransfer = await send(client, creator,
    request(pins.positionManager.address, positionAbi, "transferFrom", [engine, creator, position.positionTokenId]), "reverted");
  const ledger = await read(client, engine, engineAbi, "lpFeeLedger", [token]);
  const ledgerHash = await verifiedRuntime(client, ledger, artifacts.RMTLaunchCurveLpFeeLedgerV1);
  await policy(ledger, lpAbi);
  const lpClaimed = recipients.map(() => [0n, 0n]);
  const lpClaims = [];
  const collections = [];
  const swaps = [];
  for (const round of [0, 1]) {
    const buy = await proveSwap(client, pins, positionKey, trader, true, parseEther("0.1") + BigInt(round));
    const sell = await proveSwap(client, pins, positionKey, trader, false, buy.output / 2n);
    swaps.push({ buy, sell });
    const collection = await harvest(client, token, position, ledger, engine, artifacts, pins, collector);
    const buckets = await assertBuckets(client, ledger, lpAbi, recipients, bps, collection.cumulative, lpClaimed, true);
    collections.push({ ...collection, buckets });
    for (const [i, recipient] of recipients.entries()) {
      const expected = subtract(buckets.map((bucket) => bucket[i]), lpClaimed[i]);
      if (expected.every((amount) => amount === 0n)) continue;
      if (round === 0 && i === 1 && treasury.kind === "rejecting-fixture") {
        rejectPayout.push(await proveRejected(client, token, ledger, lpAbi, recipient, treasury.invoke, true));
        lpClaims.push(await proveClaim(client, token, ledger, lpAbi, recipient, "token", [0n, expected[1]], senders[i]));
        lpClaimed[i][1] += expected[1];
        await treasury.allowNative();
        lpClaims.push(await proveClaim(client, token, ledger, lpAbi, recipient, "native", [expected[0], 0n], senders[i]));
        lpClaimed[i][0] += expected[0];
      } else if (round === 1 && i === 1 && treasury.execute) {
        for (const [index, mode] of ["native", "token"].entries()) {
          assert.ok(expected[index] > 0n);
          const payout = index === 0 ? [expected[0], 0n] : [0n, expected[1]];
          lpClaims.push(await proveClaim(client, token, ledger, lpAbi, recipient, mode, payout, senders[i]));
        }
        lpClaimed[i] = [lpClaimed[i][0] + expected[0], lpClaimed[i][1] + expected[1]];
      } else {
        lpClaims.push(await proveClaim(client, token, ledger, lpAbi, recipient, "combined", expected, senders[i]));
        lpClaimed[i] = [lpClaimed[i][0] + expected[0], lpClaimed[i][1] + expected[1]];
      }
      await assertBuckets(client, ledger, lpAbi, recipients, bps, collection.cumulative, lpClaimed, true);
    }
    assert.deepEqual(await balances(client, token, ledger), [0n, 0n]);
    assert.deepEqual(await verifyPosition(client, pins, position, engine), custody);
  }
  for (const [i, recipient] of recipients.entries()) {
    const amount = split(accrued, bps)[i] - claimed[i];
    if (amount === 0n) continue;
    curveClaims.push(await proveClaim(client, token, revenueLedger, revenueAbi, recipient, "curve", [amount, 0n], senders[i]));
    claimed[i] += amount;
  }
  const curveBuckets = await assertBuckets(client, revenueLedger, revenueAbi, recipients, bps, accrued, claimed, false);
  assert.deepEqual(await balances(client, token, revenueLedger), [0n, 0n]);
  assert.equal(await read(client, token, erc20Abi, "totalSupply"), supply);
  if (treasury.proveSpending) {
    treasury.spending = await treasury.proveSpending({ token, spendingWallet: trader,
      nativeAmount: lpClaimed[1][0] / 2n, tokenAmount: lpClaimed[1][1] / 2n });
  }
  return { percent, bps, recipients, treasuryKind: treasury.kind, treasurySetup: treasury.setup,
    treasurySpending: treasury.spending, creator, token, supply,
    creation: { ...receiptEvidence(creation.launch), fee: creation.fee, insufficient: creation.insufficient,
      logIndex: creation.created.logIndex, origin, revenueLedger },
    curve: { trades: curveTrades, migrations, accrued, buckets: curveBuckets[0], claims: curveClaims },
    graduation: { ...receiptEvidence(completion), logIndex: graduationLogIndex, ...position, custody,
      interrupted: receiptEvidence(interrupted), deniedTransfer: receiptEvidence(deniedTransfer) },
    swaps, lp: { ledger, ledgerHash, collections, claims: lpClaims, amountsClaimed: lpClaimed },
    rejectedPayout: rejectPayout };
}

const { values } = parseArgs({ options: {
  anvil: { type: "string" }, solc: { type: "string" }, archive: { type: "string", default: "pinax" },
  safe: { type: "boolean", default: false }, "safe-only": { type: "boolean", default: false },
  lib: { type: "string" },
} });
assert.ok(values.anvil && values.solc, "Explicit pinned Anvil and Solc paths required");
assert.ok(!values["safe-only"] || values.safe, "Select --safe with --safe-only");
const { artifacts, manifest } = compile(values, 4663, backing);
assert.equal(manifest.inputSha256, terms.compiler.inputSha256);
const results = await withAnvilFork(values, async ({ rpcUrl, accounts, report }) => {
  assert.equal(report.network.blockNumber, terms.freshFork.block);
  assert.equal(report.archiveBoundary.blockedWriteProbe, "HTTP 403");
  const client = localClient(rpcUrl, 4663);
  assert.equal(await client.getChainId(), 4663);
  const pins = report.network.contracts;
  const deployment = await deploy(client, accounts, pins, artifacts);
  const [operator, operating, , , , collector] = accounts;
  const cases = [];
  async function runCase(percent, treasury, ordinal) {
    console.error("Running 4663 treasury " + percent + "% (" + treasury.kind + ")");
    cases.push(await launchCase(client, accounts, artifacts, pins, deployment, { percent, treasury }, ordinal));
    console.error("Passed 4663 treasury " + percent + "% (" + treasury.kind + ")");
  }
  if (!values["safe-only"]) {
    const rejecting = await deployRejectingTreasury(client, collector, values.solc);
    const eoa = { address: collector, kind: "EOA" };
    const matrix = [[0, { address: zeroAddress, kind: "none" }], [25, eoa], [50, rejecting], [100, eoa]];
    for (const [ordinal, [percent, treasury]] of matrix.entries()) await runCase(percent, treasury, ordinal + 1);
  }
  if (values.safe) {
    const { setupFixtureSafe, proveSafeSpending } = await import("./safe-rehearsal.mjs");
    const safe = await setupFixtureSafe({ client, sender: collector, submit: (from, payload, expected) =>
      send(client, from, payload, expected), fixtureBlock: BigInt(report.network.blockNumber) });
    let checkedClaimAuthorization = false;
    async function execute(call) {
      if (checkedClaimAuthorization) return safe.execute(call);
      const insufficient = await safe.rejectInsufficient(call);
      const execution = await safe.execute(call);
      const replay = await safe.rejectReplay(execution);
      checkedClaimAuthorization = true;
      return { ...execution, authorization: { insufficient, replay } };
    }
    await runCase(25, { ...safe, execute, kind: "safe-1.4.1", proveSpending: (params) =>
      proveSafeSpending({ safe, client, ...params }) }, 5);
    assert.ok(checkedClaimAuthorization);
  }
  const creationFees = await read(client, deployment.factory, artifacts.RMTLaunchCurveFactoryV1.abi, "creationFeesAccrued");
  assert.equal(creationFees, deployment.creationFeeWei * BigInt(cases.length));
  const before = await client.getBalance({ address: operating });
  const claim = await send(client, operator, request(deployment.factory, artifacts.RMTLaunchCurveFactoryV1.abi, "claimCreationFees"));
  assert.equal(await client.getBalance({ address: operating }) - before, creationFees);
  assert.equal(await client.getBalance({ address: deployment.factory }), 0n);
  const constructors = {};
  for (const [i, [name, address]] of Object.entries([
    ["directory", deployment.directory], ["registry", deployment.projectRegistry],
    ["v2Template", deployment.deployment.successorDeployer], ["bootstrap", deployment.deployment.address],
  ])) {
    const block = await client.getBlock({ blockNumber: deployment.deployBlock - 3n + BigInt(i) });
    assert.equal(block.transactions.length, 1);
    const receipt = await client.getTransactionReceipt({ hash: block.transactions[0] });
    assert.ok(same(receipt.contractAddress, address) && receipt.status === "success");
    constructors[name] = { ...receiptEvidence(receipt), address };
  }
  constructors.v3Template = { ...deployment.v3Template.deployed, address: deployment.v3Template.deployer };
  return { report, deployment, constructors, cases,
    creationFeeClaim: { ...receiptEvidence(claim), recipient: operating, nativeAmount: creationFees } };
});
console.log(JSON.stringify({ profile: terms.profile, compiler: manifest, ...results }, (_, value) =>
  typeof value === "bigint" ? value.toString() : value, 2));
