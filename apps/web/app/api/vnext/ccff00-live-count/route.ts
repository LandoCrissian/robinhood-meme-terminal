import { NextResponse } from "next/server";
import { createPublicClient, parseAbi, http } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../../../lib/vnext/trusted-asset-registry";
import { acrossRpcEndpoint } from "../../../../lib/server/vnext-across-rpc";
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
  transport: http(acrossRpcEndpoint(ROBINHOOD_MAINNET_CHAIN_ID), {
    retryCount: 3,
    timeout: 12_000
  })
});

export async function GET() {
  try {
    const latestBlock = await client.getBlock({ includeTransactions: false });
    if (!latestBlock || latestBlock.number === undefined || !latestBlock.hash) {
      return NextResponse.json({ error: "LIVE COUNT UNAVAILABLE" }, {
        status: 503,
        headers: HEADERS
      });
    }
    const [totalSupply, publicMinted, reserveMinted] = await Promise.all([
      client.readContract({
        address: CCFF00_COLLECTION,
        abi: collectionAbi,
        functionName: "totalSupply",
        blockNumber: latestBlock.number
      }),
      client.readContract({
        address: CCFF00_COLLECTION,
        abi: collectionAbi,
        functionName: "publicMinted",
        blockNumber: latestBlock.number
      }),
      client.readContract({
        address: CCFF00_COLLECTION,
        abi: collectionAbi,
        functionName: "reserveMinted",
        blockNumber: latestBlock.number
      })
    ]);

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
