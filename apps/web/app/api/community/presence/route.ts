import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  COMMUNITY_PRESENCE_TTL_MS,
  COMMUNITY_SCHEMA_VERSION,
  normalizeCommunityRoomId
} from "../../../../lib/community";
import {
  communityAuthorKey,
  communityBearerToken,
  communityIdentitySecret
} from "../../../../lib/server/community-identity";
import { getRmtAdminAuth, getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../lib/server/media-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };
const COUNT_CAP = 1_000;

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "community-presence", limit: 20, windowMs: 10 * 60_000 });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, {
      status: guard.status,
      headers: { ...HEADERS, ...(guard.retryAfterSeconds ? { "Retry-After": String(guard.retryAfterSeconds) } : {}) }
    });
  }

  const token = communityBearerToken(request);
  if (!token) return NextResponse.json({ error: "Community identity required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 256);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const roomId = normalizeCommunityRoomId(input.roomId);
  if (!roomId) return NextResponse.json({ error: "Community room is invalid." }, { status: 400, headers: HEADERS });

  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  const secret = communityIdentitySecret();
  if (!auth || !db || !secret) {
    return NextResponse.json(
      { error: "Community presence is awaiting secure production configuration." },
      { status: 503, headers: { ...HEADERS, "Retry-After": "60" } }
    );
  }

  try {
    const identity = await auth.verifyIdToken(token, true);
    const guest = identity.firebase?.sign_in_provider === "anonymous";
    if (!guest && identity.email_verified !== true) {
      return NextResponse.json({ error: "Verified member or guest identity required." }, { status: 403, headers: HEADERS });
    }

    const now = Date.now();
    const key = communityAuthorKey(secret, identity.uid);
    const presence = db.collection("communityPresence").doc(key);
    await presence.set({
      schemaVersion: COMMUNITY_SCHEMA_VERSION,
      authorKey: key,
      identityKind: guest ? "guest" : "member",
      roomId,
      lastSeenAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(now + COMMUNITY_PRESENCE_TTL_MS)
    }, { merge: true });

    const activeQuery = db.collection("communityPresence")
      .where("roomId", "==", roomId)
      .where("expiresAt", ">", Timestamp.fromMillis(now));
    const aggregate = await activeQuery.count().get();
    const observed = aggregate.data().count;
    return NextResponse.json({
      online: Math.min(observed, COUNT_CAP),
      approximate: true,
      capped: observed > COUNT_CAP,
      observedAt: new Date(now).toISOString()
    }, { headers: HEADERS });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) {
      return NextResponse.json({ error: "Community identity expired." }, { status: 401, headers: HEADERS });
    }
    return NextResponse.json({ error: "Community presence is temporarily unavailable." }, { status: 503, headers: HEADERS });
  }
}
