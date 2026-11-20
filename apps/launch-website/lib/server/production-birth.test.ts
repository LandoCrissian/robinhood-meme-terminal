import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { curveProductionDeployment as d, curveProductionPins as pins } from "./curve-production";
import { isPrunedProductionBirthState, productionBootstrap as bootstrap, proveProductionFactoryBirth, readProductionFactoryBirthCode } from "./production-birth";
import type { EarningsRpc } from "./earnings-contracts";

const metadata = (directory: string, name: string) => JSON.parse(gunzipSync(readFileSync(new URL(
  `../../../../docs/evidence/rmt-task092/source/${directory}/${name}.metadata.json.gz`, import.meta.url))).toString());
const boot = metadata("current", "RMTLaunchCurveDeploymentV2");
const runtime = new Map<string, Hex>([[bootstrap.address.toLowerCase(), boot.deployed_bytecode],
  [pins.factory[0].toLowerCase(), metadata("current-tail", "RMTLaunchCurveFactoryV2").deployed_bytecode],
  [pins.engine[0].toLowerCase(), metadata("current-tail", "RMTV4CurveGraduationV1").deployed_bytecode],
  [pins.guard[0].toLowerCase(), metadata("current", "RMTV4CurveInitializationGuardV1").deployed_bytecode]]);
const pruned = () => Object.assign(new Error("Missing or invalid parameters"), { code: -32000,
  details: "historical state " + "a".repeat(64) + " is not available" });
function fixture() {
  const calls: string[] = [], checkpoint = d.blockNumber + 100n;
  const transaction = { hash: d.transactionHash, chainId: 4663, to: null, value: 0n, nonce: 482, from: bootstrap.sender,
    input: boot.creation_bytecode, blockNumber: d.blockNumber, blockHash: d.blockHash, transactionIndex: 0 };
  const receipt = { transactionHash: d.transactionHash, blockNumber: d.blockNumber, blockHash: d.blockHash,
    transactionIndex: 0, status: "success", contractAddress: bootstrap.address };
  const knobs = { historical: "pruned" as "pruned" | "wrong" | "empty" | "good" | "outage", reorg: false, wrongBinding: false, wrongRuntime: false };
  const rpc = {
    async getChainId() { return 4663; }, async getTransaction() { calls.push("transaction"); return transaction; }, async getTransactionReceipt() { return receipt; },
    async getBlock({ blockNumber }: { blockNumber: bigint }) { return { number: blockNumber,
      hash: knobs.reorg ? "0x" + "c".repeat(64) : blockNumber === d.blockNumber ? d.blockHash : "0x" + "b".repeat(64), transactions: [d.transactionHash] }; },
    async getCode({ address, blockNumber }: { address: string; blockNumber: bigint }) {
      if (blockNumber === d.blockNumber && address.toLowerCase() === pins.factory[0].toLowerCase()) {
        if (knobs.historical === "pruned") throw pruned();
        if (knobs.historical === "outage") throw Object.assign(new Error("HTTP 429"), { status: 429 });
        if (knobs.historical === "empty") return undefined;
        if (knobs.historical === "wrong") return "0x6000";
      }
      return knobs.wrongRuntime ? "0x6000" : runtime.get(address.toLowerCase());
    },
    async readContract({ functionName }: { functionName: string }) { return knobs.wrongBinding ? bootstrap.sender
      : functionName === "factory" ? pins.factory[0] : functionName === "graduationEngine" ? pins.engine[0] : pins.guard[0]; },
  } as unknown as EarningsRpc;
  return { rpc, transaction, receipt, knobs, calls, checkpoint };
}
test("exact on-chain one-shot constructor proves factory birth when historical state is explicitly pruned", async () => {
  assert.equal(keccak256(boot.creation_bytecode), bootstrap.initcodeHash);
  const f = fixture(); assert.equal(await readProductionFactoryBirthCode(f.rpc, f.checkpoint), runtime.get(pins.factory[0].toLowerCase()));
  assert.equal(f.calls.filter(call => call === "transaction").length, 1);
});
test("wrong/empty historical code remains a rejected code witness; no alternative proof silently replaces it", async () => {
  for (const mode of ["wrong", "empty", "good"] as const) {
    const f = fixture(); f.knobs.historical = mode; const result = await readProductionFactoryBirthCode(f.rpc, f.checkpoint);
    assert.equal(result, mode === "wrong" ? "0x6000" : mode === "empty" ? undefined : runtime.get(pins.factory[0].toLowerCase()));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.knobs.historical = "outage"; await assert.rejects(readProductionFactoryBirthCode(f.rpc, f.checkpoint)); assert.equal(f.calls.length, 0);
});
test("canonical initcode, direct CREATE identity, receipt, membership, immutables and all child pins are indispensable", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.transaction.input += "00"; },
    (f: ReturnType<typeof fixture>) => { f.transaction.nonce++; },
    (f: ReturnType<typeof fixture>) => { f.transaction.value = 1n; },
    (f: ReturnType<typeof fixture>) => { f.transaction.transactionIndex = 1; },
    (f: ReturnType<typeof fixture>) => { f.receipt.status = "reverted"; },
    (f: ReturnType<typeof fixture>) => { f.receipt.contractAddress = bootstrap.sender as typeof bootstrap.address; },
    (f: ReturnType<typeof fixture>) => { f.knobs.reorg = true; },
    (f: ReturnType<typeof fixture>) => { f.knobs.wrongBinding = true; },
    (f: ReturnType<typeof fixture>) => { f.knobs.wrongRuntime = true; },
  ]) { const f = fixture(); mutate(f); await assert.rejects(proveProductionFactoryBirth(f.rpc, f.checkpoint)); }
});
test("only the observed typed historical-state condition is admitted, never auth, quota, timeout or unknown failures", () => {
  assert.equal(isPrunedProductionBirthState(pruned()), true);
  for (const error of [new Error("historical state " + "a".repeat(64) + " is not available"),
    Object.assign(pruned(), { code: -32602 }), Object.assign(pruned(), { status: 429 }), new Error("timeout"),
    Object.assign(pruned(), { details: "historical state unavailable" }), Object.assign(pruned(), { message: "Status: 403" })]) {
    assert.equal(isPrunedProductionBirthState(error), false);
  }
  assert.equal(isPrunedProductionBirthState({ code: -32000, cause: { details: pruned().details } }), false);
});
