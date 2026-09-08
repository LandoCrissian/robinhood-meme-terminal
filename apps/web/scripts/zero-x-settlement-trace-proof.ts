import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, decodeFunctionData, getAddress, http, keccak256, parseAbi, stringToHex, zeroAddress, type Hash } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { readBoundedSettlementJson, readSettlementTrace } from "../lib/server/vnext-settlement-trace-client";
import { decodeZeroXExecutableMinimum, ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH } from "../lib/server/vnext-zero-x-execution-decoder";
import { verifyVNextNativeOutputSettlement } from "../lib/vnext/output-settlement";

// Public mined transaction capability proof, not a new execution or a synthetic
// user-journal entry. Explorer supplies candidate hashes only; ordinary RPC and
// the canonical executable decoder independently establish every binding.
async function main() {
  if (!process.env.RMT_SETTLEMENT_TRACE_RPC_URL) process.loadEnvFile(".env.local");
  const report: Record<string, unknown> = { observedAt: new Date().toISOString(), chainId: 4663, traceMethod: "debug_traceTransaction",
    traceProviderKind: "NOT_CONFIGURED", traceSupported: "UNPROVEN", callTracerSupported: "UNPROVEN", traceTxHash: null,
    traceNormalization: "NOT_REACHED", verifierResult: "NOT_REACHED", liveNativeSettlementProof: "NOT_ESTABLISHED",
    credentialServerOnly: true, walletRequests: 0, signatures: 0, transactions: 0, journalChanged: false };
  const save = () => {
    const out = resolve("../../evidence/trading-hardening/sell-response-closure"); mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, "dedicated-native-trace-proof.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  };
  if (!process.env.RMT_SETTLEMENT_TRACE_RPC_URL) { report.blocker = "SERVER_ONLY_TRACE_ENDPOINT_NOT_SUPPLIED"; save(); return; }
  try {
    const hostname = new URL(process.env.RMT_SETTLEMENT_TRACE_RPC_URL).hostname;
    report.traceProviderKind = hostname.endsWith(".quiknode.pro") ? "QUICKNODE" : "CONFIGURED_EVM_RPC";
    const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RMT_RPC_URL?.trim()
      || process.env.RMT_MAINNET_RPC_URL?.trim() || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
      || process.env.NEXT_PUBLIC_RMT_RPC_URL?.trim() || robinhoodChain.rpcUrls.default.http[0], { timeout: 8000, retryCount: 0 }) });
    if (await client.getChainId() !== 4663) throw new Error();
    const holder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
    if (keccak256(await client.getCode({ address: holder }) ?? "0x") !== "0x99f5e8edaceacfdd183eb5f1da8a7757b322495b80cf7928db289a1b1a09f799") throw new Error();
    const candidates: Hash[] = [];
    const supplied = process.env.RMT_SETTLEMENT_TRACE_PROOF_TX_HASH;
    if (supplied && /^0x[0-9a-f]{64}$/i.test(supplied)) candidates.push(supplied as Hash);
    else {
      const response = await fetch(`https://robinhoodchain.blockscout.com/api/v2/addresses/${holder}/transactions?filter=to`, { signal: AbortSignal.timeout(8000) });
      const body = await readBoundedSettlementJson(response) as { items?: { hash?: string }[] };
      if (!response.ok || !Array.isArray(body.items)) throw new Error();
      for (const item of body.items.slice(0, 12)) if (typeof item.hash === "string" && /^0x[0-9a-f]{64}$/i.test(item.hash)) candidates.push(item.hash as Hash);
    }
    for (const hash of candidates) {
      const transaction = await client.getTransaction({ hash });
      const receipt = await client.getTransactionReceipt({ hash });
      if (transaction.to?.toLowerCase() !== holder.toLowerCase() || transaction.value !== 0n || receipt.status !== "success") continue;
      let decoded;
      let inputAsset;
      let inputAmountAtomic;
      try {
        const { args } = decodeFunctionData({ abi: parseAbi(["function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)"]), data: transaction.input });
        inputAsset = getAddress(args[1]); inputAmountAtomic = args[2].toString();
        decoded = decodeZeroXExecutableMinimum({ target: holder, data: transaction.input, inputAsset,
          outputAsset: zeroAddress, inputAmountAtomic, recipient: transaction.from, valueAtomic: "0" });
      } catch { continue; }
      if (keccak256(await client.getCode({ address: decoded.settlerTarget }) ?? "0x") !== ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH) continue;
      report.traceTxHash = hash;
      const result = await readSettlementTrace(hash);
      if (result.status !== "available") { report.blocker = result.reason; break; }
      report.traceSupported = "YES"; report.callTracerSupported = "YES"; report.traceNormalization = "PASS";
      if (result.blockHash !== receipt.blockHash.toLowerCase()) { report.blocker = "INDEPENDENT_RECEIPT_BLOCK_MISMATCH"; break; }
      const record = { chainId: 4663, provider: "zero-x-swap", kind: "swap", wallet: transaction.from, txHash: hash,
        planId: `public-capability:${hash}`, payloadHash: keccak256(stringToHex(`public-capability:${hash}`)),
        inputAsset, inputAmountAtomic, outputAsset: zeroAddress,
        providerNativeFee: { protectedOutputAtomic: decoded.minimumAtomic, transactionTarget: holder, calldataHash: keccak256(transaction.input) }
      } as unknown as Parameters<typeof verifyVNextNativeOutputSettlement>[0];
      const proof = verifyVNextNativeOutputSettlement(record, receipt, transaction, result.trace);
      report.verifierResult = proof ? "PASS" : "CONFIRMED_UNSETTLED";
      report.liveNativeSettlementProof = proof ? "PUBLIC_TRANSACTION_CAPABILITY_PASS" : "NOT_ESTABLISHED";
      report.protectedMinimum = decoded.minimumAtomic; report.provenNetNativeAtomic = proof?.amountAtomic ?? null;
      report.authorityContext = "Read-only reconstructed public transaction capability record; not an owner execution/journal entry";
      break;
    }
    if (!report.traceTxHash) report.blocker = "NO_NATIVE_OUTPUT_CONTROL_FOUND_IN_BOUNDED_PUBLIC_SAMPLE";
  } catch { report.blocker = "CAPABILITY_READ_UNAVAILABLE"; }
  save();
}
void main().catch(() => { console.error("TRACE_PROOF_UNAVAILABLE_NO_PROVIDER_DETAILS_RETAINED"); process.exitCode = 1; });
