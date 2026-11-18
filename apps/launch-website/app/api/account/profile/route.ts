import { accountHandler } from "../../../../lib/server/profiles/controller";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return accountHandler(request, "profile"); }
export function PATCH(request: Request) { return accountHandler(request, "profile"); }
export function DELETE(request: Request) { return accountHandler(request, "profile"); }
