import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

test("creation dispatch preserves the original absolute URL and query across requests", () => {
  const path = "/api/launchpad/production-creation";
  for (const origin of ["https://rmt-review.example", "https://www.rmtlaunch.fun"]) {
    for (const suffix of ["", "?unused=1"]) {
      const href = origin + path + suffix;
      const result = middleware(new NextRequest(href, { method: "POST" }));
      assert.equal(result.headers.get("x-middleware-rewrite"), href);
      assert.equal(result.headers.get("cache-control"), "private, no-store");
    }
  }
  const unrelated = middleware(new NextRequest("https://www.rmtlaunch.fun/api/launchpad/production-lifecycle", { method: "POST" }));
  assert.equal(unrelated.headers.get("x-middleware-rewrite"), null);
});
