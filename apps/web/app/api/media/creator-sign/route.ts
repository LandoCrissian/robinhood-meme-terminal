import { NextResponse } from "next/server";
import { normalizeProjectSlug } from "../../../../lib/creator-application";
import {
  fetchWithTimeout,
  guardMediaRequest,
  readBoundedJsonRequest,
  readBoundedJsonResponse
} from "../../../../lib/server/media-request-guard";

const MAX_IMAGE_BYTES = 5_000_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_REQUEST_BYTES = 2_048;
const FIRESTORE_TIMEOUT_MS = 6_000;
const PINATA_TIMEOUT_MS = 8_000;
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{100,4096})$/);
  return match?.[1] ?? "";
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "creator-media-sign", limit: 12, windowMs: 60_000 });
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

  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Verified creator sign-in required." }, { status: 401, headers: RESPONSE_HEADERS });

  const body = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: RESPONSE_HEADERS });
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return NextResponse.json({ error: "The creator media request is invalid." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const input = body.value as { filename?: unknown; projectSlug?: unknown };
  const projectSlug = typeof input.projectSlug === "string" ? normalizeProjectSlug(input.projectSlug) : "";
  if (!projectSlug || projectSlug !== input.projectSlug) {
    return NextResponse.json({ error: "The project identity is invalid." }, { status: 400, headers: RESPONSE_HEADERS });
  }
  if (input.filename !== undefined && (typeof input.filename !== "string" || input.filename.length > 200)) {
    return NextResponse.json({ error: "The image filename is invalid." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "";
  if (!/^[a-z0-9-]{4,64}$/.test(projectId)) {
    return NextResponse.json({ error: "Creator ownership verification is unavailable." }, { status: 503, headers: RESPONSE_HEADERS });
  }
  const assignment = await fetchWithTimeout(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/projectAssignments/${encodeURIComponent(projectSlug)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    FIRESTORE_TIMEOUT_MS
  );
  if (!assignment.ok) {
    return NextResponse.json(
      { error: assignment.timedOut ? "Creator ownership verification timed out." : "Creator ownership verification is unavailable." },
      { status: assignment.timedOut ? 504 : 502, headers: RESPONSE_HEADERS }
    );
  }
  if (!assignment.response.ok) {
    const denied = [401, 403, 404].includes(assignment.response.status);
    return NextResponse.json(
      { error: denied ? "This profile is not assigned to manage the project." : "Creator ownership verification is unavailable." },
      { status: denied ? 403 : 502, headers: RESPONSE_HEADERS }
    );
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "Creator image storage is not configured yet." }, { status: 503, headers: RESPONSE_HEADERS });
  const filename = (input.filename || "creator-image").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
  const upstream = await fetchWithTimeout("https://uploads.pinata.cloud/v3/files/sign", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      network: "public",
      date: Math.floor(Date.now() / 1000),
      expires: 60,
      max_file_size: MAX_IMAGE_BYTES,
      allow_mime_types: IMAGE_TYPES,
      filename: `${projectSlug}-${filename}`
    })
  }, PINATA_TIMEOUT_MS);
  if (!upstream.ok) {
    return NextResponse.json(
      { error: upstream.timedOut ? "Image storage timed out. Please try again." : "Image storage is temporarily unavailable." },
      { status: upstream.timedOut ? 504 : 502, headers: { ...RESPONSE_HEADERS, "Retry-After": "5" } }
    );
  }

  const result = await readBoundedJsonResponse(upstream.response, 32_768) as { data?: unknown } | null;
  if (!upstream.response.ok || typeof result?.data !== "string" || !result.data.startsWith("https://")) {
    return NextResponse.json({ error: "Could not prepare the creator image upload." }, { status: 502, headers: RESPONSE_HEADERS });
  }
  return NextResponse.json({ url: result.data, maxBytes: MAX_IMAGE_BYTES, types: IMAGE_TYPES }, { headers: RESPONSE_HEADERS });
}
