import { createHash } from "node:crypto";
import { keccak256, type Hex } from "viem";
import { normalizeNativeTrace } from "../vnext/normalized-native-trace";
import type { SettlementTraceResult } from "./vnext-settlement-trace-client";
import preservedTrace from "./settlement-trace-archive/4663/0x3c5b142f2fcf2bad01a154b1b84754bd4e4c32281aa14c06641fa70f2221a522.json";
import provenance from "./settlement-trace-archive/4663/provenance.json";

if (typeof window !== "undefined") throw new Error("Historical settlement evidence is server-only.");

export type HistoricalTraceExpected = {
  hash: Hex; blockHash: Hex; blockNumber: bigint; from: string; to: string; input: Hex; value: bigint;
};
const TRACE_SHA256 = "3963a8431996dbfe97781437ecdb0122b888f33a0db9e586b3d959b8002202c1";
const same = (left: string | undefined, right: string) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();

/** Preserved full trace, never an accepted-status override or wallet allowlist.
 * The route must authenticate the wallet and establish a fresh canonical mined
 * envelope before this read, then recheck the receipt. The browser still binds
 * its exact original plan/calldata/recipient/minimum and computes native output.
 * Unknown transactions and every evidence mismatch retain ordinary recovery.
 */
export function readHistoricalSettlementTrace(expected: HistoricalTraceExpected): SettlementTraceResult | null {
  try {
    if (provenance.schemaVersion !== 1 || provenance.chainId !== 4663 || provenance.notAnAuthorization !== true
      || provenance.canonicalTraceSha256 !== TRACE_SHA256 || provenance.originalTraceSha256 !== TRACE_SHA256
      || !same(provenance.txHash, expected.hash) || !same(provenance.blockHash, expected.blockHash)
      || provenance.blockNumber !== expected.blockNumber.toString() || expected.value !== 0n
      || createHash("sha256").update(JSON.stringify(preservedTrace)).digest("hex") !== TRACE_SHA256) return null;
    const trace = normalizeNativeTrace(preservedTrace);
    if (trace.type !== "CALL" || trace.error || trace.value !== "0x0"
      || !same(trace.from, expected.from) || !same(trace.to, expected.to)
      || !same(trace.inputHash, keccak256(expected.input))) return null;
    return { status: "available", txHash: expected.hash.toLowerCase(), blockHash: expected.blockHash.toLowerCase(), trace };
  } catch { return null; }
}
