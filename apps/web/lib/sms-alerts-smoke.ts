import assert from "node:assert/strict";
import {
  formatSmsAlertMessage,
  normalizeSmsDailyLimit,
  SMS_ALERT_MAX_PER_DAY,
  smsAlertMetricShortLabel
} from "./sms-alerts";
import {
  constantTimePhoneKeyMatches,
  decryptSmsPhone,
  encryptSmsPhone,
  sendTwilioSms,
  smsDeliveryConfiguration,
  smsDeliveryStatus,
  smsPhoneKey,
  smsProviderWebhookConfiguration,
  smsPreferenceDocumentId
} from "./server/sms-alert-delivery";
import {
  evaluateSmsAlertTransition,
  smsAlertDayKey,
  smsAlertObservedLabel,
  smsAlertStateKey
} from "./server/sms-alert-evaluator";
import {
  fetchSmsAlertMarkets,
  smsAlertMarketSnapshot
} from "./server/sms-alert-market-source";
import {
  expectedTwilioSignature,
  smsProviderOptOutType,
  validSmsProviderIdentity,
  validTwilioSignature
} from "./server/sms-provider-webhook";
import { readBoundedFormRequest } from "./server/media-request-guard";
import { verifiedPrivyPhone } from "./server/privy-identity";

const env = {
  RMT_SMS_ALERTS_ENABLED: "true",
  RMT_SMS_COMPLIANCE_CONFIRMED: "true",
  RMT_SMS_DAILY_BUDGET_CENTS: "100",
  RMT_SMS_MAX_MESSAGES_PER_DAY: "25",
  RMT_SMS_PHONE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  RMT_SMS_PHONE_HASH_SECRET: "phone-hash-secret-with-more-than-32-characters",
  RMT_SMS_PROVIDER: "twilio",
  RMT_PUBLIC_ORIGIN: "https://www.rmtlaunch.fun",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "b".repeat(32),
  TWILIO_MESSAGING_SERVICE_SID: `MG${"c".repeat(32)}`
};
const configuration = smsDeliveryConfiguration(env, { requireImplementation: false });
assert.ok(configuration);
assert.equal(configuration.globalDailyMessageLimit, 25);
assert.equal(smsProviderWebhookConfiguration(env)?.webhookUrl, "https://www.rmtlaunch.fun/api/alerts/sms-provider");
assert.equal(smsDeliveryConfiguration({ RMT_SMS_ALERTS_ENABLED: "false" }), null);
assert.deepEqual(smsDeliveryStatus(env), { available: false, reason: "delivery_locked" });
assert.equal(normalizeSmsDailyLimit(0), 1);
assert.equal(normalizeSmsDailyLimit(10), SMS_ALERT_MAX_PER_DAY);
assert.equal(normalizeSmsDailyLimit("5"), SMS_ALERT_MAX_PER_DAY);
assert.equal(smsAlertMetricShortLabel("netSellLiquidityBps"), "net sell flow");

const phone = "+13035551234";
const sealed = encryptSmsPhone(configuration, phone);
assert.notEqual(sealed.includes(phone), true);
assert.equal(decryptSmsPhone(configuration, sealed), phone);
const phoneKey = smsPhoneKey(configuration, phone);
assert.equal(constantTimePhoneKeyMatches(phoneKey, phoneKey), true);
assert.equal(constantTimePhoneKeyMatches(phoneKey, `${"0".repeat(64)}`), false);
assert.match(smsPreferenceDocumentId("did:privy:test-user"), /^[a-f0-9]{64}$/);
assert.match(smsAlertStateKey("test-rule"), /^[a-f0-9]{64}$/);
assert.equal(smsAlertDayKey(Date.parse("2026-08-02T12:00:00Z")), "2026-08-02");
assert.equal(smsAlertObservedLabel("largeSellLiquidityBps", 1250), "12.50%");

const testAlert = {
  id: "rule-1",
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  metric: "priceUsd" as const,
  direction: "above" as const,
  threshold: 1,
  enabled: true,
  createdAt: 1
};
const armed = evaluateSmsAlertTransition(testAlert, { priceUsd: 2 }, null, 100);
assert.equal(armed.transition, "armed");
assert.equal(armed.shouldSend, false);
const cleared = evaluateSmsAlertTransition(testAlert, { priceUsd: 0.5 }, armed.next, 200);
assert.equal(cleared.transition, "cleared");
const triggered = evaluateSmsAlertTransition(testAlert, { priceUsd: 1.5 }, cleared.next, 300);
assert.equal(triggered.transition, "triggered");
assert.equal(triggered.shouldSend, true);
assert.equal(evaluateSmsAlertTransition(testAlert, { priceUsd: 2 }, triggered.next, 400).shouldSend, false);

const marketSnapshot = smsAlertMarketSnapshot({
  address: testAlert.address,
  pairAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  symbol: "TEST",
  signal: "moving",
  priceUsd: 2,
  liquidityUsd: 75_000,
  volume5m: 1_000,
  volume1h: 6_000,
  volume24h: 50_000,
  buys5m: 5,
  sells5m: 2,
  buys1h: 10,
  sells1h: 4
}, {
  pairAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  liquidityUsd: 100_000
});
assert.equal(marketSnapshot.liquidityDropBps, 2_500);
assert.equal(marketSnapshot.runnerPace, 2);

const officialParameters = new URLSearchParams({
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675310",
  Digits: "1234",
  From: "+14158675310",
  To: "+18005551212"
});
const officialSignature = "L/OH5YylLD5NRKLltdqwSvS0BnU=";
assert.equal(
  expectedTwilioSignature("12345", "https://example.com/myapp.php?foo=1&bar=2", officialParameters),
  officialSignature
);
assert.equal(validTwilioSignature(
  "12345",
  "https://example.com/myapp.php?foo=1&bar=2",
  officialParameters,
  officialSignature
), true);
assert.equal(validTwilioSignature(
  "12345",
  "https://example.com/wrong",
  officialParameters,
  officialSignature
), false);

const stopParameters = new URLSearchParams({
  AccountSid: env.TWILIO_ACCOUNT_SID,
  MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
  MessageSid: `SM${"e".repeat(32)}`,
  From: phone,
  OptOutType: "STOP"
});
assert.equal(smsProviderOptOutType(stopParameters), "STOP");
assert.equal(validSmsProviderIdentity(stopParameters, configuration), true);

const message = formatSmsAlertMessage({
  address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  metric: "largeSellLiquidityBps",
  observed: "+12.50%",
  symbol: "$Runner🚀"
});
assert.ok(message.length <= 160);
assert.match(message, /^RMT RUNNER: large sell \+12.50%\./);
assert.match(message, /Reply STOP to opt out\.$/);

void (async () => {
  const parsedForm = await readBoundedFormRequest(new Request("https://www.rmtlaunch.fun/test", {
    body: "From=%2B13035551234&OptOutType=STOP",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST"
  }), 1_024);
  assert.equal(parsedForm.ok, true);
  if (parsedForm.ok) assert.equal(parsedForm.value.get("From"), phone);

  const directMarketAddress = "0xcccccccccccccccccccccccccccccccccccccccc";
  const directMarkets = await fetchSmsAlertMarkets(
    "https://www.rmtlaunch.fun",
    [directMarketAddress],
    async (input) => String(input).startsWith("https://www.rmtlaunch.fun/")
      ? new Response(JSON.stringify({ markets: [] }), { status: 200 })
      : new Response(JSON.stringify([{
          chainId: "robinhood",
          pairAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
          baseToken: { address: directMarketAddress, symbol: "DIRECT" },
          priceUsd: "0.25",
          liquidity: { usd: 25_000 },
          volume: { m5: 500, h1: 2_000, h24: 10_000 },
          priceChange: { m5: 1, h1: 2 },
          txns: { m5: { buys: 5, sells: 1 }, h1: { buys: 12, sells: 3 } },
          pairCreatedAt: Date.now() - 60_000
        }]), { status: 200 })
  );
  assert.equal(directMarkets.get(directMarketAddress)?.symbol, "DIRECT");

  let submittedBody = "";
  const sent = await sendTwilioSms(configuration, { body: message, to: phone }, async (_input, init) => {
    submittedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ sid: `SM${"d".repeat(32)}` }), {
      headers: { "Content-Type": "application/json" },
      status: 201
    });
  });
  assert.equal(sent.sid, `SM${"d".repeat(32)}`);
  assert.match(submittedBody, /MessagingServiceSid=MG/);
  assert.match(submittedBody, /To=%2B13035551234/);
  assert.doesNotMatch(submittedBody, /AccountSid/);

  const verifiedPhone = verifiedPrivyPhone({
    linked_accounts: [{
      first_verified_at: 1,
      latest_verified_at: 1,
      phoneNumber: phone,
      type: "phone",
      verified_at: 1
    }]
  });
  assert.equal(verifiedPhone, phone);
  assert.equal(verifiedPrivyPhone({
    linked_accounts: [{
      first_verified_at: null,
      latest_verified_at: null,
      phoneNumber: phone,
      type: "phone",
      verified_at: 0
    }]
  }), "");

  console.log("SMS alert smoke checks passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
