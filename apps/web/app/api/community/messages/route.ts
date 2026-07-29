import { createHmac } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  COMMUNITY_SCHEMA_VERSION,
  normalizeCommunityBody,
  normalizeCommunityRoomId,
  validateCommunityBody
} from "../../../../lib/community";
import { RMT_ADMIN_EMAIL } from "../../../../lib/creator-application";
import { getRmtAdminAuth, getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../lib/server/media-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };
const GUEST_WINDOW_LIMIT = 60;
const MEMBER_WINDOW_LIMIT = 200;
const WINDOW_MS = 60 * 60 * 1_000;
const COOLDOWN_MS = 5_000;

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{100,4096})$/)?.[1] ?? "";
}

function communitySecret() {
  const value = (process.env.COMMUNITY_IDENTITY_SECRET ?? "").trim();
  return value.length >= 32 ? value : "";
}

function authorKey(secret: string, uid: string) {
  return createHmac("sha256", secret).update(uid).digest("hex").slice(0, 32);
}

function cleanProfile(value: unknown) {
  if (!value || typeof value !== "object") return { displayName: "RMT Member", handle: "" };
  const candidate = value as { displayName?: unknown; handle?: unknown };
  const displayName = typeof candidate.displayName === "string"
    ? candidate.displayName.trim().slice(0, 40)
    : "";
  const handle = typeof candidate.handle === "string" && /^[a-zA-Z0-9_]{0,24}$/.test(candidate.handle)
    ? candidate.handle
    : "";
  return { displayName: displayName || "RMT Member", handle };
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "community-message", limit: 20, windowMs: 60_000 });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, {
      status: guard.status,
      headers: { ...HEADERS, ...(guard.retryAfterSeconds ? { "Retry-After": String(guard.retryAfterSeconds) } : {}) }
    });
  }
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Community identity required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 2_048);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const roomId = normalizeCommunityRoomId(input.roomId);
  const messageBody = normalizeCommunityBody(input.body);
  const replyTo = typeof input.replyTo === "string" && /^[A-Za-z0-9]{20}$/.test(input.replyTo)
    ? input.replyTo
    : "";
  if (!roomId) return NextResponse.json({ error: "Community room is invalid." }, { status: 400, headers: HEADERS });

  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  const secret = communitySecret();
  if (!auth || !db || !secret) {
    return NextResponse.json(
      { error: "RMT Live is awaiting secure production configuration." },
      { status: 503, headers: { ...HEADERS, "Retry-After": "60" } }
    );
  }

  try {
    const identity = await auth.verifyIdToken(token, true);
    const guest = identity.firebase?.sign_in_provider === "anonymous";
    if (!guest && identity.email_verified !== true) {
      return NextResponse.json({ error: "Verified member or guest identity required." }, { status: 403, headers: HEADERS });
    }
    const validationError = validateCommunityBody(messageBody, guest);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400, headers: HEADERS });

    const key = authorKey(secret, identity.uid);
    const actorReference = db.collection("communityActors").doc(key);
    const roomReference = db.collection("communityRooms").doc(roomId);
    const messageReference = roomReference.collection("messages").doc();
    const profileReference = db.collection("users").doc(identity.uid);
    const assignmentReference = roomId.startsWith("project--")
      ? db.collection("projectAssignments").doc(roomId.slice("project--".length))
      : null;
    const replyReference = replyTo ? roomReference.collection("messages").doc(replyTo) : null;

    const [profileSnapshot, assignmentSnapshot, replySnapshot] = await Promise.all([
      guest ? Promise.resolve(null) : profileReference.get(),
      assignmentReference ? assignmentReference.get() : Promise.resolve(null),
      replyReference ? replyReference.get() : Promise.resolve(null)
    ]);
    if (replyReference && (!replySnapshot?.exists || replySnapshot.data()?.status !== "visible")) {
      return NextResponse.json({ error: "The referenced message is unavailable." }, { status: 409, headers: HEADERS });
    }
    const profile = cleanProfile(profileSnapshot?.data()?.profile);
    const isRmt = identity.email?.toLowerCase() === RMT_ADMIN_EMAIL;
    const isCreator = Boolean(assignmentSnapshot?.exists && assignmentSnapshot.data()?.ownerId === identity.uid);
    const authorKind = isRmt ? "rmt" : isCreator ? "creator" : guest ? "guest" : "member";
    const authorLabel = guest ? `Guest-${key.slice(-4).toUpperCase()}` : profile.displayName;
    const now = Date.now();

    await db.runTransaction(async (transaction) => {
      const actorSnapshot = await transaction.get(actorReference);
      const actor = actorSnapshot.data() as {
        bannedUntil?: Timestamp;
        lastMessageAt?: Timestamp;
        windowStartedAt?: Timestamp;
        windowCount?: number;
      } | undefined;
      if (actor?.bannedUntil && actor.bannedUntil.toMillis() > now) throw new Error("banned");
      if (actor?.lastMessageAt && now - actor.lastMessageAt.toMillis() < COOLDOWN_MS) throw new Error("cooldown");
      const sameWindow = Boolean(actor?.windowStartedAt && now - actor.windowStartedAt.toMillis() < WINDOW_MS);
      const windowCount = sameWindow ? actor?.windowCount ?? 0 : 0;
      if (windowCount >= (guest ? GUEST_WINDOW_LIMIT : MEMBER_WINDOW_LIMIT)) throw new Error("quota");

      transaction.set(actorReference, {
        schemaVersion: COMMUNITY_SCHEMA_VERSION,
        firebaseUid: identity.uid,
        authorKey: key,
        identityKind: guest ? "guest" : "member",
        lastMessageAt: FieldValue.serverTimestamp(),
        windowStartedAt: sameWindow ? actor!.windowStartedAt : FieldValue.serverTimestamp(),
        windowCount: windowCount + 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.create(messageReference, {
        schemaVersion: COMMUNITY_SCHEMA_VERSION,
        messageId: messageReference.id,
        roomId,
        authorKey: key,
        authorKind,
        authorLabel,
        authorHandle: guest ? "" : profile.handle,
        body: messageBody,
        replyTo,
        status: "visible",
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return NextResponse.json({ messageId: messageReference.id, roomId }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) return NextResponse.json({ error: "Community identity expired." }, { status: 401, headers: HEADERS });
    if (message === "banned") return NextResponse.json({ error: "This community identity is temporarily restricted." }, { status: 403, headers: HEADERS });
    if (message === "cooldown") return NextResponse.json({ error: "Please wait a few seconds before posting again." }, { status: 429, headers: { ...HEADERS, "Retry-After": "5" } });
    if (message === "quota") return NextResponse.json({ error: "Community posting limit reached. Try again later." }, { status: 429, headers: { ...HEADERS, "Retry-After": "3600" } });
    return NextResponse.json({ error: "Message could not be posted." }, { status: 503, headers: HEADERS });
  }
}
