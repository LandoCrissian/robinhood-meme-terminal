import { NextResponse } from "next/server";
import { readVNextCanonicalMarketDirectoryPage } from "../../../../lib/server/vnext-canonical-market-directory";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: Request) {
  const result = await readVNextCanonicalMarketDirectoryPage(request.url);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: NO_STORE_HEADERS
  });
}
