import assert from "node:assert/strict";
import { createSettlementTraceClient, readBoundedSettlementJson } from "./vnext-settlement-trace-client";
import { normalizeNativeTrace } from "../vnext/normalized-native-trace";
import { POST } from "../../app/api/vnext/native-settlement-trace/route";

const hash = `0x${"ab".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const wallet = "0x1111111111111111111111111111111111111111";
const holder = "0x0000000000001fF3684f28c67538d4D072C22734";
const marker = "DO_NOT_EXPOSE_PROVIDER_TEXT_OR_ENDPOINT";
const trace = () => ({ type: "CALL", from: wallet, to: holder, input: "0x12345678", value: "0x0",
  calls: [{ type: "CALL", from: holder, to: wallet, value: "0x96", input: "0x" }] });
type Fixture = { method: string; id: number; params: unknown[] };
async function run() {
  let sent = 0;
  const fetcher = (mutate: (body: Record<string, unknown>, request: Fixture) => unknown = body => body): typeof fetch => async (_url, init) => {
    sent++;
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    const request = JSON.parse(String(init?.body)) as Fixture;
    assert.ok(["eth_chainId", "eth_getTransactionReceipt", "debug_traceTransaction"].includes(request.method));
    if (request.method === "debug_traceTransaction") assert.deepEqual(request.params, [hash, { tracer: "callTracer", timeout: "5s" }]);
    const result = request.method === "eth_chainId" ? "0x1237" : request.method === "debug_traceTransaction" ? trace()
      : { status: "0x1", transactionHash: hash, blockHash };
    return Response.json(mutate({ jsonrpc: "2.0", id: request.id, result }, request));
  };
  const client = (fetch: typeof globalThis.fetch) => createSettlementTraceClient({ endpoint: `https://trace-fixture.invalid/${marker}`, fetch, timeoutMs: 1000 });
  const good = await client(fetcher())(hash);
  assert.equal(good.status, "available"); assert.equal(sent, 4);
  assert.ok(!JSON.stringify(good).includes(marker)); assert.ok(!JSON.stringify(good).includes("12345678"));
  if (good.status === "available") { assert.equal(good.blockHash, blockHash); assert.ok(good.trace.inputHash); }
  sent = 0; assert.equal((await client(fetcher())("not-a-hash")).status, "unavailable"); assert.equal(sent, 0);
  const reject = async (mutate: Parameters<typeof fetcher>[0]) => {
    const result = await client(fetcher(mutate))(hash);
    assert.equal(result.status, "unavailable"); assert.ok(!JSON.stringify(result).includes(marker));
  };
  await reject(body => ({ ...body, id: 999 }));
  await reject(body => ({ ...body, jsonrpc: "1.0" }));
  await reject(body => ({ ...body, error: { code: -32601, message: marker } }));
  await reject((body, request) => request.method === "eth_chainId" ? { ...body, result: "0x1" } : body);
  await reject((body, request) => request.method === "eth_getTransactionReceipt" ? { ...body, result: null } : body); // nonexistent tx
  await reject((body, request) => request.id === 4 ? { ...body, result: { status: "0x1", transactionHash: hash, blockHash: `0x${"ef".repeat(32)}` } } : body);
  await reject((body, request) => request.method === "debug_traceTransaction" ? { ...body, result: { ...trace(), error: marker } } : body);
  await reject((body, request) => request.method === "debug_traceTransaction" ? { ...body, result: { type: "CALL", from: marker } } : body);
  await reject((body, request) => request.method === "debug_traceTransaction" ? { ...body, result: { ...trace(), calls: Array.from({ length: 4097 }, () => trace().calls[0]) } } : body);
  let nested: any = trace(); for (let i = 0; i < 66; i++) nested = { ...trace(), calls: [nested] };
  await reject((body, request) => request.method === "debug_traceTransaction" ? { ...body, result: nested } : body);
  assert.equal((await client(async () => new Response(" ".repeat(1024 * 1024 + 1)))(hash)).status, "unavailable");
  assert.equal((await client(async () => new Response('{"jsonrpc":"2.0","id":1,"id":1,"result":"0x1237"}'))(hash)).status, "unavailable");
  assert.equal((await client(async () => { throw new Error(marker); })(hash)).status, "unavailable");
  const timeout = createSettlementTraceClient({ endpoint: "https://trace-fixture.invalid", timeoutMs: 5, fetch: () => new Promise(() => {}) });
  assert.equal((await timeout(hash)).status, "unavailable");
  await assert.rejects(() => readBoundedSettlementJson(new Response("{".repeat(140))));
  const normalized = normalizeNativeTrace({ ...trace(), calls: [{ ...trace().calls[0], error: marker }] });
  assert.equal(normalized.calls[0].error, true); assert.ok(!JSON.stringify(normalized).includes(marker));
  const unauthorized = await POST(new Request("https://rmt.invalid/api/vnext/native-settlement-trace", { method: "POST",
    body: JSON.stringify({ txHash: hash, wallet }), headers: { "Content-Type": "application/json" } }));
  assert.equal(unauthorized.status, 401, "server trace endpoint preserves Privy identity boundary");
  console.log("Server-only native trace resource/identity/timeout/normalization adversarial tests PASS.");
}
void run();
