import {
  handleAcrossInfrastructurePreflightRequest,
  runAcrossInfrastructurePreflight
} from "../../../../../lib/server/vnext-across-infrastructure-preflight";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleAcrossInfrastructurePreflightRequest(request, {
    env: process.env,
    runPreflight: () => runAcrossInfrastructurePreflight({ env: process.env })
  });
}
