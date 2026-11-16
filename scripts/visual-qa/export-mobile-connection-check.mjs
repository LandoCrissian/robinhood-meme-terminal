import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const expectedAccount = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const expectedChain = "0x1237";

export function mobileConnectionCheck(endpoint) {
  const url = new URL(endpoint);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
    && /^[a-z0-9.-]+$/i.test(url.hostname) && /^\/[a-z0-9/_-]+\.html$/i.test(url.pathname),
  "Supply the exact approved HTTPS page URL with a plain .html path");
  const script = `
const status = document.querySelector("#status");
const button = document.querySelector("#connect");
if (!window.isSecureContext || window.top !== window || location.href !== ${JSON.stringify(url.href)}) {
  status.textContent = "Open the exact approved HTTPS address in the wallet browser.";
} else {
  button.disabled = false;
  let revision = 0;
  const observed = new WeakSet();
  const clear = () => {
    revision++;
    status.textContent = "Wallet selection changed. Check the connection again.";
  };
  button.onclick = async () => {
    const provider = window.ethereum;
    if (!provider || typeof provider.request !== "function" || typeof provider.on !== "function") {
      status.textContent = "No compatible injected wallet found. Open this page inside the wallet browser.";
      return;
    }
    if (!observed.has(provider)) {
      for (const event of ["accountsChanged", "chainChanged", "disconnect"]) provider.on(event, clear);
      observed.add(provider);
    }
    button.disabled = true;
    const current = ++revision;
    status.textContent = "Waiting for wallet connection.";
    const request = provider.request;
    try {
      await request.call(provider, { method: "eth_requestAccounts" });
      // Provider events during the permission dialog are expected. Bind the result to this read.
      const checked = revision;
      const accounts = await request.call(provider, { method: "eth_accounts" });
      const chain = await request.call(provider, { method: "eth_chainId" });
      if (revision !== checked || provider !== window.ethereum || request !== provider.request) return clear();
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== ${JSON.stringify(expectedAccount.toLowerCase())}) {
        status.textContent = "Select the proposed deployment account and try again.";
      } else if (typeof chain !== "string" || chain.toLowerCase() !== ${JSON.stringify(expectedChain)}) {
        status.textContent = "Select Robinhood Chain 4663 in the wallet and try again.";
      } else {
        status.textContent = "Connection verified locally for the proposed account on Robinhood Chain 4663.";
      }
    } catch {
      if (current === revision) status.textContent = "Wallet connection declined or unavailable.";
    } finally {
      button.disabled = false;
    }
  };
}
`.trim();
  const style = "html{color-scheme:dark}body{margin:0;background:#0a0e0b;color:#eef4ee;font:1rem/1.5 system-ui,sans-serif}main{max-width:36rem;margin:3rem auto;padding:0 1.25rem}button{background:#2bdf4b;color:#071009;border:0;border-radius:.5rem;padding:.8rem 1rem;font:inherit;font-weight:700}button:disabled{opacity:.55}.status{padding:.85rem 0;overflow-wrap:anywhere}";
  const sha = (value) => createHash("sha256").update(value).digest("base64");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${sha(script)}'; style-src 'sha256-${sha(style)}'; base-uri 'none'; form-action 'none'">
<title>RMT Launch wallet connection check</title><style>${style}</style></head>
<body><main><h1>Wallet connection check</h1><p>Connect the proposed account on Robinhood Chain 4663. This page only checks the selected account and network.</p>
<button id="connect" disabled>Check connection</button>
<p class="status" id="status" role="status">Checking the review origin.</p></main><script>${script}</script></body></html>
`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { url: { type: "string" }, output: { type: "string" } } });
  assert.ok(values.url && values.output, "Supply --url and a fresh --output file");
  writeFileSync(values.output, mobileConnectionCheck(values.url), { encoding: "utf8", flag: "wx" });
}
