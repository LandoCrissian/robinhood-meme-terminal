import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RMT_PUBLIC_IDENTITY_URLS,
  RMT_SITE_URL,
  rmtWebApplicationStructuredData
} from "./site-identity";

const pageSource = readFileSync(new URL("../app/robinhood-chain/page.tsx", import.meta.url), "utf8");
const sitemapSource = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
const footerSource = readFileSync(new URL("../app/site-footer.tsx", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

assert.equal(rmtWebApplicationStructuredData["@type"], "WebApplication");
assert.equal(rmtWebApplicationStructuredData.url, `${RMT_SITE_URL}/`);
assert.equal(rmtWebApplicationStructuredData.applicationCategory, "FinanceApplication");
assert.ok(RMT_PUBLIC_IDENTITY_URLS.includes("https://x.com/RMTLaunch"));
assert.ok(RMT_PUBLIC_IDENTITY_URLS.includes("https://github.com/LandoCrissian/robinhood-meme-terminal"));

assert.match(pageSource, /Robinhood Chain Trading Terminal & Market Intelligence/);
assert.match(pageSource, /type="application\/ld\+json"/);
assert.match(pageSource, /"@type": "CollectionPage"/);
assert.match(pageSource, /"@type": "BreadcrumbList"/);
assert.match(pageSource, /independent Robinhood Chain terminal/);
assert.match(pageSource, /project origin, trading venue, RWA identity, and RMT-originated execution as separate facts/);
assert.match(pageSource, /Search by the contract, then verify before signing/);
assert.match(pageSource, /does not imply endorsement by Robinhood/);

assert.match(sitemapSource, /\["\/robinhood-chain", "daily", 0\.9\]/);
assert.match(footerSource, /href="\/robinhood-chain">Robinhood Chain/);
assert.match(layoutSource, /rmtWebApplicationStructuredData/);
assert.match(layoutSource, /JSON\.stringify\(rmtWebApplicationStructuredData\)/);

console.info("Search reach and Robinhood Chain authority surface smoke test passed");
