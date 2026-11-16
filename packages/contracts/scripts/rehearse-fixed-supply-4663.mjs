import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { backing, compileFixedSupplyProfile, creationFee, rmtFixture, supply } from "./fixed-supply-profile.mjs";
import { call, deployFixedSupplyFixture, localFixtureClient, receiptEvidence, reviewTransactionEvidence, sendFixture, transact, verifyRuntime }
  from "./deploy-fixed-supply-fixture.mjs";
import { proveFundedMigrations } from "./prove-fixed-supply-funded-migrations.mjs";
import { proveFixedSupplySettlementTrace } from "./prove-fixed-supply-settlement-trace.mjs";
import { rehearseDelegatedSender } from "./rehearse-delegated-sender.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { decodeEventLog, erc20Abi, isAddressEqual, parseAbi, toHex, zeroAddress } = require("viem");
const historicalPin = "8dca5773cbd4dc98f52a45616f420bce96b000f0";
const { values: args } = parseArgs({ options: {
  solc: { type: "string" }, anvil: { type: "string" }, lib: { type: "string" },
  archive: { type: "string", default: "pinax" }, output: { type: "string" }, delegated: { type: "boolean" },
} });
assert.ok(args.solc && args.anvil && args.output, "Supply --solc, --anvil and a new --output file");
const { artifacts, manifest } = compileFixedSupplyProfile({ ...args, chainId: 4663 });
const reportPath = resolve(args.output);
writeFileSync(reportPath, "", { flag: "wx" });

const scratchParent = realpathSync(tmpdir());
const scratch = mkdtempSync(join(scratchParent, "rmt-049-fork-"));
const moduleLink = join(scratch, "apps/web/node_modules");
function frozen(path) {
  return execFileSync("git", ["show", historicalPin + ":" + path], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
}
function fixtureFile(path, text) {
  const target = join(scratch, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text.replaceAll("\r\n", "\n"), { flag: "wx" });
}
const stringify = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
function event(receipt, address, abi, name) {
  const logs = receipt.logs.flatMap((log) => {
    if (!isAddressEqual(log.address, address)) return [];
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
      return decoded.eventName === name ? [decoded] : [];
    } catch { return []; }
  });
  assert.equal(logs.length, 1, "Expected exactly one " + name);
  return logs[0].args;
}

function split(total, treasuryBps) {
  const platform = total / 10n;
  const project = total - platform;
  const treasury = project * BigInt(treasuryBps) / 9000n;
  return [project - treasury, treasury, platform / 2n, platform - platform / 2n];
}

try {
  const scriptPath = "packages/contracts/scripts/";
  for (const path of ["packages/contracts/test/fixtures/rmt-v4-deployment-identities.json",
    ...["build-launch-4663-review.mjs", "launch-4663-review-inputs.json"].map((name) => scriptPath + name)]) {
    fixtureFile(path, frozen(path));
  }
  const environmentPath = scriptPath + "robinhood-4663-fork-environment.mjs";
  const baselineEnvironment = frozen(environmentPath);
  assert.equal(baselineEnvironment.split('"cancun"').length, 3, "Pinned fork hardfork declaration changed");
  const environment = args.delegated ? baselineEnvironment.replaceAll('"cancun"', '"prague"') : baselineEnvironment;
  const ready = '    const rpcUrl = await waitForLocalPort(child);';
  assert.equal(environment.split(ready).length, 2, "Pinned fork startup probe shape changed");
  // Continue draining Anvil's piped RPC logs after the startup probe detaches.
  fixtureFile(environmentPath, environment.replace(ready, ready + "\n    child.stdout.resume();\n    child.stderr.resume();"));
  const inherited = frozen(scriptPath + "validate-curve-graduation-4663.mjs");
  fixtureFile(scriptPath + "swap-proof.mjs", inherited + "\nexport { proveSwap, poolIdFor, routerCall };\n");
  const safeSource = readFileSync(join(root, "docs/evidence/rmt-task041/safe-rehearsal.mjs"), "utf8").replaceAll("\r\n", "\n");
  // Keep the exact pinned runtime checks and avoid concurrent historical reads
  // through the rate-limited read-only archive proxy.
  const parallelPins = `  await Promise.all([
    matchRuntime(client, singleton, singletonHash, reviewedFork.number), matchRuntime(client, factory, factoryHash, reviewedFork.number),
    matchRuntime(client, fallback, fallbackHash, reviewedFork.number),
  ]);`;
  assert.equal(safeSource.split(parallelPins).length, 2, "Safe fixture probe shape changed");
  fixtureFile(scriptPath + "safe-proof.mjs", safeSource.replace(parallelPins, `  await matchRuntime(client, singleton, singletonHash, reviewedFork.number);
  await matchRuntime(client, factory, factoryHash, reviewedFork.number);
  await matchRuntime(client, fallback, fallbackHash, reviewedFork.number);`));
  mkdirSync(dirname(moduleLink), { recursive: true });
  symlinkSync(join(root, "apps/launch-website/node_modules"), moduleLink, process.platform === "win32" ? "junction" : "dir");
  const reanchor = join(root, "docs/evidence/rmt-task042/fork/reanchor.patch");
  execFileSync("git", ["apply", "-"], { cwd: scratch, input: readFileSync(reanchor, "utf8").replaceAll("\r\n", "\n"), windowsHide: true });
  const env = await import(pathToFileURL(join(scratch, scriptPath, "robinhood-4663-fork-environment.mjs")));
  const { proveSwap, poolIdFor, routerCall } = await import(pathToFileURL(join(scratch, scriptPath, "swap-proof.mjs")));
  const { setupFixtureSafe, proveSafeSpending } = await import(pathToFileURL(join(scratch, scriptPath, "safe-proof.mjs")));

  const result = await env.withAnvilFork({ anvil: resolve(args.anvil), archive: args.archive }, async ({ rpcUrl, accounts, report }) => {
    const client = await localFixtureClient(rpcUrl, 4663);
    const [fixtureOperator, fixtureOperations, fixtureReserve, fixtureRmt, unrelatedA, unrelatedB] = accounts;
    const delegated = args.delegated ? await rehearseDelegatedSender(client, report, fixtureOperator) : null;
    const { sender: operator, operations, reserve } = delegated ?? {
      sender: fixtureOperator, operations: fixtureOperations, reserve: fixtureReserve,
    };
    const rmt = delegated ? operator : fixtureRmt;
    const send = delegated?.submit ?? sendFixture;
    const submit = async (from, request, status) => {
      try {
        return await send(client, from, request, status);
      } catch (error) {
        throw new Error("Fixture transaction failed at " + (request.to ?? "CREATE") + " " + request.data.slice(0, 10), { cause: error });
      }
    };
    const pins = report.network.contracts;
    const saveDelegatedCheckpoint = (phase) => {
      delegated.evidence.phase = phase;
      writeFileSync(reportPath, stringify({ manifest, report, delegatedSender: delegated.evidence }) + "\n");
    };
    if (delegated) {
      saveDelegatedCheckpoint("PLATFORM_SAFES_REHEARSED");
      const constructors = [];
      const exact = await deployFixedSupplyFixture(client, artifacts, pins, { operator, operations, reserve, send,
        observedGovernors: delegated.governors, observeConstructor: (record) => constructors.push(record) });
      delegated.evidence.exactConstructorReceipts = delegated.receipts().slice(2).map((receipt, index) => {
        const expected = constructors[index];
        assert.ok(isAddressEqual(receipt.contractAddress, expected.address));
        return { ...receipt, name: expected.name, runtimeHash: expected.runtimeHash };
      });
      delegated.evidence.exactGovernors = delegated.governors;
      delegated.evidence.exactFactory = exact.factory;
      delegated.evidence.exactFactoryRuntimeHash = exact.factoryRuntimeHash;
      await delegated.recoverSnapshot();
      delegated.evidence.exactConstructorReplay = "ROLLED_BACK_BEFORE_DISPOSABLE_GOVERNORS_REPLAY";
      saveDelegatedCheckpoint("EXACT_CONSTRUCTORS_REHEARSED");
    }
    const unsignedConstructors = [];
    const deployment = await deployFixedSupplyFixture(client, artifacts, pins, { operator, operations, reserve, send,
      exerciseRotation: !delegated, fixtureMigrationAuthority: true, observeConstructor: (record) => unsignedConstructors.push(record) });
    if (delegated) {
      assert.equal(delegated.evidence.exactFactory, deployment.factory);
      assert.equal(delegated.evidence.exactFactoryRuntimeHash, deployment.factoryRuntimeHash);
      delegated.evidence.replayedNotices = delegated.receipts().slice(7, 11);
      delegated.evidence.phase = "GOVERNANCE_REHEARSED";
    }
    const previous = [];
    const checkpoints = { manifest, deployment, unsignedConstructors, report, projects: previous,
      ...(delegated && { delegatedSender: delegated.evidence }) };
    const save = () => writeFileSync(reportPath, stringify(checkpoints) + "\n");
    save();
    const independentTreasury = toHex(0x46630006n, { size: 20 });
    assert.equal(await client.getCode({ address: independentTreasury }), undefined);
    assert.equal(await client.getTransactionCount({ address: independentTreasury }), 0);
    assert.equal(await client.getBalance({ address: independentTreasury }), 0n);
    await client.request({ method: "anvil_setBalance", params: [independentTreasury, toHex(10n ** 18n)] });
    await client.request({ method: "anvil_impersonateAccount", params: [independentTreasury] });
    const factory = deployment.factory;
    const engine = deployment.graduationEngine;
    const factoryAbi = artifacts.RMTLaunchCurveFactoryV2.abi;
    const engineAbi = artifacts.RMTV4CurveGraduationV1.abi;
    const curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
    const curveLedgerAbi = artifacts.RMTLaunchCurveRevenueLedgerV1.abi;
    const lpLedgerAbi = artifacts.RMTLaunchCurveLpFeeLedgerV1.abi;
    const safe = await setupFixtureSafe({ client, submit, sender: fixtureOperator });
    checkpoints.safe = safe.setup;
    save();
    const cases = [
      { name: rmtFixture.name, symbol: rmtFixture.symbol, projectURI: rmtFixture.projectURI,
        creator: rmt, treasury: safe.address, treasuryBps: rmtFixture.treasuryShareBpsOfEligibleFees },
      { name: "Harbor Research", symbol: "HBR", creator: unrelatedA, treasury: independentTreasury, treasuryBps: 4500 },
      { name: "Cedar Toolkit", symbol: "CDR", creator: unrelatedB, treasury: zeroAddress, treasuryBps: 0 },
    ];
    const positionAbi = parseAbi(["function ownerOf(uint256) view returns (address)",
      "function getPositionLiquidity(uint256) view returns (uint128)", "function getApproved(uint256) view returns (address)",
      "function transferFrom(address,address,uint256)"]);
    const poolManagerAbi = parseAbi(["function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) returns (int24)"]);
    const deadline = async () => (await client.getBlock()).timestamp + 600n;
    for (const [index, project] of cases.entries()) {
      const { name, symbol, creator, treasury, treasuryBps } = project;
      const parts = [name, symbol, project.projectURI ?? ("https://example.test/rmt-fixture/" + symbol.toLowerCase()),
        treasury, treasuryBps, toHex(index + 1, { size: 32 }), await deadline()];
      assert.notEqual(creator, treasury);
      const request = { ...transact(factory, factoryAbi, "create", parts), value: creationFee };
      // Exact unsigned review data; only the synthetic fork receives the simulated transaction.
      const unsigned = { from: creator, ...request, chainId: 4663, status: "BLOCKED_NO_BROADCAST" };
      await client.call({ account: creator, ...request });
      const created = await submit(creator, request);
      if (delegated && index === 0) {
        delegated.evidence.replayedRmtCreation = delegated.receipts()[11];
        assert.equal(delegated.evidence.replayedRmtCreation.transactionHash, created.transactionHash);
        delegated.evidence.phase = "FIRST_RMT_CREATED";
        save();
      }
      const { token, curve: originCurve, supply: observedSupply, revenueLedger } = event(created, factory, factoryAbi, "CurveCreated");
      let curve = originCurve;
      const tokenArtifact = artifacts.RMTLaunchCurveTokenV2;
      assert.equal(observedSupply, supply);
      const tokenRuntimeHash = await verifyRuntime(client, token, tokenArtifact, created.blockNumber);
      assert.equal(await call(client, token, tokenArtifact.abi, "decimals"), 18);
      assert.equal(await call(client, token, tokenArtifact.abi, "totalSupply"), supply);
      assert.equal(await call(client, token, erc20Abi, "balanceOf", [curve]), supply);
      assert.equal(await call(client, curve, curveAbi, "sold"), 0n);
      assert.equal(await call(client, curve, curveAbi, "backingReserve"), 0n);
      assert.equal(await call(client, curve, curveAbi, "graduationSold"), supply * 3n / 5n);
      assert.equal(await call(client, factory, factoryAbi, "tokenForIntent", [creator, parts[5]]), token);
      assert.ok(previous.every((record) => !isAddressEqual(record.projectAsset, token)), "Duplicate project asset");
      assert.equal(event(created, factory, factoryAbi, "CreationFeePaid").fee, creationFee);
      const early = await submit(creator, transact(curve, curveAbi, "graduate", [await deadline()]), "reverted");

      const buyBudget = 500_000_000_000_000_000n;
      const [quotedBuy, grossBuy, buyFee, refund] = await call(client, curve, curveAbi, "quoteBuy", [buyBudget]);
      const buy = await submit(creator, { ...transact(curve, curveAbi, "buy", [quotedBuy, await deadline()]), value: buyBudget });
      const bought = event(buy, curve, curveAbi, "CurveTrade");
      assert.deepEqual([bought.tokenAmount, bought.grossNative, bought.fee, bought.nativeRefund], [quotedBuy, grossBuy, buyFee, refund]);
      const beneficiaries = [creator, treasury, operations, reserve];
      const migration = index === 0
        ? await proveFundedMigrations(client, artifacts, deployment, submit, transact, { token, curve, creator, revenueLedger, beneficiaries })
        : undefined;
      if (migration) curve = migration.curve;
      const sellAmount = quotedBuy / 7n;
      await submit(creator, transact(token, erc20Abi, "approve", [curve, sellAmount]));
      const [nativeOut, grossSell, sellFee] = await call(client, curve, curveAbi, "quoteSell", [sellAmount]);
      const sell = await submit(creator, transact(curve, curveAbi, "sell", [sellAmount, nativeOut, await deadline()]));
      const sold = event(sell, curve, curveAbi, "CurveTrade");
      assert.deepEqual([sold.tokenAmount, sold.grossNative, sold.fee], [sellAmount, grossSell, sellFee]);
      assert.equal(grossSell - sellFee, nativeOut);
      const closingBudget = 3n * 10n ** 18n;
      const [closingQuote] = await call(client, curve, curveAbi, "quoteBuy", [closingBudget]);
      const closing = await submit(creator, { ...transact(curve, curveAbi, "buy", [closingQuote, await deadline()]), value: closingBudget });
      const closingEvent = event(closing, curve, curveAbi, "CurveTrade");
      assert.equal(await call(client, curve, curveAbi, "sold"), supply * 3n / 5n);
      assert.equal(await call(client, curve, curveAbi, "backingReserve"), backing);
      assert.equal(await call(client, token, erc20Abi, "balanceOf", [curve]), supply * 2n / 5n);
      assert.ok(closingEvent.nativeRefund > 0n);

      const curveFees = buyFee + sellFee + closingEvent.fee;
      assert.equal(await call(client, revenueLedger, curveLedgerAbi, "totalAccrued"), curveFees);
      const curveCredits = split(curveFees, treasuryBps);
      const wrongBeneficiary = index === 0 ? unrelatedA : rmt;
      const crossProjectCurveClaim = await submit(wrongBeneficiary, transact(revenueLedger, curveLedgerAbi, "claim"), "reverted");
      const authorized = async (beneficiary, transaction) => {
        if (isAddressEqual(beneficiary, safe.address)) return (await safe.execute(transaction)).receipt;
        if (delegated?.safes.some(({ address }) => isAddressEqual(address, beneficiary))) {
          return delegated.exactClaims(beneficiary, transaction);
        }
        return submit(beneficiary, transaction);
      };
      const curveClaims = [];
      for (const [bucket, beneficiary] of beneficiaries.entries()) {
        assert.equal(await call(client, revenueLedger, curveLedgerAbi, "claimable", [beneficiary]), curveCredits[bucket]);
        if (curveCredits[bucket] === 0n) continue;
        const receipt = await authorized(beneficiary, transact(revenueLedger, curveLedgerAbi, "claim"));
        const claimed = event(receipt, revenueLedger, curveLedgerAbi, "CurveFeeClaimed");
        assert.deepEqual([claimed.recipient, claimed.amount], [beneficiary, curveCredits[bucket]]);
        curveClaims.push(receiptEvidence(receipt));
      }
      assert.equal(await call(client, revenueLedger, curveLedgerAbi, "totalClaimed"), curveFees);
      const key = await call(client, engine, engineAbi, "canonicalPoolKey", [token]);
      const preinitialize = await submit(creator, transact(pins.poolManager.address, poolManagerAbi, "initialize", [key, 2n ** 96n]), "reverted");
      const graduationDeadline = await deadline();
      const graduated = await submit(creator, transact(curve, curveAbi, "graduate", [graduationDeadline]));
      const position = event(graduated, engine, engineAbi, "CurveGraduated");
      assert.equal(position.poolId, poolIdFor(key));
      assert.deepEqual(position.poolKey, key);
      assert.equal(position.tokenUsed + position.tokenDust, supply * 2n / 5n);
      assert.equal(position.nativeUsed + position.nativeDust, backing);
      assert.ok(position.nativeUsed > 0n && position.tokenUsed > 0n && position.liquidity > 0n);
      const positionManager = pins.positionManager.address;
      const positionId = position.positionTokenId;
      const assertCustody = async () => {
        assert.equal(await call(client, positionManager, positionAbi, "ownerOf", [positionId]), engine);
        assert.equal(await call(client, positionManager, positionAbi, "getPositionLiquidity", [positionId]), position.liquidity);
        assert.equal(await call(client, positionManager, positionAbi, "getApproved", [positionId]), zeroAddress);
      };
      await assertCustody();
      await submit(creator, transact(positionManager, positionAbi, "transferFrom", [engine, creator, positionId]), "reverted");
      const v4Buy = await proveSwap(client, pins, key, creator, true, 30_000_000_000_000_000n);
      const v4Sell = await proveSwap(client, pins, key, creator, false, v4Buy.output / 3n);
      let invalidRoutes;
      if (index === 0) {
        const amount = 2_000_000_000_000_000n;
        const expiration = await deadline();
        const wrongPool = routerCall(pins.universalRouter.address, { ...key, fee: 500 }, true, amount, 1n, expiration);
        const correctPool = routerCall(pins.universalRouter.address, key, true, amount, 1n, expiration);
        const tokenBefore = await call(client, token, erc20Abi, "balanceOf", [creator]);
        const rejectedPool = await submit(creator, wrongPool, "reverted");
        const rejectedRouter = await submit(creator, { ...correctPool, to: pins.quoter.address }, "reverted");
        assert.equal(rejectedPool.logs.length + rejectedRouter.logs.length, 0);
        assert.equal(await call(client, token, erc20Abi, "balanceOf", [creator]), tokenBefore);
        await assertCustody();
        invalidRoutes = { wrongPool: receiptEvidence(rejectedPool), wrongRouter: receiptEvidence(rejectedRouter) };
      }
      const ledger = await call(client, engine, engineAbi, "lpFeeLedger", [token]);
      const preview = await call(client, engine, engineAbi, "previewLpFees", [token]);
      assert.ok(preview[0] > 0n && preview[1] > 0n);
      const collectionDeadline = await deadline();
      const collection = await submit(operator, transact(engine, engineAbi, "collectLpFees", [token, collectionDeadline]));
      const collected = event(collection, engine, engineAbi, "LpFeesCollected");
      assert.deepEqual([collected.nativeAmount, collected.tokenAmount], preview);
      assert.equal(collected.ledger, ledger);
      const traceBindings = { factory, curve, engine, token, ledger, key, position, positionManager,
        poolManager: pins.poolManager.address, permit2: pins.permit2.address };
      const settlementTraces = {
        graduation: await proveFixedSupplySettlementTrace(client, "graduation", {
          ...traceBindings, receipt: graduated, deadline: graduationDeadline,
          liquidityLedgerArtifact: artifacts.RMTLaunchCurveLpFeeLedgerV1,
          beneficiaries: { creator, treasury, treasuryShareBps: treasuryBps, operatingRecipient: operations,
            futureReserveRecipient: reserve },
        }),
        collection: await proveFixedSupplySettlementTrace(client, "collection", {
          ...traceBindings, receipt: collection, deadline: collectionDeadline, collected,
        }),
      };
      const lpCredits = preview.map((amount) => split(amount, treasuryBps));
      const crossProjectLpClaim = await submit(wrongBeneficiary, transact(ledger, lpLedgerAbi, "claim"), "reverted");
      const lpClaims = [];
      for (const [bucket, beneficiary] of beneficiaries.entries()) {
        const due = lpCredits.map((credits) => credits[bucket]);
        assert.deepEqual(await call(client, ledger, lpLedgerAbi, "claimable", [beneficiary]), due);
        if (due.every((amount) => amount === 0n)) continue;
        const receipt = await authorized(beneficiary, transact(ledger, lpLedgerAbi, "claim"));
        const claimed = event(receipt, ledger, lpLedgerAbi, "LpFeesClaimed");
        assert.deepEqual([claimed.recipient, claimed.nativeAmount, claimed.tokenAmount], [beneficiary, ...due]);
        lpClaims.push(receiptEvidence(receipt));
      }
      assert.deepEqual(await call(client, ledger, lpLedgerAbi, "totalClaimed"), preview);
      await assertCustody();
      assert.equal(await call(client, token, tokenArtifact.abi, "totalSupply"), supply);
      const safeSpending = index === 0 ? await proveSafeSpending({ safe, client, token, spendingWallet: rmt,
        nativeAmount: lpCredits[0][1] / 2n, tokenAmount: lpCredits[1][1] / 2n }) : undefined;
      previous.push({ ...project, projectAsset: token, tokenRuntimeHash, unsigned,
        creation: await reviewTransactionEvidence(client, created), initialBackingWei: "0", supplyWei: supply,
        migrations: migration?.transitions, early: receiptEvidence(early), buy: receiptEvidence(buy), sell: receiptEvidence(sell), closing: receiptEvidence(closing),
        curveFees, curveCredits, curveClaims, preinitialize: receiptEvidence(preinitialize),
        graduation: { receipt: receiptEvidence(graduated), ...position }, v4Buy, v4Sell, collection: receiptEvidence(collection),
        preview, lpCredits, lpClaims, principalUnchanged: true, safeSpending, invalidRoutes, settlementTraces,
        crossProjectClaims: { curve: receiptEvidence(crossProjectCurveClaim), lp: receiptEvidence(crossProjectLpClaim) } });
      save();
    }
    if (delegated) delegated.evidence.phase = "LIFECYCLE_REHEARSED";
    return checkpoints;
  });
  writeFileSync(reportPath, stringify(result) + "\n");
} finally {
  assert.equal(dirname(realpathSync(scratch)), scratchParent);
  const moduleEntry = lstatSync(moduleLink, { throwIfNoEntry: false });
  if (moduleEntry) {
    assert.ok(moduleEntry.isSymbolicLink(), "Fixture dependency path is not the expected link");
    try {
      unlinkSync(moduleLink);
    } catch (error) {
      if (error.code !== "ENOENT" || lstatSync(moduleLink, { throwIfNoEntry: false })) throw error;
    }
  }
  assert.equal(lstatSync(moduleLink, { throwIfNoEntry: false }), undefined);
  rmSync(scratch, { recursive: true, force: true });
}
console.log("Fixed-supply official 4663 fork passed for RMT and two unrelated projects: " + reportPath);
