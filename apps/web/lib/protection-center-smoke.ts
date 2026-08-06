import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const protectionLayout = readFileSync(new URL("../app/protection/layout.tsx", import.meta.url), "utf8");
const protectionPage = readFileSync(new URL("../app/protection/page.tsx", import.meta.url), "utf8");
const protectionCenter = readFileSync(new URL("../app/protection/protection-center.tsx", import.meta.url), "utf8");
const protectionInventoryRoute = readFileSync(
  new URL("../app/api/position-guards/live/list/route.ts", import.meta.url),
  "utf8"
);
const protectionOrderRoute = readFileSync(
  new URL("../app/api/position-guards/live/route.ts", import.meta.url),
  "utf8"
);
const evaluatorRoute = readFileSync(
  new URL("../app/api/internal/position-guards/evaluate/route.ts", import.meta.url),
  "utf8"
);
const publicChrome = readFileSync(new URL("../app/public-chrome.tsx", import.meta.url), "utf8");
const localGuardPanel = readFileSync(new URL("../app/position-guard-panel.tsx", import.meta.url), "utf8");
const liveGuardControls = readFileSync(new URL("../app/live-position-guard-controls.tsx", import.meta.url), "utf8");
const reviewPolicy = readFileSync(new URL("./live-position-guard-review.ts", import.meta.url), "utf8");

assert.match(protectionLayout, /import "\.\/protection-center\.css"/);
assert.match(protectionPage, /<ProtectionCenter \/>/);
assert.match(protectionCenter, /\/api\/position-guards\/live\/list/);
assert.match(protectionCenter, /Manage and revoke/);
assert.match(protectionCenter, /walletCleanupReported === false/);
assert.match(protectionCenter, /revocationPending/);
assert.match(protectionCenter, /already-submitted transaction cannot settle/);
assert.match(protectionCenter, /server-backed automatic exit/);
assert.match(protectionCenter, /livePositionGuardReviewMessage/);

assert.match(protectionInventoryRoute, /\.where\("ownerKey", "==", ownerKey\(identity\.id\)\)/);
assert.match(protectionInventoryRoute, /\.limit\(MAX_ORDERS\)/);
assert.match(protectionInventoryRoute, /capped: snapshot\.size >= MAX_ORDERS/);
assert.match(protectionInventoryRoute, /reviewReason: livePositionGuardReviewReason/);
assert.doesNotMatch(protectionInventoryRoute, /walletId\s*:/);
assert.doesNotMatch(protectionInventoryRoute, /authorizationId\s*:/);

assert.match(protectionOrderRoute, /livePositionGuardAuthorityMatchesPlan/);
assert.match(protectionOrderRoute, /livePositionGuardCanReplaceOrder/);
assert.match(protectionOrderRoute, /database\.runTransaction/);
assert.match(protectionOrderRoute, /allowance equal to the protected amount/);
assert.match(protectionOrderRoute, /must be cleared or reconciled/);
assert.match(evaluatorRoute, /livePositionGuardRuntimeAuthority/);
assert.match(evaluatorRoute, /const amountIn = amountLimit/);
assert.match(evaluatorRoute, /balance_below_order_limit/);
assert.match(evaluatorRoute, /transaction_receipt_timeout/);
assert.match(evaluatorRoute, /\.orderBy\("lastEvaluatedAt", "asc"\)/);
assert.match(evaluatorRoute, /Promise\.all\(orders\.docs\.map/);
assert.match(reviewPolicy, /allowance_exceeds_order_limit/);
assert.match(reviewPolicy, /residual executor allowance/);

assert.match(localGuardPanel, /armingEnabled=\{false\}/);
assert.match(localGuardPanel, /Server-backed automatic permissions must be managed separately in Protection Center/);
assert.match(liveGuardControls, /candidate\.address\.toLowerCase\(\) === wallet\.toLowerCase\(\)/);
assert.match(liveGuardControls, /armingEnabled && configuration\.enabled/);
assert.match(liveGuardControls, /already-authorized transaction may still confirm/);

assert.match(publicChrome, /<PublicLink href="\/protection">Protection<\/PublicLink>/);
assert.match(publicChrome, /<PublicLink href="\/watchlist"><span aria-hidden="true">☆<\/span>Watchlist<\/PublicLink>/);
assert.match(publicChrome, /<PublicLink href="\/protection"><span aria-hidden="true">◇<\/span>Protection<\/PublicLink>/);

console.log("Protection Center and cross-device recovery smoke checks passed");
