import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const expectedAccount = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const expectedChain = "0x1237";
const expectedDelegate = "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b";
const expectedRuntimeSha256 = "c921aae598d4413e7e93d9b69cfce4043c59687bd988c31a41d56fd45094be90";
const previewLifetime = 72 * 60 * 60 * 1000;

export function mobileConnectionCheck(endpoint, { runtimeSha256, runtimeByteLength, expiresAt = Date.now() + previewLifetime } = {}) {
  const url = new URL(endpoint);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
    && /^[a-z0-9.-]+$/i.test(url.hostname) && (url.pathname === "/" || /^\/[a-z0-9/_-]+\.html$/i.test(url.pathname)),
  "Supply the exact approved HTTPS site root or a plain .html path");
  assert.ok(Number.isSafeInteger(expiresAt) && expiresAt <= Date.now() + previewLifetime, "Preview lifetime is at most 72 hours");
  const testRuntime = runtimeSha256 !== undefined || runtimeByteLength !== undefined;
  assert.ok(!testRuntime || (url.hostname.endsWith(".test") && typeof runtimeSha256 === "string" && /^[0-9a-f]{64}$/.test(runtimeSha256)
    && Number.isSafeInteger(runtimeByteLength) && runtimeByteLength > 0 && runtimeByteLength <= 24576), "Runtime overrides are test-only");
  const byteLength = runtimeByteLength ?? 11185;
  const script = `
const status = document.querySelector("#status");
const button = document.querySelector("#connect");
const expiresAt = ${expiresAt};
const expectedAccount = ${JSON.stringify(expectedAccount.toLowerCase())};
const expectedChain = ${JSON.stringify(expectedChain)};
const expectedDelegate = ${JSON.stringify(expectedDelegate)};
const designator = "0xef0100" + expectedDelegate.slice(2);
const unavailable = "Wallet code or block evidence is unavailable. Check again with Robinhood Chain selected.";
const accountMatches = (accounts) => Array.isArray(accounts) && typeof accounts[0] === "string"
  && accounts[0].toLowerCase() === expectedAccount;
const chainMatches = (chain) => typeof chain === "string" && chain.toLowerCase() === expectedChain;
const isQuantity = (value) => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i.test(value);
const isCurrentBlock = (block) => block && isQuantity(block.number) && /^0x[0-9a-f]{64}$/i.test(block.hash)
  && isQuantity(block.timestamp) && Math.abs(Date.now() / 1000 - Number(BigInt(block.timestamp))) <= 180;
const expired = () => {
  if (Date.now() < expiresAt) return false;
  button.disabled = true;
  status.textContent = "This temporary connection check has expired.";
  return true;
};
if (!window.isSecureContext || window.top !== window || location.href !== ${JSON.stringify(url.href)}) {
  status.textContent = "Open the exact approved HTTPS address in the wallet browser.";
} else if (!expired()) {
  button.disabled = false;
  status.textContent = "Ready for a connection-only check.";
  let revision = 0;
  const observed = new WeakSet();
  const clear = () => {
    revision++;
    if (!expired()) status.textContent = "Wallet selection changed. Check the connection again.";
  };
  button.onclick = async () => {
    if (expired()) return;
    const provider = window.ethereum;
    if (!provider || typeof provider.request !== "function" || typeof provider.on !== "function" || !crypto.subtle) {
      status.textContent = "No compatible injected wallet found. Open this page inside the wallet browser.";
      return;
    }
    if (!observed.has(provider)) {
      for (const event of ["accountsChanged", "chainChanged", "disconnect"]) provider.on(event, clear);
      observed.add(provider);
    }
    button.disabled = true;
    let checked = ++revision;
    let permitted = false;
    status.textContent = "Waiting for wallet connection.";
    const request = provider.request;
    const bound = () => revision === checked && provider === window.ethereum && request === provider.request;
    const read = (method, params) => {
      if (expired() || !bound()) throw new Error("Wallet selection changed");
      return request.call(provider, { method, ...(params && { params }) });
    };
    try {
      await read("eth_requestAccounts");
      // Provider events during the permission dialog are expected. Bind the result to this read.
      permitted = true;
      checked = revision;
      const accounts = await read("eth_accounts");
      const chain = await read("eth_chainId");
      if (!bound()) return clear();
      if (!accountMatches(accounts)) {
        status.textContent = "Select the proposed deployment account and try again.";
        return;
      }
      if (!chainMatches(chain)) {
        status.textContent = "Select Robinhood Chain 4663 in the wallet and try again.";
        return;
      }
      status.textContent = "Checking the account's delegation through your wallet.";
      const block = await read("eth_getBlockByNumber", ["latest", false]);
      if (!isCurrentBlock(block)) throw new Error("Current block unavailable");
      const accountCode = await read("eth_getCode", [expectedAccount, block.number]);
      const delegateCode = await read("eth_getCode", [expectedDelegate, block.number]);
      const canonical = await read("eth_getBlockByNumber", [block.number, false]);
      const finalAccounts = await read("eth_accounts");
      const finalChain = await read("eth_chainId");
      if (!bound() || !accountMatches(finalAccounts) || !chainMatches(finalChain)) return clear();
      if (!isCurrentBlock(canonical) || canonical.hash !== block.hash || canonical.number !== block.number) throw new Error("Block changed");
      if (typeof accountCode !== "string" || accountCode.length > 49154 || !/^0x(?:[0-9a-f]{2})*$/i.test(accountCode)) throw new Error("Account code unavailable");
      if (accountCode.toLowerCase() !== designator) {
        status.textContent = "The wallet's current delegation does not match the expected MetaMask delegate.";
        return;
      }
      if (typeof delegateCode !== "string" || delegateCode.length > 49154 || !/^0x(?:[0-9a-f]{2})*$/i.test(delegateCode)) throw new Error("Delegate code unavailable");
      let hash = "";
      if (delegateCode.length === 2 + ${byteLength} * 2) {
        const bytes = Uint8Array.from(delegateCode.slice(2).match(/../g), (byte) => Number.parseInt(byte, 16));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      if (expired()) return;
      if (!bound()) return clear();
      if (hash !== ${JSON.stringify(runtimeSha256 ?? expectedRuntimeSha256)}) {
        status.textContent = "The MetaMask delegate runtime did not match the reviewed Robinhood Chain code.";
        return;
      }
      status.textContent = "Connection verified locally for the proposed account on Robinhood Chain 4663. The expected delegation and runtime matched at block " + BigInt(block.number).toString() + ".";
    } catch {
      if (expired()) return;
      if (!bound()) return clear();
      status.textContent = permitted ? unavailable : "Wallet connection declined or unavailable.";
    } finally {
      if (!expired()) button.disabled = false;
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
<body><main><h1>Wallet connection check</h1><p>Select the proposed account on Robinhood Chain 4663. The checker reads the account, network and current delegation through your wallet.</p>
<p>Connecting shares your public address with this page, which does not upload it. The check requires no signature, gas, spending approval, delegation authorization or transaction.</p>
<button id="connect" disabled>Check connection</button>
<p class="status" id="status" role="status" aria-live="polite">Checking the review origin.</p>
<small>Temporary preview through <time datetime="${new Date(expiresAt).toISOString()}">${new Date(expiresAt).toISOString().replace("T", " ").slice(0, 16)} UTC</time> · BLOCKED_NO_BROADCAST</small></main><script>${script}</script></body></html>
`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { url: { type: "string" }, output: { type: "string" }, expires: { type: "string" } } });
  assert.ok(values.url && values.output, "Supply --url and a fresh --output file");
  writeFileSync(values.output, mobileConnectionCheck(values.url, { ...(values.expires && { expiresAt: Date.parse(values.expires) }) }),
    { encoding: "utf8", flag: "wx" });
}
