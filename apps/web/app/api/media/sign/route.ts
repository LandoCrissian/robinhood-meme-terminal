import { NextResponse } from "next/server";
import {
  fetchWithTimeout,
  guardMediaRequest,
  readBoundedJsonRequest,
  readBoundedJsonResponse
} from "../../../../lib/server/media-request-guard";

const MAX_IMAGE_BYTES = 5_000_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_REQUEST_BYTES = 2_048;
const PINATA_TIMEOUT_MS = 8_000;
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "media-sign", limit: 10, windowMs: 60_000 });
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
  if (!jwt) return NextResponse.json({ error: "Token image storage is not configured yet." }, { status: 503, headers: RESPONSE_HEADERS });

  const body = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: RESPONSE_HEADERS });
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return NextResponse.json({ error: "The image request is invalid." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const requestedFilename = (body.value as { filename?: unknown }).filename;
  if (requestedFilename !== undefined && (typeof requestedFilename !== "string" || requestedFilename.length > 200)) {
    return NextResponse.json({ error: "The image filename is invalid." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const filename = (requestedFilename || "token-image").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
  const upstream = await fetchWithTimeout("https://uploads.pinata.cloud/v3/files/sign", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ network: "public", date: Math.floor(Date.now() / 1000), expires: 60, max_file_size: MAX_IMAGE_BYTES, allow_mime_types: IMAGE_TYPES, filename })
  }, PINATA_TIMEOUT_MS);
  if (!upstream.ok) {
    return NextResponse.json(
      { error: upstream.timedOut ? "Image storage timed out. Please try again." : "Image storage is temporarily unavailable." },
      { status: upstream.timedOut ? 504 : 502, headers: { ...RESPONSE_HEADERS, "Retry-After": "5" } }
    );
  }

  const result = await readBoundedJsonResponse(upstream.response, 32_768) as { data?: unknown } | null;
  if (!upstream.response.ok || typeof result?.data !== "string" || !result.data.startsWith("https://")) {
    return NextResponse.json({ error: "Could not prepare the image upload." }, { status: 502, headers: RESPONSE_HEADERS });
  }
  return NextResponse.json({ url: result.data, maxBytes: MAX_IMAGE_BYTES, types: IMAGE_TYPES }, { headers: RESPONSE_HEADERS });
}
