import { accountHandler } from "../../../../lib/server/profiles/controller";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return accountHandler(request, "avatar"); }
export function DELETE(request: Request) { return accountHandler(request, "avatar"); }
