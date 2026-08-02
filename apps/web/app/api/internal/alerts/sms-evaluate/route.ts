import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { FieldValue, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { formatSmsAlertMessage, normalizeSmsDailyLimit } from "../../../../../lib/sms-alerts";
import {
  normalizeWatchlistAlertListSnapshot,
  type WatchlistAlert
} from "../../../../../lib/watchlist-alerts";
import { getRmtAdminFirestore } from "../../../../../lib/server/firebase-admin";
import {
  decryptSmsPhone,
  sendTwilioSms,
  smsDeliveryConfiguration,
  smsProviderWebhookConfiguration
} from "../../../../../lib/server/sms-alert-delivery";
import {
  evaluateSmsAlertTransition,
  normalizeSmsAlertRuleState,
  smsAlertDayKey,
  smsAlertObservedLabel,
  smsAlertPriority,
  smsAlertStateKey,
  SMS_ALERT_EVALUATOR_SCHEMA_VERSION
} from "../../../../../lib/server/sms-alert-evaluator";
import {
  fetchSmsAlertMarkets,
  fetchSmsAlertSellPressure,
  smsAlertMarketSnapshot,
  type SmsAlertMarket,
  type SmsAlertPreviousMarket
} from "../../../../../lib/server/sms-alert-market-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_PREFERENCES_PER_RUN = 25;
const MAX_TRADE_TAPES_PER_RUN = 12;
const LEASE_DURATION_MS = 55_000;

type EvaluatorState = {
  dailyKey?: unknown;
  dailyMessages?: unknown;
  markets?: unknown;
  rules?: unknown;
};

function evaluatorAuthorized(request: Request) {
  const configured = process.env.RMT_SMS_EVALUATOR_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/)?.[1] ?? "";
  if (configured.length < 32 || configured.length > 512 || !supplied) return false;
  const left = Buffer.from(configured);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validOwnerUid(value: unknown) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && !value.includes("/")
    ? value
    : "";
}

function positiveCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function stateRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function previousMarket(value: unknown): SmsAlertPreviousMarket | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { liquidityUsd?: unknown; pairAddress?: unknown };
  return typeof candidate.pairAddress === "string"
    && /^0x[0-9a-f]{40}$/.test(candidate.pairAddress)
    && typeof candidate.liquidityUsd === "number"
    && Number.isFinite(candidate.liquidityUsd)
    && candidate.liquidityUsd >= 0
      ? { pairAddress: candidate.pairAddress, liquidityUsd: candidate.liquidityUsd }
      : undefined;
}

async function acquireLease(database: Firestore, now: number) {
  const reference = database.collection("smsAlertSystem").doc("evaluatorLease");
  const token = randomUUID();
  return database.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const leaseUntil = positiveCount(current.data()?.leaseUntil);
    if (leaseUntil > now) return "";
    transaction.set(reference, {
      leaseTokenHash: createHash("sha256").update(token).digest("hex"),
      leaseUntil: now + LEASE_DURATION_MS,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return token;
  });
}

async function releaseLease(database: Firestore, token: string) {
  const reference = database.collection("smsAlertSystem").doc("evaluatorLease");
  const expected = createHash("sha256").update(token).digest("hex");
  await database.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    if (current.data()?.leaseTokenHash === expected) {
      transaction.set(reference, {
        leaseTokenHash: FieldValue.delete(),
        leaseUntil: 0,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });
}

function wantsSellPressure(alerts: WatchlistAlert[]) {
  return alerts.some((alert) =>
    alert.metric === "largeSellLiquidityBps" || alert.metric === "netSellLiquidityBps"
  );
}

async function evaluatePreference(input: {
  configuration: NonNullable<ReturnType<typeof smsDeliveryConfiguration>>;
  alerts: WatchlistAlert[];
  database: Firestore;
  markets: Map<string, SmsAlertMarket>;
  now: number;
  preference: DocumentSnapshot;
  sellPressure: Map<string, Awaited<ReturnType<typeof fetchSmsAlertSellPressure>>>;
}) {
  const preferenceData = input.preference.data() as Record<string, unknown> | undefined;
  const ownerUid = validOwnerUid(preferenceData?.watchlistOwnerUid);
  if (!ownerUid || preferenceData?.enabled !== true) return "skipped" as const;
  const alerts = input.alerts;
  if (alerts.length === 0) return "skipped" as const;

  const stateReference = input.database.collection("smsAlertEvaluationStates").doc(input.preference.id);
  const dayKey = smsAlertDayKey(input.now);
  const budgetReference = input.database.collection("smsAlertBudgets").doc(dayKey);
  const reservation = await input.database.runTransaction(async (transaction) => {
    const [freshPreference, currentState, currentBudget] = await Promise.all([
      transaction.get(input.preference.ref),
      transaction.get(stateReference),
      transaction.get(budgetReference)
    ]);
    const freshData = freshPreference.data() as Record<string, unknown> | undefined;
    if (freshData?.enabled !== true || validOwnerUid(freshData.watchlistOwnerUid) !== ownerUid) return null;

    const state = (currentState.data() ?? {}) as EvaluatorState;
    const priorRules = stateRecord(state.rules);
    const priorMarkets = stateRecord(state.markets);
    const nextRules: Record<string, unknown> = {};
    const nextMarkets: Record<string, unknown> = {};
    const triggered: Array<{ alert: WatchlistAlert; observed: number }> = [];

    for (const alert of alerts) {
      const ruleKey = smsAlertStateKey(alert.id);
      const marketKey = smsAlertStateKey(alert.address);
      const market = input.markets.get(alert.address);
      const snapshot = market
        ? smsAlertMarketSnapshot(
            market,
            previousMarket(priorMarkets[marketKey]),
            input.sellPressure.get(alert.address) ?? undefined
          )
        : {};
      const transition = evaluateSmsAlertTransition(
        alert,
        snapshot,
        normalizeSmsAlertRuleState(priorRules[ruleKey]),
        input.now
      );
      nextRules[ruleKey] = transition.next;
      const observed = snapshot[alert.metric];
      if (transition.shouldSend && typeof observed === "number") triggered.push({ alert, observed });
      if (market) {
        nextMarkets[marketKey] = {
          address: market.address,
          liquidityUsd: market.liquidityUsd,
          pairAddress: market.pairAddress
        };
      }
    }

    const dailyMessages = state.dailyKey === dayKey ? positiveCount(state.dailyMessages) : 0;
    const globalMessages = positiveCount(currentBudget.data()?.attemptedMessages);
    const selected = triggered.sort((left, right) =>
      smsAlertPriority(left.alert) - smsAlertPriority(right.alert)
      || left.alert.createdAt - right.alert.createdAt
    )[0];
    const maxDailyMessages = normalizeSmsDailyLimit(freshData.maxDailyMessages);
    const mayReserve = selected
      && dailyMessages < maxDailyMessages
      && globalMessages < input.configuration.globalDailyMessageLimit;
    const attemptId = mayReserve ? randomUUID() : "";

    transaction.set(stateReference, {
      dailyKey: dayKey,
      dailyMessages: dailyMessages + (mayReserve ? 1 : 0),
      evaluatedAt: input.now,
      markets: nextMarkets,
      rules: nextRules,
      schemaVersion: SMS_ALERT_EVALUATOR_SCHEMA_VERSION,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: false });

    if (!mayReserve || !selected) return null;
    transaction.set(budgetReference, {
      attemptedMessages: globalMessages + 1,
      configuredBudgetCents: input.configuration.dailyBudgetCents,
      configuredMessageLimit: input.configuration.globalDailyMessageLimit,
      dayKey,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    const attemptReference = input.database.collection("smsAlertDeliveryAttempts").doc(attemptId);
    transaction.set(attemptReference, {
      alertKey: smsAlertStateKey(selected.alert.id),
      preferenceId: input.preference.id,
      reservedAt: FieldValue.serverTimestamp(),
      schemaVersion: SMS_ALERT_EVALUATOR_SCHEMA_VERSION,
      status: "reserved"
    });
    return {
      alert: selected.alert,
      attemptReference,
      encryptedPhone: String(freshData.encryptedPhone ?? ""),
      observed: selected.observed,
      symbol: input.markets.get(selected.alert.address)?.symbol ?? "TOKEN"
    };
  });

  if (!reservation) return "evaluated" as const;
  try {
    const phone = decryptSmsPhone(input.configuration, reservation.encryptedPhone);
    const body = formatSmsAlertMessage({
      address: reservation.alert.address,
      metric: reservation.alert.metric,
      observed: smsAlertObservedLabel(reservation.alert.metric, reservation.observed),
      symbol: reservation.symbol
    });
    const delivery = await sendTwilioSms(input.configuration, { body, to: phone });
    await reservation.attemptReference.set({
      acceptedAt: FieldValue.serverTimestamp(),
      providerMessageSid: delivery.sid,
      status: "accepted",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "accepted" as const;
  } catch {
    await reservation.attemptReference.set({
      failedAt: FieldValue.serverTimestamp(),
      status: "failed_no_automatic_retry",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "failed" as const;
  }
}

export async function POST(request: Request) {
  if (!evaluatorAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: HEADERS });
  }
  const configuration = smsDeliveryConfiguration();
  const webhook = smsProviderWebhookConfiguration();
  const database = getRmtAdminFirestore();
  if (!configuration || !webhook || !database) {
    return NextResponse.json({ error: "Phone alert evaluation is release-locked." }, {
      status: 503,
      headers: { ...HEADERS, "Retry-After": "3600" }
    });
  }

  const now = Date.now();
  const lease = await acquireLease(database, now);
  if (!lease) return NextResponse.json({ status: "already_running" }, { headers: HEADERS });

  try {
    const preferences = await database.collection("smsAlertPreferences")
      .where("enabled", "==", true)
      .limit(MAX_PREFERENCES_PER_RUN)
      .get();
    const alertLists = await Promise.all(preferences.docs.map(async (preference) => {
      const ownerUid = validOwnerUid(preference.data().watchlistOwnerUid);
      if (!ownerUid) return [] as WatchlistAlert[];
      const document = await database.doc(`users/${ownerUid}/settings/watchlistAlerts`).get();
      return normalizeWatchlistAlertListSnapshot(document.data())?.alerts.filter((alert) => alert.enabled) ?? [];
    }));
    const alertAddresses = [...new Set(alertLists.flat().map((alert) => alert.address))];
    const markets = await fetchSmsAlertMarkets(new URL(webhook.webhookUrl).origin, alertAddresses);
    const sellAddresses = [...new Set(alertLists.flatMap((alerts) =>
      wantsSellPressure(alerts)
        ? alerts.filter((alert) =>
            alert.metric === "largeSellLiquidityBps" || alert.metric === "netSellLiquidityBps"
          ).map((alert) => alert.address)
        : []
    ))].slice(0, MAX_TRADE_TAPES_PER_RUN);
    const sellPressure = new Map(await Promise.all(sellAddresses.map(async (address) => {
      const market = markets.get(address);
      return [address, market ? await fetchSmsAlertSellPressure(market, fetch, now) : null] as const;
    })));

    const results = [] as string[];
    for (const [preferenceIndex, preference] of preferences.docs.entries()) {
      results.push(await evaluatePreference({
        configuration,
        alerts: alertLists[preferenceIndex] ?? [],
        database,
        markets,
        now,
        preference,
        sellPressure
      }));
    }
    const counts = results.reduce<Record<string, number>>((summary, status) => ({
      ...summary,
      [status]: (summary[status] ?? 0) + 1
    }), {});
    return NextResponse.json({ processed: preferences.size, status: "complete", counts }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Phone alert evaluation failed safely." }, {
      status: 503,
      headers: { ...HEADERS, "Retry-After": "60" }
    });
  } finally {
    await releaseLease(database, lease).catch(() => undefined);
  }
}
