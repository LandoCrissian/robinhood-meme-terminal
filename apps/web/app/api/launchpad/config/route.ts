import { NextResponse } from "next/server";
import { readLaunchpadRuntime, verifiedLaunchpadRpc } from "../../../../lib/server/new-launchpad-config";
import { LaunchpadStore } from "../../../../lib/server/new-launchpad-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET() {
  try {
    const config = readLaunchpadRuntime();
    if (!config) {
      return NextResponse.json({ status: "disabled", reason: "New launches are disabled on this deployment." }, { headers });
    }
    const store = new LaunchpadStore(config.databasePath, config.scope);
    store.close();
    await verifiedLaunchpadRpc(config);
    return NextResponse.json({ status: "ready", deployment: config.deployment }, { headers });
  } catch {
    return NextResponse.json({ status: "unavailable", reason: "The local launch stack could not be verified." }, { status: 503, headers });
  }
}
