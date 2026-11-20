import { handleProductionLifecycle } from "../../../../lib/server/production-lifecycle";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleProductionLifecycle(request);
