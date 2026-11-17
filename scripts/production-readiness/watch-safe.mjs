import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { privateOutputPath } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
import { MOBILE_DEPLOYMENT_PAYER, makeReadOnlyRpc, ROBINHOOD_SOURCES } from "./rpc.mjs";
import { verifySafeCreation } from "./safe.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { padHex, toEventSelector } = require("viem");
const load = (name) => JSON.parse(readFileSync(new URL("../../docs/evidence/" + name, import.meta.url)));
const proposals = load("rmt-task046/treasury-safe-initializers.json").proposals;
const { factory, singleton } = load("rmt-task045/operations-safe-policy.json").operations;
const quantity = (number) => "0x" + number.toString(16);
const hash = /^0x[0-9a-f]{64}$/i;
const rpcQuantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const topic = toEventSelector("ProxyCreation(address,address)");
const names = ["official", "pocket"];
const value = (row) => row?.status === "observed" ? row.value : undefined;
const normalizeLog = (log) => ({ address: log.address.toLowerCase(), blockHash: log.blockHash.toLowerCase(),
  transactionHash: log.transactionHash.toLowerCase(), blockNumber: BigInt(log.blockNumber).toString(),
  transactionIndex: BigInt(log.transactionIndex).toString(), logIndex: BigInt(log.logIndex).toString(),
  topics: log.topics.map((item) => item.toLowerCase()), data: log.data.toLowerCase(), removed: log.removed });

// A bounded, explicitly started read-only observer. It never submits or retries a transaction.
export async function watchSafeReceipt({ fromBlock, role = "RMT-RESERVE", seconds = 60,
  readers = Object.fromEntries(names.map((name) => [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] })])),
  verify = verifySafeCreation, now = Date.now, sleep = delay, pollMs = 5_000, maxBlocks = 4_096 } = {}) {
  assert.ok(typeof fromBlock === "bigint" && fromBlock >= 0n && fromBlock <= (1n << 64n), "Use a nonnegative block number");
  assert.ok(Number.isInteger(seconds) && seconds >= 1 && seconds <= 300, "Watcher duration must be 1–300 seconds");
  assert.ok(Number.isInteger(pollMs) && pollMs >= 1_000 && pollMs <= 30_000, "Poll interval must be 1–30 seconds");
  assert.ok(Number.isInteger(maxBlocks) && maxBlocks >= 1 && maxBlocks <= 4_096, "Scan limit must be 1–4096 blocks");
  const plan = proposals.find((item) => item.role === role);
  assert.ok(plan && names.every((name) => typeof readers[name] === "function"), "Use one pinned Safe role and both independent readers");
  const proxyTopic = padHex(plan.counterfactualAddress, { size: 32 }).toLowerCase();
  const singletonData = padHex(singleton, { size: 32 }).toLowerCase();
  const start = now(), deadline = start + seconds * 1_000;
  let cursor = fromBlock, scanned = 0, checkpoint = null, lastReason = "NO_CREATION_OBSERVED", polls = 0;
  const result = (status, extra = {}) => ({ schemaVersion: 1, mode: "BOUNDED_READ_ONLY_SAFE_WATCH", chainId: 4663,
    role, safe: plan.counterfactualAddress, approvedPayer: MOBILE_DEPLOYMENT_PAYER, fromBlock: fromBlock.toString(),
    nextBlock: cursor.toString(), scannedBlocks: scanned, polls, observedAt: new Date(now()).toISOString(),
    status, reason: lastReason, finality: "L1_UNVERIFIED", broadcastAuthorized: false, ...extra });
  // The count bound also prevents a faulty/custom clock from creating an unbounded loop.
  for (; polls < Math.ceil(seconds * 1_000 / pollMs) + maxBlocks + 1 && now() < deadline;) {
    polls++;
    let unavailable = false;
    const read = (name) => async (...args) => {
      let row;
      try { row = await readers[name](...args); }
      catch { row = { status: "unavailable" }; }
      if (row?.status !== "observed") unavailable = true;
      return row;
    };
    const observed = Object.fromEntries(names.map((name) => [name, read(name)]));
    try {
      const chains = await Promise.all(names.map((name) => observed[name]("eth_chainId", [])));
      if (unavailable) { lastReason = "PROVIDER_UNAVAILABLE"; }
      else if (!chains.every((row) => row.value === "0x1237")) return result("EVIDENCE_INVALID", { reason: "WRONG_CHAIN" });
      else {
        const heads = await Promise.all(names.map((name) => observed[name]("eth_getBlockByNumber", ["latest", false])));
        if (!unavailable) {
          assert.ok(heads.every((row) => rpcQuantity.test(row.value?.number)), "Malformed head");
          const height = heads.map((row) => BigInt(row.value.number)).reduce((a, b) => a < b ? a : b);
          if (checkpoint) {
            const checkpoints = await Promise.all(names.map((name) => observed[name]("eth_getBlockByNumber", [quantity(checkpoint.number), false])));
            if (!unavailable && checkpoints.some((row) => row.value?.hash?.toLowerCase() !== checkpoint.hash)) {
              return result("EVIDENCE_INVALID", { reason: "REORG_INVALIDATED_CHECKPOINT", checkpoint: { number: checkpoint.number.toString(), hash: checkpoint.hash } });
            }
          }
          if (!unavailable && height >= cursor) {
            if (scanned >= maxBlocks) return result("PENDING", { reason: "SCAN_LIMIT_REACHED" });
            const end = [height, cursor + 383n, cursor + BigInt(maxBlocks - scanned) - 1n].reduce((a, b) => a < b ? a : b);
            const filter = { address: factory, fromBlock: quantity(cursor), toBlock: quantity(end), topics: [topic, proxyTopic] };
            const anchors = await Promise.all(names.map((name) => observed[name]("eth_getBlockByNumber", [quantity(end), false])));
            if (!unavailable) {
              assert.ok(anchors.every((row) => row.value?.number === quantity(end) && hash.test(row.value?.hash)), "Malformed canonical anchor");
              if (anchors[0].value.hash.toLowerCase() !== anchors[1].value.hash.toLowerCase()) return result("EVIDENCE_INVALID", { reason: "PROVIDER_BLOCK_DISAGREEMENT" });
              const logs = await Promise.all(names.map((name) => observed[name]("eth_getLogs", [filter])));
              if (!unavailable) {
                assert.ok(logs.every((row) => Array.isArray(row.value) && row.value.length <= 1), "Unexpected number of Safe creation events");
                const normalized = logs.map((row) => row.value.map((log) => {
                  assert.ok(log.address?.toLowerCase() === factory.toLowerCase() && log.removed === false &&
                    hash.test(log.blockHash) && hash.test(log.transactionHash) && rpcQuantity.test(log.blockNumber) &&
                    rpcQuantity.test(log.transactionIndex) && rpcQuantity.test(log.logIndex) &&
                    BigInt(log.blockNumber) >= cursor && BigInt(log.blockNumber) <= end &&
                    Array.isArray(log.topics) && log.topics.length === 2 && log.topics[0]?.toLowerCase() === topic &&
                    log.topics[1]?.toLowerCase() === proxyTopic && log.data?.toLowerCase() === singletonData,
                  "Malformed or mismatched Safe creation event");
                  return normalizeLog(log);
                }));
                if (JSON.stringify(normalized[0]) !== JSON.stringify(normalized[1])) return result("EVIDENCE_INVALID", { reason: "PROVIDER_LOG_DISAGREEMENT" });
                const rechecked = await Promise.all(names.map((name) => observed[name]("eth_getBlockByNumber", [quantity(end), false])));
                if (!unavailable && rechecked.some((row) => row.value?.hash?.toLowerCase() !== anchors[0].value.hash.toLowerCase())) return result("EVIDENCE_INVALID", { reason: "REORG_DURING_SCAN" });
                if (!unavailable && normalized[0].length) {
                  const transactionHash = normalized[0][0].transactionHash;
                  // The verifier binds the actual receipt, transaction input, initializer, salt,
                  // runtime and Safe state; an event alone never completes the operation.
                  // Pocket supplies receipt-block archive state; the official endpoint
                  // independently corroborates the canonical receipt and block. The
                  // official free endpoint may already have pruned historical state.
                  const proof = await verify({ reader: observed.pocket, corroboratingReader: observed.official,
                    role, hash: transactionHash, approvedPayer: MOBILE_DEPLOYMENT_PAYER });
                  if (!unavailable && proof?.status === "L2_CREATION_VERIFIED" && proof.role === role &&
                      proof.hash?.toLowerCase() === transactionHash && proof.safe?.toLowerCase() === plan.counterfactualAddress.toLowerCase()) {
                    return result("L2_CREATION_VERIFIED", { reason: "CANONICAL_RECEIPT_AND_SAFE_VERIFIED", proof });
                  }
                  if (!unavailable) return result("EVIDENCE_INVALID", { reason: "SAFE_PROOF_MISMATCH" });
                } else if (!unavailable) {
                  scanned += Number(end - cursor + 1n);
                  cursor = end + 1n;
                  checkpoint = { number: end, hash: anchors[0].value.hash.toLowerCase() };
                  lastReason = "NO_CREATION_OBSERVED";
                  if (cursor <= height) continue;
                }
              }
            }
          }
        }
        if (unavailable) lastReason = "PROVIDER_UNAVAILABLE";
      }
    } catch {
      if (!unavailable) return result("EVIDENCE_INVALID", { reason: "MALFORMED_OR_MISMATCHED_EVIDENCE" });
      lastReason = "PROVIDER_UNAVAILABLE";
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }
  return result("PENDING", { deadlineReached: now() >= deadline });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { "from-block": { type: "string" }, role: { type: "string" },
    seconds: { type: "string", default: "60" }, output: { type: "string" } } });
  assert.match(values["from-block"] ?? "", /^\d{1,20}$/, "Supply --from-block as a decimal block number");
  const output = privateOutputPath(values.output);
  const evidence = await watchSafeReceipt({ fromBlock: BigInt(values["from-block"]), role: values.role,
    seconds: Number(values.seconds) });
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  console.log(evidence.status + "; " + evidence.reason + "; evidence saved outside Git");
  if (evidence.status === "EVIDENCE_INVALID") process.exitCode = 1;
}
