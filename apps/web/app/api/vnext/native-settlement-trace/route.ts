import { createPublicClient, getAddress, http } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { readBoundedSettlementJson, readSettlementTrace } from "../../../../lib/server/vnext-settlement-trace-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store, max-age=0" };
const unavailable = () => Response.json({ status: "unavailable" }, { headers });

export async function POST(request: Request) {
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
      || receipt.to?.toLowerCase() !== transaction.to.toLowerCase() || transaction.value !== 0n) return unavailable();
    const result = await readSettlementTrace(hash);
    if (result.status !== "available" || result.blockHash !== receipt.blockHash.toLowerCase()) return unavailable();
    // The browser additionally binds its durable exact plan, payload, calldata,
    // recipient, native output and minimum. This response never grants authority.
    return Response.json(result, { headers });
  } catch (cause) { return tradeIdentityErrorResponse(cause) ?? unavailable(); }
}
