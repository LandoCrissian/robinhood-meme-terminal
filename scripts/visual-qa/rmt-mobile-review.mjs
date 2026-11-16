import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionData, keccak256, parseAbi, toHex } = require("viem");
const factoryAbi = parseAbi(["function create(string,string,string,address,uint16,bytes32,uint256) payable returns (address,address)"]);
const chain = "0x7a69";
const route = "/wallet/mobile-review";
const endpoint = "/api/launchpad/test-mobile-review";

// The shim signs only exact requests for the disposable local account. A wallet
// rejection returns code 4001 without invoking the signer or the Anvil sender.
export async function testMobileReview({ context, site, out, rpc, creator, alternate, factory, feeWei, setGasDrift, hideReceipt }) {
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  const receipts = [];
  let account = creator.address, connectedChain = chain, decision = "normal", attempts = 0;
  let walletBlockMismatch = false;
  let walletFailure;
  async function walletRequest({ method, params = [] }) {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return { value: [account] };
    if (method === "eth_chainId") return { value: connectedChain };
    if (method === "eth_getTransactionCount") return { value: await rpc(method, params) };
    if (method === "eth_getBlockByNumber") {
      const block = await rpc(method, params);
      return { value: walletBlockMismatch ? { ...block, hash: "0x" + "aa".repeat(32) } : block };
    }
    assert.equal(method, "eth_sendTransaction", "Fixture wallet admits only one synthetic write method");
    attempts++;
    assert.equal(connectedChain, chain);
    assert.equal(await rpc("eth_chainId"), chain);
    const [request] = params;
    assert.equal(params.length, 1);
    assert.equal(request.chainId, chain);
    assert.equal(request.from.toLowerCase(), creator.address.toLowerCase());
    assert.equal(request.to.toLowerCase(), factory.toLowerCase());
    assert.ok([request.nonce, request.value, request.gas, request.gasPrice].every((value) => /^0x[0-9a-f]+$/i.test(value)));
    assert.equal(BigInt(request.value), feeWei);
    const nonce = await rpc("eth_getTransactionCount", [creator.address, "pending"]);
    assert.equal(BigInt(request.nonce), BigInt(nonce));
    const { functionName, args: [name, symbol, , , , intent, deadline] } = decodeFunctionData({ abi: factoryAbi, data: request.data });
    assert.equal(functionName, "create");
    assert.equal(name, "Mobile review rehearsal");
    assert.equal(symbol, "MOB");
    assert.ok(deadline > BigInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp));
    if (decision === "reject") return { error: { code: 4001, message: "Synthetic wallet rejected" } };
    if (decision === "revert") await rpc("evm_setNextBlockTimestamp", [Number(deadline + 1n)]);

    const signed = await creator.signTransaction({
      chainId: 31337, nonce: Number(BigInt(request.nonce)), gas: BigInt(request.gas), gasPrice: BigInt(request.gasPrice),
      to: request.to, data: request.data, value: BigInt(request.value), type: "legacy",
    });
    const hash = keccak256(signed);
    try {
      assert.equal(await rpc("eth_sendRawTransaction", [signed]), hash);
    } catch (error) {
      // Some providers return a JSON-RPC revert error even if the transaction mined.
      if (decision !== "revert" || !(await rpc("eth_getTransactionReceipt", [hash]))) throw error;
    }
    let receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (!receipt) {
      const pending = await rpc("eth_getTransactionByHash", [hash]);
      if (pending?.hash === hash && pending.blockNumber === null) {
        await rpc("evm_mine");
        receipt = await rpc("eth_getTransactionReceipt", [hash]);
      }
    }
    assert.ok(receipt);
    assert.equal(receipt.status, decision === "revert" ? "0x0" : "0x1");
    const transaction = await rpc("eth_getTransactionByHash", [hash]);
    assert.equal(BigInt(transaction.nonce), BigInt(request.nonce));
    assert.equal(transaction.input, request.data);
    assert.equal(BigInt(transaction.gas), BigInt(request.gas));
    assert.equal(BigInt(transaction.gasPrice), BigInt(request.gasPrice));
    const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
    assert.equal(block.hash, receipt.blockHash);
    receipts.push({ hash, nonce: request.nonce, calldataHash: keccak256(request.data), intent, value: request.value, gas: request.gas,
      gasPrice: request.gasPrice, status: receipt.status, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash });
    if (decision === "lose") {
      hideReceipt(hash);
      return {};
    }
    if (decision === "wrong-hash") return { value: receipts[0].hash };
    return { value: hash };
  }
  await page.exposeFunction("localMobileRequest", async (request) => {
    try { return await walletRequest(request); }
    catch (error) { walletFailure = error; throw error; }
  });
  await page.addInitScript(() => {
    const listeners = new Map();
    window.mobileWalletEvent = (name, value) => {
      for (const listener of listeners.get(name) ?? []) listener(value);
    };
    window.ethereum = {
      on: (name, listener) => {
        const group = listeners.get(name) ?? new Set();
        group.add(listener);
        listeners.set(name, group);
      },
      removeListener: (name, listener) => listeners.get(name)?.delete(listener),
      request: async ({ method, params }) => {
        const result = await window.localMobileRequest({ method, params });
        if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        return result.value;
      },
    };
  });
  const id = (name) => page.getByTestId("mobile-" + name);
  const screenshot = (suffix) => page.screenshot({ path: join(out, "mobile-wallet-" + suffix + ".png"), fullPage: true });
  const status = (phase) => page.locator('[data-testid="mobile-status"][data-phase="' + phase + '"]').waitFor();
  const prepare = async () => {
    await id("prepare").click();
    await id("approve").waitFor();
    assert.equal(await id("submit").isEnabled(), false, "A review never approves itself");
  };
  const submit = async () => {
    await id("approve").check();
    await id("submit").click();
  };
  const setWallet = async (selectedAccount, selectedChain) => {
    account = selectedAccount;
    connectedChain = selectedChain;
    await page.evaluate(({ selectedAccount, selectedChain }) => {
      window.mobileWalletEvent("accountsChanged", [selectedAccount]);
      window.mobileWalletEvent("chainChanged", selectedChain);
    }, { selectedAccount, selectedChain });
  };
  const noSend = () => assert.equal(attempts, 0, "Unsafe review never requested a wallet transaction");
  try {
    const invalidOrigin = await fetch(new URL(endpoint, site), {
      method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(invalidOrigin.status, 403);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(new URL(route, site).href);
    await id("connect").click();
    await prepare();
    const text = await page.locator("main").innerText();
    assert.match(text, /4663/);
    assert.match(text, /31337/);
    assert.match(text, /BLOCKED_NO_BROADCAST/i);
    assert.match(text, /0[.]0004\s*synthetic ETH/i);
    assert.ok(text.toLowerCase().includes(creator.address.toLowerCase()));
    assert.ok(text.toLowerCase().includes(factory.toLowerCase()));
    assert.equal(await id("offline-plan").locator("details").count(), 12);
    assert.match(await id("observed-sender").innerText(), /475/);
    assert.match(await id("observed-sender").innerText(), /7702/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot("portrait");
    await page.setViewportSize({ width: 844, height: 390 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot("landscape");
    await page.setViewportSize({ width: 390, height: 844 });

    await setWallet(alternate, chain);
    await status("wrongWallet");
    noSend();
    await setWallet(creator.address, "0x1237");
    await id("connect").click();
    await status("wrongWallet");
    assert.equal(await id("approve").count(), 0);
    noSend();
    await setWallet(creator.address, chain);
    await id("connect").click();
    await status("connected");

    await prepare();
    walletBlockMismatch = true;
    await submit();
    await status("stale");
    walletBlockMismatch = false;
    noSend();

    await prepare();
    setGasDrift(true);
    await submit();
    await status("stale");
    setGasDrift(false);
    noSend();

    await prepare();
    const checkpoint = await rpc("evm_snapshot");
    const nonce = BigInt(await rpc("eth_getTransactionCount", [creator.address, "pending"]));
    await rpc("anvil_setNonce", [creator.address, toHex(nonce + 1n)]);
    await submit();
    await status("stale");
    noSend();
    assert.equal(await rpc("evm_revert", [checkpoint]), true);

    await prepare();
    decision = "reject";
    await submit();
    await status("rejected");
    assert.equal(attempts, 1);
    assert.equal(receipts.length, 0);

    await prepare();
    decision = "revert";
    await submit();
    await status("reverted");
    assert.equal(receipts.length, 1);
    await screenshot("reverted");
    await id("clear").click();
    await status("connected");

    await prepare();
    decision = "lose";
    await submit();
    await page.locator('[data-testid="mobile-status"]:is([data-phase="pending"], [data-phase="unavailable"])').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="mobile-check"]')?.disabled === false);
    assert.equal(receipts.length, 2);
    await page.reload();
    await id("recover").waitFor();
    await screenshot("recovery-before-hash");
    await id("recovery-hash").fill(receipts[0].hash);
    await id("recover").click();
    await status("mismatch");
    assert.equal(attempts, 3);

    hideReceipt(undefined);
    await id("check").click();
    await status("confirmed");
    assert.equal(attempts, 3, "Recovery never broadcasts again");
    assert.deepEqual(receipts.map(({ status }) => status), ["0x0", "0x1"]);
    assert.notEqual(receipts[0].nonce, receipts[1].nonce);
    await screenshot("confirmed");
    await id("clear").click();
    await status("disconnected");
    await id("connect").click();
    await status("connected");
    await prepare();
    decision = "wrong-hash";
    await submit();
    await status("mismatch");
    await id("check").click();
    await status("confirmed");
    assert.equal(await id("transaction-hash").innerText(), receipts[2].hash);
    assert.equal(attempts, 4, "Recovery from an unrelated wallet-returned hash never broadcasts again");
    return { chainId: 31337, attemptedWalletRequests: attempts, receipts, wrongAccountRejected: true,
      wrongChainRejected: true, walletAnchorMismatchRejected: true, staleGasRejected: true, nonceDriftRejected: true,
      walletRejection: true, minedRevert: true, receiptMismatch: true, recoveredUnknownHashAfterReload: true,
      recoveredUnrelatedReturnedHash: true, duplicateBroadcast: false };
  } catch (error) {
    await screenshot("failure").catch(() => {});
    if (walletFailure) throw new Error("Synthetic wallet bridge failed", { cause: walletFailure });
    throw error;
  } finally {
    setGasDrift(false);
    hideReceipt(undefined);
    await page.close();
  }
}
