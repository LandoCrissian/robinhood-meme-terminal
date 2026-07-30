import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rmt-public-surface-"));
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-public-surface.mjs");
const write = (name, value) => fs.writeFileSync(path.join(directory, name), value);

try {
  write("home.headers", "HTTP/2 200\r\ncontent-type: text/html; charset=utf-8\r\n");
  write("home.html", [
    "<title>RMT Launch | Robinhood Meme Terminal</title>",
    '<meta name="robots" content="index, follow"/>',
    '<link rel="canonical" href="https://www.rmtlaunch.fun"/>',
    '<meta property="og:site_name" content="RMT Launch"/>',
    '<script type="application/ld+json">',
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "RMT Launch",
      alternateName: "Robinhood Meme Terminal",
      url: "https://www.rmtlaunch.fun/"
    }),
    "</script>"
  ].join(""));
  write("robots.txt", [
    "User-Agent: *",
    "Allow: /",
    "Sitemap: https://www.rmtlaunch.fun/sitemap.xml"
  ].join("\n"));
  write("sitemap.xml", "<urlset><url><loc>https://www.rmtlaunch.fun/</loc></url></urlset>");

  const healthy = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /canonical identity/);

  write("home.headers", "HTTP/2 200\r\ncontent-type: text/html\r\nx-robots-tag: noindex\r\n");
  const blocked = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /noindex/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.info("Public surface verifier smoke test passed");
