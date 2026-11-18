import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { fixtureMigratedRegistration } from "./curve-fixture-migration.js";
import { assertFixtureCanonicalCurveStart, fixtureGraduationAbi, lifecycleCurveAbi } from "./curve-fixture-lifecycle.js";
import { indexFixtureSuccessorGraduation } from "./curve-fixture-successor-graduation.js";
import { syntheticProductionConfig as production, syntheticProductionRegistration } from "./curve-production-smoke.js";

const address = (id: number): Address => `0x${((1n << 156n) + BigInt(id)).toString(16).padStart(40, "0")}`;
const word = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;

export async function testFixtureMigrationEarnings() {
  const binding = { ...production.binding, chainId: 31337 as const };
  const launch = { ...syntheticProductionRegistration(), chainId: 31337 as const };
  const graduation = { graduationEngine: address(30), graduationHash: word(30), guard: address(31), guardHash: word(31) };
  const second = address(32), third = address(33);
  const observed = { blockNumber: "105", blockHash: word(105), timestamp: "2026-11-18T12:00:00.000Z" };
  let version = 2;
  const overrides = new Map<string, unknown>();
  const current = () => version === 1 ? launch.initialCurve : version === 2 ? second : third;
  const rpc = {
    async getCode({ address: target, blockNumber }: { address: Address; blockNumber: bigint }) {
      assert.equal(blockNumber, 105n);
      if (overrides.has("code:" + target)) return overrides.get("code:" + target);
      return target === binding.factory ? "0x6001" : target === binding.projectRegistry ? "0x6002" : target === second ? "0x6003" : "0x6004";
    },
    async readContract({ address: target, functionName: name, args, blockNumber }: { address: Address; functionName: string; args?: readonly unknown[]; blockNumber: bigint }) {
      assert.equal(blockNumber, 105n, "Migration earnings proof never silently reads latest instead of the indexed checkpoint");
      if (overrides.has(name)) return overrides.get(name);
      if (name === "curveForToken" || name === "activeCurve") return current();
      if (name === "project") return [binding.factory, current(), version, current(), BigInt(version - 1)];
      if (name === "originCurveForToken" || name === "originCurve" || name === "curve") return launch.initialCurve;
      if (name === "migration") {
        assert.ok(args?.[1] === 1n || args?.[1] === 2n, "RegistryV3 migration records are one-based; entry zero is absent");
        return args[1] === 1n ? [1, 2, launch.initialCurve, second, keccak256("0x6003"), 101n, 1_000]
          : [2, 3, second, third, keccak256("0x6004"), 102n, 1_001];
      }
      if (name === "migrationCommitment") return word(44);
      if (name === "migrationSource") return target === second ? launch.initialCurve : second;
      if (name === "migratedTo") return target === launch.initialCurve ? second : version === 3 ? third : zeroAddress;
      if (name === "executionVersion") return target === second ? 2 : 3;
      if (name === "executionEngine") return target;
      if (name === "token") return launch.token;
      if (name === "factory") return binding.factory;
      if (name === "projectRegistry") return binding.projectRegistry;
      if (name === "creator") return launch.creator;
      if (name === "treasury") return zeroAddress;
      if (name === "treasuryShareBps") return 0;
      if (name === "operatingRecipient") return binding.creationFeeRecipient;
      if (name === "futureReserveRecipient") return production.reserveRecipient;
      if (name === "revenueLedger") return launch.revenueLedger;
      if (name === "active") return true;
      if (name === "totalSupply") return 10n ** 27n;
      if (name === "graduationSold") return 600_000_000n * 10n ** 18n;
      if (name === "VIRTUAL_ETH") return 4n * 10n ** 18n;
      if (name === "GRADUATION_BACKING") return 2n * 10n ** 18n;
      if (name === "TRADE_FEE_BPS") return 100n;
      if (name === "graduationEngine") return graduation.graduationEngine;
      throw new Error("Unexpected migration-proof read");
    },
  } as unknown as PublicClient;
  for (const nextVersion of [2, 3]) {
    version = nextVersion;
    const result = await fixtureMigratedRegistration(rpc, binding, graduation, launch, observed);
    assert.equal(result?.activeCurve, current());
    assert.equal(result?.revenueLedger, launch.revenueLedger);
    assert.equal(result?.lifecycle, "unsupported-successor", "Registration proof never pretends successor trading was indexed");
  }
  version = 1; assert.equal(await fixtureMigratedRegistration(rpc, binding, graduation, launch, observed), null);
  version = 3;
  for (const [field, value] of [["activeCurve", second], ["originCurve", second], ["revenueLedger", second],
    ["TRADE_FEE_BPS", 101n], ["GRADUATION_BACKING", 1n], ["totalSupply", 1n], ["operatingRecipient", third],
    ["creator", third], ["treasuryShareBps", 1], ["migrationSource", third], ["migratedTo", second],
    ["project", [binding.factory, current(), 4, current(), 3n]], ["code:" + third, "0x6005"]] as const) {
    overrides.set(field, value);
    await assert.rejects(fixtureMigratedRegistration(rpc, binding, graduation, launch, observed), /route or immutable policy proof failed/, field);
    overrides.clear();
  }
  for (const start of [{ sold: 0n, backing: 0n }, { sold: 600_000_000n * 10n ** 18n, backing: 2n * 10n ** 18n }]) {
    assert.doesNotThrow(() => assertFixtureCanonicalCurveStart(start));
  }
  for (const start of [{ sold: -1n, backing: 0n }, { sold: 0n, backing: 1n },
    { sold: 600_000_000n * 10n ** 18n, backing: 1n }, { sold: 600_000_001n * 10n ** 18n, backing: 2n * 10n ** 18n }]) {
    assert.throws(() => assertFixtureCanonicalCurveStart(start), /canonical starting reserves/);
  }
  const tx = { from: launch.creator, to: third, value: 0n, hash: word(200), chainId: 31337,
    input: encodeFunctionData({ abi: lifecycleCurveAbi, functionName: "graduate", args: [1_800_000_000n] }),
    blockNumber: 105n, blockHash: observed.blockHash, transactionIndex: 0 };
  const poolKey = { currency0: zeroAddress, currency1: launch.token, fee: 3000, tickSpacing: 60, hooks: graduation.guard };
  const data = encodeAbiParameters([{ type: "tuple", components: [
    { type: "address", name: "currency0" }, { type: "address", name: "currency1" }, { type: "uint24", name: "fee" },
    { type: "int24", name: "tickSpacing" }, { type: "address", name: "hooks" },
  ] }, { type: "uint160" }, { type: "uint256" }, ...Array.from({ length: 5 }, () => ({ type: "uint128" as const }))],
  [poolKey, 1n, 1n, 1n, 1n, 1n, 0n, 0n]);
  Object.assign(rpc, { async getTransactionReceipt() { return { from: tx.from, to: tx.to, transactionHash: tx.hash,
    blockNumber: tx.blockNumber, blockHash: tx.blockHash, transactionIndex: 0, status: "success",
    logs: [{ address: graduation.graduationEngine, blockNumber: tx.blockNumber, blockHash: tx.blockHash,
      transactionHash: tx.hash, transactionIndex: 0, removed: false, logIndex: 1, data,
      topics: encodeEventTopics({ abi: fixtureGraduationAbi, eventName: "CurveGraduated", args: { token: launch.token, curve: third, poolId: word(300) } }) }] }; } });
  for (const [field, value] of [["activeCurve", second], ["revenueLedger", second], ["code:" + third, "0x6005"]] as const) {
    overrides.set(field, value);
    await assert.rejects(indexFixtureSuccessorGraduation(rpc, binding, graduation, [{ launch, grossFees: 0n }], tx, observed, 0), /route or immutable policy proof failed/);
    overrides.clear();
  }
}
