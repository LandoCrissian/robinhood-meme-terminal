import assert from "node:assert/strict";
import test from "node:test";
import { creationReviewPath, emptyLaunchDraft, projectTreasuryShareUnit, readStoredLaunchDraft, restoreLegacyLaunchDraft,
  reviewableFields, treasuryProjectPercent, validateLaunchDraft } from "../launch-draft";
import { reviewLaunchDraft } from "./launch-draft";

const origin = "https://rmt.example";
const treasury = "0x" + "A".repeat(40);
const draft = {
  ...emptyLaunchDraft, name: " Civic Builders ", symbol: " build ", description: "Draft only\r\nSecond line",
  projectURI: "https://example.org/launch", artworkURL: "https://example.org/art.png",
  treasury, treasuryShare: "25",
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
    projectURI: draft.projectURI, artworkURL, supply: 1_000_000_000,
    treasury: treasury.toLowerCase(), treasuryShareBps: 2250,
  });
  assert.equal(validateLaunchDraft({ ...draft, name: "é".repeat(24), treasuryShare: "100.00" }).ok, true);
  assert.equal(validateLaunchDraft({ ...draft, treasury: "", treasuryShare: "" }).ok, true);
});

test("rejects invalid strings, noncanonical options and unpaired treasury data", () => {
  const cases = [
    { name: "é".repeat(25) }, { name: "x\u202Ey" }, { symbol: "ß" }, { symbol: "A!".repeat(6) },
    { description: "x".repeat(501) }, { description: "x\u0000y" },
    { projectURI: "javascript:alert(1)" }, { projectURI: "https://user:pass@example.org/" },
    { projectURI: "https://example.org/" + "é".repeat(50) },
    { artworkURL: "https://example.org\\bad" }, { artworkURL: "http://example.org/art.png" },
    { treasury: "0x" + "0".repeat(40) }, { treasury: "" }, { treasuryShare: "0.00" },
    { treasuryShare: "100.01" }, { treasuryShare: "0.01" }, { treasuryShare: "0.001" }, { treasuryShare: "2e1" },
  ];
  for (const item of cases) {
    const result = validateLaunchDraft({ ...draft, ...item });
    assert.equal(result.ok, false, JSON.stringify(item));
    if (!result.ok) assert.ok(Object.keys(result.errors).includes(Object.keys(item)[0]));
  }
});

test("uses the same one-billion review on every origin and rejects client-supplied supply", async () => {
  const valid = { ...reviewFields, treasuryShareUnit: projectTreasuryShareUnit };
  for (const extra of [{ supplyPreset: "0" }, { supply: "1000000" }, { supply: "1000000000" },
    { fixedSupplyWei: "1000000000000000000000000000" }]) {
    assert.equal((await reviewLaunchDraft(post({ ...valid, ...extra }))).status, 400);
  }
  const response = await reviewLaunchDraft(post(valid));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.draft.supply, 1_000_000_000);
  assert.equal(Object.hasOwn(result.draft, "supplyPreset"), false);
});

test("restores editable text from an earlier draft without restoring its supply option", () => {
  assert.deepEqual(readStoredLaunchDraft({ ...draft, supplyPreset: "1" }), draft);
  assert.equal(readStoredLaunchDraft({ ...draft, symbol: false }), undefined);
  assert.equal(readStoredLaunchDraft({ ...draft, symbol: "x".repeat(501) }), undefined);
});

test("accepts only a same-origin JSON review and returns only contract-relevant fields", async () => {
  const response = await reviewLaunchDraft(post({ ...reviewFields, treasuryShareUnit: projectTreasuryShareUnit }));
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

test("converts project percentages to contract bps and displays the actual encoded fraction", () => {
  for (const [entered, expected] of [["0", 0], ["25", 2250], ["50", 4500], ["100", 9000], ["11.22", 1009]] as const) {
    const result = validateLaunchDraft({ ...draft, treasury: expected ? treasury : "", treasuryShare: entered });
    assert.ok(result.ok, entered);
    assert.equal(result.draft.treasuryShareBps, expected);
  }
  assert.equal(treasuryProjectPercent(2250), "25%");
  assert.equal(treasuryProjectPercent(9000), "100%");
  assert.equal(treasuryProjectPercent(1009), "≈11.2111%");
});

test("restores all 9001 encoded legacy splits without changing their committed bps", () => {
  for (let bps = 0; bps <= 9000; bps++) {
    const prior = { ...draft, treasury: bps ? treasury : "", treasuryShare: (bps / 100).toFixed(2) };
    const restored = restoreLegacyLaunchDraft(prior);
    const result = validateLaunchDraft(restored);
    assert.ok(result.ok, String(bps));
    assert.equal(result.draft.treasuryShareBps, bps);
    assert.equal(restored.treasury, prior.treasury);
  }
  const invalidPrior = restoreLegacyLaunchDraft({ ...draft, treasuryShare: "95" });
  assert.equal(invalidPrior.treasuryShare, "");
  assert.equal(validateLaunchDraft(invalidPrior).ok, false);
});

test("keeps the legacy HTTP unit and rejects unknown or spoofed units", async () => {
  const old = await reviewLaunchDraft(post({ ...reviewFields, treasuryShare: "12.03" }));
  assert.equal(old.status, 200);
  assert.equal((await old.json()).draft.treasuryShareBps, 1203);
  const full = await reviewLaunchDraft(post({ ...reviewFields, treasuryShare: "100", treasuryShareUnit: projectTreasuryShareUnit }));
  assert.equal(full.status, 200);
  assert.equal((await full.json()).draft.treasuryShareBps, 9000);
  assert.equal((await reviewLaunchDraft(post({ ...reviewFields, treasuryShare: "100" }))).status, 422);
  assert.equal((await reviewLaunchDraft(post({ ...reviewFields, treasuryShareUnit: "basis-points" }))).status, 400);
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

test("binds the real browser authority through Next's loopback URL and ignores forwarded authority", async () => {
  const review = (url: string, host: string, origin: string) => reviewLaunchDraft(new Request(url + creationReviewPath, {
    method: "POST",
    headers: { host, origin, "content-type": "application/json", "x-forwarded-host": "spoof.example" },
    body: JSON.stringify(reviewFields),
  }));
  assert.equal((await review("http://localhost:3263", "127.0.0.1:3263", "http://127.0.0.1:3263")).status, 200);
  assert.equal((await review("http://localhost:3263", "127.0.0.1:3263", "http://localhost:3263")).status, 403);
  assert.equal((await review("http://localhost:443", "rmt.example", "https://rmt.example")).status, 200);
  assert.equal((await review("http://localhost:443", "rmt.example", "http://rmt.example")).status, 403);
  assert.equal((await review("https://rmt.example", "rmt.example", "https://spoof.example")).status, 403);
});
