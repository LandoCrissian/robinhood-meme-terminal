import { POST as quotes } from "../../../vnext/quotes/route";
import { POST as verify } from "../../../vnext/verify/route";
import { POST as authorize } from "../../../vnext/authorize/route";
import { POST as trace } from "../../../vnext/native-settlement-trace/route";
import { handleCannaCatEmbedRequest } from "../../../../../lib/server/cannacat-embed-boundary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const dependencies = { handlers: { quotes, verify, authorize, "native-settlement-trace": trace } };
type Context = { params: Promise<{ operation: string }> };

export async function POST(request: Request, context: Context) {
  return handleCannaCatEmbedRequest(request, (await context.params).operation, dependencies);
}
export async function OPTIONS(request: Request, context: Context) {
  return handleCannaCatEmbedRequest(request, (await context.params).operation, dependencies);
}
