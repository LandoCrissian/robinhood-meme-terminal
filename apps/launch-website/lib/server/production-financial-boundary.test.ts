import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { handleProductionLifecycle } from "./production-lifecycle";
import { handleProductionEarningsClaim } from "./production-earnings";
import { config as creationRule } from "../../netlify/edge-functions/launch-creation-limit";
import { encodeFunctionData, type Hex } from "viem";
import { productionCreationAbi, productionCreationFactory, submitProductionCreation, type ProductionCreationRequest } from "../production-creation";

test("exact financial POST routes reach their complete gates; GET and sibling paths stay closed", () => {
  for (const path of ["/api/launchpad/production-lifecycle", "/api/launchpad/production-earnings"]) {
    const response = middleware(new NextRequest(`https://www.rmtlaunch.fun${path}`, { method: "POST" }));
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
    for (const method of ["GET", "HEAD", "PUT", "DELETE"]) assert.notEqual(middleware(new NextRequest(`https://www.rmtlaunch.fun${path}`, { method })).headers.get("x-middleware-next"), "1");
    assert.notEqual(middleware(new NextRequest(`https://www.rmtlaunch.fun${path}/extra`, { method: "POST" })).headers.get("x-middleware-next"), "1");
    assert.ok(creationRule.path.includes(path));
  }
  assert.deepEqual(creationRule.rateLimit, { windowSize: 60, windowLimit: 12, aggregateBy: ["ip", "domain"] });
});

test("routed financial adapters return no execution capability with every financial flag absent", async () => {
  for (const handler of [handleProductionLifecycle, handleProductionEarningsClaim]) {
    const response = await handler(new Request("https://www.rmtlaunch.fun/api/launchpad/production-lifecycle", { method: "POST",
      headers: { host: "www.rmtlaunch.fun", origin: "https://www.rmtlaunch.fun", "x-forwarded-proto": "https", "content-type": "application/json" }, body: "{}" }));
    assert.equal(response.status, 404);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.notEqual((await response.json()).executionEnabled, true);
  }
});

test("creation joins the shared financial protections and cannot send through storage that silently discards the intent", async () => {
  const owner = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA", hash = `0x${"a".repeat(64)}` as Hex;
  const request: ProductionCreationRequest = { from: owner, to: productionCreationFactory, chainId: "0x1237", nonce: "0x0",
    value: "0x16bcc41e90000", intentId: hash, deadline: "1800000000", blockNumber: "0x6f6c31e", blockHash: hash,
    data: encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: ["Storage Test", "STORE", "https://example.invalid/project",
      "0x0000000000000000000000000000000000000000", 0, hash, 1800000000n] }) };
  let sends = 0;
  const provider = { async request(input: { method: string }) {
    if (input.method === "eth_accounts") return [owner];
    if (input.method === "eth_chainId") return "0x1237";
    if (input.method === "eth_getTransactionCount") return "0x0";
    if (input.method === "eth_getBlockByNumber") return { hash };
    if (input.method === "eth_sendTransaction") { sends++; return hash; }
    throw Error("Unexpected wallet method");
  } };
  await assert.rejects(submitProductionCreation({ account: owner, provider, request: provider.request }, request,
    { getItem: () => null, setItem: () => {}, removeItem: () => {} }, () => {}), /durably recorded/);
  assert.equal(sends, 0);
});
