import { NextResponse } from "next/server";
import { readVNextMarketDirectoryRequest } from "../../../../lib/server/vnext-market-directory-route";

export async function GET(request: Request) {
  const result = await readVNextMarketDirectoryRequest(request.url);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers
  });
}
