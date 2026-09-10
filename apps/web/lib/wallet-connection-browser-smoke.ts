import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Run with: pnpm exec tsx lib/wallet-connection-browser-smoke.ts
// Automated desktop/mobile acceptance of the real panel/controller.
// No wallet SDK, extension, or external RPC is used.
async function main() {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild") as {
    build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }>;
  };
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./wallet-connection-browser-fixture.tsx", import.meta.url))],
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }
  });
  const { chromium } = createRequire(new URL("../../../package.json", import.meta.url))("playwright") as typeof import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 667 }]) {
  const token = randomUUID();
  let reportResult: (value: { ok: boolean }) => void = () => {};
  const reported = new Promise<{ ok: boolean }>(resolve => { reportResult = resolve; });
  const server = createServer((req, res) => {
    if (req.url === `/fixture/${token}`) {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta charset="utf-8"><title>Wallet lifecycle smoke</title><div id="root"></div><script src="/fixture.js"></script>');
    } else if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript"); res.end(result.outputFiles![0].text);
    } else if (req.url === "/result" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; if (body.length > 16_384) req.destroy(); });
      req.on("end", () => {
        try {
          const report = JSON.parse(body);
          console.log(JSON.stringify({ viewport, ...report }, null, 2));
          reportResult(report);
        } catch { reportResult({ ok: false }); }
        res.end("recorded");
      });
    } else { res.statusCode = 404; res.end(); }
  });
  const deadline = setTimeout(() => reportResult({ ok: false }), 30_000);
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture address");
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/fixture/${token}`);
    if (!(await reported).ok) throw new Error("Wallet browser lifecycle failed");
  } finally { clearTimeout(deadline); await context.close(); server.close(); }
  }
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
