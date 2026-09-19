import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Exercise the actual hook with deterministic browser transports and time.
// This is mocked integration coverage, never provider or execution evidence.
const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
const states: unknown[] = [];
let effect: () => void | (() => void);
Module._load = function (id: string, ...args: unknown[]) {
  if (id === "react") return {
    useState(initial: unknown) {
      const index = states.length;
      states.push(initial);
      return [initial, (value: unknown) => { states[index] = value; }];
    },
    useEffect(fn: typeof effect) { effect = fn; }
  };
  return originalLoad.call(this, id, ...args);
};
let useExternalMarketStream: typeof import("./use-external-market-stream").useExternalMarketStream;
try {
  ({ useExternalMarketStream } = require("./use-external-market-stream"));
} finally {
  Module._load = originalLoad;
}

const token = "0x232CDFc415D10b673845D83Dc02ba2eaBe7e30d1";
const pair = "0x39A200271525E9641e799127bdAB299DAeF21953";
const market = { address: token, pairAddress: pair, verifiedMarkets: [{
  chainId: 4663, assetId: `eip155:4663/contract:${token}`, token: { address: token }, pool: { kind: "evm-address", value: pair },
  chartEligibility: "eligible", displayEligibility: "eligible"
}] } as unknown as NonNullable<Parameters<typeof useExternalMarketStream>[0]>;
const snapshot = { token, pair, source: "GeckoTerminal", updatedAt: "2026-09-19T00:00:00Z", trades: [] };
let now = 0;
let serial = 0;
const timers = new Map<number, { at: number; interval: number; run: () => void }>();
function timer(run: () => void, delay: number, interval = 0) {
  const id = ++serial;
  timers.set(id, { at: now + delay, interval, run });
  return id;
}
async function tick(milliseconds: number) {
  const end = now + milliseconds;
  for (;;) {
    const next = [...timers].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    const [id, job] = next;
    now = job.at;
    if (job.interval) job.at += job.interval;
    else timers.delete(id);
    job.run();
    await flush();
  }
  now = end;
  await flush();
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
const browser = Object.assign(new EventTarget(), {
  setTimeout: (run: () => void, delay: number) => timer(run, delay),
  clearTimeout: (id: number) => timers.delete(id),
  setInterval: (run: () => void, delay: number) => timer(run, delay, delay),
  clearInterval: (id: number) => timers.delete(id)
});
const network = { onLine: true };
class Stream extends EventTarget {
  static all: Stream[] = [];
  closed = false;
  onopen?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) { super(); Stream.all.push(this); }
  close() { this.closed = true; }
  send(name: string, value = snapshot) { this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(value) })); }
}
const requests: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
const originals = Object.fromEntries(["window", "document", "navigator", "EventSource", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalNow = Date.now;
Object.defineProperties(globalThis, {
  window: { configurable: true, value: browser }, document: { configurable: true, value: page },
  navigator: { configurable: true, value: network }, EventSource: { configurable: true, value: Stream },
  fetch: { configurable: true, value: (_url: string, init: RequestInit) => new Promise<Response>(resolve => {
    requests.push({ signal: init.signal as AbortSignal, resolve });
  }) }
});
Date.now = () => now;
function visibility(state: string) { page.visibilityState = state; page.dispatchEvent(new Event("visibilitychange")); }
function online(value: boolean) { network.onLine = value; browser.dispatchEvent(new Event(value ? "online" : "offline")); }
function mount(input = market) {
  states.length = 0;
  useExternalMarketStream(input);
  const cleanup = effect!();
  return () => { if (typeof cleanup === "function") cleanup(); };
}
function latest() { return Stream.all.at(-1)!; }

async function main() {
  // A hidden mount must not start a stream, fallback, or watchdog.
  page.visibilityState = "hidden";
  let unmount = mount();
  await tick(60_000);
  assert.equal(Stream.all.length, 0, "hidden mount must not open a stream");
  assert.equal(requests.length, 0);
  assert.equal(timers.size, 0);
  visibility("visible");
  assert.equal(Stream.all.length, 1);
  const first = latest();
  first.onopen?.(); first.send("snapshot");
  assert.equal(states[1], "live");
  const retained = states[0];
  visibility("hidden");
  assert.equal(first.closed, true);
  assert.notEqual(states[1], "live");
  first.send("upstream-delay"); first.send("rotate"); first.onerror?.();
  await tick(60_000);
  assert.equal(Stream.all.length, 1);
  assert.equal(requests.length, 0);
  assert.equal(timers.size, 0);
  assert.equal(states[0], retained, "retain last snapshot while paused");
  visibility("visible"); visibility("visible"); online(true);
  assert.equal(Stream.all.length, 2, "resume opens one stream, no replay or duplicate events");

  // Rotation/reconnection timers cannot resurrect a paused stream.
  latest().send("rotate");
  visibility("hidden"); await tick(60_000);
  assert.equal(Stream.all.length, 2);
  visibility("visible");
  latest().onerror?.();
  assert.equal(requests.length, 1);
  const pending = requests[0];
  visibility("hidden");
  assert.equal(pending.signal.aborted, true);
  pending.resolve(Response.json({ ...snapshot, trades: [], updatedAt: "2026-09-19T00:01:00Z" }));
  await tick(60_000);
  assert.equal(requests.length, 1);
  assert.equal(Stream.all.length, 3);
  assert.equal(states[0], retained, "late fallback cannot publish after suspension");

  // Offline is a pause, not a reason to poll a failed network.
  online(false); visibility("visible"); await tick(60_000);
  assert.equal(requests.length, 1); assert.equal(Stream.all.length, 3);
  online(true); assert.equal(Stream.all.length, 4);
  latest().send("upstream-delay");
  assert.equal(requests.length, 2);
  const slow = requests[1];
  await tick(18_000);
  assert.equal(requests.length, 2, "slow fallback must not be aborted/restarted every six seconds");
  assert.equal(slow.signal.aborted, false);
  slow.resolve(Response.json(snapshot)); await flush();
  await tick(6_000);
  assert.equal(requests.length, 3, "visible fallback continues after completion");
  latest().send("heartbeat");
  assert.equal(requests[2].signal.aborted, true, "healthy stream cancels fallback");
  unmount(); assert.equal(timers.size, 0);
  const streamsBefore = Stream.all.length;
  visibility("hidden"); visibility("visible"); online(true); await tick(60_000);
  assert.equal(Stream.all.length, streamsBefore, "unmount removes listeners");

  // Visible healthy stream retains six-second snapshots and normal rotation.
  unmount = mount(); const healthy = latest(); healthy.onopen?.();
  for (let i = 0; i < 10; i++) { healthy.send("snapshot"); await tick(6_000); }
  assert.equal(latest(), healthy);
  healthy.send("rotate"); await tick(50);
  assert.notEqual(latest(), healthy);
  assert.equal(requests.length, 3, "healthy stream needs no fallback");
  unmount();
  page.visibilityState = "hidden"; unmount = mount(); unmount();
  visibility("visible"); await tick(60_000);
  assert.equal(timers.size, 0);
  console.log(JSON.stringify({ evidence: "MOCKED_INTEGRATION", actualHook: true,
    hiddenRequestsPerMinute: 0, offlineRequestsPerMinute: 0, resumeStreams: 1,
    slowFallbackMaximumConcurrent: 1, retainedSnapshot: true, visibleCadencePreserved: true }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Date.now = originalNow;
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
