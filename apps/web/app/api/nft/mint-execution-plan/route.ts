import { createNftMintExecutionPlanPostHandler } from "../../../../lib/server/nft-mint-execution-plan-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createNftMintExecutionPlanPostHandler();
