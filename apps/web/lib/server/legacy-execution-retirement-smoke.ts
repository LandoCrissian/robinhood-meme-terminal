import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RETIRED_TRANSACTION_PREPARATION_MESSAGE,
  retiredTransactionPreparationResponse
} from "./retired-transaction-preparation";
import { VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY } from "../vnext/provider-fee-settlement";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = join(webRoot, "app/api");
const transactionAuthorityKeys = /approvalSpender|approvalTransaction|depositTransaction|calldata|executionId|transactionTarget/;
const forbiddenPreparationImports = /external-uniswap-trade|external-uniswap-v4-trade|rmt-v4-trade|sushi-trade|vnext-across-funding|live-position-guard-execution|sendLivePositionGuardTransaction/;

function routesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return routesBelow(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

const retiredPublicRouteSources = [
  "app/api/trade/external-uniswap/route.ts",
  "app/api/trade/external-uniswap-v4/route.ts",
  "app/api/trade/external-sushi-quote/route.ts",
  "app/api/trade/rmt-v4/route.ts",
  "app/api/trade/sushi-quote/route.ts",
  "app/api/vnext/funding/across/quote/route.ts"
];
const retiredWorkerRouteSource = "app/api/internal/position-guards/evaluate/route.ts";

for (const route of [...retiredPublicRouteSources, retiredWorkerRouteSource]) {
  const source = readFileSync(join(webRoot, route), "utf8");
  assert.match(source, /retiredTransactionPreparationResponse/);
  assert.doesNotMatch(source, forbiddenPreparationImports);
  assert.doesNotMatch(source, transactionAuthorityKeys);
  assert.doesNotMatch(source, /\.json\(|readBoundedJsonRequest|requireAuthenticatedTradeWallet|createPublicClient|fetch\(/);
}

const tradeRoutes = routesBelow(join(apiRoot, "trade")).map((route) => relative(webRoot, route).replaceAll("\\", "/")).sort();
assert.deepEqual(tradeRoutes, [
  "app/api/trade/external-availability/route.ts",
  "app/api/trade/external-sushi-quote/route.ts",
  "app/api/trade/external-uniswap-v4/route.ts",
  "app/api/trade/external-uniswap/route.ts",
  "app/api/trade/external-venues/route.ts",
  "app/api/trade/rmt-v4/route.ts",
  "app/api/trade/sushi-quote/route.ts"
]);

const informationalRoutes = tradeRoutes.filter((route) => /external-(availability|venues)/.test(route));
const retiredTradeRoutes = tradeRoutes.filter((route) => !informationalRoutes.includes(route));
assert.equal(informationalRoutes.length, 2);
assert.equal(retiredTradeRoutes.length, 5);
for (const route of informationalRoutes) {
  assert.doesNotMatch(readFileSync(join(webRoot, route), "utf8"), transactionAuthorityKeys);
}

const activeClientSources = routesBelow(join(webRoot, "app"))
  .filter((route) => !route.includes(`${join("app", "api")}`))
  .map((route) => readFileSync(route, "utf8"));
const appClientSources = readdirSync(join(webRoot, "app"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name))
  .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
for (const source of [...activeClientSources, ...appClientSources]) {
  assert.doesNotMatch(source, /\/api\/trade\/(external-uniswap(?:-v4)?|external-sushi-quote|rmt-v4|sushi-quote)|\/api\/vnext\/funding\/across\/quote/);
}

const authorizeRoute = readFileSync(join(webRoot, "app/api/vnext/authorize/route.ts"), "utf8");
assert.match(authorizeRoute, /prepareRobinhoodVNextAuthorization/);
assert.match(authorizeRoute, /stockTokenExecutionPolicyErrorResponse/);
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v3"].state, "V2_ATOMIC_INPUT_FEE");
assert.ok(Object.entries(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY).every(([provider, entry]) => provider === "uniswap-v3" || entry.state === "QUOTE_ONLY"));
const providerAdapter = readFileSync(join(webRoot, "lib/server/vnext-provider-adapter.ts"), "utf8");
assert.match(providerAdapter, /assertVNextWalletFeeAdmission/);
assert.match(providerAdapter, /VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY/);

const positionGuardRoute = readFileSync(join(webRoot, "app/api/position-guards/live/route.ts"), "utf8");
assert.match(positionGuardRoute, /input\.action === "arm"[\s\S]*retiredTransactionPreparationResponse/);
assert.match(positionGuardRoute, /livePositionGuardCancellationDisposition/);
assert.doesNotMatch(positionGuardRoute, forbiddenPreparationImports);

const engine = readFileSync(join(webRoot, "lib/server/vnext-execution-engine.ts"), "utf8");
assert.match(engine, /prepareRobinhoodVNextUniswapXIntent/);
assert.match(engine, /requireVNextStockTokenExecutionEligible/);
const apiRouteSources = routesBelow(apiRoot).map((route) => ({
  route: relative(webRoot, route).replaceAll("\\", "/"),
  source: readFileSync(route, "utf8")
}));
const apiSources = apiRouteSources.map(({ source }) => source);
assert.equal(apiSources.filter((source) => /prepareRobinhoodVNextUniswapXIntent/.test(source)).length, 0);
assert.deepEqual(
  apiRouteSources.filter(({ source }) => transactionAuthorityKeys.test(source)).map(({ route }) => route).sort(),
  ["app/api/vnext/authorize/route.ts", "app/api/vnext/verify/route.ts"]
);
const verifyRoute = readFileSync(join(webRoot, "app/api/vnext/verify/route.ts"), "utf8");
assert.doesNotMatch(verifyRoute, /authorizationPayloadHash|VNextAuthorizationPlan|prepared\.transaction/);

async function expectGone(post: () => Promise<Response> | Response) {
  const response = await post();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json() as Record<string, unknown>;
  assert.deepEqual(payload, { error: RETIRED_TRANSACTION_PREPARATION_MESSAGE });
  assert.doesNotMatch(JSON.stringify(payload), transactionAuthorityKeys);
}

async function main() {
  process.env.RMT_EXTERNAL_UNISWAP_EXECUTION_ENABLED = "true";
  process.env.RMT_SUSHI_QUOTES_ENABLED = "true";
  process.env.RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED = "true";
  let bodyParseCalls = 0;
  const body = { json: async () => { bodyParseCalls += 1; throw new Error("body must not be parsed"); } };
  const modules = await Promise.all([
    import("../../app/api/trade/external-uniswap/route"),
    import("../../app/api/trade/external-uniswap-v4/route"),
    import("../../app/api/trade/external-sushi-quote/route"),
    import("../../app/api/trade/rmt-v4/route"),
    import("../../app/api/trade/sushi-quote/route"),
    import("../../app/api/vnext/funding/across/quote/route"),
    import("../../app/api/internal/position-guards/evaluate/route")
  ]);
  for (const route of modules) {
    const post = route.POST as (request?: Request) => Promise<Response>;
    await expectGone(() => post(body as unknown as Request));
  }
  assert.equal(bodyParseCalls, 0);
  await expectGone(() => retiredTransactionPreparationResponse());

  const livePositionGuard = await import("../../app/api/position-guards/live/route");
  const armRequest = new Request("https://rmt.invalid/api/position-guards/live", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://rmt.invalid", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ action: "arm" })
  });
  await expectGone(() => livePositionGuard.POST(armRequest));
}

void main().then(() => {
  console.log("Legacy execution route inventory and behavioral retirement checks passed: 7 trade routes inventoried, 5 retired trade routes, 1 retired funding route, and 1 retired worker route.");
}).catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
