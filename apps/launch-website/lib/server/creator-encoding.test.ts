import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("creator and wallet copy contains original UTF-8 punctuation", () => {
  for (const name of ["creator-draft", "production-creation-wallet"]) {
    const source = readFileSync(new URL("../../app/_components/" + name + ".tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /[\u00c2\u00c3\ufffd]|\u00e2\u20ac/);
    if (name === "production-creation-wallet") assert.ok(source.includes("Robinhood Chain 4663 · real ETH"));
  }
});
