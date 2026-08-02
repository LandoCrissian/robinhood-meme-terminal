import { FieldValue } from "firebase-admin/firestore";
import { getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { readBoundedFormRequest } from "../../../../lib/server/media-request-guard";
import {
  smsPhoneKey,
  smsProviderWebhookConfiguration
} from "../../../../lib/server/sms-alert-delivery";
import {
  smsProviderOptOutType,
  validSmsProviderIdentity,
  validTwilioSignature
} from "../../../../lib/server/sms-provider-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function emptyTwiml() {
  return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", {
    headers: { ...NO_STORE, "Content-Type": "application/xml; charset=utf-8" }
  });
}

export async function POST(request: Request) {
  const body = await readBoundedFormRequest(request, 8_192);
  if (!body.ok) {
    return new Response("Invalid request.", { status: body.status, headers: NO_STORE });
  }

  try {
    const configuration = smsProviderWebhookConfiguration();
    const database = getRmtAdminFirestore();
    if (!configuration || !database) {
      return new Response("Unavailable.", { status: 503, headers: NO_STORE });
    }
    const signature = request.headers.get("x-twilio-signature")?.trim() ?? "";
    if (
      !validTwilioSignature(configuration.authToken, configuration.webhookUrl, body.value, signature)
      || !validSmsProviderIdentity(body.value, configuration)
    ) {
      return new Response("Invalid request.", { status: 403, headers: NO_STORE });
    }

    const optOutType = smsProviderOptOutType(body.value);
    if (optOutType !== "STOP") return emptyTwiml();

    const from = body.value.get("From") ?? "";
    const key = smsPhoneKey(configuration, from);
    const preferences = await database.collection("smsAlertPreferences")
      .where("phoneKey", "==", key)
      .limit(10)
      .get();
    if (!preferences.empty) {
      const batch = database.batch();
      for (const preference of preferences.docs) {
        batch.set(preference.ref, {
          enabled: false,
          encryptedPhone: FieldValue.delete(),
          phoneKey: FieldValue.delete(),
          providerOptOutAt: FieldValue.serverTimestamp(),
          revokedAt: FieldValue.serverTimestamp(),
          revocationReason: "provider_stop",
          updatedAt: FieldValue.serverTimestamp(),
          watchlistOwnerUid: FieldValue.delete()
        }, { merge: true });
      }
      await batch.commit();
    }
    return emptyTwiml();
  } catch {
    return new Response("Unavailable.", { status: 503, headers: NO_STORE });
  }
}
