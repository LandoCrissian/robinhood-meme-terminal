import assert from "node:assert/strict";
import { verifyLockedLaunchpadSurface } from "./verify-locked-launchpad-surface.mjs";

const jsonHeaders = "content-type: application/json\r\ncache-control: private, no-store\r\nx-robots-tag: noindex, nofollow";
const artifacts = {
  "launchpad-config.headers": jsonHeaders,
  "launchpad-config.json": '{"status":"disabled","reason":"New launches are disabled on this deployment."}',
  "launchpad-directory.headers": jsonHeaders,
  "launchpad-directory.json": '{"status":"disabled","launches":[]}',
  "launchpad-public-list.headers": jsonHeaders,
  "launchpad-public-list.json": '{"status":"disabled","reason":"Launchpad unavailable."}',
  "launchpad-mcp.headers": jsonHeaders,
  "launchpad-mcp.json": '{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"MCP is available only on the local preview."}}',
  "home.headers": "Content-Type: text/html; charset=utf-8",
  "home.html": '<title>RMT Launch | Token Launchpad</title><meta name="robots" content="noindex, nofollow"/><h1>Launches</h1><a href="/create-token">Create</a><a href="/my-launches">My Launches</a><a href="/wallet">Wallet</a>',
  "robots.txt": "Sitemap: https://www.rmtlaunch.fun/sitemap.xml",
  "sitemap.xml": "<urlset><loc>https://www.rmtlaunch.fun/</loc></urlset>",
};
const verify = (overrides = {}) => verifyLockedLaunchpadSurface((name) => overrides[name] ?? artifacts[name]);
assert.doesNotThrow(() => verify());
assert.throws(() => verify({ "launchpad-config.json": '{"status":"ready","deployment":{"chainId":4663}}' }), /locked launchpad/);
assert.throws(() => verify({ "launchpad-config.json": '{"status":"disabled","deployment":null}' }), /locked launchpad/);
assert.throws(() => verify({ "launchpad-directory.json": '{"status":"disabled","launches":[{}]}' }), /published launch records/);
assert.throws(() => verify({ "launchpad-public-list.json": '{"status":"disabled","data":{}}' }), /exposed data/);
assert.throws(() => verify({ "launchpad-public-list.headers": "Content-Type: text/html" }), /content-type/);
assert.throws(() => verify({ "launchpad-mcp.json": '{"jsonrpc":"2.0","id":1,"result":{}}' }), /accepted initialization/);
assert.throws(() => verify({ "launchpad-config.headers": jsonHeaders.replace("no-store", "public") }), /cache-control/);
assert.throws(() => verify({ "home.html": artifacts["home.html"].replace("noindex, nofollow", "index, follow") }), /robots/);
assert.throws(() => verify({ "home.html": artifacts["home.html"].replace('href="/wallet"', 'href="/portfolio"') }), /wallet/);
assert.throws(() => verify({ "sitemap.xml": artifacts["sitemap.xml"].replace("https://www.", "https://") }), /canonical/);
console.info("Locked production launchpad surface smoke test passed.");
