import { getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";
import {
  assessExternalV4Execution,
  isUniswapV4PoolId,
  type ExternalV4Evidence
} from "../../../../lib/external-v4-evidence";
import { verifyExternalUniswapV4Market } from "../../../../lib/server/external-uniswap-v4-market";
import { simulateExternalUniswapV4Sell } from "../../../../lib/server/external-uniswap-v4-simulation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  token: z.string().refine(isAddress),
  pool: z.string().refine(isUniswapV4PoolId)
});

export async function GET(request: Request) {
  try {
    const parsed = requestSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid Uniswap v4 evidence request." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const market = await verifyExternalUniswapV4Market({
      token: getAddress(parsed.data.token),
      poolId: parsed.data.pool as Hex
    });
    const sellSimulation = await simulateExternalUniswapV4Sell(market);
    const executionAssessment = assessExternalV4Execution({
      hook: market.hook,
      sellSimulation
    });
    const warnings = [
      "This evidence is a point-in-time rehearsal, not a guarantee that a later trade will succeed.",
      "Price, liquidity, hook state, balances, approvals, and routing can change before wallet confirmation.",
      ...(market.hook.affectsSwap
        ? ["This pool uses hook logic that can run during swaps. Review the exact permissions below."]
        : [])
    ];
    const payload: ExternalV4Evidence = {
      protocol: "uniswap-v4",
      token: market.token,
      poolId: market.poolId,
      poolManager: market.poolManager,
      stateView: market.stateView,
      quoter: market.quoter,
      router: market.router,
      marketVerified: true,
      poolKey: market.poolKey,
      poolState: {
        sqrtPriceX96: market.poolState.sqrtPriceX96.toString(),
        tick: market.poolState.tick,
        protocolFee: market.poolState.protocolFee,
        lpFee: market.poolState.lpFee,
        initializedAtBlock: market.poolState.initializedAtBlock.toString()
      },
      hook: market.hook,
      sellSimulation,
      executionAssessment,
      warnings,
      checkedAt: new Date().toISOString()
    };
    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120"
      }
    });
  } catch {
    return Response.json(
      { error: "RMT could not complete canonical v4 hook and sell-route evidence." },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}
