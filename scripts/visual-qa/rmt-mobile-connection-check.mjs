import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { mobileConnectionCheck } from "./export-mobile-connection-check.mjs";

assert.throws(() => mobileConnectionCheck("http://example.test/connection.html"));
assert.throws(() => mobileConnectionCheck("https://example.test/connection.html?copy=1"));
const url = "https://rmt-review.example.test/connection.html";
const html = mobileConnectionCheck(url);
const payer = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const calls = [];
let account = "0x0000000000000000000000000000000000000001", chain = "0x1237";
let denied = false;

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage(devices["iPhone 13"]);
    await page.route("**/*", (route) => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
    await page.exposeFunction("checkWalletRead", (method) => {
      calls.push(method);
      assert.ok(["eth_requestAccounts", "eth_accounts", "eth_chainId"].includes(method), "Connection probe called a write or signing method");
      if (method === "eth_requestAccounts" && denied) return { denied: true };
      return { value: method === "eth_chainId" ? chain : [account] };
    });
    await page.addInitScript(() => {
      const listeners = new Map();
      window.ethereum = {
        on: (event, listener) => { listeners.set(event, listener); },
        request: async ({ method }) => {
          const result = await window.checkWalletRead(method);
          if (result.denied) throw Object.assign(new Error("Declined"), { code: 4001 });
          return result.value;
        },
      };
      window.walletChanged = () => listeners.get("chainChanged")();
    });
    const check = page.getByRole("button", { name: "Check connection" });
    const status = (text) => page.getByRole("status").getByText(text).waitFor();
    const callCount = calls.length;
    await page.goto("https://rmt-review.example.test/copied.html");
    assert.equal(await check.isEnabled(), false);
    await page.goto(url);
    await check.waitFor();
    assert.equal(calls.length, callCount, "No automatic provider requests on page load");
    account = "0x0000000000000000000000000000000000000001";
    chain = "0x1237";
    await check.click();
    await status("Select the proposed deployment account and try again.");
    account = payer;
    chain = "0x7a69";
    await check.click();
    await status("Select Robinhood Chain 4663 in the wallet and try again.");
    chain = "0x1237";
    denied = true;
    await check.click();
    await status("Wallet connection declined or unavailable.");
    denied = false;
    await check.click();
    await status("Connection verified locally for the proposed account on Robinhood Chain 4663.");
    if (process.env.RMT_WEBSITE_PREVIEW_ARTIFACTS) {
      await page.screenshot({ path: join(process.env.RMT_WEBSITE_PREVIEW_ARTIFACTS, "iphone-connection-" + name + ".png") });
    }
    await page.evaluate(() => window.walletChanged());
    await status("Wallet selection changed. Check the connection again.");
    assert.deepEqual(calls.slice(callCount), [
      "eth_requestAccounts", "eth_accounts", "eth_chainId",
      "eth_requestAccounts", "eth_accounts", "eth_chainId",
      "eth_requestAccounts",
      "eth_requestAccounts", "eth_accounts", "eth_chainId",
    ]);
  } finally {
    await browser.close();
  }
  console.log("Connection-only HTTPS fixture passed on " + name);
}
