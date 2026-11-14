import { isLaunchAddress } from "../launch-data";
import { readLaunchDirectory } from "./launch-data";

const headers = { "Cache-Control": "private, no-store" };

export async function respondWithLaunchHistory(request: Request, token?: string) {
  if (new URL(request.url).search || (token !== undefined && !isLaunchAddress(token))) {
    return Response.json({ error: "invalid_launch_history_request" }, { status: 400, headers });
  }
  const data = await readLaunchDirectory(token);
  const status = data.status === "unavailable" ? 503 : token && !data.launches.length ? 404 : 200;
  return Response.json(data, { status, headers });
}
