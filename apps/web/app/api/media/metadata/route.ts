import { NextResponse } from "next/server";
import { z } from "zod";
import {
  fetchWithTimeout,
  guardMediaRequest,
  readBoundedJsonRequest,
  readBoundedJsonResponse
} from "../../../../lib/server/media-request-guard";

const MAX_REQUEST_BYTES = 4_096;
const PINATA_TIMEOUT_MS = 10_000;
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };
const httpsUrlOrEmpty = z.string().trim().max(300).url().startsWith("https://").or(z.literal(""));

const metadataSchema = z.object({
  name: z.string().trim().min(2).max(40),
  symbol: z.string().trim().min(2).max(10).regex(/^[A-Z0-9]+$/),
  description: z.string().trim().min(10).max(500),
  image: z.string().max(200).regex(/^ipfs:\/\/[a-zA-Z0-9]+$/),
  website: httpsUrlOrEmpty,
  x: httpsUrlOrEmpty,
  telegram: httpsUrlOrEmpty
}).strict();

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "media-metadata", limit: 6, windowMs: 60_000 });
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error },
      {
        status: guard.status,
        headers: {
          ...RESPONSE_HEADERS,
          ...(guard.retryAfterSeconds ? { "Retry-After": String(guard.retryAfterSeconds) } : {})
        }
      }
    );
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "Token metadata storage is not configured yet." }, { status: 503, headers: RESPONSE_HEADERS });
  const body = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: RESPONSE_HEADERS });
  const parsed = metadataSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "The token metadata is invalid." }, { status: 400, headers: RESPONSE_HEADERS });

  const metadata = { ...parsed.data, website: parsed.data.website || undefined, x: parsed.data.x || undefined, telegram: parsed.data.telegram || undefined, decimals: 18, properties: { category: "image" } };
  const file = new File([JSON.stringify(metadata)], `${parsed.data.symbol.toLowerCase()}-metadata.json`, { type: "application/json" });
  const form = new FormData();
  form.append("file", file);
  form.append("network", "public");
  const upstream = await fetchWithTimeout(
    "https://uploads.pinata.cloud/v3/files",
    { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form },
    PINATA_TIMEOUT_MS
  );
  if (!upstream.ok) {
    return NextResponse.json(
      { error: upstream.timedOut ? "Metadata storage timed out. Please try again." : "Metadata storage is temporarily unavailable." },
      { status: upstream.timedOut ? 504 : 502, headers: { ...RESPONSE_HEADERS, "Retry-After": "5" } }
    );
  }

  const result = await readBoundedJsonResponse(upstream.response, 32_768) as { data?: { cid?: unknown } } | null;
  const cid = result?.data?.cid;
  if (!upstream.response.ok || typeof cid !== "string" || !/^[a-zA-Z0-9]+$/.test(cid)) {
    return NextResponse.json({ error: "Could not save token metadata." }, { status: 502, headers: RESPONSE_HEADERS });
  }
  return NextResponse.json({ uri: `ipfs://${cid}`, cid }, { headers: RESPONSE_HEADERS });
}
