import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRADE_AUTHORIZATION_MAX_ATTEMPTS,
  TRADE_AUTHORIZATION_TIMEOUT_MS,
  TradeAuthorizationRequestError,
  isCurrentTradeAuthorizationAttempt,
  requestTradeAuthorization,
  type TradeAuthorizationTransport
} from "./vnext/trade-authorization-client";

type Scheduled = { id: number; at: number; callback: () => void };

class FakeClock {
  nowMs = 0;
  nextId = 1;
  scheduled: Scheduled[] = [];

  readonly setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.nextId++;
    this.scheduled.push({ id, at: this.nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  readonly clearTimeout = (handle: ReturnType<typeof setTimeout>) => {
    const id = handle as unknown as number;
    this.scheduled = this.scheduled.filter((entry) => entry.id !== id);
  };

  advanceTo(targetMs: number) {
    assert.ok(targetMs >= this.nowMs);
    while (true) {
      const next = this.scheduled
        .filter((entry) => entry.at <= targetMs)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;
      this.scheduled = this.scheduled.filter((entry) => entry.id !== next.id);
      this.nowMs = next.at;
      next.callback();
    }
    this.nowMs = targetMs;
  }
}

function delayedTransport(delayMs: number, status = 200) {
  const clock = new FakeClock();
  let calls = 0;
  let observedInit: RequestInit | undefined;
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    observedInit = init;
    return new Promise<Response>((resolve, reject) => {
      const handle = clock.setTimeout(() => resolve(new Response(JSON.stringify(
        status === 200 ? { evidence: { ok: true }, plan: { id: "ready" } } : { error: "rejected" }
      ), { status, headers: { "Content-Type": "application/json" } })), delayMs);
      init?.signal?.addEventListener("abort", () => {
        clock.clearTimeout(handle);
        reject(new Error("aborted"));
      }, { once: true });
    });
  }) as typeof fetch;
  const transport: TradeAuthorizationTransport = {
    fetch: fetchImpl,
    now: () => clock.nowMs,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  };
  return { clock, transport, calls: () => calls, observedInit: () => observedInit };
}

async function acceptedAt(delayMs: number) {
  const test = delayedTransport(delayMs);
  const pending = requestTradeAuthorization("/api/vnext/authorize", { verificationId: "verify-1" }, {
    identityToken: "identity-token",
    transport: test.transport
  });
  test.clock.advanceTo(delayMs);
  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(response.attempts, 1);
  assert.equal(response.latencyMs, delayMs);
  assert.equal(test.calls(), 1);
  const init = test.observedInit();
  assert.equal(init?.method, "POST");
  assert.equal(init?.cache, "no-store");
  assert.equal(init?.credentials, "same-origin");
  assert.equal(new Headers(init?.headers).get("privy-id-token"), "identity-token");
}

async function main() {
  assert.equal(TRADE_AUTHORIZATION_TIMEOUT_MS, 30_000);
  assert.equal(TRADE_AUTHORIZATION_MAX_ATTEMPTS, 1);
  await acceptedAt(15_100);
  await acceptedAt(20_000);
  await acceptedAt(25_000);

  const beyondBudget = delayedTransport(30_001);
  const timedOut = requestTradeAuthorization("/api/vnext/authorize", { verificationId: "verify-timeout" }, {
    timeoutMs: 60_000,
    transport: beyondBudget.transport
  });
  beyondBudget.clock.advanceTo(30_000);
  await assert.rejects(timedOut, (error: unknown) => (
    error instanceof TradeAuthorizationRequestError
    && error.code === "timeout"
    && error.attempts === 1
    && /protected wallet authorization in time\. Verify the route again\./.test(error.message)
  ));
  assert.equal(beyondBudget.calls(), 1, "authorization timeout never triggers an automatic retry");

  const uncached = delayedTransport(1);
  const first = requestTradeAuthorization("/api/vnext/authorize", { verificationId: "same" }, { transport: uncached.transport });
  const second = requestTradeAuthorization("/api/vnext/authorize", { verificationId: "same" }, { transport: uncached.transport });
  uncached.clock.advanceTo(1);
  await Promise.all([first, second]);
  assert.equal(uncached.calls(), 2, "authorization requests never share the quote promise cache");

  assert.equal(isCurrentTradeAuthorizationAttempt(4, 4), true);
  assert.equal(isCurrentTradeAuthorizationAttempt(3, 4), false,
    "a late response from an older authorization attempt cannot install over a newer attempt");

  const composer = readFileSync(new URL("../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
  const quoteRequest = composer.slice(composer.indexOf("const requestLiveRoutes"), composer.indexOf("useEffect", composer.indexOf("const requestLiveRoutes")));
  const verifyRequest = composer.slice(composer.indexOf("const requestStrictVerification"), composer.indexOf("const requestAuthorizationPlan"));
  const authorizationRequest = composer.slice(composer.indexOf("const requestAuthorizationPlan"), composer.indexOf("const startTrade"));
  const backgroundRefresh = composer.slice(composer.indexOf("const canRefresh"), composer.indexOf("const requestStrictVerification"));
  assert.match(quoteRequest, /timeoutMs: 12_000/);
  assert.match(verifyRequest, /timeoutMs: 15_000/);
  assert.match(authorizationRequest, /requestTradeAuthorization\("\/api\/vnext\/authorize"/);
  assert.doesNotMatch(authorizationRequest, /requestTradeQuote|identityScope|maxAttempts|timeoutMs/);
  assert.match(composer, /authorizationAttemptEpoch/);
  assert.match(composer, /isCurrentTradeAuthorizationAttempt\(authorizationAttempt, authorizationAttemptEpoch\.current\)/);
  assert.match(composer, /setAuthorizationState\(\{ state: "ready", plan: authorization\.plan \}\)/);
  assert.match(backgroundRefresh, /authorizationState\.state === "idle"/,
    "background quote refresh stays suspended while authorization or wallet review is active");

  console.log("Dedicated one-shot authorization transport and stale-response handoff guards passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
