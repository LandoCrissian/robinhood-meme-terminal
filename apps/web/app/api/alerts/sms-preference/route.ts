import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  SMS_ALERT_CONSENT_VERSION,
  SMS_ALERT_MAX_PER_DAY,
  SMS_ALERT_SCHEMA_VERSION,
  normalizeSmsDailyLimit
} from "../../../../lib/sms-alerts";
import { getRmtAdminAuth, getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../lib/server/media-request-guard";
import {
  privyBearerToken,
  verifiedPrivyEmail,
  verifiedPrivyPhone,
  verifyPrivyIdentity
} from "../../../../lib/server/privy-identity";
import { findRmtFirebaseUser } from "../../../../lib/server/rmt-firebase-user";
import {
  encryptSmsPhone,
  smsDeliveryConfiguration,
  smsDeliveryStatus,
  smsPhoneKey,
  smsPreferenceDocumentId
} from "../../../../lib/server/sms-alert-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

function responseStatus(input: {
  available: boolean;
  enabled: boolean;
  maxDailyMessages: number;
  phone: string;
}) {
  return {
    available: input.available,
    enabled: input.enabled,
    maxDailyMessages: input.maxDailyMessages,
    phoneLast4: input.phone.slice(-4),
    phoneLinked: Boolean(input.phone),
    reason: input.enabled
      ? input.available ? "active" : "delivery_paused"
      : !input.phone
        ? "phone_required"
        : "delivery_locked"
  };
}

async function verifiedRequestIdentity(request: Request) {
  const token = privyBearerToken(request);
  if (!token) return null;
  const identity = await verifyPrivyIdentity(token);
  return identity.is_guest ? null : identity;
}

function storedPreference(data: Record<string, unknown> | undefined) {
  return {
    enabled: data?.enabled === true,
    maxDailyMessages: normalizeSmsDailyLimit(data?.maxDailyMessages)
  };
}

export async function GET(request: Request) {
  try {
    const identity = await verifiedRequestIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to manage phone alerts." }, { status: 401, headers: HEADERS });
    }
    const phone = verifiedPrivyPhone(identity);
    const database = getRmtAdminFirestore();
    if (!database) {
      return NextResponse.json({ error: "Private alert settings are temporarily unavailable." }, {
        status: 503,
        headers: { ...HEADERS, "Retry-After": "60" }
      });
    }
    const document = await database.collection("smsAlertPreferences")
      .doc(smsPreferenceDocumentId(identity.id))
      .get();
    const preference = storedPreference(document.data() as Record<string, unknown> | undefined);
    const delivery = smsDeliveryStatus();
    return NextResponse.json(responseStatus({
      available: delivery.available,
      enabled: preference.enabled,
      maxDailyMessages: preference.maxDailyMessages,
      phone
    }), { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "RMT could not verify phone-alert access." }, {
      status: 401,
      headers: HEADERS
    });
  }
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, {
    namespace: "sms-preference",
    limit: 10,
    windowMs: 60_000
  });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, {
      status: guard.status,
      headers: {
        ...HEADERS,
        ...(guard.retryAfterSeconds ? { "Retry-After": String(guard.retryAfterSeconds) } : {})
      }
    });
  }
  const body = await readBoundedJsonRequest(request, 2_048);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  }
  const input = body.value && typeof body.value === "object"
    ? body.value as { action?: unknown; consent?: unknown; consentVersion?: unknown; maxDailyMessages?: unknown }
    : {};
  if (input.action !== "enable" && input.action !== "disable") {
    return NextResponse.json({ error: "Choose whether to enable or disable phone alerts." }, {
      status: 400,
      headers: HEADERS
    });
  }

  try {
    const identity = await verifiedRequestIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to manage phone alerts." }, { status: 401, headers: HEADERS });
    }
    const phone = verifiedPrivyPhone(identity);
    const database = getRmtAdminFirestore();
    const auth = getRmtAdminAuth();
    if (!database || !auth) {
      return NextResponse.json({ error: "Private alert settings are temporarily unavailable." }, {
        status: 503,
        headers: { ...HEADERS, "Retry-After": "60" }
      });
    }
    const reference = database.collection("smsAlertPreferences").doc(smsPreferenceDocumentId(identity.id));
    if (input.action === "disable") {
      await reference.set({
        enabled: false,
        encryptedPhone: FieldValue.delete(),
        phoneKey: FieldValue.delete(),
        watchlistOwnerUid: FieldValue.delete(),
        revokedAt: FieldValue.serverTimestamp(),
        schemaVersion: SMS_ALERT_SCHEMA_VERSION,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return NextResponse.json(responseStatus({
        available: smsDeliveryStatus().available,
        enabled: false,
        maxDailyMessages: SMS_ALERT_MAX_PER_DAY,
        phone
      }), { headers: HEADERS });
    }

    const configuration = smsDeliveryConfiguration();
    if (!configuration || !smsDeliveryStatus().available) {
      return NextResponse.json({
        error: "Text delivery is not active yet. Your verified phone remains linked only to your RMT account."
      }, { status: 503, headers: { ...HEADERS, "Retry-After": "3600" } });
    }
    if (!phone) {
      return NextResponse.json({ error: "Verify a phone through Privy before enabling alerts." }, {
        status: 409,
        headers: HEADERS
      });
    }
    if (input.consent !== true || input.consentVersion !== SMS_ALERT_CONSENT_VERSION) {
      return NextResponse.json({ error: "Current phone-alert consent is required." }, {
        status: 400,
        headers: HEADERS
      });
    }
    const maxDailyMessages = normalizeSmsDailyLimit(input.maxDailyMessages);
    const owner = await findRmtFirebaseUser(auth, identity.id, verifiedPrivyEmail(identity));
    if (!owner || owner.disabled) {
      return NextResponse.json({ error: "Finish RMT profile sync before enabling phone alerts." }, {
        status: 409,
        headers: HEADERS
      });
    }
    await reference.set({
      consentAt: FieldValue.serverTimestamp(),
      consentVersion: SMS_ALERT_CONSENT_VERSION,
      enabled: true,
      encryptedPhone: encryptSmsPhone(configuration, phone),
      maxDailyMessages,
      phoneKey: smsPhoneKey(configuration, phone),
      provider: "twilio",
      revokedAt: FieldValue.delete(),
      schemaVersion: SMS_ALERT_SCHEMA_VERSION,
      watchlistOwnerUid: owner.uid,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return NextResponse.json(responseStatus({
      available: true,
      enabled: true,
      maxDailyMessages,
      phone
    }), { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "RMT could not update phone-alert settings." }, {
      status: 401,
      headers: HEADERS
    });
  }
}
