import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { staticPublicSitemap } from "../app/sitemap";
import { indexNowUrlsForChangedStaticFiles } from "../scripts/indexnow-static-refresh";
import {
  RMT_BRAND_LOGO_URL,
  RMT_PUBLIC_IDENTITY_URLS,
  RMT_SITE_URL,
  rmtOrganizationStructuredData,
  rmtWebApplicationStructuredData,
  rmtWebsiteStructuredData
} from "./site-identity";

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

assert.match(rmtIdentitySource, /RMT \| Official Robinhood Meme Terminal Identity/);
assert.match(rmtIdentitySource, /type="application\/ld\+json"/);
assert.match(rmtIdentitySource, /"@type": "BreadcrumbList"/);
assert.match(rmtIdentitySource, /do not imply endorsement by Robinhood/);
assert.match(rmtIdentitySource, /0xdBa33be56C89CC9fc014c4459028d7e5c7878671/);
assert.match(rmtIdentitySource, /0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee/);
assert.match(rmtIdentitySource, /0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C/);
assert.match(rmtIdentitySource, /Official RMT V6 issuance/);
assert.match(rmtIdentitySource, /Original RMT V4 issuance/);
assert.match(rmtIdentitySource, /block: "9156510"/);
assert.match(rmtIdentitySource, /0xe5cd6ed09a3cccae743b7c29c0ee0971f3797986bce171eadc3642de60b3410b/);
assert.match(rmtIdentitySource, /href="#v6-official-provenance"/);
assert.doesNotMatch(rmtIdentitySource, /Retired launchpad launch 0 token|user-created token/);
assert.match(rmtIdentitySource, /"@type": "AboutPage"/);

assert.match(sitemapSource, /\["\/rmt", "monthly", 0\.9\]/);
assert.doesNotMatch(sitemapSource, /"\/(?:robinhood-chain|markets\/robinhood-chain|nft|experience)(?:\/|")/);
assert.match(footerSource, /href="\/rmt">RMT identity/);
assert.doesNotMatch(footerSource, /href="\/(?:robinhood-chain|markets\/robinhood-chain|nft|experience)(?:\/|")/);
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
assert.deepEqual(globalRefreshUrls, staticPublicSitemap().map(({ url }) => url));
assert.deepEqual(indexNowUrlsForChangedStaticFiles([
  "apps/web/app/robinhood-chain/page.tsx",
  "apps/web/app/markets/robinhood-chain/page.tsx",
  "apps/web/app/nft/page.tsx",
  "apps/web/app/experience/page.tsx",
]), []);
assert.ok(!globalRefreshUrls.some((url) => url.includes("/project/0xdBa33be56C89CC9fc014c4459028d7e5c7878671")));

console.info("Search reach, RMT identity, and incremental IndexNow smoke test passed");
