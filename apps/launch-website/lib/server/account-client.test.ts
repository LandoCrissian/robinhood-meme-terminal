import assert from "node:assert/strict";
import test from "node:test";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { assertAccountChallenge, assertConnectedAccount, connectAccountWallet, discoverAccountWallets, signAccountMessage,
  type ConnectedAccount } from "../profile-wallet";
import { accountApi, AccountApiError } from "../account-api";
import { type ProfileChallenge } from "../profiles";

const owner = privateKeyToAccount("0x" + "1".padStart(64, "0") as `0x${string}`), other = "0x2222222222222222222222222222222222222222";
const now = Date.parse("2026-11-17T12:00:00Z");
const location = { origin: "https://rmt.example.test", host: "rmt.example.test", protocol: "https:" };
function challenge(options: Partial<Parameters<typeof createSiweMessage>[0]> = {}, purpose: ProfileChallenge["purpose"] = "login"): ProfileChallenge {
  return { message: createSiweMessage({ domain: location.host, address: owner.address, uri: location.origin, version: "1", chainId: 4663,
    nonce: "11223344aabbccdd", statement: purpose === "login" ? "Sign in to RMT Launch" : "Confirm removal of your RMT Launch profile",
    issuedAt: new Date(now), expirationTime: new Date(now + 300_000), ...options }),
  nonce: "11223344aabbccdd", expiresAt: new Date(now + 300_000).toISOString(), purpose };
}
function wallet() {
  const methods: string[] = [], state = { address: owner.address as string, chain: "0x1237", rejected: false, changeWhileSigning: false };
  const provider = { async request({ method, params }: { method: string; params?: readonly unknown[] }) {
    methods.push(method);
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [state.address];
    if (method === "eth_chainId") return state.chain;
    if (method === "personal_sign") {
      assert.equal(params?.[1], owner.address);
      if (state.rejected) throw Object.assign(new Error("Declined"), { code: 4001 });
      if (state.changeWhileSigning) state.address = other;
      return owner.signMessage({ message: { raw: params?.[0] as `0x${string}` } });
    }
    throw new Error("Unexpected wallet method: " + method);
  } };
  const connected: ConnectedAccount = { id: "test", name: "Synthetic wallet", provider, request: provider.request, address: owner.address, chainId: 4663 };
  return { connected, provider, state, methods };
}

test("sign-in review binds exact site, account, chain, nonce, purpose and bounded expiry", () => {
  assert.doesNotThrow(() => assertAccountChallenge(challenge(), wallet().connected, location, now));
  assert.doesNotThrow(() => assertAccountChallenge(challenge({}, "delete-profile"), wallet().connected, location, now));
  const invalidMessages: Array<Partial<Parameters<typeof createSiweMessage>[0]>> = [{ domain: "attacker.invalid" }, { uri: "https://attacker.invalid" }, { address: other }, { chainId: 1 },
    { statement: "Authorize a transfer" }, { nonce: "anothernonce" }, { expirationTime: new Date(now - 1) },
    { resources: ["https://unrelated.invalid/authorization"] }, { issuedAt: new Date(now + 30_000) }];
  for (const changes of invalidMessages) {
    assert.throws(() => assertAccountChallenge(challenge(changes), wallet().connected, location, now));
  }
  assert.throws(() => assertAccountChallenge({ ...challenge(), message: challenge().message + "\nSend assets now" }, wallet().connected, location, now));
  assert.throws(() => assertAccountChallenge({ ...challenge(), expiresAt: new Date(now + 301_000).toISOString() }, wallet().connected, location, now));
});

test("connecting requests only account permission and reads network; it never signs or submits", async () => {
  const h = wallet(); const connected = await connectAccountWallet({ id: "test", name: "Synthetic wallet", provider: h.provider });
  assert.equal(connected.address, owner.address); assert.equal(connected.chainId, 4663);
  assert.deepEqual(h.methods.sort(), ["eth_accounts", "eth_chainId", "eth_requestAccounts"].sort());
});

test("explicit message signing preserves review binding across wallet rejection, account changes and asynchronous review invalidation", async () => {
  const success = wallet(); let checks = 0;
  const signature = await signAccountMessage(success.connected, challenge().message, () => { checks++; });
  assert.match(signature, /^0x[0-9a-f]{130}$/i); assert.equal(checks, 2);
  assert.equal(success.methods.filter((m) => m === "personal_sign").length, 1);
  assert.equal(success.methods.some((m) => /sendTransaction|sendRawTransaction|approve/.test(m)), false);
  const rejected = wallet(); rejected.state.rejected = true;
  await assert.rejects(signAccountMessage(rejected.connected, challenge().message, () => undefined), /Declined/);
  const changed = wallet(); changed.state.changeWhileSigning = true;
  await assert.rejects(signAccountMessage(changed.connected, challenge().message, () => undefined), /changed/);
  const reviewChanged = wallet(); let validation = 0;
  await assert.rejects(signAccountMessage(reviewChanged.connected, challenge().message, () => { if (++validation > 1) throw new Error("Review changed"); }), /Review changed/);
});

test("wrong network or replaced provider cannot request a sign-in signature", async () => {
  const h = wallet(); h.state.chain = "0x1";
  await assert.rejects(signAccountMessage(h.connected, challenge().message, () => undefined), /network changed/);
  assert.equal(h.methods.includes("personal_sign"), false);
  const replaced = wallet(); replaced.provider.request = async () => [];
  await assert.rejects(assertConnectedAccount(replaced.connected), /provider changed/);
});

test("EIP-6963 discovery is bounded, deduplicated, makes no wallet calls and ignores remote icons", () => {
  const previous = globalThis.window;
  const surface = new EventTarget();
  Object.assign(globalThis, { window: surface });
  try {
    const found: string[] = []; const dispose = discoverAccountWallets((entry) => found.push(entry.name));
    const provider = { request: async () => { throw new Error("Discovery must not call the wallet"); } };
    const announce = (n: number, name = "Wallet " + n, p = provider) => surface.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { uuid: `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`, name, icon: "https://tracking.invalid/icon.svg" }, provider: p },
    }));
    announce(1); announce(1); assert.equal(found.length, 1);
    announce(2, "Misleading\u202ewallet", { request: provider.request }); assert.equal(found.length, 1);
    for (let n = 2; n < 20; n++) announce(n, "Wallet " + n, { request: provider.request });
    assert.equal(found.length, 8); dispose();
  } finally { if (previous === undefined) Reflect.deleteProperty(globalThis, "window"); else globalThis.window = previous; }
});

test("account API requests keep cookies same-origin and CSRF out of URLs and reject malformed/oversized responses", async () => {
  const original = globalThis.fetch;
  try {
    let requests = 0;
    globalThis.fetch = async (url, init) => { requests++; assert.equal(url, "/api/account/profile");
      assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("x-csrf-token"), "synthetic-csrf"); return Response.json({ profile: { displayName: "Creator" } }); };
    assert.deepEqual(await accountApi("/api/account/profile", { method: "PATCH", body: { displayName: "Creator" }, csrfToken: "synthetic-csrf" }), { profile: { displayName: "Creator" } });
    for (const path of ["https://outside.invalid/api/account/profile", "/api/account/../admin", "/api/account/profile?csrf=private", "/api/account/%2e%2e/admin"]) await assert.rejects(accountApi(path));
    assert.equal(requests, 1);
    globalThis.fetch = async () => new Response("x".repeat(65_537), { headers: { "content-type": "application/json" } });
    await assert.rejects(accountApi("/api/account/session"), AccountApiError);
    globalThis.fetch = async () => Response.json({ error: "unauthorized" }, { status: 401 });
    await assert.rejects(accountApi("/api/account/session"), (error) => error instanceof AccountApiError && error.status === 401);
  } finally { globalThis.fetch = original; }
});
