import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { RMT_ADMIN_EMAIL } from "../../../../lib/creator-application";
import {
  EXPERIENCE_SCHEMA_VERSION,
  experienceDayId,
  normalizeExperienceDevice,
  normalizeExperienceStage
} from "../../../../lib/experience-funnel";
import { communityBearerToken } from "../../../../lib/server/community-identity";
import { getRmtAdminAuth, getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../lib/server/media-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };
const REPORTING_DAYS = 14;

async function verifiedAdmin(request: Request) {
  const token = communityBearerToken(request);
  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  if (!token || !auth || !db) return null;
  const identity = await auth.verifyIdToken(token, true);
  if (identity.email_verified !== true || identity.email?.toLowerCase() !== RMT_ADMIN_EMAIL) return null;
  return db;
}

function recentDayIds(now = new Date()) {
  return Array.from({ length: REPORTING_DAYS }, (_, offset) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - offset);
    return experienceDayId(date);
  }).reverse();
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "experience-funnel", limit: 40, windowMs: 60_000 });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 512);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};

  if (input.operation === "list") {
    try {
      const db = await verifiedAdmin(request);
      if (!db) return NextResponse.json({ error: "RMT administrator access required." }, { status: 403, headers: HEADERS });
      const days = await db.getAll(...recentDayIds().map((day) => db.collection("experienceFunnel").doc(day)));
      return NextResponse.json({
        reportingDays: REPORTING_DAYS,
        days: days.flatMap((snapshot) => snapshot.exists ? [{
          day: snapshot.id,
          counts: snapshot.data()?.counts ?? {}
        }] : [])
      }, { headers: HEADERS });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code.startsWith("auth/")) return NextResponse.json({ error: "Administrator sign-in expired." }, { status: 401, headers: HEADERS });
      return NextResponse.json({ error: "Experience milestones are temporarily unavailable." }, { status: 503, headers: HEADERS });
    }
  }

  const stage = normalizeExperienceStage(input.stage);
  const device = normalizeExperienceDevice(input.device);
  if (
    input.schemaVersion !== EXPERIENCE_SCHEMA_VERSION
    || !stage
    || !device
    || Object.keys(input).some((key) => !["device", "schemaVersion", "stage"].includes(key))
  ) {
    return NextResponse.json({ error: "The anonymous milestone is invalid." }, { status: 400, headers: HEADERS });
  }

  const db = getRmtAdminFirestore();
  if (!db) return NextResponse.json({ accepted: false }, { status: 503, headers: HEADERS });
  try {
    const day = experienceDayId();
    await db.collection("experienceFunnel").doc(day).set({
      schemaVersion: EXPERIENCE_SCHEMA_VERSION,
      day,
      counts: {
        all: { [stage]: FieldValue.increment(1) },
        [device]: { [stage]: FieldValue.increment(1) }
      },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return NextResponse.json({ accepted: true }, { status: 202, headers: HEADERS });
  } catch {
    return NextResponse.json({ accepted: false }, { status: 503, headers: HEADERS });
  }
}
