import { createPublicClient, getAddress, http } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { readBoundedSettlementJson, readSettlementTrace, readOfficialExplorerSettlementTrace } from "../../../../lib/server/vnext-settlement-trace-client";
import { readHistoricalSettlementTrace } from "../../../../lib/server/historical-settlement-trace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store, max-age=0" };
type RecoveryReadReason = "INVALID_REQUEST" | "UNSUPPORTED_ENVELOPE" | "TRACE_SOURCE_UNAVAILABLE" | "CANONICAL_RECEIPT_CHANGED" | "RECOVERY_READ_FAILED";
const unavailable = (reason: RecoveryReadReason = "INVALID_REQUEST") => {
  // Categorical diagnostics only; never log identity tokens, wallets, payloads,
  // provider URLs, credentials or arbitrary exception messages.
  console.info(JSON.stringify({ event: "native_settlement_evidence", status: "unavailable", reason }));
  return Response.json({ status: "unavailable", reason }, { headers });
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = await readBoundedSettlementJson(request, 512);
    if (!body || typeof body !== "object" || Array.isArray(body)) return unavailable();
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join(",") !== "txHash,wallet" || typeof input.txHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(input.txHash)
      || typeof input.wallet !== "string" || !/^0x[0-9a-f]{40}$/i.test(input.wallet)) return unavailable();
    const wallet = getAddress(input.wallet);
    await requireAuthenticatedTradeWallet(request, wallet);
    // Existing ordinary RPC remains independent transaction/receipt authority.
    const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RMT_RPC_URL?.trim()
      || process.env.RMT_MAINNET_RPC_URL?.trim() || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
      || process.env.NEXT_PUBLIC_RMT_RPC_URL?.trim() || robinhoodChain.rpcUrls.default.http[0], { timeout: 8000, retryCount: 0 }) });
    const hash = input.txHash as `0x${string}`;
    const [chainId, transaction, receipt] = await Promise.all([client.getChainId(), client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
    if (chainId !== 4663 || transaction.chainId !== 4663 || receipt.status !== "success"
      || transaction.hash.toLowerCase() !== hash.toLowerCase() || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
      || transaction.blockHash !== receipt.blockHash || getAddress(transaction.from) !== wallet || getAddress(receipt.from) !== wallet
      || transaction.to?.toLowerCase() !== "0x0000000000001ff3684f28c67538d4d072c22734"
      || receipt.to?.toLowerCase() !== transaction.to.toLowerCase() || transaction.value !== 0n) return unavailable("UNSUPPORTED_ENVELOPE");
    // Previously independently verified full traces remain recoverable when a
    // live tracing provider is unavailable. This grants no transaction authority:
    // authentication and the fresh canonical envelope above are still required.
    const expected = transaction.blockNumber !== null && transaction.blockHash && transaction.to
      ? { hash, blockHash: transaction.blockHash, blockNumber: transaction.blockNumber,
          from: transaction.from, to: transaction.to, input: transaction.input, value: transaction.value } : null;
    const historical = expected ? readHistoricalSettlementTrace(expected) : null;
    let source = historical ? "historical_archive_v1" : "trace_rpc";
    let result = historical ?? await readSettlementTrace(hash);
    if (result.status !== "available" && transaction.blockNumber !== null && transaction.blockHash && transaction.to) {
      source = "official_explorer";
      result = await readOfficialExplorerSettlementTrace({ hash, blockHash: transaction.blockHash, blockNumber: transaction.blockNumber,
        from: transaction.from, to: transaction.to, input: transaction.input, value: transaction.value }, { timeoutMs: 5000 });
    }
    if (result.status !== "available" || result.blockHash !== receipt.blockHash.toLowerCase() || Date.now() - startedAt > 20_000) return unavailable("TRACE_SOURCE_UNAVAILABLE");
    const canonicalAfter = await client.getTransactionReceipt({ hash });
    if (canonicalAfter.status !== "success" || canonicalAfter.blockHash !== receipt.blockHash
      || canonicalAfter.transactionHash.toLowerCase() !== hash.toLowerCase()) return unavailable("CANONICAL_RECEIPT_CHANGED");
    // The browser additionally binds its durable exact plan, payload, input bytes,
    // recipient, native output and minimum. This response never grants authority.
    console.info(JSON.stringify({ event: "native_settlement_evidence", status: "available", source }));
    return Response.json(result, { headers });
  } catch (cause) { return tradeIdentityErrorResponse(cause) ?? unavailable("RECOVERY_READ_FAILED"); }
}

