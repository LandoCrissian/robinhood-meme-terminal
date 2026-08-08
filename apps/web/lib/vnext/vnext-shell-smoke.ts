import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { config as middlewareConfig, vnextRequestBoundary } from "../../middleware";
import { vnextShellAvailable } from "./vnext-shell-access";

const page = readFileSync(new URL("../../app/vnext/page.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../app/vnext/vnext-terminal-shell.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/vnext/vnext-terminal.css", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../../app/public-chrome.tsx", import.meta.url), "utf8");

assert.match(page, /vnextShellAvailable\(process\.env\)/);
assert.match(page, /notFound\(\)/);
assert.match(page, /export const dynamic = "force-dynamic"/);
assert.match(chrome, /"\/vnext"/);

assert.equal(vnextShellAvailable({ NODE_ENV: "development" }), true);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", VERCEL_ENV: "preview" }), true);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", VERCEL_ENV: "production" }), false);
assert.equal(
  vnextShellAvailable({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED: "true",
  }),
  false,
);
assert.equal(vnextShellAvailable({ NODE_ENV: "production" }), false);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED: "true" }), true);

const blockedResponse = vnextRequestBoundary({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED: "true",
});
assert.equal(blockedResponse.status, 404);
assert.equal(blockedResponse.headers.get("cache-control"), "private, no-store, max-age=0");
assert.equal(blockedResponse.headers.get("x-robots-tag"), "noindex, nofollow");
assert.notEqual(blockedResponse.body, null);

const blockedHeadResponse = vnextRequestBoundary({ NODE_ENV: "production", VERCEL_ENV: "production" }, "HEAD");
assert.equal(blockedHeadResponse.status, 404);
assert.equal(blockedHeadResponse.body, null);

const previewResponse = vnextRequestBoundary({ NODE_ENV: "production", VERCEL_ENV: "preview" });
assert.equal(previewResponse.status, 200);
assert.equal(previewResponse.headers.get("x-middleware-next"), "1");
assert.equal(middlewareConfig.matcher, "/vnext/:path*");

assert.equal((shell.match(/export function VNextTerminalShell/g) ?? []).length, 1);
assert.match(shell, /Available to trade/);
assert.match(shell, /Pending/);
assert.match(shell, /Markets/);
assert.match(shell, /Example best execution/);
assert.match(shell, /Preview only — trading disabled/);
assert.match(shell, /cannot request quotes, approvals, signatures, or transactions/);
assert.doesNotMatch(shell, /fetch\s*\(/);
assert.doesNotMatch(shell, /useAccount|useSendTransaction|writeContract|signTypedData/);

assert.match(styles, /\.rmtVnext/);
assert.match(styles, /@media \(max-width: 760px\)/);
assert.match(styles, /@media \(max-width: 1280px\)/);
assert.match(styles, /prefers-reduced-motion/);
assert.doesNotMatch(styles, /!important/);
assert.doesNotMatch(styles, /terminal-v(?:7|8|9|10|11|12)/i);

console.log("RMT VNext shell smoke checks passed.");
