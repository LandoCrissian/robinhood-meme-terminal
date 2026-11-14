import assert from "node:assert/strict";
import test from "node:test";
import { creationReviewPath, emptyLaunchDraft, reviewableFields, validateLaunchDraft } from "../launch-draft";
import { reviewLaunchDraft } from "./launch-draft";

const origin = "https://rmt.example";
const treasury = "0x" + "A".repeat(40);
const draft = {
  ...emptyLaunchDraft, name: " Civic Builders ", symbol: " build ", description: "Draft only\r\nSecond line",
  projectURI: "https://example.org/launch", artworkURL: "https://example.org/art.png",
  supplyPreset: "1", treasury, treasuryShare: "12.03",
};
const { description, artworkURL, ...reviewFields } = draft;

function post(input: unknown, opts: { url?: string; method?: string; origin?: string | null; contentType?: string } = {}) {
  const headers = new Headers({ "content-type": opts.contentType ?? "application/json" });
  if (opts.origin !== null) headers.set("origin", opts.origin ?? origin);
  return new Request(origin + (opts.url ?? creationReviewPath), {
    method: opts.method ?? "POST", headers, ...(opts.method === "GET" ? {} : { body: JSON.stringify(input) }),
  });
}

test("validates a fixed-supply draft and normalizes project terms", () => {
  const result = validateLaunchDraft(draft);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.draft, {
    name: "Civic Builders", symbol: "BUILD", description: "Draft only\nSecond line",
    projectURI: draft.projectURI, artworkURL, supply: 10_000_000, supplyPreset: 1,
    treasury: treasury.toLowerCase(), treasuryShareBps: 1203,
  });
  assert.equal(validateLaunchDraft({ ...draft, name: "é".repeat(24), treasuryShare: "90.00" }).ok, true);
  assert.equal(validateLaunchDraft({ ...draft, treasury: "", treasuryShare: "" }).ok, true);
});

test("rejects invalid strings, noncanonical options and unpaired treasury data", () => {
  const cases = [
    { name: "é".repeat(25) }, { name: "x\u202Ey" }, { symbol: "ß" }, { symbol: "A!".repeat(6) },
    { description: "x".repeat(501) }, { description: "x\u0000y" },
    { projectURI: "javascript:alert(1)" }, { projectURI: "https://user:pass@example.org/" },
    { projectURI: "https://example.org/" + "é".repeat(50) },
    { artworkURL: "https://example.org\\bad" }, { artworkURL: "http://example.org/art.png" },
    { supplyPreset: "01" }, { supplyPreset: "3" },
    { treasury: "0x" + "0".repeat(40) }, { treasury: "" }, { treasuryShare: "0.00" },
    { treasuryShare: "90.01" }, { treasuryShare: "0.001" }, { treasuryShare: "2e1" },
  ];
  for (const item of cases) {
    const result = validateLaunchDraft({ ...draft, ...item });
    assert.equal(result.ok, false, JSON.stringify(item));
    if (!result.ok) assert.ok(Object.keys(result.errors).includes(Object.keys(item)[0]));
  }
});

test("accepts only a same-origin JSON review and returns only contract-relevant fields", async () => {
  const response = await reviewLaunchDraft(post(reviewFields));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
  const res = await response.json();
  const validated = validateLaunchDraft(draft);
  assert.ok(validated.ok);
  assert.deepEqual(res, { status: "reviewed", draft: reviewableFields(validated.draft) });
  assert.ok(!Object.values(res.draft).includes(description));
  assert.ok(!Object.values(res.draft).includes(artworkURL));
  assert.equal((await reviewLaunchDraft(post({ ...reviewFields, symbol: "UP!" }))).status, 422);
  assert.equal((await reviewLaunchDraft(post({ ...reviewFields, description }))).status, 400);
  assert.equal((await reviewLaunchDraft(post({ ...reviewFields, factory: treasury, value: "1" }))).status, 400);
  assert.equal((await reviewLaunchDraft(post(reviewFields, { origin: "https://other.example" }))).status, 403);
  assert.equal((await reviewLaunchDraft(post(reviewFields, { origin: null }))).status, 403);
  assert.equal((await reviewLaunchDraft(post(reviewFields, { method: "GET" }))).status, 405);
  assert.equal((await reviewLaunchDraft(post(reviewFields, { url: creationReviewPath + "?chainId=4663" }))).status, 400);
  assert.equal((await reviewLaunchDraft(post(reviewFields, { contentType: "text/plain" }))).status, 415);
});

test("bounds declared and streamed draft payloads and rejects malformed UTF-8", async () => {
  const tooBig = post(reviewFields);
  tooBig.headers.set("content-length", "4097");
  assert.equal((await reviewLaunchDraft(tooBig)).status, 413);
  assert.equal((await reviewLaunchDraft(post({ ...reviewFields, name: "x".repeat(4097) }))).status, 413);
  const malformed = new Request(origin + creationReviewPath, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([0xc0, 0xc0]),
  });
  assert.equal((await reviewLaunchDraft(malformed)).status, 400);
});
