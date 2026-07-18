import assert from "node:assert/strict";
import {
  guardMediaRequest,
  isSameOriginMediaRequest,
  readBoundedJsonRequest,
  readBoundedJsonResponse
} from "./media-request-guard";

function mediaRequest(origin: string | undefined, body = "{}", extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({ "Content-Type": "application/json", ...extraHeaders });
  if (origin) headers.set("Origin", origin);
  return new Request("https://www.rmtlaunch.fun/api/media/sign", { method: "POST", headers, body });
}

assert.equal(isSameOriginMediaRequest(mediaRequest("https://www.rmtlaunch.fun")), true);
assert.equal(isSameOriginMediaRequest(mediaRequest("https://attacker.example")), false);
assert.equal(isSameOriginMediaRequest(mediaRequest(undefined)), false);
assert.equal(
  isSameOriginMediaRequest(mediaRequest("https://www.rmtlaunch.fun", "{}", { "Sec-Fetch-Site": "cross-site" })),
  false
);

const rateHeaders = { "X-Forwarded-For": "203.0.113.91" };
const first = guardMediaRequest(mediaRequest("https://www.rmtlaunch.fun", "{}", rateHeaders), {
  namespace: "smoke",
  limit: 2,
  windowMs: 60_000,
  now: 1_000
});
const second = guardMediaRequest(mediaRequest("https://www.rmtlaunch.fun", "{}", rateHeaders), {
  namespace: "smoke",
  limit: 2,
  windowMs: 60_000,
  now: 1_001
});
const third = guardMediaRequest(mediaRequest("https://www.rmtlaunch.fun", "{}", rateHeaders), {
  namespace: "smoke",
  limit: 2,
  windowMs: 60_000,
  now: 1_002
});
assert.equal(first.ok, true);
assert.equal(second.ok, true);
assert.deepEqual(third, {
  ok: false,
  status: 429,
  error: "Too many media requests. Please wait and try again.",
  retryAfterSeconds: 60
});

async function main() {
  const validBody = await readBoundedJsonRequest(mediaRequest("https://www.rmtlaunch.fun", '{"filename":"logo.png"}'), 100);
  assert.deepEqual(validBody, { ok: true, value: { filename: "logo.png" } });

  const wrongType = await readBoundedJsonRequest(
    mediaRequest("https://www.rmtlaunch.fun", "{}", { "Content-Type": "text/plain" }),
    100
  );
  assert.equal(wrongType.ok, false);
  if (!wrongType.ok) assert.equal(wrongType.status, 415);

  const oversized = await readBoundedJsonRequest(mediaRequest("https://www.rmtlaunch.fun", `{"value":"${"x".repeat(100)}"}`), 32);
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.status, 413);

  assert.deepEqual(
    await readBoundedJsonResponse(new Response('{"data":"ok"}', { headers: { "Content-Type": "application/json" } }), 100),
    { data: "ok" }
  );
  assert.equal(await readBoundedJsonResponse(new Response("not-json"), 100), null);

  console.info("Media request guard smoke test passed");
}

void main();
