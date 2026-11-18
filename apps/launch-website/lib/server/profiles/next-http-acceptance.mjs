import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../../package.json", import.meta.url));
const { privateKeyToAccount } = require("viem/accounts");
const account = privateKeyToAccount("0x" + "1".padStart(64, "0"));
const origin = "http://127.0.0.1:3244";
const rawRequest = headers => new Promise((resolve, reject) => {
  const request = httpRequest(origin + "/api/account/session", { headers }, response => {
    let body = "";
    response.on("data", chunk => { body += chunk; if (body.length > 8_192) response.destroy(new Error("Bounded test response exceeded")); });
    response.on("error", reject);
    response.on("end", () => { try { resolve({ status: response.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); } });
  });
  request.on("error", reject); request.setTimeout(5_000, () => request.destroy(new Error("Local HTTP timeout"))); request.end();
});
assert.equal(process.env.GCLOUD_PROJECT, "demo-rmt-launch-profiles", "Use the isolated emulator wrapper only");
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:/);

test("production-style Next HTTP accepts its internal loopback alias without relaxing external SIWE boundaries", async () => {
  const env = { ...process.env, RMT_PROFILES_MODE: "local-firebase-emulators-v1", RMT_PROFILES_ORIGIN: origin };
  for (const name of ["NETLIFY", "VERCEL", "CONTEXT", "DEPLOY_ID", "RAILWAY_ENVIRONMENT_ID"]) delete env[name];
  const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "3244"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let log = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { log = (log + data).slice(-8_192); });
  try {
    const until = Date.now() + 30_000;
    for (;;) {
      if (server.exitCode !== null) throw new Error("Next failed: " + log);
      try { if ((await fetch(origin + "/api/account/session", { signal: AbortSignal.timeout(1_000) })).status !== 404) break; } catch { /* bounded startup retry */ }
      if (Date.now() > until) throw new Error("Next startup timed out: " + log);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const session = await fetch(origin + "/api/account/session");
    assert.equal(session.status, 200, JSON.stringify(await session.clone().json()));
    assert.deepEqual(await session.json(), { authenticated: false, availability: "available" });
    for (const headers of [{ host: "localhost:3244" }, { origin: "http://localhost:3244" }, { "x-forwarded-host": "localhost:3244" }, { "x-forwarded-port": "3245" }, { "x-forwarded-proto": "https" }, { forwarded: "host=127.0.0.1:3244" }]) {
      // Native fetch controls Host itself; raw node:http preserves the actual wire Host under test.
      const rejected = await rawRequest(headers);
      assert.equal(rejected.status, 403, JSON.stringify({ headers, body: rejected.body }));
    }
    const challenge = await fetch(origin + "/api/account/nonce", { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ address: account.address, chainId: 4663 }) });
    const nonce = await challenge.json();
    assert.equal(challenge.status, 200, JSON.stringify(nonce));
    assert.match(nonce.message, /^127\.0\.0\.1:3244 wants you to sign in/);
    assert.ok(nonce.message.includes("URI: " + origin));
    const browserCookie = challenge.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    const verified = await fetch(origin + "/api/account/verify", { method: "POST", headers: { origin, "content-type": "application/json", cookie: browserCookie },
      body: JSON.stringify({ message: nonce.message, signature: await account.signMessage({ message: nonce.message }) }) });
    assert.equal(verified.status, 200, JSON.stringify(await verified.clone().json()));
    const authCookie = verified.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    const authenticated = await fetch(origin + "/api/account/session", { headers: { cookie: browserCookie + "; " + authCookie } });
    const body = await authenticated.json();
    assert.equal(authenticated.status, 200); assert.equal(body.authenticated, true); assert.equal(body.account.walletAddress, account.address);
  } finally {
    server.kill("SIGTERM");
    await Promise.race([new Promise(resolve => server.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5_000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
});
