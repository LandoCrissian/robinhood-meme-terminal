export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    status: "disabled",
    reason: "Wallet signing and transactions are disabled in this read-only preview.",
  }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
