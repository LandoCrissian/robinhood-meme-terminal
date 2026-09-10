import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
const react = require("react");
const states: any[] = [];
const effects: (() => void | (() => void))[] = [];
Module._load = function (id: string, ...args: unknown[]) {
  if (id === "react") return { ...react,
    useState(initial: unknown) { const i = states.length; states.push(typeof initial === "function" ? initial() : initial); return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => void) => effects.push(fn)
  };
  return originalLoad.call(this, id, ...args);
};
const { useVNextMarketDirectory } = require("../../app/vnext/use-vnext-market-directory");
Module._load = originalLoad;
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
function market(n: number) {
  return { address: address(n), name: `Token ${n}`, symbol: `T${n}`,
    verifiedIdentity: { address: address(n), name: `Token ${n}`, symbol: `T${n}`, decimals: 18 },
    ...Object.fromEntries(["priceUsd", "liquidityUsd", "marketCapUsd", "fdvUsd", "volume5m", "volume1h", "volume24h", "priceChange5m", "priceChange1h", "priceChange24h", "buys5m", "sells5m", "buys1h", "sells1h", "buys24h", "sells24h", "pairCreatedAt", "ageMinutes", "momentumScore", "buyPressureBps", "riskFlags", "signal"].map(key => [key, null])),
    canonicalMarkets: [{ sourceId: "uniswap-v3", protocol: "uniswap", version: 3,
      poolKey: address(n + 1000), poolAddress: address(n + 1000), token0: address(n), token1: address(999),
      stable: null, fee: 3000, tickSpacing: 60, hooks: null,
      transactionHash: `0x${"1".repeat(64)}`, blockNumber: "100", blockHash: `0x${"2".repeat(64)}`,
      ...Object.fromEntries(["stateStatus", "liveFee", "feeDenominator", "gaugeAddress", "gaugeAlive", "gaugeWeight", "gaugeClaimable", "feesAddress", "bribeAddress", "stateObservedBlock", "stateObservedBlockHash"].map(key => [key, null])) }]
  };
}
function payload(page: number, enriched = false) {
  return { canonical: true, inventorySource: "indexed", revalidationComplete: false, coverage: "partial", stale: true,
    updatedAt: new Date().toISOString(), nextCursor: page < 4 ? `p${page + 1}` : null,
    markets: Array.from({ length: enriched ? 15 : 10 }, (_, i) => market(page * 20 + i + 1)) };
}
type Job = { page: number; signal: AbortSignal; resolve: (response: Response) => void; done: boolean };
const jobs: Job[] = [];
let maximum = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = new URL(input, "https://fixture.invalid");
  const cursor = url.searchParams.get("cursor");
  const page = cursor ? Number(cursor.slice(1)) : 0;
  if (!url.searchParams.has("identityEnrichment")) return Response.json(payload(page));
  return new Promise<Response>(resolve => {
    jobs.push({ page, signal: init!.signal as AbortSignal, resolve, done: false });
    maximum = Math.max(maximum, jobs.filter(job => !job.done && !job.signal.aborted).length);
  });
}) as typeof fetch;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const finish = (job: Job, status = 200, extra = {}) => { job.done = true; job.resolve(Response.json({ ...payload(job.page, true), ...extra }, { status })); };
function directory() {
  const state = states.length, effect = effects.length;
  const hook = useVNextMarketDirectory();
  const cleanup = effects[effect]();
  return { hook, rows: () => states[state] as { address: string }[], selected: () => states[state + 4], unmount: () => { if (typeof cleanup === "function") cleanup(); } };
}
async function main() {
  const d = directory();
  await d.hook.refresh();
  for (let page = 1; page < 5; page++) assert.equal(await d.hook.loadNextCanonicalPage(), true);
  await flush();
  assert.equal(d.rows().length, 50); d.hook.setSelectedAddress(address(41));
  assert.equal(jobs.length, 4);
  finish(jobs[0]); await flush();
  assert.equal(jobs.length, 5, "fifth page must drain without another refresh");
  for (const job of jobs.slice(1)) finish(job);
  await flush();
  assert.equal(d.rows().length, 75); assert.equal(d.selected(), address(41));
  assert.equal(await d.hook.loadNextCanonicalPage(), false, "enrichment must not alter final cursor");
  const failureStart = jobs.length;
  await d.hook.refresh(); await flush();
  assert.equal(jobs.length, failureStart + 4);
  finish(jobs[failureStart], 503); await flush();
  assert.equal(jobs.length, failureStart + 5, "failure still drains pending work");
  const obsolete = jobs.filter(job => !job.done);
  const oldCount = jobs.length;
  await d.hook.refresh(); await flush();
  assert.ok(obsolete.every(job => job.signal.aborted));
  assert.equal(jobs.length, oldCount + 4);
  for (const job of obsolete) finish(job, 200, { markets: [market(777)] });
  await flush();
  assert.equal(jobs.length, oldCount + 4, "old completion cannot dispatch queued work");
  assert.equal(d.rows().some(row => row.address === address(777)), false);
  const current = jobs.slice(oldCount);
  finish(current[0], 200, { quarantinedAddresses: [address(2)] }); await flush();
  assert.equal(jobs.length, oldCount + 5);
  for (const job of jobs.slice(oldCount).filter(job => !job.done)) finish(job);
  await flush();
  assert.equal(d.rows().length, 74); assert.equal(d.selected(), address(41));
  assert.equal(d.rows().some(row => row.address === address(2)), false);
  assert.equal(new Set(d.rows().map(row => row.address)).size, 74);
  await d.hook.refresh(); await flush();
  const unmountCount = jobs.length;
  const outstanding = jobs.filter(job => !job.done);
  const beforeUnmount = JSON.stringify(d.rows());
  d.unmount();
  assert.ok(outstanding.every(job => job.signal.aborted));
  for (const job of outstanding) finish(job);
  await flush();
  assert.equal(jobs.length, unmountCount); assert.equal(JSON.stringify(d.rows()), beforeUnmount);
  assert.equal(maximum, 4);
  console.log(JSON.stringify({ actualHook: true, pages: 5, fifthDrained: true, maximum, selectedRetained: true, quarantineRetained: true, obsoleteRejected: true, unmount: true }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
