import assert from "node:assert/strict";
import { createRequire } from "node:module";
// Execute the actual hook effect with a deterministic browser clock. Browser
// acceptance additionally checks real React. No production writes or network.
const require = createRequire(import.meta.url), Module = require("node:module");
const originalLoad = Module._load, react = require("react");
const effects: (() => (() => void))[] = [];
Module._load = function (id: string, ...args: unknown[]) {
  return id === "react" ? { ...react, useRef: (current: unknown) => ({ current }), useEffect: (effect: () => (() => void)) => effects.push(effect) } : originalLoad.call(this, id, ...args);
};
const { useScannerRefresh } = require("../../app/vnext/use-scanner-refresh");
Module._load = originalLoad;
let now = 0, sequence = 0, online = true;
const timers = new Map<number, { at: number; fn: () => void }>();
const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
const win = Object.assign(new EventTarget(), {
  setTimeout(fn: () => void, ms: number) { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; },
  clearTimeout(id: number) { timers.delete(id); }
});
const descriptors = Object.fromEntries(["window", "document", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const realNow = Date.now;
Object.defineProperty(globalThis, "window", { configurable: true, value: win });
Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get onLine() { return online; } } });
Date.now = () => now;
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
async function advance(ms: number) {
  const until = now + ms;
  for (;;) {
    const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
  }
  now = until; await flush();
}
async function main() {
  let reads = 0, fail = false, release: (() => void) | undefined;
  useScannerRefresh(async () => { reads++; if (release) await new Promise<void>(resolve => { release = resolve; }); return !fail; }, 60_000);
  effects[0](); const cleanup = effects[1]();
  await advance(0); assert.equal(reads, 1);
  doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
  await advance(300_000); assert.equal(reads, 1, "hidden browser performs no reads");
  doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange"));
  win.dispatchEvent(new Event("focus")); win.dispatchEvent(new Event("online"));
  await advance(0); assert.equal(reads, 2, "resume events coalesce into one immediate read");
  win.dispatchEvent(new Event("focus")); win.dispatchEvent(new Event("focus"));
  await advance(9_999); assert.equal(reads, 2); await advance(1); assert.equal(reads, 3, "focus is rate bounded");
  online = false; win.dispatchEvent(new Event("offline")); await advance(300_000); assert.equal(reads, 3);
  online = true; win.dispatchEvent(new Event("online")); await advance(0); assert.equal(reads, 4);
  fail = true; await advance(60_000); assert.equal(reads, 5);
  await advance(119_999); assert.equal(reads, 5, "failed reads back off");
  await advance(1); assert.equal(reads, 6); fail = false;
  release = () => {}; await advance(240_000); assert.equal(reads, 7);
  win.dispatchEvent(new Event("focus")); await advance(300_000); assert.equal(reads, 7, "one in-flight read per lane");
  release!(); release = undefined; await flush(); await advance(0); assert.equal(reads, 8);
  cleanup(); await advance(300_000); assert.equal(reads, 8, "unmount stops work");
  console.log("Actual scanner refresh hook: cadence, hidden/offline, resume coalescing, backoff, in-flight and cleanup PASS");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Date.now = realNow;
  for (const key of Object.keys(descriptors)) { if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]!); else Reflect.deleteProperty(globalThis, key); }
});
