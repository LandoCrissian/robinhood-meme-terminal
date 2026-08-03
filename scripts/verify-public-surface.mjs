import fs from "node:fs";
import path from "node:path";

const artifactDirectory = process.argv[2] ?? "health-artifacts";
const read = (name) => fs.readFileSync(path.join(artifactDirectory, name), "utf8");
const home = read("home.html");
const homeHeaders = read("home.headers").toLowerCase();
const robots = read("robots.txt");
const sitemap = read("sitemap.xml");
const canonicalOrigin = "https://www.rmtlaunch.fun";

if (!homeHeaders.includes("content-type: text/html")) {
  throw new Error("Public home page did not return HTML.");
}
if (homeHeaders.includes("x-robots-tag: noindex")) {
  throw new Error("Public home page is sending an x-robots-tag noindex directive.");
}
if (!home.includes("<title>Robinhood Meme Terminal | RMT</title>")) {
  throw new Error("Public home page is missing the canonical Robinhood Meme Terminal title.");
}
if (!home.includes(`<link rel="canonical" href="${canonicalOrigin}"/>`)) {
  throw new Error("Public home page is missing the canonical www URL.");
}
if (!home.includes('<meta name="robots" content="index, follow"/>')) {
  throw new Error("Public home page is not explicitly indexable.");
}
if (!home.includes('<meta property="og:site_name" content="Robinhood Meme Terminal"/>')) {
  throw new Error("Public home page is missing its Open Graph site name.");
}

const jsonLdBlocks = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
const website = jsonLdBlocks
  .map((match) => JSON.parse(match[1]))
  .find((entry) => entry?.["@type"] === "WebSite");
if (
  !website
  || website.name !== "Robinhood Meme Terminal"
  || website.alternateName !== "RMT"
  || website.url !== `${canonicalOrigin}/`
) {
  throw new Error("Public home page WebSite identity is missing or invalid.");
}

if (!robots.includes("User-Agent: *") || !robots.includes("Allow: /")) {
  throw new Error("robots.txt does not allow the public site.");
}
if (!robots.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`)) {
  throw new Error("robots.txt does not advertise the canonical sitemap.");
}
if (!sitemap.includes(`<loc>${canonicalOrigin}/</loc>`)) {
  throw new Error("Sitemap does not publish the canonical home page.");
}
if (sitemap.includes("<loc>http://") || sitemap.includes("<loc>https://rmtlaunch.fun")) {
  throw new Error("Sitemap contains a non-canonical origin.");
}

console.info("Public site, crawler access, canonical identity, and sitemap are healthy.");
