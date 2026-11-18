import { accountHandler } from "../../../../../lib/server/profiles/controller";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ wallet: string }> }) { return accountHandler(request, "public-wallet", (await context.params).wallet); }
