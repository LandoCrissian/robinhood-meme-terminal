import assert from "node:assert/strict";
import test from "node:test";
import { installProfileResponseObserver } from "./browser-response-observer.mjs";

test("browser observer clones the real response without resubmitting or replacing it", async () => {
  const previous = globalThis.window, requests = [], observations = [];
  let observed; const completed = new Promise(resolve => { observed = resolve; });
  const response = Response.json({ profile: { walletAddress: "synthetic", preferences: { theme: "light" } } });
  globalThis.window = { location: { href: "http://127.0.0.1:3242/account/profile" }, fetch: async (...args) => { requests.push(args); return response; },
    retain: value => { observations.push(value); observed(); } };
  try {
    installProfileResponseObserver({ origin: "http://127.0.0.1:3242", binding: "retain" });
    const options = { method: "PATCH", body: "actual test request" }, returned = await window.fetch("/api/account/profile", options);
    assert.equal(returned, response); assert.equal(requests.length, 1); assert.equal(requests[0][1], options);
    const appBody = await returned.json(); await completed;
    assert.deepEqual(observations, [{ method: "PATCH", url: "http://127.0.0.1:3242/api/account/profile", status: 200, bodyCaptured: true, body: appBody }]);
  } finally { globalThis.window = previous; }
});

test("observer reports invalid or oversized real bodies without inventing a successful body", async () => {
  const previous = globalThis.window;
  try {
    for (const content of ["not-json", JSON.stringify({ profile: "x".repeat(128) })]) {
      let observed; const completed = new Promise(resolve => { observed = resolve; }), response = new Response(content, { status: 503 });
      globalThis.window = { location: { href: "http://127.0.0.1:3242/" }, fetch: async () => response, retain: observed };
      installProfileResponseObserver({ origin: "http://127.0.0.1:3242", binding: "retain", maximumBytes: 64 });
      assert.equal(await window.fetch("/api/account/avatar", { method: "POST" }), response);
      const result = await completed; assert.equal(result.status, 503); assert.equal(result.bodyCaptured, false); assert.equal(result.body, undefined); assert.ok(result.bodyError);
      assert.equal(await response.text(), content, "The application still reads its unmodified actual response");
    }
  } finally { globalThis.window = previous; }
});

test("observer excludes read requests, other endpoints and other origins", async () => {
  const previous = globalThis.window, observations = [];
  globalThis.window = { location: { href: "http://127.0.0.1:3242/" }, fetch: async () => Response.json({ real: true }), retain: v => observations.push(v) };
  try {
    installProfileResponseObserver({ origin: "http://127.0.0.1:3242", binding: "retain" });
    for (const [url, method] of [["/api/account/profile", "GET"], ["/api/account/session", "POST"], ["https://example.invalid/api/account/profile", "PATCH"]]) {
      assert.deepEqual(await (await window.fetch(url, { method })).json(), { real: true });
    }
    assert.deepEqual(observations, []);
  } finally { globalThis.window = previous; }
});
