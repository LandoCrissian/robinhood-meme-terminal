import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const requireRoot = createRequire(path.join(root, "package.json"));
const requireWeb = createRequire(path.join(webRoot, "package.json"));
const { chromium } = requireRoot("playwright");
const nextBin = requireWeb.resolve("next/dist/bin/next");
const wallet = "0x3333333333333333333333333333333333333333";
const market = "0x39dbed3a2bd333467115de45665cc57f813c4571";
const nativeAssetKey = "eip155:4663/native";
const usdgAddress = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const usdgAssetKey = "eip155:4663/contract:0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const transferRecipient = "0x4444444444444444444444444444444444444444";
const transferHash = `0x${"55".repeat(32)}`;
const fixtureUserId = "account-first-browser-acceptance";
const tradeDraftStorageKey = "rmt:trade-draft-recovery:v1";
const fixturePreferenceStorageKey = `rmt:active-trading-wallet:v2:${encodeURIComponent(fixtureUserId)}`;
const storedExternalWalletKey = JSON.stringify([
  "wallet_connect",
  "walletconnect",
  "rmt-walletconnect-fixture",
  wallet
]);
const connectedExternalWalletKey = JSON.stringify([
  "walletconnect",
  "browser-acceptance-external",
  "rmt-walletconnect-fixture",
  wallet
]);
const confirmedTransactions = new Set();
const rpcRequests = [];
const receiptRequests = [];
let latestBlock = 0x2faf080n;
const artifactRoot = process.env.RMT_ACCOUNT_ACCEPTANCE_OUTPUT
  ?? path.resolve(root, "../account-first-evidence/after");

function jsonRpc(request) {
  rpcRequests.push({ method: request.method, params: request.params });
  const word = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
  let result;
  switch (request.method) {
    case "eth_chainId": result = "0x1237"; break;
    case "eth_accounts": case "eth_requestAccounts": result = [wallet]; break;
    case "eth_blockNumber": result = `0x${(latestBlock++).toString(16)}`; break;
    case "eth_getBalance": result = "0x8ac7230489e80000"; break;
    case "eth_getCode": result = "0x60006000"; break;
    case "eth_call": result = word(100_000_000n); break;
    case "eth_estimateGas": result = "0xc350"; break;
    case "eth_gasPrice": result = "0x2faf080"; break;
    case "eth_getTransactionCount": result = "0x1"; break;
    case "eth_getLogs": result = []; break;
    case "eth_getTransactionReceipt": {
      const hash = String(request.params?.[0] ?? "").toLowerCase();
      receiptRequests.push({ confirmed: confirmedTransactions.has(hash), hash });
      result = confirmedTransactions.has(hash) ? {
        blockHash: `0x${"66".repeat(32)}`,
        blockNumber: "0x2faf080",
        contractAddress: null,
        cumulativeGasUsed: "0x5208",
        effectiveGasPrice: "0x2faf080",
        from: wallet,
        gasUsed: "0x5208",
        logs: [],
        logsBloom: `0x${"00".repeat(256)}`,
        status: "0x1",
        to: transferRecipient,
        transactionHash: hash,
        transactionIndex: "0x0",
        type: "0x2"
      } : null;
      break;
    }
    case "eth_getTransactionByHash": {
      const hash = String(request.params?.[0] ?? "").toLowerCase();
      result = confirmedTransactions.has(hash) ? {
        accessList: [],
        blockHash: `0x${"66".repeat(32)}`,
        blockNumber: "0x2faf080",
        chainId: "0x1237",
        from: wallet,
        gas: "0xc350",
        gasPrice: "0x2faf080",
        hash,
        input: "0x",
        maxFeePerGas: "0x2faf080",
        maxPriorityFeePerGas: "0x1",
        nonce: "0x1",
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
        to: transferRecipient,
        transactionIndex: "0x0",
        type: "0x2",
        v: "0x1",
        value: "0x2386f26fc10000",
        yParity: "0x1"
      } : null;
      break;
    }
    case "wallet_switchEthereumChain": result = null; break;
    default: return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Fixture does not implement ${request.method}` } };
  }
  return { jsonrpc: "2.0", id: request.id, result };
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function reserveLoopbackPort() {
  const reservation = createServer();
  const port = await listen(reservation);
  await closeServer(reservation);
  return port;
}

async function requireAvailableLoopbackPort(port) {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(port, "127.0.0.1", resolve);
  });
  await closeServer(reservation);
}

async function stopChild(child) {
  const exitedOrSignaled = () => child.exitCode !== null || child.signalCode !== null;
  if (exitedOrSignaled()) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  if (exitedOrSignaled()) return;
  child.kill("SIGKILL");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (!exitedOrSignaled()) throw new Error("Account acceptance server did not terminate cleanly.");
}

async function waitForServer(base, child, log) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Account acceptance server exited early.\n${log.value}`);
    const ready = await fetch(base, { signal: AbortSignal.timeout(5_000) }).then(async (response) => {
      if (response.ok) return true;
      if (attempt === 0 || attempt === 119) log.value += `\nReadiness HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`;
      return false;
    }).catch((error) => {
      if (attempt === 119) log.value += `\nReadiness error: ${String(error)}`;
      return false;
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Account acceptance server did not become ready.\n${log.value}`);
}

async function buildAccountProfile(env) {
  if (process.env.RMT_ACCOUNT_ACCEPTANCE_SKIP_BUILD === "true") {
    console.warn("[account-first] diagnostic run is reusing an existing build; source provenance is not established");
    return "SKIPPED_UNVERIFIED";
  }
  console.log("[account-first] building dedicated loopback account profile");
  const build = spawn(process.execPath, [nextBin, "build"], {
    cwd: webRoot,
    env,
    stdio: "inherit",
    windowsHide: true
  });
  const exitCode = await new Promise((resolve, reject) => {
    build.once("error", reject);
    build.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`Account acceptance build failed with exit code ${exitCode}.`);
  return "FRESH_PROFILE_BUILD";
}

async function installPageFixtures(page, quoteRequests, options = {}) {
  await page.addInitScript(({
    existingEmbeddedWallet,
    mode,
    preferenceHydrationDelayMs,
    preferenceStorageKey,
    storedExternalKey,
    transactionHash,
    walletAddress,
    walletBalanceScenario
  }) => {
    if (existingEmbeddedWallet) {
      window.localStorage.setItem("rmt:account-first-returning", walletAddress);
    }
    window.__RMT_ACCOUNT_ACCEPTANCE_CONFIG__ = {
      failFirstProvisioning: window.localStorage.getItem("rmt:account-first-returning") !== walletAddress,
      mode,
      preferenceHydrationDelayMs,
      provisioningDelayMs: 450,
      returningUser: mode === "embedded-onboarding"
        && window.localStorage.getItem("rmt:account-first-returning") === walletAddress,
      storedExternalWalletKey: storedExternalKey,
      walletBalanceScenario
    };
    window.__RMT_ACCEPTANCE_WALLET_METHODS__ = [];
    window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ = [];
    window.__RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__ = [];
    window.__RMT_ACCOUNT_ACCEPTANCE_FAIL_TRANSFER_PERSIST__ = [];
    if (mode === "external-preference-hydration") {
      window.sessionStorage.setItem(preferenceStorageKey, storedExternalKey);
      window.localStorage.setItem(preferenceStorageKey, storedExternalKey);
    }
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setAcceptanceItem(key, value) {
      const transferState = key.startsWith("rmt:native-transfer:v1:") ? JSON.parse(value).state : null;
      if (window.__RMT_ACCOUNT_ACCEPTANCE_FAIL_TRANSFER_PERSIST__.includes(transferState)) {
        throw new DOMException(`Deterministic ${transferState} persistence failure`, "QuotaExceededError");
      }
      return nativeSetItem.call(this, key, value);
    };
    const listeners = new Map();
    const emit = (event, value) => (listeners.get(event) ?? []).forEach((listener) => listener(value));
    window.__RMT_ACCEPTANCE_WALLETCONNECT_PROVIDER__ = {
      on(event, listener) {
        const current = listeners.get(event) ?? [];
        listeners.set(event, [...current, listener]);
      },
      removeListener(event, listener) {
        listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
      },
      async request({ method }) {
        window.__RMT_ACCEPTANCE_WALLET_METHODS__.push(method);
        if (method === "eth_chainId") return "0x1237";
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [walletAddress];
        if (method === "wallet_switchEthereumChain") { emit("chainChanged", "0x1237"); return null; }
        if (method === "eth_getBalance") return "0x8ac7230489e80000";
        if (method === "eth_blockNumber") return "0x2faf080";
        if (method === "eth_getCode") return "0x60006000";
        if (method === "eth_call") return `0x${(100000000n).toString(16).padStart(64, "0")}`;
        if (method === "eth_estimateGas") return "0xc350";
        if (method === "eth_gasPrice") return "0x2faf080";
        if (method === "eth_getTransactionCount") return "0x1";
        if (method === "eth_getLogs") return [];
        if (method === "eth_sendTransaction") return transactionHash;
        throw new Error(`Unimplemented account fixture wallet method ${method}`);
      }
    };
  }, {
    walletAddress: wallet,
    existingEmbeddedWallet: options.existingEmbeddedWallet === true,
    mode: options.mode ?? "embedded-onboarding",
    preferenceHydrationDelayMs: options.preferenceHydrationDelayMs ?? 650,
    preferenceStorageKey: fixturePreferenceStorageKey,
    storedExternalKey: storedExternalWalletKey,
    transactionHash: transferHash,
    walletBalanceScenario: options.walletBalanceScenario ?? "positive"
  });

  await page.route(/\/api\/vnext\/asset-identity(?:\?.*)?$/, async (route) => {
    const requestedAddress = new URL(route.request().url()).searchParams.get("address")?.toLowerCase();
    if (requestedAddress !== market.toLowerCase()) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Token identity could not be verified on Robinhood Chain." })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        resolution: {
          chainId: 4_663,
          requestedAddress: market,
          requestedKind: "token",
          status: "token-only",
          token: {
            address: market,
            name: "PONS",
            symbol: "PONS",
            decimals: 18,
            totalSupply: "1000000000000000000000000"
          },
          pools: [],
          marketData: "identity-only",
          execution: "view-only",
          provenance: "robinhood-chain-contract-reads",
          resolvedAt: "2026-09-25T00:00:00.000Z"
        }
      })
    });
  });

  await page.route("**/api/vnext/quotes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const payload = route.request().postDataJSON();
    quoteRequests.push({
      ...payload,
      __fixtureObservedAt: Date.now(),
      __fixturePageUrl: route.request().frame().url()
    });
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Deterministic account acceptance stops before provider execution.",
        phase: "QUOTE_SERVICE_UNAVAILABLE",
        code: "ACCOUNT_ACCEPTANCE_READ_ONLY",
        stage: "quote",
        retryable: false
      })
    });
  });
}

async function openTransferDialog(page) {
  await page.getByRole("button", { name: /0x3333…3333/ }).first().click();
  const walletMenu = page.getByRole("dialog", { name: "Manage wallets" });
  await walletMenu.getByRole("button", { name: /^Send/ }).click();
  const transfer = page.getByRole("dialog", { name: /Send ETH on Robinhood Chain/i });
  await transfer.waitFor();
  return transfer;
}

async function activateTransferFixtureWallet(page, label) {
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByText("RMT wallet setup paused").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Retry RMT wallet" }).click();
  try {
    await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 20_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      body: document.body.innerText.slice(0, 4_000),
      events: window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? [],
      methods: window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []
    }));
    throw new Error(`${label} did not activate its signer. ${String(error)}\n${JSON.stringify(diagnostic)}`);
  }
}

async function runTransferBoundary(browser, base, serverLog) {
  console.log("[account-first:transfer] opening isolated transfer-boundary fixture");
  const context = await browser.newContext({ viewport: { width: 1_280, height: 820 } });
  const page = await context.newPage();
  const quoteRequests = [];
  try {
    await installPageFixtures(page, quoteRequests);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 180_000 });
    } catch (error) {
      throw new Error(`Transfer-boundary navigation failed.\n${String(error)}\nServer log tail:\n${serverLog.value.slice(-8_000)}`);
    }
    await acceptTerms(page, { terms: 0 });
    await activateTransferFixtureWallet(page, "Transfer fixture");
    await page.waitForFunction(() => typeof window.__RMT_ACCOUNT_ACCEPTANCE_SET_SIGNER_UID__ === "function");

    let transfer = await openTransferDialog(page);
    await transfer.getByLabel("Destination address").fill(transferRecipient);
    await transfer.getByLabel("Amount").fill("0.01");
    await transfer.getByRole("button", { name: "Review transfer" }).click();
    await transfer.getByRole("button", { name: "Confirm in wallet" }).waitFor();

    const sendsBeforeReplacement = await page.evaluate(() =>
      (window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []).filter((method) => method === "eth_sendTransaction").length);
    await page.evaluate(() => window.__RMT_ACCOUNT_ACCEPTANCE_SET_SIGNER_UID__?.("same-address-replacement-uid"));
    await transfer.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Choose trading wallet", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Confirm in wallet" }).count(), 0,
      "same-address connector replacement removes the reviewed transfer before dispatch");
    assert.equal(await page.evaluate(() =>
      (window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []).filter((method) => method === "eth_sendTransaction").length), sendsBeforeReplacement,
    "same-address connector replacement makes zero provider calls");

    await page.evaluate(() => window.__RMT_ACCOUNT_ACCEPTANCE_SET_SIGNER_UID__?.(null));
    await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor();
    transfer = page.getByRole("dialog", { name: /Send ETH on Robinhood Chain/i });
    await transfer.waitFor();
    await transfer.getByLabel("Destination address").fill(transferRecipient);
    await transfer.getByLabel("Amount").fill("0.01");
    await transfer.getByRole("button", { name: "Review transfer" }).click();
    const confirm = transfer.getByRole("button", { name: "Confirm in wallet" });
    await confirm.waitFor();
    await confirm.evaluate((button) => {
      button.click();
      button.click();
    });
    await transfer.getByText("Transaction submitted. Waiting for an onchain receipt…").waitFor({ timeout: 20_000 });
    const sendCount = await page.evaluate(() =>
      (window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []).filter((method) => method === "eth_sendTransaction").length);
    assert.equal(sendCount, 1, "rapid double-submit invokes exactly one provider send request");

    const storageKey = `rmt:native-transfer:v1:4663:${wallet}`;
    const submitted = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), storageKey);
    assert.equal(submitted?.state, "SUBMITTED", "submitted transfer is durably recorded before retry is possible");
    assert.equal(submitted?.txHash, transferHash, "submitted transfer retains the exact provider transaction hash");

    await transfer.getByRole("button", { name: "Close transfer" }).click();
    transfer = await openTransferDialog(page);
    await transfer.getByText("Transaction submitted. Waiting for an onchain receipt…").waitFor();
    assert.equal(await transfer.getByRole("button", { name: "Confirm in wallet" }).count(), 0,
      "persisted SUBMITTED transfer exposes no retry action");
    assert.equal(await page.evaluate(() =>
      (window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []).filter((method) => method === "eth_sendTransaction").length), 1,
    "persisted SUBMITTED transfer makes no second provider call");

    await transfer.getByRole("button", { name: "Close transfer" }).click();
    await page.evaluate((key) => {
      const current = JSON.parse(window.localStorage.getItem(key) ?? "null");
      window.localStorage.setItem(key, JSON.stringify({ ...current, state: "UNKNOWN", txHash: undefined }));
    }, storageKey);
    transfer = await openTransferDialog(page);
    await transfer.getByText("Wallet request unresolved. Check wallet activity and do not retry.").waitFor();
    assert.equal(await transfer.getByRole("button", { name: "Confirm in wallet" }).count(), 0,
      "persisted UNKNOWN transfer exposes no retry action");
    assert.equal(await page.evaluate(() =>
      (window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []).filter((method) => method === "eth_sendTransaction").length), 1,
    "persisted UNKNOWN transfer makes no second provider call");

    console.log("[account-first:transfer] exact signer, double-submit, SUBMITTED, and UNKNOWN protections passed");
    return {
      evidenceType: "MOCKED_LOCAL_BROWSER",
      exactConnectorSendRequests: 1,
      replacementConnectorSendRequests: 0,
      rapidDoubleSubmitSendRequests: 1,
      submittedRetryBlocked: true,
      unknownRetryBlocked: true
    };
  } finally {
    await context.close();
  }
}

async function runTransferPersistenceFailureBoundary(browser, base, serverLog) {
  console.log("[account-first:transfer-persistence] opening isolated persistence-failure fixture");
  rpcRequests.length = 0;
  receiptRequests.length = 0;
  const context = await browser.newContext({ viewport: { width: 1_280, height: 820 } });
  const page = await context.newPage();
  try {
    await installPageFixtures(page, []);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 180_000 });
    } catch (error) {
      throw new Error(`Transfer persistence navigation failed.\n${String(error)}\nServer log tail:\n${serverLog.value.slice(-8_000)}`);
    }
    await acceptTerms(page, { terms: 0 });
    await activateTransferFixtureWallet(page, "Transfer persistence fixture");
    const transfer = await openTransferDialog(page);
    await transfer.getByLabel("Destination address").fill(transferRecipient);
    await transfer.getByLabel("Amount").fill("0.01");
    await transfer.getByRole("button", { name: "Review transfer" }).click();
    await page.evaluate(() => { window.__RMT_ACCOUNT_ACCEPTANCE_FAIL_TRANSFER_PERSIST__ = ["SUBMITTED", "CONFIRMED"]; });
    confirmedTransactions.add(transferHash.toLowerCase());
    await transfer.getByRole("button", { name: "Confirm in wallet" }).click();
    await transfer.getByRole("link", { name: "View transaction on Blockscout ↗" }).waitFor();
    assert.equal(await page.evaluate(() =>
      (window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []).filter((method) => method === "eth_sendTransaction").length), 1,
    "persistence failure still performs exactly one reviewed provider request");
    assert.equal(await transfer.getByRole("button", { name: "Confirm in wallet" }).count(), 0,
      "hash-backed UNKNOWN state remains duplicate-blocking");

    try {
      await transfer.getByText("TRANSFER CONFIRMED").waitFor({ timeout: 25_000 });
    } catch (error) {
      const body = await transfer.innerText();
      const walletMethods = await page.evaluate(() => window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []);
      throw new Error(`Hash-backed receipt did not reconcile. ${String(error)}\nDialog: ${body}\nReceipt RPC: ${JSON.stringify(receiptRequests)}\nWallet RPC: ${JSON.stringify(walletMethods)}\nMethod counts: ${JSON.stringify(Object.fromEntries([...new Set(rpcRequests.map(({ method }) => method))].map((method) => [method, rpcRequests.filter((request) => request.method === method).length])))}`);
    }
    await transfer.getByText("The receipt arrived, but RMT could not persist the final transfer state. Keep the transaction hash.").waitFor();
    const storageKey = `rmt:native-transfer:v1:4663:${wallet}`;
    const reconciled = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), storageKey);
    assert.equal(reconciled?.state, "PROMPT_REQUESTED",
      "when final persistence fails the earlier durable prompt remains conservatively retry-blocking");
    assert.equal(await transfer.getByRole("link", { name: "View transaction on Blockscout ↗" }).getAttribute("href"),
      `https://robinhoodchain.blockscout.com/tx/${transferHash}`,
    "receipt reconciliation retains exact transaction identity in memory and in the visible explorer link");
    console.log("[account-first:transfer-persistence] exact hash retained and receipt reconciliation passed");
    return {
      evidenceType: "MOCKED_LOCAL_BROWSER",
      providerSendRequests: 1,
      hashRetainedAfterPersistenceFailure: true,
      exactReceiptReconciled: true
    };
  } finally {
    confirmedTransactions.delete(transferHash.toLowerCase());
    await context.close();
  }
}

async function acceptTerms(page, clicks) {
  const accept = page.getByRole("button", { name: "I understand — enter RMT" });
  if (await accept.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await accept.click();
    clicks.terms += 1;
  }
}

async function openMobileTradeSheetIfClosed(page) {
  const openSheet = page.locator(".rmtMobileSheetLayer.isOpen");
  if (await openSheet.isVisible().catch(() => false)) return;
  const buyDock = page.locator(".rmtMobileTradeDock .isBuy");
  if (await buyDock.isVisible().catch(() => false)) await buyDock.click();
}

async function waitForQuoteRecipient(quoteRequests, expectedRecipient, timeoutMs = 15_000, options = {}) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    if (quoteRequests.slice(options.afterIndex ?? 0).some((request) => (
      String(request.recipient).toLowerCase() === expectedRecipient.toLowerCase()
      && (!options.pageUrlIncludes || String(request.__fixturePageUrl).includes(options.pageUrlIncludes))
    ))) {
      return Date.now() - started;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function waitForPersistedTradeDraft(page, expected) {
  await page.waitForFunction(({ key, expectedDraft }) => {
    const encoded = window.sessionStorage.getItem(key);
    if (!encoded) return false;
    try {
      const draft = JSON.parse(encoded);
      return draft.marketAddress?.toLowerCase() === expectedDraft.marketAddress.toLowerCase()
        && draft.side === expectedDraft.side
        && draft.amount === expectedDraft.amount
        && (!expectedDraft.buyInputKey || draft.buyInputKey === expectedDraft.buyInputKey)
        && (!expectedDraft.sellOutputKey || draft.sellOutputKey === expectedDraft.sellOutputKey);
    } catch {
      return false;
    }
  }, { key: tradeDraftStorageKey, expectedDraft: expected }, { timeout: 10_000 });
}

function financialWalletMethods(methods) {
  return methods.filter((method) => method === "eth_sendTransaction"
    || method === "eth_sendRawTransaction" || method === "wallet_sendCalls"
    || method === "personal_sign" || method === "eth_sign" || method.startsWith("eth_signTypedData"));
}

async function runColdLinkedExternalBoundary(browser, base) {
  console.log("[account-first:cold-external] opening linked external cold return");
  const context = await browser.newContext({ viewport: { width: 1_200, height: 760 } });
  const page = await context.newPage();
  try {
    await installPageFixtures(page, [], { mode: "linked-external-cold-return" });
    await page.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await acceptTerms(page, { terms: 0 });
    const reconnect = page.getByRole("button", { name: "Reconnect trading wallet", exact: true });
    await reconnect.waitFor({ timeout: 20_000 });
    const before = await page.evaluate(() => ({
      authority: window.__RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__ ?? [],
      events: window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? []
    }));
    assert.equal(before.events.filter((event) => event.type === "LINKED_EXTERNAL_COLD_RETURN").length, 1,
      "The fixture must render the authenticated linked-external cold-return state exactly once.");
    assert.ok(before.authority.length > 0,
      "The cold-return render sequence must publish an explicit no-authority snapshot.");
    assert.equal(before.events.filter((event) => ["NEW_USER_PROVISIONING_REQUESTED", "PROVISIONING_STARTED", "CONNECTING", "READY"].includes(event.type)).length, 0,
      "A linked external cold return must not start or publish embedded-wallet provisioning.");
    assert.ok(before.authority.every((entry) => entry.activeWalletKey === null),
      "A linked external account with no connected record must publish no signer authority.");

    const tradeAction = page.locator(".vnReviewButton");
    await tradeAction.waitFor({ timeout: 20_000 });
    assert.equal((await tradeAction.textContent())?.trim(), "Wallet options",
      "An authenticated user without exact signer authority sees wallet options, never another login action.");
    await tradeAction.click();
    const chooser = page.getByLabel("Choose the trading wallet");
    await chooser.getByRole("button", { name: "Connect existing wallet", exact: true }).click();
    await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 15_000 });
    const after = await page.evaluate(() => ({
      authority: window.__RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__ ?? [],
      events: window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? [],
      methods: window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []
    }));
    assert.equal(after.events.filter((event) => event.type === "EXTERNAL_RECONNECT_REQUESTED").length, 1,
      "The cold linked external reconnect must be one explicit user action.");
    assert.equal(after.events.filter((event) => event.type === "EXTERNAL_RECONNECTED").length, 1,
      "The exact external connector may publish only after the explicit reconnect.");
    const publications = after.events.filter((event) => event.type === "SIGNER_AUTHORITY_PUBLISHED");
    assert.equal(publications.length, 1,
      "Explicit external reconnect must publish exactly one signer authority.");
    assert.equal(publications[0].walletKey, connectedExternalWalletKey,
      "The published signer authority must be the exact connected external wallet key.");
    assert.equal(after.authority.at(-1)?.activeWalletKey, connectedExternalWalletKey,
      "The final committed identity snapshot must retain the exact external signer key.");
    assert.deepEqual(financialWalletMethods(after.methods), [],
      "Reconnecting an existing wallet must not sign or send a transaction.");
    console.log("[account-first:cold-external] explicit reconnect passed with zero financial RPC");
    return {
      explicitReconnectRequests: 1,
      exactPublishedWalletKey: connectedExternalWalletKey,
      financialWalletRpcCount: 0,
      initialSignerAuthority: null,
      provisioningEvents: 0,
      reconnectUi: ["Wallet options", "Connect existing wallet"]
    };
  } finally {
    await context.close();
  }
}

async function runPreferenceHydrationBoundary(browser, base) {
  console.log("[account-first:preference] opening delayed preference hydration");
  const context = await browser.newContext({ viewport: { width: 1_200, height: 760 } });
  const page = await context.newPage();
  try {
    await installPageFixtures(page, [], {
      mode: "external-preference-hydration",
      preferenceHydrationDelayMs: 2_500
    });
    await page.goto(`${base}/?panel=portfolio`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await acceptTerms(page, { terms: 0 });
    await page.waitForFunction(() => {
      const events = window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? [];
      return events.some((event) => event.type === "TRANSPORT_REHYDRATED")
        && !events.some((event) => event.type === "PREFERENCE_HYDRATED");
    }, undefined, { timeout: 10_000 });
    const portfolio = page.locator("#vnext-portfolio");
    await portfolio.waitFor({ timeout: 10_000 });
    const assertPortfolioAuthoritySuppressed = async (stage) => {
      const text = await portfolio.innerText();
      assert.match(text, /Select or reconnect the exact trading wallet/,
        `${stage}: Portfolio explains that exact signer authority is unavailable`);
      assert.doesNotMatch(text, /0x3333…3333/,
        `${stage}: Portfolio must not publish an address without exact signer authority`);
      assert.equal(await portfolio.getByRole("button", { name: "Receive", exact: true }).count(), 0,
        `${stage}: Portfolio must not publish Receive authority`);
      assert.equal(await portfolio.getByRole("button", { name: "Send ETH", exact: true }).count(), 0,
        `${stage}: Portfolio must not publish Send authority`);
      assert.equal(await portfolio.locator('[aria-label="Spendable trade balance"]').count(), 0,
        `${stage}: Portfolio must not publish spendable balances`);
    };
    await assertPortfolioAuthoritySuppressed("preference hydration gap");
    await page.waitForFunction(() => {
      const events = window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? [];
      return events.some((event) => event.type === "TRANSPORT_REHYDRATED")
        && events.some((event) => event.type === "PREFERENCE_HYDRATED");
    }, undefined, { timeout: 15_000 });
    const observed = await page.evaluate(({ preferenceStorageKey }) => ({
      authority: window.__RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__ ?? [],
      events: window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? [],
      localPreference: window.localStorage.getItem(preferenceStorageKey),
      methods: window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? [],
      sessionPreference: window.sessionStorage.getItem(preferenceStorageKey)
    }), { preferenceStorageKey: fixturePreferenceStorageKey });
    const transportIndex = observed.events.findIndex((event) => event.type === "TRANSPORT_REHYDRATED");
    const preferenceIndex = observed.events.findIndex((event) => event.type === "PREFERENCE_HYDRATED");
    assert.ok(transportIndex >= 0 && preferenceIndex > transportIndex,
      "The fixture must exercise embedded transport rehydration before durable external preference hydration.");
    assert.ok(observed.authority.some((entry) => !entry.preferenceLoaded),
      "The render sequence must include the pre-hydration authority gap.");
    assert.ok(observed.authority.some((entry) => entry.preferenceLoaded
      && entry.preferredWalletKey === storedExternalWalletKey),
    "The render sequence must include committed hydration of the exact durable external preference.");
    assert.ok(observed.authority.every((entry) => entry.activeWalletKey === null),
      "A rehydrated embedded connector cannot flash signer authority before or after an external preference hydrates.");
    assert.equal(observed.events.filter((event) => event.type === "SIGNER_AUTHORITY_PUBLISHED").length, 0,
      "No signer may be published during the preference hydration sequence.");
    assert.equal(observed.events.filter((event) => ["NEW_USER_PROVISIONING_REQUESTED", "PROVISIONING_STARTED", "CONNECTING", "READY"].includes(event.type)).length, 0,
      "Preference hydration must not enter embedded provisioning.");
    assert.equal(observed.sessionPreference, storedExternalWalletKey,
      "The exact stored external preference must survive session hydration.");
    assert.equal(observed.localPreference, storedExternalWalletKey,
      "The exact stored external preference must survive durable hydration.");
    await assertPortfolioAuthoritySuppressed("hydrated preference without exact signer");
    await page.getByRole("button", { name: "Reconnect trading wallet", exact: true }).waitFor({ timeout: 10_000 });
    assert.deepEqual(financialWalletMethods(observed.methods), [],
      "Preference hydration and transport rehydration must not sign or send.");
    console.log("[account-first:preference] embedded authority remained suppressed across hydration");
    return {
      externalPreferencePreserved: true,
      financialWalletRpcCount: 0,
      committedPreferenceHydrationObserved: true,
      preHydrationRenderObserved: true,
      portfolioAuthoritySuppressed: true,
      signerAuthorityPublications: 0,
      transportBeforePreference: true
    };
  } finally {
    await context.close();
  }
}

async function runFundingPrimaryBoundaries(browser, base) {
  console.log("[account-first:funding-actions] checking zero-input and native-gas recovery actions");
  const scenarios = [
    {
      balanceScenario: "zero-input",
      evidence: /Deposit USDG to cover this amount/,
      label: "Deposit USDG",
      name: "zero-input",
      receiveAsset: `Selected asset: USDG · contract ${usdgAddress}`,
      sheetAsset: "USDG · 0x5fc5…d168"
    },
    {
      balanceScenario: "erc20-no-gas",
      evidence: /Deposit native ETH for Robinhood Chain gas/,
      label: "Deposit ETH for gas",
      name: "erc20-no-gas",
      receiveAsset: "Selected asset: ETH · native ETH",
      sheetAsset: "ETH · native"
    }
  ];
  const results = [];
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    try {
      await installPageFixtures(page, [], {
        existingEmbeddedWallet: true,
        walletBalanceScenario: scenario.balanceScenario
      });
      await page.goto(`${base}/?market=${market}&side=buy&fundingScenario=${scenario.name}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000
      });
      await acceptTerms(page, { terms: 0 });
      await openMobileTradeSheetIfClosed(page);
      await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 15_000 });
      const tradeSheet = page.locator(".rmtMobileSheetLayer.isOpen .rmtMobileTradeSheet");
      await tradeSheet.waitFor({ timeout: 10_000 });
      const amount = tradeSheet.getByLabel("Exact input amount");
      await amount.waitFor({ timeout: 30_000 });
      await amount.fill("1");
      const balanceEvidence = tradeSheet.getByText(scenario.evidence);
      await balanceEvidence.waitFor({ state: "attached", timeout: 10_000 });
      assert.match(await balanceEvidence.textContent(), scenario.evidence,
        `${scenario.name}: the exact funding blocker remains in the ticket even when the compact scroll region clips it`);
      const action = tradeSheet.getByRole("button", { name: scenario.label, exact: true });
      await action.waitFor({ timeout: 10_000 });
      assert.equal(await action.isEnabled(), true, `${scenario.name}: the funding recovery action is enabled`);
      await page.screenshot({
        path: path.join(artifactRoot, `mobile-${scenario.name}-deposit-action.png`),
        fullPage: true
      });
      await action.click();
      await page.getByRole("heading", { name: "Deposit on Robinhood Chain" }).waitFor();
      await page.getByText("0x3333…3333 · Robinhood Chain · 4663").waitFor();
      await page.getByText("Selected deposit asset", { exact: true }).waitFor();
      await page.getByText(scenario.sheetAsset, { exact: true }).waitFor();
      await page.getByRole("button", { name: "Show address & QR" }).click();
      await page.getByRole("heading", { name: "Receive on Robinhood Chain" }).waitFor();
      const receiveAssetEvidence = page.locator(".walletReceiveAddress small");
      await receiveAssetEvidence.waitFor();
      assert.ok((await receiveAssetEvidence.innerText()).includes(scenario.receiveAsset),
        `${scenario.name}: Receive retains the exact requested asset while also showing its safety guidance`);
      await page.locator(`.walletReceiveQr[aria-label="QR code for ${wallet}"]`).waitFor();
      const methods = await page.evaluate(() => window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []);
      assert.deepEqual(financialWalletMethods(methods), [], `${scenario.name}: Deposit recovery never signs or sends`);
      results.push({
        action: scenario.label,
        balanceScenario: scenario.balanceScenario,
        enabled: true,
        exactEmbeddedWallet: true,
        financialWalletRpcCount: 0,
        receiveAsset: scenario.receiveAsset
      });
    } finally {
      await context.close();
    }
  }
  console.log("[account-first:funding-actions] both recovery actions passed without financial RPC");
  return results;
}

async function runResponsiveLayoutBoundary(browser, base, label, viewport) {
  console.log(`[account-first:${label}] checking responsive layout`);
  const context = await browser.newContext({
    viewport,
    isMobile: viewport.width <= 430,
    hasTouch: viewport.width <= 430
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await installPageFixtures(page, []);
    const started = Date.now();
    await page.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await acceptTerms(page, { terms: 0 });
    await page.locator(".rmtTerminal[data-terminal-context]").waitFor({ timeout: 30_000 });
    await openMobileTradeSheetIfClosed(page);
    const amount = page.getByLabel("Exact input amount");
    await amount.waitFor({ timeout: 30_000 });
    await amount.focus();
    const primary = page.locator(".vnReviewButton");
    await primary.waitFor({ timeout: 15_000 });
    const primaryBox = await primary.boundingBox();
    const horizontalOverflowPx = await page.evaluate(() => Math.max(0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth));
    assert.ok(horizontalOverflowPx <= 1, `${label}: no horizontal page overflow`);
    if (viewport.width <= 430) assert.ok((primaryBox?.height ?? 0) >= 44,
      `${label}: the mobile primary action retains a 44px touch target`);
    assert.deepEqual(pageErrors, [], `${label}: no fatal browser runtime errors`);
    await page.screenshot({ path: path.join(artifactRoot, `${label}-layout.png`), fullPage: true });
    console.log(`[account-first:${label}] responsive layout passed`);
    return {
      focusTarget: await amount.evaluate((element) => document.activeElement === element),
      horizontalOverflowPx,
      primaryActionHeightPx: primaryBox?.height ?? null,
      shellAndTradeVisibleMs: Date.now() - started,
      viewport
    };
  } finally {
    await context.close();
  }
}

async function runViewport(browser, base, device, viewport, serverLog) {
  const progress = (step) => console.log(`[account-first:${device}] ${step}`);
  const videoDirectory = path.join(artifactRoot, "video-tmp", device);
  await mkdir(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport,
    isMobile: device === "mobile",
    hasTouch: device === "mobile",
    recordVideo: { dir: videoDirectory, size: viewport }
  });
  const page = await context.newPage();
  const video = page.video();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const quoteRequests = [];
  const clicks = { terms: 0, sideSwitches: 0, trade: 0, retry: 0, closeTrade: 0, portfolio: 0, deposit: 0, receive: 0 };
  const metrics = { device, viewport, clicks };
  try {
    await installPageFixtures(page, quoteRequests);
    const started = Date.now();
    progress("opening public market");
    try {
      await page.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    } catch (error) {
      throw new Error(`${device}: public market navigation failed.\n${String(error)}\nServer log tail:\n${serverLog.value.slice(-8_000)}`);
    }
    await acceptTerms(page, clicks);
    await page.getByRole("heading", { name: /Markets/i }).first().waitFor({ timeout: 45_000 });
    metrics.shellVisibleMs = Date.now() - started;
    progress("market shell ready");
    for (const label of ["Active", "New", "Movers", "Trending"]) {
      assert.ok(await page.getByRole("button", { name: new RegExp(label, "i") }).first().isVisible(), `${device}: ${label} market view is visible`);
    }

    if (device === "mobile") {
      await openMobileTradeSheetIfClosed(page);
    }
    const sideTabs = page.getByRole("tablist", { name: "Trade side" });
    const amount = page.getByLabel("Exact input amount");
    await amount.waitFor({ timeout: 45_000 });
    metrics.tradeActionVisibleMs = Date.now() - started;
    await sideTabs.getByRole("tab", { name: "Sell", exact: true }).click();
    clicks.sideSwitches += 1;
    await page.getByLabel("Receive asset").selectOption(nativeAssetKey);
    await amount.fill("12.345");
    await waitForPersistedTradeDraft(page, {
      amount: "12.345",
      marketAddress: market,
      sellOutputKey: nativeAssetKey,
      side: "sell"
    });
    const walletMethodsBeforeRemount = await page.evaluate(() => window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []);
    progress("remounting the public ticket with a bounded preference-only draft");
    await page.goto(`${base}/?market=${market}&side=sell&accountReturn=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    await acceptTerms(page, clicks);
    await amount.waitFor({ state: device === "mobile" ? "attached" : "visible", timeout: 45_000 });
    assert.equal(await sideTabs.getByRole("tab", { name: "Sell", exact: true }).getAttribute("aria-selected"), "true",
      `${device}: same-tab remount restores the Sell side`);
    assert.equal(await amount.inputValue(), "12.345", `${device}: same-tab remount restores the exact amount`);
    assert.equal(await page.getByLabel("Receive asset").inputValue(), nativeAssetKey,
      `${device}: same-tab remount restores the exact output asset`);
    assert.match(await page.locator(".vnAvailableLine").innerText(), /PONS\s*→\s*ETH/,
      `${device}: same-tab remount restores the selected market/input and ETH output`);
    assert.equal(new URL(page.url()).searchParams.get("market")?.toLowerCase(), market,
      `${device}: same-tab remount returns to the exact selected market`);
    assert.equal((await page.locator(".vnReviewButton").textContent())?.trim(), "Sign in",
      `${device}: recovered preferences do not create wallet or authorization authority`);
    const walletMethodsAfterRemount = await page.evaluate(() => window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []);
    assert.deepEqual(financialWalletMethods(walletMethodsBeforeRemount), []);
    assert.deepEqual(financialWalletMethods(walletMethodsAfterRemount), [],
      `${device}: preference-only remount never signs or sends`);
    metrics.preferenceRemount = {
      amount: "12.345",
      assets: "PONS_TO_NATIVE_ETH",
      financialWalletRpcCount: 0,
      market,
      side: "sell"
    };
    // The route-owned mobile sheet is already open after the exact draft
    // remount. Change the side inside that ticket instead of trying to click
    // through its modal layer to the dock underneath it.
    await sideTabs.getByRole("tab", { name: "Buy", exact: true }).click();
    clicks.sideSwitches += 1;
    await page.getByLabel("Pay with asset").selectOption(usdgAssetKey);
    await amount.fill("0.001");
    const primary = page.locator(".vnReviewButton");
    await primary.waitFor({ timeout: 20_000 });
    await amount.focus();
    metrics.amountFocusTarget = await amount.evaluate((element) => document.activeElement === element);
    assert.equal(metrics.amountFocusTarget, true, `${device}: the amount field accepts direct keyboard focus`);
    if (device === "mobile") {
      await page.setViewportSize({ width: viewport.width, height: 560 });
      await page.waitForTimeout(100);
      const actionBox = await primary.boundingBox();
      metrics.keyboardViewportActionVisible = Boolean(actionBox && actionBox.y >= 0 && actionBox.y + actionBox.height <= 560);
      assert.equal(metrics.keyboardViewportActionVisible, true,
        "mobile: the primary action remains visible in the deterministic keyboard-height viewport");
      await page.setViewportSize(viewport);
    }
    const beforeLabel = await primary.textContent();
    assert.equal(beforeLabel?.trim(), "Sign in", `${device}: explicit account action is offered`);
    await primary.click();
    clicks.trade += 1;
    progress("sign-in requested; awaiting deterministic first failure");
    const loginAt = Date.now();
    try {
      await page.getByText("RMT wallet setup paused").waitFor({ timeout: 10_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({ events: window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? [], body: document.body.innerText.slice(0, 4_000) }));
      throw new Error(`${device}: provisioning did not reach its bounded first failure. ${String(error)}\n${JSON.stringify(diagnostic)}`);
    }
    metrics.firstProvisioningFailureMs = Date.now() - loginAt;
    assert.equal(await amount.inputValue(), "0.001", `${device}: amount survives sign-in and failed provisioning`);
    assert.equal((await primary.textContent())?.trim(), "Retry RMT wallet",
      `${device}: the open trade ticket exposes its bounded wallet retry in place`);
    await primary.click();
    clicks.retry += 1;
    progress("retrying provisioning");
    const retryAt = Date.now();
    await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 15_000 });
    metrics.retryToReadyMs = Date.now() - retryAt;
    progress("exact embedded signer ready");
    assert.equal(await amount.inputValue(), "0.001", `${device}: amount survives successful provisioning`);
    await page.waitForFunction(() => window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__?.some((event) => event.type === "READY"));
    const events = await page.evaluate(() => window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__);
    const ready = events.find((event) => event.type === "READY");
    assert.equal(ready.address, wallet, `${device}: ready identity is the exact embedded signer`);
    assert.equal(events.filter((event) => event.type === "NEW_USER_PROVISIONING_REQUESTED").length, 1,
      `${device}: the fixture sends exactly one new-user provisioning request`);
    metrics.fixtureNewUserProvisioningRequests = 1;

    metrics.readyToRecipientQuoteMs = await waitForQuoteRecipient(quoteRequests, wallet);
    assert.notEqual(metrics.readyToRecipientQuoteMs, null,
      `${device}: preserved draft prepares a quote for the exact signer/recipient after verified asset identity`);
    assert.equal(await amount.inputValue(), "0.001", `${device}: quote preparation does not replace the draft`);

    if (device === "mobile") {
      await page.locator(".rmtMobileTradeSheet").getByRole("button", { name: "Close trade sheet" }).click();
      clicks.closeTrade += 1;
      await page.getByRole("button", { name: "Portfolio", exact: true }).click();
      clicks.portfolio += 1;
      await page.getByRole("heading", { name: "Portfolio", exact: true }).waitFor();
    }
    const deposit = device === "mobile"
      ? page.getByRole("button", { name: "Add funds", exact: true })
      : page.locator(".fundWalletTrigger").first();
    await deposit.click();
    clicks.deposit += 1;
    await page.getByRole("heading", { name: "Deposit on Robinhood Chain" }).waitFor();
    await page.getByText("0x3333…3333 · Robinhood Chain · 4663").waitFor();
    await page.getByRole("button", { name: "Show address & QR" }).click();
    clicks.receive += 1;
    await page.getByRole("heading", { name: "Receive on Robinhood Chain" }).waitFor();
    await page.getByText("Chain ID 4663").waitFor();
    await page.getByText(wallet, { exact: true }).waitFor();
    await page.locator(`.walletReceiveQr[aria-label="QR code for ${wallet}"]`).waitFor();
    progress("deposit and receive evidence ready");
    assert.equal(await amount.inputValue(), "0.001", `${device}: Deposit/Receive does not replace the trade draft`);
    await waitForPersistedTradeDraft(page, {
      amount: "0.001",
      buyInputKey: usdgAssetKey,
      marketAddress: market,
      side: "buy"
    });
    await page.screenshot({ path: path.join(artifactRoot, `${device}-direct-receive.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "Receive on Robinhood Chain" }).waitFor({ state: "hidden", timeout: 5_000 });
    metrics.escapeClosesReceive = true;
    assert.equal(await amount.inputValue(), "0.001", `${device}: closing Receive with Escape preserves the draft`);
    const methodsBeforeFundingReturn = await page.evaluate(() => window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []);
    assert.deepEqual(financialWalletMethods(methodsBeforeFundingReturn), [],
      `${device}: onboarding and direct Receive never sign or send before the funding return`);
    const fundingReturnQuoteStart = quoteRequests.length;
    await page.evaluate((walletAddress) => window.localStorage.setItem("rmt:account-first-returning", walletAddress), wallet);
    progress("simulating a same-tab funding return");
    await page.goto(`${base}/?market=${market}&side=buy&fundingReturn=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    await acceptTerms(page, clicks);
    if (device === "mobile") {
      await openMobileTradeSheetIfClosed(page);
    }
    await page.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__?.some((event) => event.type === "RETURNING_REUSED"));
    await amount.waitFor({ timeout: 30_000 });
    assert.equal(await sideTabs.getByRole("tab", { name: "Buy", exact: true }).getAttribute("aria-selected"), "true",
      `${device}: funding return restores the Buy side`);
    assert.equal(await amount.inputValue(), "0.001", `${device}: funding return restores the exact amount`);
    assert.equal(await page.getByLabel("Pay with asset").inputValue(), usdgAssetKey,
      `${device}: funding return restores the exact USDG input`);
    assert.match(await page.locator(".vnAvailableLine").innerText(), /USDG\s*→\s*PONS/,
      `${device}: funding return restores both selected assets`);
    assert.equal(new URL(page.url()).searchParams.get("market")?.toLowerCase(), market,
      `${device}: funding return restores the exact token workspace`);
    metrics.fundingReturnFreshQuoteMs = await waitForQuoteRecipient(quoteRequests, wallet, 15_000, {
      afterIndex: fundingReturnQuoteStart,
      pageUrlIncludes: "fundingReturn=1"
    });
    assert.notEqual(metrics.fundingReturnFreshQuoteMs, null,
      `${device}: funding return issues a fresh quote request for the exact signer and restored draft`);
    const methods = await page.evaluate(() => window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []);
    const forbidden = financialWalletMethods(methods);
    assert.deepEqual(forbidden, [], `${device}: onboarding, Deposit, and funding return must never sign or send`);
    await page.screenshot({ path: path.join(artifactRoot, `${device}-account-first-after.png`), fullPage: true });
    metrics.horizontalOverflowPx = await page.evaluate(() => Math.max(0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth));
    assert.ok(metrics.horizontalOverflowPx <= 1, `${device}: terminal must not create horizontal page overflow`);
    const allJourneyWalletMethods = [...methodsBeforeFundingReturn, ...methods];
    metrics.walletRpcCounts = Object.fromEntries([...new Set(allJourneyWalletMethods)].map((method) => [method, allJourneyWalletMethods.filter((candidate) => candidate === method).length]));
    metrics.signingOrSendRpcCount = forbidden.length;
    metrics.quoteRequests = quoteRequests.length;
    metrics.signerRecipientBound = true;
    metrics.draftPreserved = true;
    metrics.depositReceiveBound = true;
    metrics.fundingReturn = "SAME_TAB_REMOUNT_EXACT_DRAFT_FRESH_QUOTE_REQUEST_ZERO_WALLET_ACTION";
    const returningStorage = await context.storageState();
    progress("opening a cold returning embedded-wallet session");
    const returningContext = await browser.newContext({
      viewport,
      isMobile: device === "mobile",
      hasTouch: device === "mobile",
      storageState: returningStorage
    });
    const returningPage = await returningContext.newPage();
    try {
      await installPageFixtures(returningPage, []);
      await returningPage.goto(`${base}/?market=${market}&side=buy`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await acceptTerms(returningPage, { terms: 0 });
      try {
        await returningPage.getByRole("button", { name: /0x3333…3333/ }).first().waitFor({ timeout: 15_000 });
      } catch (error) {
        const diagnostic = await returningPage.evaluate(() => ({
          authority: window.__RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__ ?? [],
          body: document.body.innerText.slice(0, 4_000),
          events: window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? [],
          methods: window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []
        }));
        throw new Error(`${device}: cold returning embedded wallet did not reuse its exact account. ${String(error)}\n${JSON.stringify(diagnostic)}`);
      }
      await returningPage.waitForFunction(() => window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__?.some((event) => event.type === "RETURNING_REUSED"));
      const returningEvents = await returningPage.evaluate(() => window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ?? []);
      assert.equal(returningEvents.filter((event) => event.type === "PROVISIONING_STARTED").length, 0,
        `${device}: cold returning user reuses the existing embedded wallet without another creation attempt`);
      assert.equal(returningEvents.filter((event) => event.type === "NEW_USER_PROVISIONING_REQUESTED").length, 0,
        `${device}: cold returning embedded-wallet reuse does not request new-user provisioning`);
      const returningReady = returningEvents.find((event) => event.type === "RETURNING_REUSED");
      assert.equal(returningReady.address, wallet, `${device}: cold returning user reuses the exact embedded account`);
      const returningMethods = await returningPage.evaluate(() => window.__RMT_ACCEPTANCE_WALLET_METHODS__ ?? []);
      assert.deepEqual(financialWalletMethods(returningMethods), [],
        `${device}: cold returning-wallet reconnection must never sign or send`);
      metrics.returningWalletReused = true;
      metrics.returningSession = "COLD_BROWSER_CONTEXT_WITH_PERSISTED_STORAGE";
      metrics.returningProvisioningStarts = 0;
    } finally {
      await returningContext.close();
    }
    metrics.consoleErrors = consoleErrors;
    metrics.pageErrors = pageErrors;
    assert.deepEqual(pageErrors, [], `${device}: no fatal browser runtime errors are allowed`);
    progress("passed without financial RPC");
    return metrics;
  } finally {
    await context.close();
    if (video) {
      const videoPath = await video.path();
      const destination = path.join(artifactRoot, `${device}-embedded-onboarding-funding-return.webm`);
      await rm(destination, { force: true });
      await rename(videoPath, destination);
    }
  }
}

async function main() {
  await mkdir(artifactRoot, { recursive: true });
  const rpcServer = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(Array.isArray(payload) ? payload.map(jsonRpc) : jsonRpc(payload)));
  });
  const configuredRpcPort = process.env.RMT_ACCOUNT_ACCEPTANCE_RPC_PORT
    ? Number(process.env.RMT_ACCOUNT_ACCEPTANCE_RPC_PORT)
    : 0;
  if (!Number.isInteger(configuredRpcPort) || configuredRpcPort < 0 || configuredRpcPort > 65_535) {
    throw new Error("RMT_ACCOUNT_ACCEPTANCE_RPC_PORT must be a valid TCP port.");
  }
  const rpcPort = await listen(rpcServer, configuredRpcPort);
  let child;
  let browser;
  try {
  const appPort = process.env.RMT_ACCOUNT_ACCEPTANCE_PORT
    ? Number(process.env.RMT_ACCOUNT_ACCEPTANCE_PORT)
    : await reserveLoopbackPort();
  if (!Number.isInteger(appPort) || appPort <= 0 || appPort > 65_535) {
    throw new Error("RMT_ACCOUNT_ACCEPTANCE_PORT must be a valid TCP port.");
  }
  if (process.env.RMT_ACCOUNT_ACCEPTANCE_PORT) await requireAvailableLoopbackPort(appPort);
  const base = `http://127.0.0.1:${appPort}`;
  const env = {
    ...process.env,
    NEXT_PUBLIC_RMT_ACCOUNT_ACCEPTANCE_PROFILE: "true",
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
  const buildEvidence = await buildAccountProfile(env);
  child = spawn(process.execPath, [nextBin, "start", "-p", String(appPort)], {
    cwd: webRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const serverLog = { value: "" };
  child.stdout.on("data", (chunk) => { serverLog.value += chunk; });
  child.stderr.on("data", (chunk) => { serverLog.value += chunk; });
    await waitForServer(base, child, serverLog);
    console.log("[account-first] local application ready");
    browser = await chromium.launch({ headless: true });
    const evidence = [];
    if (process.env.RMT_ACCOUNT_ACCEPTANCE_TRANSFER_ONLY !== "true") {
      evidence.push(await runViewport(browser, base, "desktop", { width: 1440, height: 900 }, serverLog));
      evidence.push(await runViewport(browser, base, "mobile", { width: 390, height: 844 }, serverLog));
    }
    const fundingPrimaryActions = process.env.RMT_ACCOUNT_ACCEPTANCE_TRANSFER_ONLY === "true"
      ? []
      : await runFundingPrimaryBoundaries(browser, base);
    const responsiveLayouts = process.env.RMT_ACCOUNT_ACCEPTANCE_TRANSFER_ONLY === "true" ? [] : [
      await runResponsiveLayoutBoundary(browser, base, "mobile-375x812", { width: 375, height: 812 }),
      await runResponsiveLayoutBoundary(browser, base, "mobile-430x932", { width: 430, height: 932 }),
      await runResponsiveLayoutBoundary(browser, base, "tablet-768x1024", { width: 768, height: 1024 })
    ];
    const coldLinkedExternal = await runColdLinkedExternalBoundary(browser, base);
    const preferenceHydration = await runPreferenceHydrationBoundary(browser, base);
    const transferBoundary = await runTransferBoundary(browser, base, serverLog);
    const transferPersistenceFailure = await runTransferPersistenceFailureBoundary(browser, base, serverLog);
    const report = {
      evidenceType: "MOCKED_LOCAL_BROWSER",
      fixtureLabel: "ACCOUNT_FIRST_LOOPBACK_ONLY_NO_REAL_FINANCIAL_ACTION",
      buildEvidence,
      generatedAt: new Date().toISOString(),
      wallet,
      results: evidence,
      fundingPrimaryActions,
      responsiveLayouts,
      coldLinkedExternal,
      preferenceHydration,
      transferBoundary,
      transferPersistenceFailure
    };
    await writeFile(path.join(artifactRoot, "account-first-browser-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
    const scope = process.env.RMT_ACCOUNT_ACCEPTANCE_TRANSFER_ONLY === "true"
      ? "partial transfer-boundary diagnostics"
      : "full desktop/mobile account-first acceptance";
    console.log(`Account-first browser acceptance passed (${scope}): ${JSON.stringify(report)}`);
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        if (child) await stopChild(child);
      } finally {
        await closeServer(rpcServer);
      }
    }
  }
}

await main();
