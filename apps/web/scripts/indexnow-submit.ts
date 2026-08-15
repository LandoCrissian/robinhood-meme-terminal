import { pathToFileURL } from "node:url";
import { submitIndexNowUrls } from "../lib/server/indexnow";
import { RMT_SITE_URL } from "../lib/site-identity";

function decodeXmlText(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

export function indexNowUrlsFromSitemapXml(xml: string) {
  const urls = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)]
    .map((match) => decodeXmlText(match[1].trim()));
  if (urls.length === 0) throw new Error("Production sitemap contained no <loc> URLs.");
  return urls;
}

async function readSitemapUrls() {
  const sitemapUrl = `${RMT_SITE_URL}/sitemap.xml`;
  const response = await fetch(sitemapUrl, {
    headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" }
  });
  if (!response.ok) {
    throw new Error(`Could not read the production RMT sitemap: HTTP ${response.status}.`);
  }
  return indexNowUrlsFromSitemapXml(await response.text());
}

export async function runIndexNowSubmit(args = process.argv.slice(2)) {
  const explicitUrls = args.filter((argument) => !argument.startsWith("--"));
  const urls = explicitUrls.length > 0 ? explicitUrls : await readSitemapUrls();
  const result = await submitIndexNowUrls(urls);
  console.info(`IndexNow accepted ${result.submitted} canonical RMT URL(s) with HTTP ${result.status}.`);
  return result;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runIndexNowSubmit().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
