import { isAddress, getAddress, zeroAddress } from "viem";
import { readProjectOwnership } from "../../../../../lib/server/project-ownership-reader";
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet || !isAddress(wallet, { strict: false }) || wallet.toLowerCase() === zeroAddress) return Response.json({ error: "Invalid public wallet address" }, { status: 400 });
  const result = await readProjectOwnership(projectId, getAddress(wallet));
  return Response.json(result ?? { error: "Project not found" }, { status: result ? 200 : 404, headers: { "cache-control": "private, no-store" } });
}
