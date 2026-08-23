import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const retiredToken = /0xdba33be56c89cc9fc014c4459028d7e5c7878671/i;
const retiredMarket = /0xb26fb775c0ac365d369bee9ac2e044c5d90ffbee/i;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const currentProductFiles = [
  "../../app/api/markets/external/route.ts",
  "../../app/sitemap.ts",
  "../../app/sushi/page.tsx",
  "../../app/approved-project-directory.tsx",
  "../project-page.ts",
  "../public-project-discovery.ts",
  "../public-project-visibility.ts",
  "./robinhood-assets.ts",
  "./wallet-assets.ts",
  "./market-directory.ts",
  "../server/vnext-legacy-market-directory.ts",
  "../../app/vnext/use-vnext-market-directory.ts",
  "../../scripts/indexnow-static-refresh.ts"
];
for (const path of currentProductFiles) {
  const source = read(path);
  assert.doesNotMatch(source, retiredToken, `${path} must not treat launch 0 as current product configuration`);
  assert.doesNotMatch(source, retiredMarket, `${path} must not treat the launch 0 market as current product configuration`);
}

const releaseFiles = [
  "../../../../.github/workflows/production-health.yml",
  "../../../../scripts/verify-production-health.mjs",
  "../../../../scripts/verify-production-health-smoke.mjs"
];
for (const path of releaseFiles) {
  const source = read(path);
  assert.doesNotMatch(source, retiredToken, `${path} must not use launch 0 as a release fixture`);
  assert.doesNotMatch(source, retiredMarket, `${path} must not use the launch 0 market as a release fixture`);
}

const healthVerifier = read("../../../../scripts/verify-production-health.mjs");
for (const currentControl of [
  "0xe934e36a439c94017b64a3fece66af12099abf50",
  "0x39dbed3a2bd333467115de45665cc57f813c4571",
  "0x5cb6f181081301b44905f3ae15419112ecabd8a6",
  "0x020bfc650a365f8bb26819deaabf3e21291018b4",
  "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3"
]) assert.match(healthVerifier, new RegExp(currentControl, "i"));
assert.match(healthVerifier, /search-stonkbroker-text\.json/);

const rmtIdentityPage = read("../../app/rmt/page.tsx");
assert.match(rmtIdentityPage, retiredToken);
assert.match(rmtIdentityPage, retiredMarket);
assert.match(rmtIdentityPage, /Retired launchpad launch 0 token/);
assert.match(rmtIdentityPage, /not the current RMT token or a Terminal release requirement/);
assert.doesNotMatch(rmtIdentityPage, /Official RMT V6 token/);
assert.doesNotMatch(rmtIdentityPage, /existing official V6 market/);

const historicalDeployment = read("../../../../docs/MAINNET_V6_DEPLOYMENT.md");
assert.match(historicalDeployment, retiredToken);
assert.match(historicalDeployment, retiredMarket);
assert.match(historicalDeployment, /historical evidence only; launchpad retired; launch 0 dead/i);

for (const path of [
  "../server/vnext-universal-market-search.ts",
  "../server/vnext-market-indexer.ts",
  "./universal-market-search-contract.ts"
]) {
  const source = read(path);
  assert.doesNotMatch(source, retiredToken, `${path} must remain generic`);
  assert.doesNotMatch(source, retiredMarket, `${path} must remain generic`);
}

console.info("Retired launch-zero history is preserved without current product, release, search, or indexer special-casing.");
