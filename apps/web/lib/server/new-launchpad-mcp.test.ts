import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GET, POST } from "../../app/mcp/route";

const endpoint = new URL("http://127.0.0.1:3000/mcp");
const messageHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };

test("the official Streamable HTTP client negotiates and discovers only launch reads", async () => {
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      return request.method === "GET" ? GET(request) : POST(request);
    },
  });
  const client = new Client({ name: "rmt-launch-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(({ name }) => name).sort(), [
      "get_launch", "get_launch_activity", "get_launch_checks", "get_pool_state", "list_launches",
    ]);
    assert.ok(tools.every(({ annotations, inputSchema }) => annotations?.readOnlyHint && inputSchema.additionalProperties === false));

    const unavailable = await client.callTool({ name: "list_launches", arguments: { chainId: 4663 } });
    assert.equal(unavailable.isError, true);
    assert.equal((unavailable.structuredContent as { status: string }).status, "disabled");

    const invalid = await client.callTool({ name: "get_launch", arguments: { chainId: 31337, token: "RMT" } });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent, undefined);

    const extra = await client.callTool({ name: "list_launches", arguments: { chainId: 31337, rpcUrl: "http://example.com" } });
    assert.equal(extra.isError, true);
    assert.equal(extra.structuredContent, undefined);
  } finally {
    await client.close();
  }
});

test("the local HTTP boundary rejects external origins, batches and oversized requests", async () => {
  const body = JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 });
  assert.equal((await POST(new Request("https://example.com/mcp", { method: "POST", headers: messageHeaders, body }))).status, 404);
  assert.equal((await POST(new Request(endpoint, { method: "POST", headers: { ...messageHeaders, origin: "https://example.com" }, body }))).status, 403);
  assert.equal((await POST(new Request(endpoint, { method: "POST", headers: messageHeaders, body: `[${body}]` }))).status, 400);
  assert.equal((await POST(new Request(endpoint, { method: "POST", headers: messageHeaders, body: `"${"a".repeat(8193)}"` }))).status, 413);
  assert.equal(GET(new Request(endpoint, { headers: { accept: "text/event-stream" } })).status, 405);
});

test("protocol requests have a shared fixed-size budget independent of caller headers", () => {
  let limited: Response | undefined;
  for (let index = 0; index <= 120; index += 1) {
    const response = GET(new Request(endpoint, { headers: { "x-forwarded-for": `198.51.100.${index}` } }));
    if (response.status === 429) {
      limited = response;
      break;
    }
  }
  assert.ok(limited);
  assert.match(limited.headers.get("retry-after") ?? "", /^(?:[1-9]|[1-5]\d|60)$/);
  assert.equal(GET(new Request(endpoint, { headers: { "x-forwarded-for": "203.0.113.9" } })).status, 429);
});
