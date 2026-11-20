import { handleProductionEarningsClaim } from "../../../../lib/server/production-earnings";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleProductionEarningsClaim(request);
