import { createHmac, timingSafeEqual } from "node:crypto";

export type SmsProviderOptOutType = "STOP" | "START" | "HELP";

export function expectedTwilioSignature(
  authToken: string,
  webhookUrl: string,
  parameters: URLSearchParams
) {
  const fields = [...parameters.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const payload = fields.reduce((value, [name, field]) => value + name + field, webhookUrl);
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

export function validTwilioSignature(
  authToken: string,
  webhookUrl: string,
  parameters: URLSearchParams,
  suppliedSignature: string
) {
  if (!/^[A-Za-z0-9+/]{20,64}={0,2}$/.test(suppliedSignature)) return false;
  const expected = Buffer.from(expectedTwilioSignature(authToken, webhookUrl, parameters));
  const supplied = Buffer.from(suppliedSignature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function smsProviderOptOutType(parameters: URLSearchParams): SmsProviderOptOutType | null {
  const value = parameters.get("OptOutType")?.trim().toUpperCase();
  return value === "STOP" || value === "START" || value === "HELP" ? value : null;
}

export function validSmsProviderIdentity(
  parameters: URLSearchParams,
  expected: { accountSid: string; messagingServiceSid: string }
) {
  return parameters.get("AccountSid") === expected.accountSid
    && parameters.get("MessagingServiceSid") === expected.messagingServiceSid
    && /^SM[a-fA-F0-9]{32}$/.test(parameters.get("MessageSid") ?? "")
    && /^\+[1-9][0-9]{7,14}$/.test(parameters.get("From") ?? "");
}
