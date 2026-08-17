import { NextResponse } from "next/server";
import { createPublicClient, parseAbi, http } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { CCFF00_COLLECTION } from "../../../../lib/vnext/distribution-ccff00";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

const collectionAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function publicMinted() view returns (uint256)",
  "function reserveMinted() view returns (uint256)"
]);

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0], {
    retryCount: 3,
    timeout: 12_000
  })
});

export async function GET() {
  try {
    const [latestBlock, totalSupply, publicMinted, reserveMinted] = await Promise.all([
      client.getBlock(),
      client.readContract({ address: CCFF00_COLLECTION, abi: collectionAbi, functionName: "totalSupply" }),
      client.readContract({ address: CCFF00_COLLECTION, abi: collectionAbi, functionName: "publicMinted" }),
      client.readContract({ address: CCFF00_COLLECTION, abi: collectionAbi, functionName: "reserveMinted" })
    ]);

    if (!latestBlock || latestBlock.number === undefined || !latestBlock.hash) {
      return NextResponse.json({ error: "LIVE COUNT UNAVAILABLE" }, {
        status: 503,
        headers: HEADERS
      });
    }

    return NextResponse.json({
        status: "ready",
        chainId: robinhoodChain.id,
        liveChainState: {
          blockNumber: latestBlock.number.toString(),
          blockHash: latestBlock.hash,
          publicMinted: publicMinted.toString(),
          totalSupply: totalSupply.toString(),
          reserveMinted: reserveMinted.toString()
        },
      observedAt: new Date().toISOString()
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "LIVE COUNT UNAVAILABLE" }, {
      status: 503,
      headers: HEADERS
    });
  }
}
