import assert from "node:assert/strict";
import test from "node:test";
import { productionReaders } from "./curve-production";

test("financial readers retry a temporarily missing numbered block and a 503 without changing provider or height", async () => {
  const original = globalThis.fetch;
  const attempts = new Map<string, number>();
  try {
    globalThis.fetch = async (url, init) => {
      const endpoint = String(url), count = attempts.get(endpoint) ?? 0;
      attempts.set(endpoint, count + 1);
      const [query] = JSON.parse(String(init?.body));
      assert.equal(query.method, "eth_getBlockByNumber");
      assert.deepEqual(query.params, ["0x1", false]);
      if (!count && endpoint.includes("pocket")) return new Response(null, { status: 503, headers: { "Retry-After": "0" } });
      const result = !count ? null : { number: "0x1", timestamp: "0x2", hash: "0x" + "ab".repeat(32), transactions: [] };
      return Response.json([{ jsonrpc: "2.0", id: query.id, result }]);
    };
    const blocks = await Promise.all(productionReaders("financial").map(r => r.getBlock({ blockNumber: 1n })));
    assert.ok(blocks.every(b => b.number === 1n && b.hash === "0x" + "ab".repeat(32)));
    assert.deepEqual([...attempts.values()], [2, 2]);
  } finally { globalThis.fetch = original; }
});
