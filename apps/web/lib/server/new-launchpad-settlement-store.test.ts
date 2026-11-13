import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { keccak256, zeroAddress, type Address } from "viem";
import { launchPoolId } from "../launchpad/launch-record";
import { nativeSettlementEvidenceHash, type NativeSettlementProof } from "../launchpad/native-settlement";
import { LaunchpadSettlementStore, nativeSettlementRetentionMs } from "./new-launchpad-settlement-store";
import { LaunchpadStore } from "./new-launchpad-store";

const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}` as Address;
const runtime = keccak256("0x01");
const scope = [4663, 10, ...[1, 2, 3, 4, 5, 6, 7, 0x2000].flatMap((n) => [address(n), runtime]), "v2"].join(":");
const blockHash = keccak256("0x02");
const transactionHash = keccak256("0x03");
const lookup = { blockNumber: 12n, blockHash, transactionHash, logIndex: 5 };
const poolKey = { currency0: zeroAddress, currency1: address(44), hooks: address(0x2000), fee: 3000, tickSpacing: 60 };
const observedAtMs = 1_000;

function proof(overrides: Partial<NativeSettlementProof> = {}): NativeSettlementProof {
  const fields = { ...lookup, blockNumber: lookup.blockNumber.toString(), chainId: 4663, factory: address(1), poolManager: address(2),
    poolKey, poolId: launchPoolId(poolKey), account: address(55), router: address(4), calldataHash: keccak256("0x1234"), receiptHash: keccak256("0x07"),
    amountAtomic: "4", mode: "simulated_agreement" as const, sources: ["review-a", "review-b"], observedAtMs, ...overrides };
  return { ...fields, evidenceHash: nativeSettlementEvidenceHash(fields) };
}

test("proof cache preserves its exact scope, identity and retention across reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-launch-proof-"));
  const path = join(directory, "launch.sqlite");
  try {
    const writer = new LaunchpadSettlementStore(path, scope);
    try {
      const exact = proof();
      writer.save(exact, observedAtMs);
      writer.save(proof({ observedAtMs: observedAtMs + 1_000 }), observedAtMs + 1_000);
      assert.throws(() => writer.save(proof({ amountAtomic: "5" }), observedAtMs), /Conflicting/);
      assert.throws(() => writer.save(proof({ chainId: 31337 }), observedAtMs), /scope/);
      assert.throws(() => writer.save(proof({ factory: address(21) }), observedAtMs), /scope/);
      assert.throws(() => writer.save(proof({ sources: ["https://a.example/credential", "review-b"] }), observedAtMs), /scope/);
      assert.throws(() => writer.save(proof({ blockHash: keccak256("0x04") }), observedAtMs), /UNIQUE/);
    } finally { writer.close(); }

    const reader = new LaunchpadSettlementStore(path, scope);
    try {
      const expires = observedAtMs + nativeSettlementRetentionMs;
      assert.deepEqual(reader.read(lookup, expires - 1), proof());
      assert.equal(reader.read({ ...lookup, blockNumber: 13n }, observedAtMs), undefined);
      assert.equal(reader.read({ ...lookup, blockHash: keccak256("0x04") }, observedAtMs), undefined);
      assert.equal(reader.read(lookup, expires), undefined);
      reader.prune(expires);
      assert.equal(reader.read(lookup, expires), undefined);
      assert.throws(() => reader.save(proof(), expires), /retention/);
    } finally { reader.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("proof cache strips unknown fields and detects corrupted persisted proof identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-launch-proof-"));
  const path = join(directory, "launch.sqlite");
  const store = new LaunchpadSettlementStore(path, scope);
  const other = new DatabaseSync(path);
  try {
    const extended = { ...proof(), privateRpcUrl: "private", poolKey: { ...poolKey, trace: "private" } };
    store.save(extended, observedAtMs);
    assert.deepEqual(store.read(lookup, observedAtMs), proof());
    const { proof: raw } = other.prepare("SELECT proof FROM rmt_launch_native_settlement_proofs").get()!;
    assert.equal(typeof raw, "string");
    assert.ok(!(raw as string).includes("private"));
    other.prepare("UPDATE rmt_launch_native_settlement_proofs SET proof = ?")
      .run(JSON.stringify({ ...proof(), amountAtomic: "99" }));
    assert.throws(() => store.read(lookup, observedAtMs), /does not match/);
  } finally {
    other.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a newer canonical checkpoint hides and rejects stale native settlement proofs", () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-launch-proof-"));
  const path = join(directory, "launch.sqlite");
  const index = new LaunchpadStore(path, scope);
  const store = new LaunchpadSettlementStore(path, scope);
  try {
    store.save(proof(), observedAtMs);
    const anchor = { number: 9n, hash: keccak256("0x09") };
    const fork = { number: lookup.blockNumber, hash: keccak256("0x12") };
    index.commitIndex(undefined, { anchor, keep: undefined, next: fork, records: [], orphaned: [], caughtUp: true }, observedAtMs);
    assert.equal(store.read(lookup, observedAtMs), undefined);
    assert.throws(() => store.save(proof(), observedAtMs), /disagrees with the canonical index/);
  } finally {
    store.close();
    index.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
