import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { fetchWithTimeout, readBoundedJsonResponse } from "./media-request-guard";

// This lock stays false until the durable background evaluator and provider
// opt-out webhook have both passed staging. Environment variables cannot bypass it.
export const SMS_BACKGROUND_DELIVERY_IMPLEMENTED = false;

export type SmsDeliveryConfiguration = Readonly<{
  accountSid: string;
  authToken: string;
  dailyBudgetCents: number;
  encryptionKey: Buffer;
  globalDailyMessageLimit: number;
  messagingServiceSid: string;
  phoneHashSecret: string;
}>;

export type SmsProviderWebhookConfiguration = Readonly<{
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
  phoneHashSecret: string;
  webhookUrl: string;
}>;

type SmsEnvironment = Readonly<Record<string, string | undefined>>;

function exactBoolean(name: string, env: SmsEnvironment) {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return false;
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function positiveInteger(name: string, env: SmsEnvironment, maximum: number) {
  const value = env[name]?.trim() ?? "";
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function encryptionKey(env: SmsEnvironment) {
  const value = env.RMT_SMS_PHONE_ENCRYPTION_KEY?.trim() ?? "";
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64");
  } catch {
    throw new Error("RMT_SMS_PHONE_ENCRYPTION_KEY must be base64");
  }
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error("RMT_SMS_PHONE_ENCRYPTION_KEY must encode exactly 32 bytes");
  }
  return decoded;
}

function providerCredentials(env: SmsEnvironment) {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? "";
  const phoneHashSecret = env.RMT_SMS_PHONE_HASH_SECRET?.trim() ?? "";
  if (!/^AC[a-fA-F0-9]{32}$/.test(accountSid)) throw new Error("TWILIO_ACCOUNT_SID is invalid");
  if (authToken.length < 24 || authToken.length > 128) throw new Error("TWILIO_AUTH_TOKEN is invalid");
  if (!/^MG[a-fA-F0-9]{32}$/.test(messagingServiceSid)) {
    throw new Error("TWILIO_MESSAGING_SERVICE_SID is invalid");
  }
  if (phoneHashSecret.length < 32 || phoneHashSecret.length > 512) {
    throw new Error("RMT_SMS_PHONE_HASH_SECRET must contain 32 to 512 characters");
  }
  return { accountSid, authToken, messagingServiceSid, phoneHashSecret };
}

export function smsProviderWebhookConfiguration(
  env: SmsEnvironment = process.env
): SmsProviderWebhookConfiguration | null {
  const value = env.RMT_PUBLIC_ORIGIN?.trim() ?? "";
  if (!value) return null;
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("RMT_PUBLIC_ORIGIN is invalid");
  }
  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
    || origin.port
    || origin.pathname !== "/"
    || origin.search
    || origin.hash
    || (origin.hostname !== "rmtlaunch.fun" && origin.hostname !== "www.rmtlaunch.fun")
  ) {
    throw new Error("RMT_PUBLIC_ORIGIN must be the canonical HTTPS RMT origin");
  }
  return Object.freeze({
    ...providerCredentials(env),
    webhookUrl: `${origin.origin}/api/alerts/sms-provider`
  });
}

export function smsDeliveryConfiguration(
  env: SmsEnvironment = process.env,
  options: { requireImplementation?: boolean } = {}
): SmsDeliveryConfiguration | null {
  if (!exactBoolean("RMT_SMS_ALERTS_ENABLED", env)) return null;
  if (options.requireImplementation !== false && !SMS_BACKGROUND_DELIVERY_IMPLEMENTED) return null;
  if (env.RMT_SMS_PROVIDER?.trim().toLowerCase() !== "twilio") {
    throw new Error("RMT_SMS_PROVIDER must be twilio");
  }
  if (!exactBoolean("RMT_SMS_COMPLIANCE_CONFIRMED", env)) {
    throw new Error("RMT_SMS_COMPLIANCE_CONFIRMED must be true");
  }
  const provider = providerCredentials(env);
  return Object.freeze({
    ...provider,
    dailyBudgetCents: positiveInteger("RMT_SMS_DAILY_BUDGET_CENTS", env, 100_000),
    encryptionKey: encryptionKey(env),
    globalDailyMessageLimit: positiveInteger("RMT_SMS_MAX_MESSAGES_PER_DAY", env, 10_000)
  });
}

export function smsDeliveryStatus(env: SmsEnvironment = process.env) {
  if (!SMS_BACKGROUND_DELIVERY_IMPLEMENTED) {
    return { available: false as const, reason: "delivery_locked" as const };
  }
  try {
    return smsDeliveryConfiguration(env)
      ? { available: true as const, reason: "active" as const }
      : { available: false as const, reason: "delivery_locked" as const };
  } catch {
    return { available: false as const, reason: "delivery_locked" as const };
  }
}

export function smsPreferenceDocumentId(privyUserId: string) {
  return createHash("sha256").update(`rmt-sms:${privyUserId}`).digest("hex");
}

export function smsPhoneKey(configuration: Pick<SmsDeliveryConfiguration, "phoneHashSecret">, phone: string) {
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new Error("invalid_phone_number");
  return createHmac("sha256", configuration.phoneHashSecret).update(phone).digest("hex");
}

export function encryptSmsPhone(configuration: Pick<SmsDeliveryConfiguration, "encryptionKey">, phone: string) {
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new Error("invalid_phone_number");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", configuration.encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSmsPhone(configuration: Pick<SmsDeliveryConfiguration, "encryptionKey">, sealed: string) {
  const [version, ivValue, tagValue, encryptedValue, extra] = sealed.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue || extra) {
    throw new Error("invalid_encrypted_phone");
  }
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const encrypted = Buffer.from(encryptedValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length < 8 || encrypted.length > 32) {
    throw new Error("invalid_encrypted_phone");
  }
  const decipher = createDecipheriv("aes-256-gcm", configuration.encryptionKey, iv);
  decipher.setAuthTag(tag);
  const phone = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new Error("invalid_phone_number");
  return phone;
}

export function constantTimePhoneKeyMatches(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function sendTwilioSms(
  configuration: SmsDeliveryConfiguration,
  input: { body: string; to: string },
  request: typeof fetch = fetch
) {
  if (!/^\+[1-9][0-9]{7,14}$/.test(input.to)) throw new Error("invalid_phone_number");
  if (!input.body || input.body.length > 160 || /[\r\n]/.test(input.body)) throw new Error("invalid_sms_body");
  const body = new URLSearchParams({
    Body: input.body,
    MessagingServiceSid: configuration.messagingServiceSid,
    To: input.to
  });
  const result = await fetchWithTimeout(
    `https://api.twilio.com/2010-04-01/Accounts/${configuration.accountSid}/Messages.json`,
    {
      body,
      headers: {
        Authorization: `Basic ${Buffer.from(`${configuration.accountSid}:${configuration.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      method: "POST"
    },
    8_000,
    request
  );
  if (!result.ok) throw new Error(result.timedOut ? "sms_provider_timeout" : "sms_provider_unavailable");
  const responseBody = await readBoundedJsonResponse(result.response, 16_384);
  if (!result.response.ok || !responseBody || typeof responseBody !== "object") {
    throw new Error("sms_provider_rejected");
  }
  const sid = "sid" in responseBody ? String(responseBody.sid) : "";
  if (!/^SM[a-fA-F0-9]{32}$/.test(sid)) throw new Error("sms_provider_response_invalid");
  return { sid };
}
