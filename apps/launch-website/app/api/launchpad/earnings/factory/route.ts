import { earningsResponse } from "../../../../../lib/server/earnings-data";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => earningsResponse(request, {}, undefined, false, true);
