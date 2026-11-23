import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const load = createRequire(import.meta.url);

test("creator HTML follows deployment configuration even when live verification fails", async () => {
  let configured = true;
  let fault = "healthy";
  let reads = 0;
  const restore: Array<() => void> = [];
  function override(path: string, changes: Record<string, unknown>) {
    const original = load(path);
    const entry = load.cache[load.resolve(path)]!;
    entry.exports = { ...original, ...changes };
    restore.push(() => { entry.exports = original; });
  }
  const route = "../../app/create-token/page";
  try {
    override("next/headers", { headers: async () => new Headers({ host:"www.rmtlaunch.fun" }) });
    override("./production-creation", { productionCreationEnabled: () => configured });
    override("./curve-production", {
      configuredCurveProductionRelease: () => configured ? {} : null,
      verifyCurveProduction: async () => { reads++; if (fault === "rpc") throw Error("RPC unavailable"); },
    });
    override("./production-discovery", {
      configuredProductionDiscovery: () => true,
      readProductionDiscovery: async () => { reads++; return {status:fault === "stale" ? "unavailable" : "ready"}; },
    });
    // Model the client boundary. The live browser tests exercise the real owner/session gate.
    override("../../app/_components/creator-draft", { CreatorDraft: ({productionCreation}: {productionCreation?: {factory:string}}) =>
      createElement("div", { "data-owner-factory": productionCreation?.factory }) });
    const page = load(route).default;
    for (fault of ["healthy","stale","rpc"]) {
      const html = renderToStaticMarkup(await page());
      assert.match(html,/data-owner-factory="0x[0-9a-f]{40}"/i);
      assert.match(html,/Owner creation acceptance/);
      assert.doesNotMatch(html,/Draft only/);
    }
    configured = false;
    const disabled = renderToStaticMarkup(await page());
    assert.match(disabled,/Draft only/);
    assert.doesNotMatch(disabled,/data-owner-factory/);
    assert.equal(reads,0);
  } finally {
    delete load.cache[load.resolve(route)];
    for (const reset of restore.reverse()) reset();
  }
});
