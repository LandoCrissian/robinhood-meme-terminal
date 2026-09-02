import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vNextProviderLabel, vNextProviderRoutePresentation } from "./provider-presentation";

assert.equal(vNextProviderLabel("uniswap-v2"), "Uniswap V2");
assert.equal(vNextProviderRoutePresentation({ provider: "uniswap-v2", route: "direct" }).routeLabel, "Direct V2");
assert.equal(vNextProviderRoutePresentation({ provider: "uniswap-v2", route: "weth_hop" }).routeLabel, "V2 via WETH");
assert.equal(vNextProviderLabel("uniswap-v3"), "Uniswap V3");
assert.equal(vNextProviderRoutePresentation({ provider: "uniswap-v3", route: "direct" }).routeLabel, "Direct V3");
assert.equal(vNextProviderRoutePresentation({ provider: "uniswap-v3", route: "weth_hop" }).routeLabel, "V3 via WETH");
assert.equal(vNextProviderRoutePresentation({ provider: "uniswap-v4", route: "v4_pool" }).routeLabel, "Canonical V4 PoolKey");
assert.equal(vNextProviderLabel("up-v2"), "UP V2");
assert.equal(vNextProviderLabel("up-cl"), "UP CL");

const walletReview = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(walletReview, /vNextProviderLabel\(evidence\.provider\)/);
assert.match(walletReview, /RMT atomic fee settlement · policy v2/);
assert.doesNotMatch(walletReview, /Uniswap V3 · RMT atomic settlement V2/);
assert.match(composer, /vNextProviderRoutePresentation/);
assert.match(composer, /RMT atomic fee settlement · policy v2/);
assert.doesNotMatch(composer, /visibleVerification\.route === "direct" \? "Direct V3"/);
assert.doesNotMatch(composer, /RMT atomic settlement V2/);

console.log("RMT canonical provider and route presentation checks passed.");
