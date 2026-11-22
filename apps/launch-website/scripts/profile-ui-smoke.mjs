import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, devices } from "playwright";
import { installProfileResponseObserver } from "../../../scripts/profiles/browser-response-observer.mjs";

const require = createRequire(new URL("../package.json", import.meta.url));
const { privateKeyToAccount } = require("viem/accounts"), { hexToString } = require("viem"), sharp = require("sharp");
const site = new URL(process.env.RMT_PROFILE_UI_URL ?? "http://127.0.0.1:3242/");
assert.equal(site.origin + "/", site.href); assert.equal(site.protocol, "http:"); assert.ok(["127.0.0.1","localhost"].includes(site.hostname)); assert.ok(site.port);
const emulator = process.env.RMT_PROFILE_UI_MODE !== "disabled" && Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST);
const artifacts = process.env.RMT_PROFILE_UI_ARTIFACTS ?? join(tmpdir(), "rmt-profile-ui");
await mkdir(artifacts, { recursive: true });
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", site.hostname, "-p", site.port], {
  cwd: resolve(fileURLToPath(new URL("..", import.meta.url))), windowsHide: true,
  env: { ...process.env, ...(emulator ? { RMT_PROFILES_MODE: "local-firebase-emulators-v1", RMT_PROFILES_ORIGIN: site.origin,
    GCLOUD_PROJECT: "demo-rmt-launch-profiles" } : { RMT_PROFILES_MODE: "" }) }, stdio: ["ignore", "pipe", "pipe"],
});
let output = ""; for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-32_000); });
const results = [], mutationDiagnostics = [];
try {
  const until = Date.now() + 40_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error("Next server stopped: " + output);
    try { if ((await fetch(site, { signal: AbortSignal.timeout(1500) })).status === 200) break; } catch { /* bounded startup retry */ }
    if (Date.now() > until) throw new Error("Next startup timed out: " + output);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const readiness = await fetch(new URL("/api/account/session", site));
  const readinessData = await readiness.json();
  assert.equal(readiness.status, 200, "Account session preflight failed: " + JSON.stringify(readinessData));
  assert.equal(readinessData.availability, emulator ? "available" : "disabled", "Account mode preflight: " + JSON.stringify(readinessData));
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    // The server suite uses deterministic keys 1/2/3. Its durable per-user budgets
    // must not leak into this journey or between browsers, and must not be reset.
    const fixtureStart = name === "chromium" ? 1001 : 2001;
    const accounts = [fixtureStart, fixtureStart + 1].map((n) => privateKeyToAccount("0x" + n.toString(16).padStart(64, "0")));
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
      const page = await context.newPage(); page.setDefaultTimeout(15_000);
      const walletCalls = [], errors = [], outside = []; let reject = true, rejectSwitch = true;
      const mutations = []; mutationDiagnostics.push({ engine: name, entries: mutations });
      let pendingMutation;
      await context.exposeBinding("retainProfileMutationResponse", (_source, observation) => {
        const url = new URL(observation.url);
        assert.equal(url.origin, site.origin); assert.ok(pendingMutation, "Unexpected profile mutation outside an explicit UI action");
        assert.equal(observation.method, pendingMutation.method); assert.equal(url.pathname, pendingMutation.path);
        const diagnostic = { ...observation, observedAt: new Date().toISOString() }; delete diagnostic.body; mutations.push(diagnostic);
        if (!observation.bodyCaptured) pendingMutation.reject(Error(observation.bodyError ?? "Actual profile response could not be captured"));
        else pendingMutation.resolve(observation);
      });
      await context.addInitScript(installProfileResponseObserver, { origin: site.origin, binding: "retainProfileMutationResponse", maximumBytes: 65536 });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => { if (new URL(request.url()).origin !== site.origin) outside.push(request.url()); });
      await page.exposeFunction("syntheticProfileWallet", async ({ name: walletName, address, chain, method, params = [] }) => {
        walletCalls.push({ walletName, method });
        if (method === "eth_accounts" || method === "eth_requestAccounts") return { value: [address] };
        if (method === "eth_chainId") return { value: chain };
        if (method === "wallet_switchEthereumChain") {
          assert.deepEqual(params, [{ chainId: "0x1237" }]);
          if (rejectSwitch) { rejectSwitch = false; return { error: { code: 4001, message: "Synthetic network rejection" } }; }
          return { value: null };
        }
        if (method === "personal_sign") {
          assert.ok(emulator, "A disabled-profile preview must never request a signature");
          assert.equal(params[1].toLowerCase(), address.toLowerCase());
          const message = hexToString(params[0]);
          assert.match(message, /Sign in to RMT Launch|Confirm removal of your RMT Launch profile/);
          assert.ok(message.includes(site.host));
          if (reject) { reject = false; return { error: { code: 4001, message: "Synthetic user rejection" } }; }
          const account = accounts.find((entry) => entry.address.toLowerCase() === address.toLowerCase()); assert.ok(account);
          return { value: await account.signMessage({ message }) };
        }
        throw new Error("Unexpected wallet call: " + method);
      });
      await page.addInitScript(({ initialAddress }) => {
        const wallets = {};
        window.rmtDiscoveryCount = 0; window.addEventListener("eip6963:requestProvider", () => { window.rmtDiscoveryCount++; });
        for (const [name, uuid] of [["MetaMask", "00000000-0000-4000-8000-000000000001"], ["Rabby", "00000000-0000-4000-8000-000000000002"]]) {
          let address = initialAddress, chain = "0x1237"; const listeners = new Map();
          const provider = { isMetaMask: name === "MetaMask", isRabby: name === "Rabby",
            request: async ({ method, params }) => { const result = await window.syntheticProfileWallet({ name, address, chain, method, params });
              if (result.error) throw Object.assign(new Error(result.error.message), result.error);
              if (method === "wallet_switchEthereumChain") { chain = params[0].chainId; for (const handler of listeners.get("chainChanged") ?? []) handler(chain); }
              return result.value; },
            on: (event, handler) => { const handlers = listeners.get(event) ?? []; handlers.push(handler); listeners.set(event, handlers); },
            removeListener: (event, handler) => listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== handler)) };
          wallets[name] = { provider, change(next) { address = next; for (const handler of listeners.get("accountsChanged") ?? []) handler([next]); },
            network(next) { chain = next; for (const handler of listeners.get("chainChanged") ?? []) handler(next); } };
          window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid, name }, provider } })));
        }
        window.ethereum = wallets.MetaMask.provider; window.profileWallets = wallets;
      }, { initialAddress: accounts[0].address });
      const goto = async (path) => { const response = await page.goto(new URL(path, site).href); assert.equal(response.status(), 200, path); };
      const status = (pattern) => page.getByRole("status").filter({ hasText: pattern }).first().waitFor();
      const profileIdle = () => page.waitForFunction(() => {
        const save = document.querySelector('form[aria-label="Edit profile"] button[type="submit"]');
        const upload = document.querySelector('input[type="file"]');
        return save instanceof HTMLButtonElement && !save.disabled && upload instanceof HTMLInputElement && !upload.disabled;
      });
      const profileMutation = async (method, path, act, expectedStatus = 200) => {
        await profileIdle();
        assert.equal(pendingMutation, undefined);
        let timer;
        const captured = new Promise((resolve, reject) => {
          pendingMutation = { method, path, resolve, reject };
          timer = setTimeout(() => reject(Error("Actual browser mutation response was not retained")), 15000);
        });
        let responseStatus, body;
        try {
          const [network, observation] = await Promise.all([
            page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method)
              .then(response => ({ method: response.request().method(), url: response.url(), status: response.status() })),
            captured, act(),
          ]);
          assert.equal(network.method, method); assert.equal(network.url, observation.url); assert.equal(network.status, observation.status);
          responseStatus = observation.status; body = observation.body;
        } finally { clearTimeout(timer); pendingMutation = undefined; }
        assert.equal(responseStatus, expectedStatus, `${method} ${path}: ${typeof body.code === "string" ? body.code : "unexpected response"}`);
        if (expectedStatus === 200) assert.equal(body.profile?.walletAddress.toLowerCase(), accounts[0].address.toLowerCase());
        await profileIdle();
        return body;
      };
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const screenshot = async (suffix) => { await noOverflow(); await page.screenshot({ path: join(artifacts, name + "-" + suffix + ".png"), fullPage: true }); };
      const avatarLoaded = async () => {
        await page.waitForFunction(() => {
          const avatars = [...document.querySelectorAll(".lpProfileAvatar img")];
          return avatars.length >= 2 && avatars.every((image) => image.complete && image.naturalWidth > 0);
        });
        const urls = await page.locator(".lpProfileAvatar img").evaluateAll((images) => [...new Set(images.map((image) => image.getAttribute("src")))]);
        assert.equal(urls.length, 1, "Header and page avatar must use the same sanitized image");
        const response = await context.request.get(new URL(urls[0], site).href);
        assert.equal(response.status(), 200); assert.match(response.headers()["content-type"], /^image\/webp/);
        const bytes = await response.body(), metadata = await sharp(bytes).metadata();
        assert.ok(bytes.length > 0 && bytes.length <= 65_536); assert.equal(metadata.format, "webp");
        assert.ok(metadata.width > 0 && metadata.width <= 256 && metadata.height > 0 && metadata.height <= 256);
      };
      const publicCard = async username => {
        const crawler = {headers:{"user-agent":"Twitterbot/1.0"}};
        const page = await context.request.get(new URL("/u/" + username, site).href, crawler);
        assert.equal(page.status(),200);
        const tag = (await page.text()).match(/<meta name="twitter:image" content="([^"]+)"/);
        assert.ok(tag,"Public HTML must include the X card");
        const path = new URL(tag[1]).pathname;
        assert.ok(path.startsWith("/share/u/" + username + "/"));
        const image = await context.request.get(new URL(path,site).href,crawler);
        assert.equal(image.status(),200);
        const bytes = await image.body(), metadata = await sharp(bytes).metadata();
        assert.deepEqual([metadata.format,metadata.width,metadata.height],["png",1200,630]);
        return {path,bytes};
      };
      await goto("/"); await page.getByRole("heading", { name: "Launches", exact: true }).waitFor();
      const discovery = page.getByRole("region", { name: "New RMT Launch engine", exact: true });
      await discovery.getByRole("heading", { name: "Launches coming soon", exact: true }).waitFor();
      await discovery.getByRole("searchbox", { name: "Search launches", exact: true }).waitFor();
      assert.equal(await page.getByRole("main").getByText(/Historical registrations/i).count(), 0);
      assert.equal(await page.locator("details.lpArchive").count(), 0);
      assert.equal(walletCalls.length, 0);
      assert.equal(await page.evaluate(() => window.rmtDiscoveryCount), 0);
      await screenshot("home-portrait");
      const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
      const wide = await desktop.newPage(); await wide.goto(site.href); await wide.screenshot({ path: join(artifacts, name + "-home-desktop.png"), fullPage: true }); await desktop.close();
      for (const [path, suffix] of [["/create-token", "create-portrait"], ["/my-launches", "my-launches-portrait"]]) {
        await goto(path); await screenshot(suffix);
      }
      await goto("/wallet"); await page.getByRole("heading", { name: "Connect your wallet", exact: true }).waitFor();
      if (!emulator) {
        await status(/not configured|unavailable/); assert.equal(walletCalls.length, 0);
        await screenshot("wallet-disabled"); await goto("/account/profile"); await status(/not configured|unavailable/);
        await goto("/u/synthetic_user"); await page.getByRole("heading",{name:"Couldn’t load profile"}).waitFor();
        assert.equal((await context.request.post(new URL("/api/launchpad/production-creation", site).href, { data: {} })).status(), 404);
        assert.equal(walletCalls.length, 0); assert.equal(await page.evaluate(() => window.rmtDiscoveryCount), 0); assert.deepEqual(errors, []); assert.deepEqual(outside, []);
        results.push({ engine: name, mode: "disabled", walletCalls: 0, transactions: 0 }); await context.close(); continue;
      }
      await page.getByRole("button", { name: "Choose wallet", exact: true }).click();
      await page.getByRole("button", { name: "Connect MetaMask", exact: true }).click(); await status(/Wallet connected/);
      assert.equal(walletCalls.some((entry) => entry.method === "personal_sign"), false);
      await page.getByRole("button", { name: "Review gas-free sign-in" }).click(); await page.getByRole("heading", { name: "Review wallet sign-in" }).waitFor();
      const originalMessage = await page.locator(".lpSiweReview pre").textContent();
      await page.getByRole("button", { name: "Review a new message", exact: true }).click();
      await page.waitForFunction((previous) => document.querySelector(".lpSiweReview pre")?.textContent !== previous && document.querySelector(".lpSiweReview pre"), originalMessage);
      assert.equal(walletCalls.some((entry) => entry.method === "personal_sign"), false);
      await page.getByRole("button", { name: "Sign in with wallet" }).click(); await status(/declined/);
      await page.getByRole("button", { name: "Sign in with wallet" }).click(); await page.getByText("Signed in", { exact: true }).waitFor();
      const session = await (await context.request.get(new URL("/api/account/session", site).href)).json(); assert.equal(session.authenticated, true);
      const cookies = await context.cookies(); const sessionCookie = cookies.find((cookie) => cookie.name === "rmt_launch_session_v1");
      assert.ok(sessionCookie?.httpOnly, "Session must be a real HttpOnly cookie");
      await page.evaluate((other) => window.profileWallets.Rabby.change(other), accounts[1].address);
      await page.getByText("Signed in", { exact: true }).waitFor();
      await page.getByRole("link", { name: "Edit profile", exact: true }).click();
      const removalDisclosure = page.locator("summary").filter({ hasText: "Profile data and removal" });
      await removalDisclosure.waitFor();
      const removalBounds = await removalDisclosure.boundingBox();
      assert.ok(removalBounds && removalBounds.height >= 44 && removalBounds.width >= 44, "Profile removal disclosure needs an accessible touch target");
      const username = "ui_" + name + "_" + Date.now().toString(36);
      await page.getByLabel("Username", { exact: true }).fill(username); await page.getByLabel("Display name", { exact: true }).fill("Synthetic Creator");
      await page.getByLabel("Bio", { exact: true }).fill("Isolated Firebase emulator profile. No real transactions.");
      await page.getByLabel("X username (optional)").fill("@rmt_creator");
      await page.getByRole("button", { name: "Add HTTPS link" }).click(); await page.getByLabel("Label", { exact: true }).fill("Project");
      await page.getByLabel("HTTPS URL", { exact: true }).fill("example.invalid/project");
      await page.getByRole("button", { name: "Save profile", exact: true }).click();
      await status(/Project link 1 needs a full HTTPS URL/);
      await page.getByLabel("HTTPS URL", { exact: true }).fill("https://example.invalid/project");
      await page.locator("summary").filter({hasText:"Private preferences"}).click();
      await page.getByLabel("Reduce motion", { exact: true }).check();
      const saved = await profileMutation("PATCH", "/api/account/profile", () => page.getByRole("button", { name: "Save profile", exact: true }).click());
      assert.equal(saved.profile.username, username); await status(/Profile saved/);
      await page.getByLabel("Appearance", { exact: true }).selectOption("light");
      const light = await profileMutation("PATCH", "/api/account/profile", () => page.getByRole("button", { name: "Save profile", exact: true }).click());
      assert.equal(light.profile.preferences.theme, "light"); await status(/Profile saved/);
      await page.waitForFunction(() => document.querySelector(".launchpad")?.getAttribute("data-theme") === "light");
      assert.equal(await page.locator(".launchpad").evaluate((element) => getComputedStyle(element).getPropertyValue("--rmt-surface").trim()), "#fff");
      await page.getByLabel("Appearance", { exact: true }).selectOption("dark");
      const dark = await profileMutation("PATCH", "/api/account/profile", () => page.getByRole("button", { name: "Save profile", exact: true }).click());
      assert.equal(dark.profile.preferences.theme, "dark"); await status(/Profile saved/);
      const { reportedPng, phoneJpeg } = require("./scripts/photo-fixtures.cjs");
      const image = await reportedPng(), phone = await phoneJpeg();
      const selectAvatar = () => page.getByLabel("Upload image", { exact: true })
        .setInputFiles({ name: "reported.png", mimeType: "image/png", buffer: image });
      const retryAvatar = () => page.getByRole("button", {name:"Retry avatar upload"}).click();
      for (const [code, action, message] of [[401,selectAvatar,/session ended/i], [503,retryAvatar,/Check your connection and retry/i]]) {
        await page.route("**/api/account/avatar", async route => {
          await page.getByAltText("Selected avatar preview").waitFor();
          await page.getByRole("progressbar", {name:"Saving avatar"}).waitFor();
          await route.fulfill({status:code,contentType:"application/json",body:JSON.stringify({code:"unavailable"})});
        }, {times:1});
        await profileMutation("POST","/api/account/avatar",action,code);
        await status(message);
      }
      await profileMutation("POST","/api/account/avatar",retryAvatar); await status(/Avatar updated/);
      await avatarLoaded();
      const originalAvatar = (await (await context.request.get(new URL("/api/account/session", site).href)).json()).account.profile.avatarUrl;
      const originalCard = await publicCard(username);
      const list = await context.newPage();
      await list.goto(new URL("/people",site).href);
      const firstImage = list.getByRole("link",{name:new RegExp("@"+username)}).locator("img");
      assert.equal(await firstImage.getAttribute("src"),originalAvatar);
      await firstImage.evaluate(image=>image.decode());
      await list.close();
      const removed = await profileMutation("DELETE", "/api/account/avatar", () => page.getByRole("button", { name: "Remove avatar", exact: true }).click());
      assert.equal(removed.profile.avatarUrl, null); await status(/Avatar removed/);
      await page.waitForFunction(() => document.querySelectorAll(".lpProfileAvatar img").length === 0);
      const afterRemoval = await (await context.request.get(new URL("/api/account/session", site).href)).json();
      assert.equal(afterRemoval.authenticated, true); assert.equal(afterRemoval.account.profile.username, username);
      assert.equal(afterRemoval.account.profile.avatarUrl, null); assert.equal(afterRemoval.account.profile.preferences.reducedMotion, true);
      assert.equal((await context.request.get(new URL(originalAvatar, site).href)).status(), 404);
      assert.equal(await page.getByRole("button", { name: "Remove avatar", exact: true }).count(), 0);
      assert.equal(await page.getByRole("status").filter({ hasText: /Avatar removed/ }).count(), 1, "Avatar changes should produce one live status announcement");
      await profileMutation("POST", "/api/account/avatar", () => page.getByLabel("Upload image", { exact: true })
        .setInputFiles({name:"phone.jpg", mimeType:"image/jpeg", buffer:phone}));
      await status(/Avatar updated/);
      await avatarLoaded();
      const replacementAvatar = (await (await context.request.get(new URL("/api/account/session", site).href)).json()).account.profile.avatarUrl;
      assert.notEqual(replacementAvatar, originalAvatar, "A replacement must have a fresh upload version");
      const publicImage = await context.request.get(new URL(replacementAvatar, site).href);
      assert.equal(publicImage.status(),200);
      const meta = await sharp(await publicImage.body()).metadata();
      assert.deepEqual([meta.width,meta.height],[192,256], "Camera orientation survives optimization and storage");
      const replacementCard = await publicCard(username);
      assert.notEqual(replacementCard.path,originalCard.path);
      assert.ok(!replacementCard.bytes.equals(originalCard.bytes),"Replacing only the avatar must change the rendered card");
      const repeated = await profileMutation("POST", "/api/account/avatar", () => page.getByLabel("Upload image", { exact: true })
        .setInputFiles({name:"phone.jpg", mimeType:"image/jpeg", buffer:phone}));
      assert.notEqual(repeated.profile.avatarUrl,replacementAvatar,"Same-file reupload must have a fresh upload version");
      await status(/Avatar updated/);
      assert.equal((await context.request.get(new URL(originalAvatar, site).href)).status(), 404);
      await screenshot("profile-portrait"); await page.setViewportSize({ width: 844, height: 390 }); await screenshot("profile-landscape");
      const callsBeforeReload = walletCalls.length; await page.reload(); await page.getByRole("form", { name: "Edit profile" }).waitFor();
      assert.equal(walletCalls.length, callsBeforeReload); assert.equal(await page.evaluate(() => window.rmtDiscoveryCount), 0); assert.equal(await page.getByLabel("Username", { exact: true }).inputValue(), username);
      assert.equal(await page.getByLabel("Reduce motion", { exact: true }).isChecked(), true);
      for (const width of (name==="webkit" ? [320,390] : [1440])) {
        await page.setViewportSize({width,height:width===1440?900:844}); await screenshot("editor-"+width);
      }
      await goto("/leaderboard");
      assert.equal(new URL(page.url()).pathname, "/people");
      const directoryImage=page.getByRole("link",{name:new RegExp("@"+username)}).locator("img");
      assert.equal(await directoryImage.getAttribute("src"),repeated.profile.avatarUrl);
      await directoryImage.evaluate(image=>image.decode());
      await page.getByRole("link", { name: new RegExp("@"+username) }).click();
      await page.getByRole("heading", { name: "Synthetic Creator", exact: true }).waitFor();
      assert.equal(await page.getByRole("link", { name: /@rmt_creator on X/ }).getAttribute("href"), "https://x.com/rmt_creator");
      const intent = new URL(await page.getByRole("link", { name: "Share my profile" }).getAttribute("href"));
      assert.equal(intent.origin + intent.pathname, "https://twitter.com/intent/tweet");
      assert.equal(intent.searchParams.get("url"), "https://www.rmtlaunch.fun/u/" + username);
      assert.match(intent.searchParams.get("text"),/^Find me on @RMTLaunch/);
      assert.equal(intent.searchParams.getAll("url").length,1);
      await screenshot("signed-in-share");
      // Capture the actual browser popup handoff without logging in to or posting on X.
      let handedOff;
      await context.route("https://twitter.com/intent/tweet?**", route=>{
        handedOff=route.request().url();
        return route.fulfill({status:200,contentType:"text/plain",body:"Composer handoff recorded by browser test."});
      },{times:1});
      const [composer] = await Promise.all([page.waitForEvent("popup"),page.getByRole("link",{name:"Share my profile"}).click()]);
      await composer.waitForLoadState();
      assert.equal(handedOff,intent.href);
      await composer.close();
      const visitor = await browser.newContext({ viewport:page.viewportSize() });
      try {
        const view = await visitor.newPage();
        let resume;
        const waiting=new Promise(resolve=>{resume=resolve;});
        await view.route("**/api/account/session",async route=>{await waiting;await route.continue();},{times:1});
        await view.goto(new URL("/u/"+username,site).href,{waitUntil:"domcontentloaded"});
        await view.getByRole("button",{name:"Checking account…"}).waitFor();
        assert.equal(await view.locator('a[href*="intent/tweet"]').count(),0);
        resume();
        const guest=new URL(await view.getByRole("link",{name:"Share this profile"}).getAttribute("href"));
        assert.equal(guest.searchParams.get("url"),intent.searchParams.get("url"));
        assert.match(guest.searchParams.get("text"),/Synthetic Creator’s/);
        assert.equal(await view.getByRole("link",{name:"Edit profile",exact:true}).count(),0);
      } finally { await visitor.close(); }
      const publicProfile = await (await context.request.get(new URL("/api/account/public/" + username, site).href)).json();
      assert.equal(publicProfile.profile.preferences, undefined); assert.equal(publicProfile.profile.walletAddress.toLowerCase(), accounts[0].address.toLowerCase());
      await avatarLoaded();
      await screenshot("public-profile-landscape");
      await goto("/wallet");
      await page.route("**/api/account/logout", (route) => route.abort(), { times: 1 });
      await page.getByRole("button", { name: "Sign out & disconnect" }).click(); await page.getByRole("heading", { name: "Connect your wallet", exact: true }).waitFor();
      await page.getByRole("button", { name: "Retry server sign-out", exact: true }).waitFor();
      assert.equal((await (await context.request.get(new URL("/api/account/session", site).href)).json()).authenticated, true, "An aborted logout must not be reported as server success");
      await page.getByRole("button", { name: "Retry server sign-out", exact: true }).click(); await status(/Signed out/);
      assert.equal((await (await context.request.get(new URL("/api/account/session", site).href)).json()).authenticated, false);
      await page.getByRole("button", { name: "Choose wallet", exact: true }).click();
      await page.getByRole("button", { name: "Connect MetaMask", exact: true }).click(); await page.getByRole("button", { name: "Review gas-free sign-in" }).click();
      await page.getByRole("button", { name: "Sign in with wallet" }).click(); await page.getByText("Signed in", { exact: true }).waitFor();
      await page.evaluate((other) => window.profileWallets.MetaMask.change(other), accounts[1].address);
      await page.getByRole("heading", { name: "Connect your wallet", exact: true }).waitFor();
      await page.waitForTimeout(150); assert.equal((await (await context.request.get(new URL("/api/account/session", site).href)).json()).authenticated, false);
      await page.evaluate((original) => window.profileWallets.MetaMask.change(original), accounts[0].address);
      await page.getByRole("button", { name: "Connect MetaMask", exact: true }).click();
      await page.getByRole("button", { name: "Review gas-free sign-in" }).click(); await page.getByRole("button", { name: "Sign in with wallet" }).click();
      await page.getByText("Signed in", { exact: true }).waitFor(); await page.getByRole("link", { name: "Edit profile", exact: true }).click();
      const longName="Robinhood Chain Studio · 🐑💜 Small Batch Creators";
      await page.getByLabel("Display name",{exact:true}).fill(longName);
      await page.getByLabel("Label",{exact:true}).fill("Community artwork and resources");
      await profileMutation("PATCH","/api/account/profile",()=>page.getByRole("button",{name:"Save profile",exact:true}).click());
      await goto("/u/"+username);
      await page.getByRole("heading",{name:longName,exact:true}).waitFor();
      await page.setViewportSize({width:320,height:844}); await screenshot("long-profile-320");
      await page.getByRole("link",{name:"Edit profile",exact:true}).click();
      await page.getByText("Profile data and removal", { exact: true }).click();
      // The full public-page reload restored the session, not the in-memory wallet connection.
      await page.getByRole("button",{name:"Choose wallet",exact:true}).click();
      await page.getByRole("button",{name:"Connect MetaMask",exact:true}).click();
      await page.getByRole("button", { name: "Review profile removal", exact: true }).click();
      await page.getByRole("button", { name: "Confirm wallet for removal", exact: true }).click(); await status(/Wallet control confirmed/);
      await page.getByLabel("I want to remove my RMT Launch profile data.", { exact: true }).check();
      await page.getByRole("button", { name: "Delete profile data", exact: true }).click(); await status(/Profile data removed/);
      assert.equal((await context.request.get(new URL("/api/account/public/" + username, site).href)).status(), 404);
      assert.equal((await (await context.request.get(new URL("/api/account/session", site).href)).json()).authenticated, false);
      await goto("/wallet"); await page.getByRole("button", { name: "Choose wallet", exact: true }).click();
      await page.evaluate((second) => { window.profileWallets.Rabby.change(second); window.profileWallets.Rabby.network("0x1"); }, accounts[1].address);
      await page.getByRole("button", { name: "Connect Rabby", exact: true }).click(); await status(/another network/);
      const signaturesBeforeSwitch = walletCalls.filter(({ method }) => method === "personal_sign").length;
      await page.getByRole("button", { name: "Switch to Robinhood Chain", exact: true }).click(); await status(/declined/);
      assert.equal(walletCalls.filter(({ method }) => method === "personal_sign").length, signaturesBeforeSwitch);
      await page.getByRole("button", { name: "Switch to Robinhood Chain", exact: true }).click();
      await page.getByRole("button", { name: "Connect Rabby", exact: true }).click();
      await page.getByRole("button", { name: "Review gas-free sign-in" }).click(); await page.getByRole("button", { name: "Sign in with wallet" }).click();
      await page.getByText("Signed in", { exact: true }).waitFor();
      const rabbySession = await (await context.request.get(new URL("/api/account/session", site).href)).json();
      assert.equal(rabbySession.account.walletAddress.toLowerCase(), accounts[1].address.toLowerCase());
      assert.ok(walletCalls.some(({ walletName, method }) => walletName === "Rabby" && method === "personal_sign"));
      await page.getByRole("button", { name: "Sign out & disconnect", exact: true }).click(); await status(/Signed out/);
      assert.equal(walletCalls.some(({ method }) => /sendTransaction|sendRawTransaction|wallet_sendCalls|approve/.test(method)), false);
      assert.deepEqual(errors, []); assert.deepEqual(outside, []);
      results.push({ engine: name, mode: "firebase-emulators", syntheticWallet: accounts[0].address,
        fixtureIsolation: "Per-browser deterministic synthetic identities, separate from server-suite accounts; durable limits unchanged",
        signatureRequests: walletCalls.filter(({ method }) => method === "personal_sign").length, walletsAccepted: ["MetaMask", "Rabby"],
        cookieHttpOnly: sessionCookie.httpOnly, profiles: "saved/reloaded/public/deleted-after-fresh-proof", avatar: "uploaded/re-encoded/decoded/removed-with-profile-retained/reuploaded-versioned/header-editor-public-loaded", privatePreferences: "saved/not-public", logoutAndAccountChange: "verified-including-outage-retry", networkSwitch: "rejection-then-confirmed-switch", transactions: 0 });
      await context.close();
    } catch (error) {
      const failedPage = browser.contexts()[0]?.pages()[0];
      if (failedPage) await failedPage.screenshot({ path: join(artifacts, name + "-failure.png"), fullPage: true }).catch(() => undefined);
      await writeFile(join(artifacts, name + "-failure.json"), JSON.stringify({ engine: name, url: failedPage?.url(),
        error: String(error?.message ?? error), mutations: mutationDiagnostics.find((entry) => entry.engine === name)?.entries ?? [] }, null, 2));
      throw error;
    } finally { await browser.close(); }
  }
  await writeFile(join(artifacts, "profile-ui-results.json"), JSON.stringify({ environment: "loopback", emulator, url: site.href, results, mutationDiagnostics,
    physicalWalletAcceptance: "not performed", productionActivation: false }, null, 2));
  console.log("Profile UI passed " + (emulator ? "real Firebase-emulator authentication" : "disabled-service checks") + " in Chromium/WebKit. Evidence: " + artifacts);
} finally { child.kill(); await writeFile(join(artifacts, "next.log"), output); }
