import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { walletTransports } from "../app/wallet-config";

// Run with the Production NEXT_PUBLIC_RMT_RPC_URL setting (currently absent,
// verified read-only in Vercel), not with browser-fixture or server overrides.
async function main() {
  const client = createPublicClient({ chain: robinhoodChain, transport: walletTransports[4663] });
  const hash = "0xc60aee39ad2299370bec76f1bb3023a02b89c8f1417bd92b0cd8a055f7ed70a3" as const;
  const chainId = await client.getChainId();
  const receipt = await client.getTransactionReceipt({ hash });
  const transaction = await client.getTransaction({ hash });
  if (chainId !== 4663 || receipt.status !== "success" || receipt.transactionHash !== hash || transaction.hash !== hash || transaction.blockHash !== receipt.blockHash) throw new Error();
  const methods: Record<string, unknown>[] = [];
  const request = client.request as unknown as (args: { method: string; params: unknown[] }) => Promise<unknown>;
  for (const method of ["debug_traceTransaction", "trace_transaction", "arbtrace_transaction"]) {
    try {
      const trace = await request({ method, params: method === "debug_traceTransaction" ? [hash, { tracer: "callTracer", timeout: "5s" }] : [hash] });
      const shape = trace && typeof trace === "object" && !Array.isArray(trace) && (trace as { type?: unknown }).type === "CALL";
      methods.push({ method, supported: true, callTracerShape: Boolean(shape) });
    } catch (error) {
      let cause: unknown = error, code: number | null = null;
      for (let depth = 0; depth < 8 && cause && typeof cause === "object"; depth++) {
        const value = cause as { code?: unknown; cause?: unknown };
        if (typeof value.code === "number" && Number.isSafeInteger(value.code)) code = value.code;
        cause = value.cause;
      }
      methods.push({ method, supported: false, code });
    }
  }
  const report = { observedAt: new Date().toISOString(), chainId, transactionHash: hash, receiptStatus: receipt.status,
    blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    path: "Production walletTransports[4663] via Viem publicClient.request, as used by useVNextExecutionRecovery",
    productionPublicRpcOverride: process.env.NEXT_PUBLIC_RMT_RPC_URL ? "PRESENT" : "ABSENT_CANONICAL_DEFAULT",
    methods, nativeSettlementProof: "NOT_ESTABLISHED", verifierResult: "NOT_REACHED_TRACE_UNAVAILABLE",
    canaryDirection: "ETH_TO_USDG_CAPABILITY_CONTROL_NOT_NATIVE_OUTPUT_PROOF",
    blocker: "Existing Production RPC exposes no transaction trace. Native settlement remains confirmed_unsettled; a supported transaction-specific evidence source requires owner review before a new authority is introduced.",
    walletRequests: 0, signatures: 0, transactions: 0, productionChanged: false };
  const out = resolve("../../evidence/trading-hardening/sell-response-closure"); mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "native-trace-capability.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
void main().catch(() => { console.error("CAPABILITY_CHECK_UNAVAILABLE_NO_RAW_ERRORS_RETAINED"); process.exitCode = 1; });
