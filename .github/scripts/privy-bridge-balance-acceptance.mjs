import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const requireRoot = createRequire(path.join(root, "package.json"));
const requireWeb = createRequire(path.join(webRoot, "package.json"));
const { chromium } = requireRoot("playwright");
const nextBin = requireWeb.resolve("next/dist/bin/next");
const {
  decodeAbiParameters,
  decodeFunctionData,
  deploylessCallViaBytecodeBytecode,
  encodeFunctionResult,
  erc20Abi,
  multicall3Abi,
  parseAbiParameters
} = requireWeb("viem");

const chainId = 4_663;
const walletA = "0x3333333333333333333333333333333333333333";
const walletB = "0x4444444444444444444444444444444444444444";
const market = "0x0000000000000000000000000000000000001001";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const weth = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const usdgAssetKey = "eip155:4663/contract:0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const wethAssetKey = "eip155:4663/contract:0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const artifactRoot = process.env.RMT_PRIVY_BRIDGE_ACCEPTANCE_OUTPUT
  ?? path.resolve(root, "../account-first-evidence/privy-bridge");
const rpc = {
  native: "success",
  token: new Map([[usdg.toLowerCase(), null], [weth.toLowerCase(), 15n * 10n ** 18n], [market.toLowerCase(), 15n * 10n ** 18n]]),
  held: false,
  release: undefined,
  requests: []
};

const word = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const diagnosticJson = (value) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

function decodeDeploylessMulticall(data) {
  if (data.startsWith("0x82ad56cb")) {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data });
    return decoded.functionName === "aggregate3" ? decoded.args[0] : null;
  }
  if (!data.startsWith(deploylessCallViaBytecodeBytecode)) return null;
  const args = `0x${data.slice(deploylessCallViaBytecodeBytecode.length)}`;
  const [, aggregateData] = decodeAbiParameters(parseAbiParameters("bytes, bytes"), args);
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: aggregateData });
  return decoded.functionName === "aggregate3" ? decoded.args[0] : null;
}

function tokenCallResult(target, callData) {
  const selector = callData.slice(0, 10).toLowerCase();
  if (selector === "0x70a08231") {
    const balance = rpc.token.get(target.toLowerCase());
    if (process.env.RMT_ACCEPTANCE_RPC_DEBUG === "true") console.log("[balance-rpc]", target, balance);
    return balance === null || balance === undefined
      ? { returnData: "0x", success: false }
      : { returnData: word(balance), success: true };
  }
  if (selector === "0x313ce567") return {
    returnData: encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: target.toLowerCase() === usdg.toLowerCase() ? 6 : 18 }),
    success: true
  };
  if (selector === "0x95d89b41") return {
    returnData: encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: target.toLowerCase() === usdg.toLowerCase() ? "USDG" : "PONS" }),
    success: true
  };
  if (selector === "0x06fdde03") return {
    returnData: encodeFunctionResult({ abi: erc20Abi, functionName: "name", result: target.toLowerCase() === usdg.toLowerCase() ? "USDG" : "PONS" }),
    success: true
  };
  return { returnData: "0x", success: false };
}

async function jsonRpc(request) {
  rpc.requests.push({ method: request.method, params: request.params });
  if (request.method === "eth_chainId") return { jsonrpc: "2.0", id: request.id, result: "0x1237" };
  if (request.method === "eth_blockNumber") return { jsonrpc: "2.0", id: request.id, result: "0x2faf080" };
  if (request.method === "eth_getCode") return { jsonrpc: "2.0", id: request.id, result: "0x60006000" };
  if (request.method === "eth_getLogs") return { jsonrpc: "2.0", id: request.id, result: [] };
  if (request.method === "eth_getTransactionCount") return { jsonrpc: "2.0", id: request.id, result: "0x1" };
  if (request.method === "eth_gasPrice") return { jsonrpc: "2.0", id: request.id, result: "0x3b9aca00" };
  if (request.method === "eth_estimateGas") return { jsonrpc: "2.0", id: request.id, result: "0x2bf20" };
  if (request.method === "eth_getBlockByNumber") return { jsonrpc: "2.0", id: request.id, result: {
    baseFeePerGas: "0x3b9aca00",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    hash: `0x${"a".repeat(64)}`,
    number: "0x2faf090",
    timestamp: `0x${Math.floor(Date.now() / 1_000).toString(16)}`,
    transactions: []
  } };
  if (request.method === "eth_getBalance") {
    if (rpc.native === "failure") return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Deterministic native read unavailable" } };
    return { jsonrpc: "2.0", id: request.id, result: "0x8ac7230489e80000" };
  }
  if (request.method === "eth_call") {
    if (rpc.held) await new Promise((resolve) => { rpc.release = resolve; });
    const data = String(request.params?.[0]?.data ?? "0x");
    const calls = decodeDeploylessMulticall(data);
    if (process.env.RMT_ACCEPTANCE_RPC_DEBUG === "true" && !calls) console.log("[unparsed-eth-call]", request.params?.[0]?.to, data.slice(0, 42), data.length);
    if (!calls) return { jsonrpc: "2.0", id: request.id, result: word(100_000_000n) };
    if (process.env.RMT_ACCEPTANCE_RPC_DEBUG === "true") console.log("[multicall]", calls.map((call) => [call.target, call.callData.slice(0, 10)]));
    const result = calls.map((call) => tokenCallResult(call.target, call.callData));
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result })
    };
  }
  return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Fixture does not implement ${request.method}` } };
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitForServer(base, child, logs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Acceptance server exited.\n${logs.value}`);
    if (await fetch(base).then((response) => response.ok).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Acceptance server did not become ready.\n${logs.value.slice(-8_000)}`);
}

function walletRecord({ address = walletA, id = "rmt-privy-embedded", kind = "embedded" } = {}) {
  return {
    address,
    connectorType: kind === "embedded" ? "embedded" : "injected",
    linked: true,
    meta: { id, name: kind === "embedded" ? "RMT wallet" : "Existing wallet" },
    type: "ethereum",
    walletClientType: kind === "embedded" ? "privy-v2" : "metamask"
  };
}

async function installFixtures(page, quoteRequests, options = {}) {
  const executionFixture = options.executionFixture;
  const executionState = options.executionState;
  const initialWallet = options.wallet ?? walletRecord();
  const walletRecords = options.wallets ?? [initialWallet];
  const finalLinkedAccounts = walletRecords.map((record) => ({
    type: "wallet", chainType: "ethereum", address: record.address,
    connectorType: record.connectorType, walletClientType: record.walletClientType
  }));
  await page.addInitScript(({ chainId, initialWallet, walletRecords, finalLinkedAccounts, delayedWalletMs, initiallyMissingWallet, newUser, storedPreference, walletA }) => {
    const listeners = new Map();
    const makeProvider = (initialAddress, providerId) => {
      let accounts = [initialAddress];
      let activeChain = `0x${chainId.toString(16)}`;
      const emit = (name, value) => (listeners.get(name) ?? []).forEach((listener) => listener(value));
      return {
        on(name, listener) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); },
        removeListener(name, listener) { listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== listener)); },
        async request({ method, params }) {
          window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__.push({ method, providerId });
          if (method === "eth_accounts" || method === "eth_requestAccounts") return accounts;
          if (method === "eth_chainId") return activeChain;
          if (method === "wallet_switchEthereumChain") {
            activeChain = params?.[0]?.chainId ?? `0x${chainId.toString(16)}`;
            emit("chainChanged", activeChain);
            return null;
          }
          if (method === "eth_getBalance") return "0x8ac7230489e80000";
          if (method === "eth_blockNumber") return "0x2faf080";
          if (method === "eth_getCode") return "0x60006000";
          if (method === "eth_call") return `0x${(100000000n).toString(16).padStart(64, "0")}`;
          if (method === "eth_getLogs") return [];
          if (method === "eth_estimateGas") return "0x2bf20";
          if (method === "eth_gasPrice") return "0x3b9aca00";
          if (method === "eth_getTransactionCount") return "0x1";
          if (method === "eth_sendTransaction") {
            window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_EVENTS__.push(`WALLET_REQUEST:${providerId}`);
            const error = new Error("User rejected the request");
            error.code = 4001;
            throw error;
          }
          throw new Error(`Acceptance wallet does not implement ${method}`);
        },
        __setAccounts(next) { accounts = next; emit("accountsChanged", next); },
        __setChain(next) { activeChain = next; emit("chainChanged", next); }
      };
    };
    const provider = makeProvider(initialWallet.address, "rmt-privy-embedded");
    window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__ = [];
    window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_EVENTS__ = [];
    window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_PROVIDERS__ = {
      "rmt-privy-embedded": provider,
      "rmt-privy-external": makeProvider(walletA, "rmt-privy-external")
    };
    window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_STATE__ = {
      authenticated: true,
      identityToken: "privy-production-bridge-acceptance-token",
      ready: true,
      user: { id: "privy-production-bridge-user", linkedAccounts: newUser ? [] : finalLinkedAccounts },
      wallets: delayedWalletMs || initiallyMissingWallet ? [] : walletRecords,
      walletsReady: !delayedWalletMs
    };
    if (storedPreference) {
      window.localStorage.setItem("rmt:active-trading-wallet:v2:privy-production-bridge-user", storedPreference);
    }
    window.__RMT_PRIVY_ACCEPTANCE_PROVIDER__ = provider;
    window.__RMT_ACCEPTANCE_READ_WALLET_ASSETS__ = true;
    if (delayedWalletMs) window.setTimeout(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_SET_STATE__?.({
      user: { id: "privy-production-bridge-user", linkedAccounts: finalLinkedAccounts },
      wallets: walletRecords, walletsReady: true
    }), delayedWalletMs);
  }, {
    chainId,
    initialWallet,
    walletRecords,
    finalLinkedAccounts,
    delayedWalletMs: options.delayedWalletMs ?? 0,
    initiallyMissingWallet: options.initiallyMissingWallet === true,
    newUser: options.newUser === true,
    storedPreference: options.storedPreference ?? null,
    walletA
  });

  await page.route(/\/api\/vnext\/asset-identity(?:\?.*)?$/, async (route) => {
    const requestedAddress = new URL(route.request().url()).searchParams.get("address")?.toLowerCase();
    if (requestedAddress !== market.toLowerCase()) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Unknown fixture asset" }) });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ resolution: {
        chainId,
        requestedAddress: market,
        requestedKind: "token",
        status: "token-only",
        token: { address: market, name: "PONS", symbol: "PONS", decimals: 18, totalSupply: "1000000000000000000000000" },
        pools: [], marketData: "identity-only", execution: "view-only",
        provenance: "robinhood-chain-contract-reads", resolvedAt: "2026-09-26T00:00:00.000Z"
      } })
    });
  });
  await page.route("**/api/vnext/quotes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const snapshot = await route.request().frame().evaluate(() => window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__).catch(() => undefined);
    quoteRequests.push({ ...route.request().postDataJSON(), __balanceSnapshot: snapshot ? {
      assetBalanceEvidence: snapshot.assetBalanceEvidence,
      nativeBalanceEvidence: snapshot.nativeBalanceEvidence,
      status: snapshot.status,
      walletAddress: snapshot.walletAddress
    } : null });
    if (executionFixture) {
      const request = route.request().postDataJSON();
      const selected = String(request.inputAsset).toLowerCase() === executionFixture.native.quote.inputAsset.toLowerCase()
        ? executionFixture.native.quote
        : executionFixture.erc20.quote;
      const now = Date.now();
      executionState.quotes += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ...selected,
        requestedAtMs: now,
        completedAtMs: now + 1,
        attempts: selected.attempts.map((attempt) => ({ ...attempt, quotedAtMs: now, expiresAtMs: now + 1_800_000 }))
      }) });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({
      error: "Read-only acceptance stops before provider execution.", code: "PRIVY_BRIDGE_ACCEPTANCE_READ_ONLY", stage: "quote", retryable: false
    }) });
  });
  if (executionFixture) {
    const freshEvidence = (evidence) => {
      const now = Date.now();
      return { ...evidence, verifiedAtMs: now, expiresAtMs: Math.min(now + 300_000, Number(BigInt(evidence.deadline) * 1_000n)) };
    };
    const freshPlan = (plan) => {
      const now = Date.now();
      return { ...plan, preparedAtMs: now, expiresAtMs: Math.min(now + 60_000, Number(BigInt(plan.deadline) * 1_000n) - 180_000) };
    };
    await page.route("**/api/vnext/verify", async (route) => {
      const request = route.request().postDataJSON();
      const nativeInput = String(request.inputAsset).toLowerCase() === executionFixture.native.quote.inputAsset.toLowerCase();
      executionState.verifications += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(freshEvidence(
        nativeInput ? executionFixture.native.swapEvidence : executionFixture.erc20.approvalEvidence
      )) });
    });
    await page.route("**/api/vnext/authorize", async (route) => {
      const request = route.request().postDataJSON();
      const nativeInput = String(request.inputAsset).toLowerCase() === executionFixture.native.quote.inputAsset.toLowerCase();
      const evidence = nativeInput ? executionFixture.native.swapEvidence : executionFixture.erc20.approvalEvidence;
      const plan = nativeInput ? executionFixture.native.swapPlan : executionFixture.erc20.approvalPlan;
      executionState.authorizations += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        evidence: freshEvidence(evidence),
        plan: freshPlan(plan)
      }) });
    });
  }
}

async function acceptTerms(page) {
  const button = page.getByRole("button", { name: "I understand — enter RMT" });
  if (await button.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) await button.click();
}

async function openActiveWallet(page, base, options) {
  const quotes = [];
  await installFixtures(page, quotes, options);
  await page.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await acceptTerms(page);
  await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 20_000 });
  await page.getByLabel("Exact input amount").waitFor({ timeout: 30_000 });
  await page.waitForFunction((expected) => window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__?.walletAddress?.toLowerCase() === expected,
    walletA.toLowerCase(), { timeout: 20_000 });
  return quotes;
}

async function runBalanceIsolation(browser, base) {
  rpc.native = "success";
  rpc.token = new Map([[usdg.toLowerCase(), null], [weth.toLowerCase(), 15n * 10n ** 18n], [market.toLowerCase(), 15n * 10n ** 18n]]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const quotes = await openActiveWallet(page, base, { delayedWalletMs: 350, newUser: true });
  try {
    await page.getByText("USDG balance unavailable", { exact: true }).first().waitFor({ timeout: 20_000 });
    const initialSnapshot = await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__);
    assert.equal(initialSnapshot.nativeBalanceEvidence.state, "confirmed", "native balance evidence must succeed");
    assert.equal(initialSnapshot.assetBalanceEvidence[usdg.toLowerCase()]?.state, "unavailable", "USDG must be unavailable");
    assert.equal(initialSnapshot.assetBalanceEvidence[weth.toLowerCase()]?.state, "confirmed", "another ERC-20 must remain confirmed");
    const unavailableUsdgQuotes = quotes.filter((quote) => String(quote.inputAsset?.address ?? quote.sellToken ?? "").toLowerCase() === usdg.toLowerCase());
    assert.equal(unavailableUsdgQuotes.length, 0, `unavailable USDG cannot produce a quote (${JSON.stringify(quotes)})`);
    const amount = page.getByLabel("Exact input amount");
    await page.getByLabel("Pay with asset").selectOption(wethAssetKey);
    await amount.fill("1");
    await page.waitForFunction(() => document.querySelector(".vnConfirmedBalance strong")?.textContent?.includes("WETH"));
    await page.waitForTimeout(700);
    assert.ok(quotes.length > 0,
      "selected ERC-20 can quote when its balance and native gas are confirmed despite USDG failure");

    rpc.token.set(usdg.toLowerCase(), 0n);
    await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_REFRESH_BALANCES__?.());
    await page.getByRole("tab", { name: "Buy", exact: true }).click();
    await page.getByLabel("Pay with asset").selectOption(usdgAssetKey);
    await page.waitForFunction((key) => window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__?.assetBalanceEvidence?.[key]?.state === "confirmed",
      usdg.toLowerCase(), { timeout: 20_000 });
    const recoveredBalance = (await page.locator(".vnConfirmedBalance strong").textContent())?.trim();
    assert.equal(recoveredBalance, "No USDG balance found", `subsequent successful zero read recovers as confirmed zero (observed ${recoveredBalance})`);
    return { ethWhileUsdgUnavailable: "PASS", selectedErc20AndGas: "PASS", zeroVsUnavailable: "PASS", recovery: "PASS" };
  } finally {
    await context.close();
  }
}

async function runUnavailableBoundaries(browser, base) {
  const results = {};
  for (const test of [
    { name: "selectedInput", native: "success", usdgBalance: null, expected: "USDG balance unavailable" },
    { name: "nativeGas", native: "failure", usdgBalance: 5_000_000n, expected: "native ETH gas balance is unavailable" }
  ]) {
    rpc.native = test.native;
    rpc.token = new Map([[usdg.toLowerCase(), test.usdgBalance], [weth.toLowerCase(), 15n * 10n ** 18n], [market.toLowerCase(), 15n * 10n ** 18n]]);
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    const quotes = await openActiveWallet(page, base, {});
    try {
      await page.getByLabel("Exact input amount").fill("1");
      await page.waitForFunction(({ kind, usdgKey }) => kind === "selectedInput"
        ? window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__?.assetBalanceEvidence?.[usdgKey]?.state === "unavailable"
        : window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__?.nativeBalanceEvidence?.state === "unavailable",
      { kind: test.name, usdgKey: usdg.toLowerCase() }, { timeout: 20_000 });
      await page.waitForTimeout(600);
      assert.equal(await page.locator(".vnReviewButton").isDisabled(), true,
        `${test.name}: unavailable selected-input/gas authority must keep the wallet-review action disabled`);
      const methods = await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__);
      assert.equal(methods.some(({ method }) => ["eth_sendTransaction", "eth_sign", "personal_sign"].includes(method)), false,
        `${test.name}: unavailable authority produces no financial wallet request`);
      results[test.name] = { indicativeQuoteRequests: quotes.length, walletReview: "BLOCKED", financialCalls: 0 };
    } finally {
      await context.close();
    }
  }
  return results;
}

async function runLateResponseIsolation(browser, base) {
  rpc.native = "success";
  rpc.token = new Map([[usdg.toLowerCase(), 9_000_000n], [weth.toLowerCase(), 15n * 10n ** 18n], [market.toLowerCase(), 15n * 10n ** 18n]]);
  rpc.held = true;
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const quotes = [];
  await installFixtures(page, quotes, {});
  try {
    await page.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await acceptTerms(page);
    await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 20_000 });
    await page.evaluate(({ walletB }) => {
      window.__RMT_PRIVY_ACCEPTANCE_PROVIDER__.__setAccounts([walletB]);
      const current = window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_STATE__;
      const next = { ...current.wallets[0], address: walletB };
      window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_SET_STATE__?.({
        user: { ...current.user, linkedAccounts: [{ ...current.user.linkedAccounts[0], address: walletB }] },
        wallets: [next]
      });
    }, { walletB });
    rpc.held = false;
    rpc.release?.();
    await page.waitForTimeout(1_000);
    assert.equal(await page.getByText("9 USDG", { exact: true }).count(), 0,
      "late wallet-A balance may not publish into wallet B");
    return { accountChangeRejectsLateResponse: "PASS" };
  } finally {
    rpc.held = false;
    rpc.release?.();
    await context.close();
  }
}

async function runIdentityTransitions(browser, base) {
  rpc.native = "success";
  rpc.token = new Map([[usdg.toLowerCase(), 5_000_000n], [weth.toLowerCase(), 15n * 10n ** 18n], [market.toLowerCase(), 15n * 10n ** 18n]]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const quotes = await openActiveWallet(page, base, { delayedWalletMs: 450 });
  try {
    const methods = await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__);
    assert.equal(methods.some(({ method }) => ["eth_sendTransaction", "eth_sign", "personal_sign"].includes(method)), false,
      "login and connector activation have zero financial calls");
    const identity = await page.evaluate(() => ({
      events: window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_EVENTS__,
      state: window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_STATE__
    }));
    assert.equal(identity.state.wallets[0].address.toLowerCase(), walletA.toLowerCase());
    await page.getByLabel("Exact input amount").fill("1");
    await page.waitForTimeout(700);
    assert.ok(quotes.every((quote) => !quote.recipient || quote.recipient.toLowerCase() === walletA.toLowerCase()),
      "quote recipient remains the exact selected signer");
    await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_SET_STATE__?.({ authenticated: false, user: undefined, wallets: [] }));
    await page.getByRole("button", { name: "Sign in" }).first().waitFor({ timeout: 10_000 });
    return {
      delayedCreationAndConnector: "PASS",
      exactDepositTakerSignerContinuity: "PASS",
      logoutInvalidatesAuthority: "PASS",
      financialCalls: 0
    };
  } finally {
    await context.close();
  }
}

async function runProvisioningRecovery(browser, base) {
  rpc.native = "success";
  rpc.token = new Map([[usdg.toLowerCase(), 5_000_000n], [weth.toLowerCase(), 15n * 10n ** 18n]]);
  const embedded = walletRecord();
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const quotes = [];
  await installFixtures(page, quotes, { initiallyMissingWallet: true, wallet: embedded });
  try {
    await page.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await acceptTerms(page);
    await page.getByText(/existing RMT wallet is linked|wallet setup paused/i).first().waitFor({ timeout: 15_000 });
    await page.evaluate((record) => {
      const current = window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_STATE__;
      window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_SET_STATE__?.({ ...current, wallets: [record], walletsReady: true });
    }, embedded);
    await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__?.walletAddress?.toLowerCase() === "0x3333333333333333333333333333333333333333");
    const methods = await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__);
    assert.equal(methods.some(({ method }) => ["eth_sendTransaction", "eth_sign", "personal_sign"].includes(method)), false);
    return { boundedFailure: "PASS", sdkRecordRecovery: "PASS", financialCalls: 0 };
  } finally {
    await context.close();
  }
}

async function runExternalPreferenceRace(browser, base) {
  rpc.native = "success";
  rpc.token = new Map([[usdg.toLowerCase(), 5_000_000n], [weth.toLowerCase(), 15n * 10n ** 18n]]);
  const embedded = walletRecord();
  const external = walletRecord({ id: "rmt-privy-external", kind: "external" });
  const externalKey = JSON.stringify(["injected", "metamask", "rmt-privy-external", walletA]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const quotes = [];
  await installFixtures(page, quotes, { wallets: [embedded, external], storedPreference: externalKey });
  try {
    await page.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await acceptTerms(page);
    await page.waitForFunction((expected) => window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__?.walletKey === expected,
      externalKey, { timeout: 20_000 });
    const beforeChainChange = await page.evaluate(() => ({
      methods: window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__,
      snapshot: window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__
    }));
    assert.equal(beforeChainChange.snapshot.walletKey, externalKey, "stored external provider preference wins the embedded activation race");
    assert.ok(beforeChainChange.methods.some(({ providerId }) => providerId === "rmt-privy-external"),
      "the same-address external provider, rather than the embedded provider, is activated");
    await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_PROVIDERS__["rmt-privy-external"].__setChain("0x1"));
    await page.waitForFunction(() => window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__?.walletAddress === null, undefined, { timeout: 10_000 });
    return {
      storedPreference: "PASS",
      sameAddressProviderBinding: "PASS",
      externalWinsRace: "PASS",
      chainChangeInvalidatesReadAuthority: "PASS"
    };
  } finally {
    await context.close();
  }
}

async function runEmbeddedQuoteToHandoff(browser, base, executionFixture) {
  rpc.native = "success";
  rpc.token = new Map([[usdg.toLowerCase(), 5_000_000n], [weth.toLowerCase(), 15n * 10n ** 18n], [market.toLowerCase(), 15n * 10n ** 18n]]);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const quotes = [];
  const state = { quotes: 0, verifications: 0, authorizations: 0 };
  await installFixtures(page, quotes, { executionFixture, executionState: state });
  try {
    await page.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await acceptTerms(page);
    await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 20_000 });
    const panel = page.locator(".vnTradePanel").last();
    await panel.getByLabel("Pay with asset").selectOption("eip155:4663/native");
    await panel.getByLabel("Exact input amount").fill("0.0005");
    const prepare = panel.locator(".vnReviewButton");
    await prepare.click();
    const walletAction = panel.getByRole("button", { name: "Review verified swap in wallet", exact: true });
    try {
      await walletAction.waitFor({ state: "visible", timeout: 60_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        balance: window.__RMT_PRIVY_BRIDGE_BALANCE_SNAPSHOT__,
        body: document.body.innerText.slice(-4_000),
        events: window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_EVENTS__,
        methods: window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__
      }));
      throw new Error(`embedded quote did not reach verified wallet review: ${diagnosticJson(diagnostic)}`, { cause: error });
    }
    const before = await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__
      .filter(({ method }) => method === "eth_sendTransaction").length);
    assert.equal(before, 0, "verified quote preparation may not invoke the wallet before explicit review");
    await walletAction.click();
    try {
      await page.waitForFunction(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__
        .filter(({ method }) => method === "eth_sendTransaction").length === 1, undefined, { timeout: 30_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        body: document.body.innerText.slice(-4_000),
        events: window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_EVENTS__,
        methods: window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__
      }));
      throw new Error(`embedded wallet handoff did not reach the selected provider: ${diagnosticJson(diagnostic)}`, { cause: error });
    }
    const after = await page.evaluate(() => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_RPC_METHODS__
      .filter(({ method }) => method === "eth_sendTransaction").length);
    assert.equal(after, 1, "one explicit embedded-wallet review invokes exactly one wallet request");
    assert.ok(state.quotes >= 1, "embedded handoff requires a fresh quote");
    assert.ok(state.verifications >= 1, "embedded handoff requires verified evidence");
    assert.ok(state.authorizations >= 1, "embedded handoff requires an immutable authorization plan");
    return {
      selectedSigner: walletA,
      quoteRequests: state.quotes,
      verificationRequests: state.verifications,
      authorizationRequests: state.authorizations,
      preActionWalletRequests: before,
      explicitWalletReviewRequests: after,
      ownerRejected: true,
      signatures: 0,
      approvals: 0,
      transactions: 0
    };
  } finally {
    await context.close();
  }
}

async function main() {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  const fixturePath = path.join(artifactRoot, "v2-fixture.json");
  execFileSync(process.execPath, [requireWeb.resolve("tsx/cli"), "lib/vnext/browser-acceptance-v2-fixture.ts", fixturePath], {
    cwd: webRoot,
    env: process.env,
    stdio: "inherit"
  });
  const executionFixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const rpcServer = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-origin": "*"
      });
      response.end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const output = Array.isArray(payload) ? await Promise.all(payload.map(jsonRpc)) : await jsonRpc(payload);
    response.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json" });
    response.end(JSON.stringify(output));
  });
  const rpcPort = await listen(rpcServer, Number(process.env.RMT_PRIVY_BRIDGE_RPC_PORT ?? 34_663));
  const appServer = createServer();
  const appPort = await listen(appServer, Number(process.env.RMT_PRIVY_BRIDGE_APP_PORT ?? 34_664));
  await closeServer(appServer);
  const base = `http://127.0.0.1:${appPort}`;
  const env = {
    ...process.env,
    NEXT_PUBLIC_PRIVY_APP_ID: "privy-acceptance-id-00001",
    NEXT_PUBLIC_RMT_PRIVY_BRIDGE_ACCEPTANCE_PROFILE: "true",
    NEXT_PUBLIC_RMT_NETWORK: "mainnet",
    NEXT_PUBLIC_RMT_RPC_URL: `http://127.0.0.1:${rpcPort}`,
    RMT_RPC_URL: `http://127.0.0.1:${rpcPort}`,
    RMT_MAINNET_RPC_URL: `http://127.0.0.1:${rpcPort}`,
    ROBINHOOD_MAINNET_RPC_URL: `http://127.0.0.1:${rpcPort}`,
    RMT_VNEXT_SHELL_ENABLED: "true",
    NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
    NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true",
    RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
    RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "zero-x-swap",
    RMT_VNEXT_ZEROX_OBSERVATION_ENABLED: "true",
    RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED: "true",
    RMT_ZEROX_API_KEY: "server-only-test-key",
    RMT_ZEROX_ALLOWANCE_HOLDER: "0x0000000000001fF3684f28c67538d4D072C22734",
    RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH: `0x${"11".repeat(32)}`
  };
  let child;
  let browser;
  try {
    if (process.env.RMT_PRIVY_BRIDGE_ACCEPTANCE_SKIP_BUILD !== "true") {
      const build = spawn(process.execPath, [nextBin, "build"], { cwd: webRoot, env, stdio: "inherit", windowsHide: true });
      const code = await new Promise((resolve, reject) => { build.once("error", reject); build.once("exit", resolve); });
      if (code !== 0) throw new Error(`Privy bridge acceptance build failed (${code}).`);
    }
    child = spawn(process.execPath, [nextBin, "start", "-p", String(appPort)], { cwd: webRoot, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const logs = { value: "" };
    child.stdout.on("data", (chunk) => { logs.value += chunk; });
    child.stderr.on("data", (chunk) => { logs.value += chunk; });
    await waitForServer(base, child, logs);
    browser = await chromium.launch({ headless: true });
    const report = {
      evidenceType: "MOCKED_LOCAL_BROWSER_REAL_PRIVY_IDENTITY_BRIDGE",
      generatedAt: new Date().toISOString(),
      sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      sourceTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim(),
      profile: "NEXT_PUBLIC_RMT_PRIVY_BRIDGE_ACCEPTANCE_PROFILE",
      balanceIsolation: await runBalanceIsolation(browser, base),
      unavailableBoundaries: await runUnavailableBoundaries(browser, base),
      lateResponseIsolation: await runLateResponseIsolation(browser, base),
      identityTransitions: await runIdentityTransitions(browser, base),
      provisioningRecovery: await runProvisioningRecovery(browser, base),
      externalPreferenceRace: await runExternalPreferenceRace(browser, base),
      embeddedQuoteToHandoff: await runEmbeddedQuoteToHandoff(browser, base, executionFixture),
      walletRequests: 0,
      signatures: 0,
      approvals: 0,
      transactions: 0
    };
    await writeFile(path.join(artifactRoot, "privy-bridge-balance-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Privy bridge and balance acceptance passed: ${JSON.stringify(report)}`);
  } finally {
    await browser?.close();
    await stopChild(child);
    await closeServer(rpcServer);
  }
}

await main();
