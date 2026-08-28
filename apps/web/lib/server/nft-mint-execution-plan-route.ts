import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { readRmtNftMintRadar, type RmtMintRadarResponse } from "./nft-mint-radar";
import { runRmtNftMintPreflightWithPlan } from "./nft-mint-preflight";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "./rmt-trade-identity";

const requestSchema = z.object({
  candidateId: z.string().regex(/^opensea:[a-zA-Z0-9._-]{1,160}$/),
  wallet: z.string().refine((value) => isAddress(value, { strict: false })),
  quantity: z.number().int().min(1).max(10),
}).strict();

type WalletBinder = (request: Request, wallet: Address) => Promise<unknown>;
type RadarReader = () => Promise<RmtMintRadarResponse>;
type PlanRunner = typeof runRmtNftMintPreflightWithPlan;

export function createNftMintExecutionPlanPostHandler(dependencies: {
  env?: Partial<NodeJS.ProcessEnv>;
  bindWallet?: WalletBinder;
  readRadar?: RadarReader;
  runPreflightWithPlan?: PlanRunner;
} = {}) {
  const env = dependencies.env ?? process.env;
  const bindWallet = dependencies.bindWallet ?? requireAuthenticatedTradeWallet;
  const readRadar = dependencies.readRadar ?? readRmtNftMintRadar;
  const runPreflightWithPlan = dependencies.runPreflightWithPlan ?? runRmtNftMintPreflightWithPlan;
  return async function POST(request: Request) {
    if (env.RMT_NFT_MINT_EXECUTION_ENABLED !== "true") {
      return Response.json({ status: "EXECUTION_DISABLED", message: "NFT mint execution is not enabled." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    try {
      const parsed = requestSchema.safeParse(await request.json());
      if (!parsed.success) return Response.json({ error: "Invalid NFT mint execution intent." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      const wallet = getAddress(parsed.data.wallet);
      await bindWallet(request, wallet);
      const radar = await readRadar();
      if (radar.status !== "READY") {
        return Response.json({ status: "PROVIDER_UNAVAILABLE", message: "Fresh Mint Radar evidence is unavailable." }, { status: 422, headers: { "Cache-Control": "no-store" } });
      }
      const candidate = radar.live.find((item) => item.candidateId === parsed.data.candidateId);
      if (!candidate) {
        return Response.json({ status: "NOT_PREFLIGHT_ELIGIBLE", message: "The candidate is not in the current LIVE NOW Radar feed." }, { status: 422, headers: { "Cache-Control": "no-store" } });
      }
      const { report, plan } = await runPreflightWithPlan({ candidate, wallet, quantity: BigInt(parsed.data.quantity), env });
      if (!plan || report.status !== "PREFLIGHT_READY") return Response.json(report, { status: 422, headers: { "Cache-Control": "no-store" } });
      return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      const identityResponse = tradeIdentityErrorResponse(cause);
      if (identityResponse) return identityResponse;
      return Response.json({ error: "NFT mint execution plan could not be established." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
  };
}
