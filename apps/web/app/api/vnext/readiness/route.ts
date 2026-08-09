import { readVNextReleaseReadiness } from "../../../../lib/vnext/release-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(readVNextReleaseReadiness(process.env), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
