import assert from "node:assert/strict";
import { OpenSeaClient, page } from "./opensea-client.js";
let calls: URL[] = [];
let sleeps: number[] = [];
const responses = [
  new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
  new Response(JSON.stringify({ listings: [], next: "opaque+/=? cursor" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
];
const client = new OpenSeaClient({
  baseUrl: "https://api.example.test",
  apiKey: "secret",
  timeoutMs: 1000,
  pageSize: 25,
  fetchImpl: async (input, init) => {
    calls.push(new URL(input.toString()));
    assert.equal(new Headers(init?.headers).get("x-api-key"), "secret");
    return responses.shift()!;
  },
  sleep: async (ms) => {
    sleeps.push(ms);
  },
});
const raw = await client.listings("slug", "opaque+/=? cursor");
assert.equal(page(raw, "listings").next, "opaque+/=? cursor");
assert.equal(sleeps[0], 2000);
assert.equal(calls[1]!.searchParams.get("next"), "opaque+/=? cursor");
assert.equal(calls[1]!.searchParams.get("limit"), "25");
assert.throws(
  () =>
    new OpenSeaClient({
      baseUrl: "https://x",
      apiKey: "",
      timeoutMs: 1,
      pageSize: 1,
    }),
  /key is required/,
);
console.info("nft-marketplace client smoke: PASS");
