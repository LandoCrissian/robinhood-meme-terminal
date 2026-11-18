import assert from "node:assert/strict";
import { keccak256, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { fixtureMigratedRegistration } from "./curve-fixture-migration.js";
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
      if (name === "migration") return args?.[1] === 0n
        ? [1, 2, launch.initialCurve, second, keccak256("0x6003"), 101n, 1_000]
        : [2, 3, second, third, keccak256("0x6004"), 102n, 1_001];
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
}
