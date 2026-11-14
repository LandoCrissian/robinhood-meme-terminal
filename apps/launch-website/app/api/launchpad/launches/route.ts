import { respondWithLaunchHistory } from "../../../../lib/server/launch-api";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return respondWithLaunchHistory(request);
}
