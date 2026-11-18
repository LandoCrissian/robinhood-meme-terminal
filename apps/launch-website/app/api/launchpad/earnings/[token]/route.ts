import { earningsResponse } from "../../../../../lib/server/earnings-data";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return earningsResponse(request, {}, (await context.params).token);
}
