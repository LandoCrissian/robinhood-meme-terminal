import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { indexNowUrlsForChangedStaticFiles } from "../scripts/indexnow-static-refresh";
import {
  RMT_BRAND_LOGO_URL,
  RMT_PUBLIC_IDENTITY_URLS,
  RMT_SITE_URL,
  rmtOrganizationStructuredData,
  rmtWebApplicationStructuredData,
  rmtWebsiteStructuredData
} from "./site-identity";

const pageSource = readFileSync(new URL("../app/robinhood-chain/page.tsx", import.meta.url), "utf8");
const rmtIdentitySource = readFileSync(new URL("../app/rmt/page.tsx", import.meta.url), "utf8");
const sitemapSource = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
const footerSource = readFileSync(new URL("../app/site-footer.tsx", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

assert.equal(rmtOrganizationStructuredData["@type"], "Organization");
assert.equal(rmtOrganizationStructuredData.url, `${RMT_SITE_URL}/`);
assert.equal(rmtOrganizationStructuredData.logo, RMT_BRAND_LOGO_URL);
assert.deepEqual(rmtOrganizationStructuredData.sameAs, RMT_PUBLIC_IDENTITY_URLS);
assert.equal(rmtWebsiteStructuredData.publisher["@id"], `${RMT_SITE_URL}/#organization`);
assert.equal(rmtWebApplicationStructuredData["@type"], "WebApplication");
assert.equal(rmtWebApplicationStructuredData.url, `${RMT_SITE_URL}/`);
assert.equal(rmtWebApplicationStructuredData.applicationCategory, "FinanceApplication");
assert.equal(rmtWebApplicationStructuredData.publisher["@id"], `${RMT_SITE_URL}/#organization`);
assert.ok(RMT_PUBLIC_IDENTITY_URLS.includes("https://x.com/RMTLaunch"));
assert.ok(RMT_PUBLIC_IDENTITY_URLS.includes("https://github.com/LandoCrissian/robinhood-meme-terminal"));

assert.match(pageSource, /Robinhood Chain Trading Terminal & Market Intelligence/);
assert.match(pageSource, /type="application\/ld\+json"/);
assert.match(pageSource, /"@type": "CollectionPage"/);
assert.match(pageSource, /"@type": "BreadcrumbList"/);
assert.match(pageSource, /independent Robinhood Chain terminal/);
assert.match(pageSource, /project origin, trading venue, RWA identity, and RMT-originated execution as separate facts/);
assert.match(pageSource, /Search by the contract, then verify before signing/);
assert.match(pageSource, /do not\s+imply endorsement by Robinhood/);

assert.match(rmtIdentitySource, /RMT \| Official Robinhood Meme Terminal Identity/);
assert.match(rmtIdentitySource, /0xdBa33be56C89CC9fc014c4459028d7e5c7878671/);
assert.match(rmtIdentitySource, /0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee/);
assert.match(rmtIdentitySource, /0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C/);
assert.match(rmtIdentitySource, /Token names and tickers can be duplicated/);
assert.match(rmtIdentitySource, /"@type": "AboutPage"/);

assert.match(sitemapSource, /\["\/rmt", "monthly", 0\.9\]/);
assert.match(sitemapSource, /\["\/robinhood-chain", "daily", 0\.9\]/);
assert.match(footerSource, /href="\/rmt">RMT identity/);
assert.match(footerSource, /href="\/robinhood-chain">Robinhood Chain/);
assert.match(layoutSource, /rmtOrganizationStructuredData/);
assert.match(layoutSource, /JSON\.stringify\(rmtOrganizationStructuredData\)/);
assert.match(layoutSource, /rmtWebApplicationStructuredData/);
assert.match(layoutSource, /JSON\.stringify\(rmtWebApplicationStructuredData\)/);

assert.deepEqual(
  indexNowUrlsForChangedStaticFiles(["apps/web/app/rmt/page.tsx"]),
  [`${RMT_SITE_URL}/rmt`]
);
const globalRefreshUrls = indexNowUrlsForChangedStaticFiles(["apps/web/lib/site-identity.ts"]);
assert.ok(globalRefreshUrls.includes(`${RMT_SITE_URL}/`));
assert.ok(globalRefreshUrls.includes(`${RMT_SITE_URL}/rmt`));
assert.ok(globalRefreshUrls.includes(`${RMT_SITE_URL}/robinhood-chain`));
assert.ok(globalRefreshUrls.includes(`${RMT_SITE_URL}/project/0xdBa33be56C89CC9fc014c4459028d7e5c7878671`));

console.info("Search reach, RMT identity, and incremental IndexNow smoke test passed");
