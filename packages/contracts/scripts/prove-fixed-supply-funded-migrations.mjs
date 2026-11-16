import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { call, receiptEvidence, verifyRuntime } from "./deploy-fixed-supply-fixture.mjs";
import { observedMutationGraph } from "./prove-fixed-supply-settlement-trace.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { erc20Abi, keccak256 } = require("viem");

export async function proveFundedMigrations(client, artifacts, deployment, submit, makeCall, project) {
  const { factory, projectRegistry: registry, directory } = deployment;
  const { token, creator, revenueLedger, beneficiaries } = project;
  const curveAbi = artifacts.RMTLaunchBondingCurveV1.abi;
  const factoryAbi = artifacts.RMTLaunchCurveFactoryV2.abi;
  const registryAbi = artifacts.RMTLaunchProjectRegistryV3.abi;
  const ledgerAbi = artifacts.RMTLaunchCurveRevenueLedgerV1.abi;
  const readCurve = (address, name) => call(client, address, curveAbi, name);
  const native = (address) => client.getBalance({ address });
  const balance = (address) => call(client, token, erc20Abi, "balanceOf", [address]);
  const credits = () => Promise.all(beneficiaries.map((account) => call(client, revenueLedger, ledgerAbi, "claimable", [account])));
  const route = () => call(client, registry, registryAbi, "project", [token]);
  const factoryRoute = () => call(client, factory, factoryAbi, "curveForToken", [token]);

  const transitions = [];
  let curve = project.curve;
  for (const [version, artifact] of [[2, artifacts.RMTLaunchBondingCurveV2], [3, artifacts.RMTLaunchBondingCurveV3]]) {
    const prepared = await submit(creator, makeCall(factory, factoryAbi, "prepareMigration", [token, version]));
    const next = await call(client, factory, factoryAbi, "migrationCandidate", [token, version]);
    const runtimeHash = await verifyRuntime(client, next, artifact);
    const expires = (await client.getBlock()).timestamp + 4n * 86400n;
    const proposed = await submit(creator, makeCall(registry, registryAbi, "proposeMigration", [token, next, runtimeHash, Number(expires)]));
    const scheduled = await deployment.scheduleFixtureMigration(token);
    const execute = makeCall(registry, registryAbi, "executeMigration", [token]);
    const sold = await readCurve(curve, "sold");
    const backing = await readCurve(curve, "backingReserve");
    const supply = await call(client, token, erc20Abi, "totalSupply");
    const inventory = supply - sold;
    const commitment = await readCurve(curve, "migrationCommitment");
    const originalCredits = await credits();
    const originalAccrual = await call(client, revenueLedger, ledgerAbi, "totalAccrued");
    const holderBalance = await balance(creator);
    assert.ok(backing > 0n && originalAccrual > 0n && holderBalance > 0n);
    assert.deepEqual([await native(curve), await balance(curve), await native(next), await balance(next)], [backing, inventory, 0n, 0n]);
    const premature = await submit(creator, execute, "reverted");
    assert.equal(premature.logs.length, 0);
    assert.deepEqual(await route(), [factory, curve, version - 1, curve, BigInt(version - 2)]);
    assert.equal(await factoryRoute(), curve);
    assert.deepEqual([await native(curve), await balance(curve), await native(next), await balance(next)], [backing, inventory, 0n, 0n]);
    assert.deepEqual(await credits(), originalCredits);

    await client.request({ method: "evm_increaseTime", params: [Number(await call(client, registry, registryAbi, "migrationDelay"))] });
    await client.request({ method: "evm_mine" });
    const migrated = await submit(creator, execute);
    assert.deepEqual(await route(), [factory, next, version, next, BigInt(version - 1)]);
    assert.equal(await factoryRoute(), next);
    assert.deepEqual([await native(curve), await balance(curve), await native(next), await balance(next)], [0n, 0n, backing, inventory]);
    assert.equal(await readCurve(curve, "active"), false);
    assert.equal(await readCurve(curve, "migratedTo"), next);
    assert.equal(await readCurve(next, "active"), true);
    assert.equal(await readCurve(next, "sold"), sold);
    assert.equal(await readCurve(next, "backingReserve"), backing);
    assert.equal(await readCurve(next, "migrationCommitment"), commitment);
    assert.equal(await balance(creator), holderBalance);
    assert.equal(await call(client, token, erc20Abi, "totalSupply"), supply);
    assert.equal(await call(client, revenueLedger, ledgerAbi, "activeCurve"), next);
    assert.equal(await call(client, revenueLedger, ledgerAbi, "totalAccrued"), originalAccrual);
    assert.deepEqual(await credits(), originalCredits);

    const trace = await client.request({ method: "debug_traceTransaction", params: [migrated.transactionHash, { tracer: "callTracer" }] });
    const admittedReads = new Set([registry, factory, directory, curve, next, token, revenueLedger].map((address) => address.toLowerCase()));
    admittedReads.add("0x0000000000000000000000000000000000000001"); // ECDSA precompile if present.
    const graph = observedMutationGraph(trace, admittedReads);
    const edge = (depth, from, to, { data }, value = 0n) =>
      ({ depth, type: "CALL", from: from.toLowerCase(), to: to.toLowerCase(),
        selector: data.slice(0, 10), inputHash: keccak256(data), value: value.toString() });
    assert.deepEqual(graph, [
      edge(0, creator, registry, execute),
      edge(1, registry, factory, makeCall(factory, factoryAbi, "executeMigration", [token, next, runtimeHash])),
      edge(2, factory, curve, makeCall(curve, curveAbi, "migrateAssets", [next, runtimeHash])),
      edge(3, curve, token, makeCall(token, erc20Abi, "transfer", [next, inventory])),
      edge(3, curve, revenueLedger, makeCall(revenueLedger, ledgerAbi, "moveAccrual", [next])),
      edge(3, curve, next, makeCall(next, curveAbi, "acceptMigration", [sold, backing, inventory]), backing),
    ]);
    transitions.push({ version, source: curve, successor: next, runtimeHash, sold, backing, inventory, commitment,
      holderBalance, originalCredits, revenueLedger, graph, prepared: receiptEvidence(prepared), proposed: receiptEvidence(proposed),
      scheduled, premature: receiptEvidence(premature), migrated: receiptEvidence(migrated) });
    curve = next;
  }
  return { curve, transitions };
}
