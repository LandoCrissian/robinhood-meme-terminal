import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function requireHeader(read, response, field, token) {
  const value = read(`${response}.headers`).match(new RegExp(`^${field}:\\s*([^\\r\\n]+)`, "im"))?.[1];
  if (!value?.toLowerCase().split(/[,;\s]+/).includes(token)) {
    throw new Error(`${response} is missing ${field} ${token}.`);
  }
}

function requireDisabled(read, response) {
  requireHeader(read, response, "content-type", "application/json");
  requireHeader(read, response, "cache-control", "no-store");
  requireHeader(read, response, "x-robots-tag", "noindex");
  const body = JSON.parse(read(`${response}.json`));
  if (body?.status !== "disabled" || Object.hasOwn(body, "deployment")) {
    throw new Error(`${response} did not report a locked launchpad.`);
  }
  return body;
}

export function verifyLockedLaunchpadSurface(read) {
  requireDisabled(read, "launchpad-config");
  const directory = requireDisabled(read, "launchpad-directory");
  if (!Array.isArray(directory.launches) || directory.launches.length !== 0) {
    throw new Error("The locked directory published launch records.");
  }
  const publicList = requireDisabled(read, "launchpad-public-list");
  if (Object.hasOwn(publicList, "data")) throw new Error("The locked public read exposed data.");

  requireHeader(read, "home", "content-type", "text/html");
  const home = read("home.html");
  for (const fragment of [
    "<title>RMT Launch | Token Launchpad</title>", '<meta name="robots" content="noindex, nofollow"/>',
    "<h1>Launches</h1>", 'href="/create-token"', 'href="/my-launches"', 'href="/wallet"',
  ]) {
    if (!home.includes(fragment)) throw new Error(`The locked launchpad home is missing ${fragment}.`);
  }

  const canonical = "https://www.rmtlaunch.fun";
  const robots = read("robots.txt");
  const sitemap = read("sitemap.xml");
  if (!robots.includes(`Sitemap: ${canonical}/sitemap.xml`) || !sitemap.includes(`<loc>${canonical}/</loc>`)
    || /<loc>https?:\/\/rmtlaunch\.fun\b|<loc>http:\/\//i.test(sitemap)) {
    throw new Error("The launchpad crawler endpoints lost the canonical www identity.");
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const artifactDirectory = process.argv[2] ?? "health-artifacts";
  verifyLockedLaunchpadSurface((name) => fs.readFileSync(path.join(artifactDirectory, name), "utf8"));
  console.info("Launchpad home, disabled execution and disabled public reads verified.");
}
