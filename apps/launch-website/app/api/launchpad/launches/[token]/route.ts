import { respondWithLaunchHistory } from "../../../../../lib/server/launch-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return respondWithLaunchHistory(request, (await context.params).token);
}
