import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { captureAccountSurface } from "./account-first-browser-capture.mjs";

test("account captures await required fonts without depending on unrelated document loads", async t => {
  const output = await mkdtemp(path.join(tmpdir(), "rmt-account-capture-"));
  let font;
  for (const candidate of ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"]) {
    try { font = await readFile(candidate); break; } catch { /* next installed system-font file */ }
  }
  assert.ok(font, "The runner must provide a real font for loading regressions");
  const held = new Map();
  const server = createServer((req, res) => {
    if (req.url === "/held-image" || req.url === "/font.ttf") { held.set(req.url, res); return; }
    const useFont = req.url === "/required";
    res.setHeader("Content-Type", "text/html");
    res.end(`<html><head><meta name="viewport" content="width=device-width"><style>body{margin:0;height:1200px;font-family:Arial,sans-serif}${useFont ? '@font-face{font-family:Required;src:url(/font.ttf)}h1{font-family:Required,Arial,sans-serif}' : ''}</style></head><body><h1>Receive on Robinhood Chain</h1>${req.url === "/pending-image" ? '<img src="/held-image">' : ''}</body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    await t.test("reproduces loaded/zero-font/interactive failure; corrected full-page capture passes", async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      try {
        await page.goto(`${base}/pending-image`, { waitUntil: "domcontentloaded" });
        assert.deepEqual(await page.evaluate(() => ({ document: document.readyState, status: document.fonts.status, faces: document.fonts.size })), { document: "interactive", status: "loaded", faces: 0 });
        await assert.rejects(page.screenshot({ fullPage: true, timeout: 300 }), /waiting for fonts to load/);
        const destination = path.join(output, "resolved-system-fonts.png");
        const result = await captureAccountSurface(page, destination);
        assert.equal(result.documentState, "interactive", "Do not fabricate document completion");
        assert.ok(result.fonts.every(item => item.source === "SYSTEM_FONT_STACK"));
        const png = await readFile(destination);
        assert.equal(png.readUInt32BE(16), 390);
        assert.equal(png.readUInt32BE(20), 1200, "The full-page screenshot is retained");
      } finally { await context.close(); held.get("/held-image")?.destroy(); held.delete("/held-image"); }
    });
    await t.test("required real web font delays capture until loaded", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`${base}/required`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => [...document.fonts].some(face => face.status === "loading"));
        const destination = path.join(output, "required-font.png");
        const capture = captureAccountSurface(page, destination);
        await assert.rejects(access(destination), /ENOENT/);
        held.get("/font.ttf").writeHead(200, { "Content-Type": "font/ttf" });
        held.get("/font.ttf").end(font);
        const result = await capture;
        assert.ok(result.fonts.some(item => item.source === "WEB_FONT" && item.faces.some(face => face.family === "Required" && face.status === "loaded")));
      } finally { await context.close(); held.delete("/font.ttf"); }
    });
    await t.test("an unused loading font cannot block resolved surface fonts", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(base);
        await page.evaluate(() => {
          const unused = new FontFace("Unused", "url(/font.ttf)");
          document.fonts.add(unused);
          unused.load().catch(() => {});
        });
        await page.waitForFunction(() => [...document.fonts].some(face => face.status === "loading"));
        const result = await captureAccountSurface(page, path.join(output, "unused-font.png"));
        assert.ok(result.fonts.every(item => !item.font.includes("Unused")));
        assert.equal(result.fontSetState, "loading", "Do not pretend the unused font loaded");
      } finally { await context.close(); held.get("/font.ttf")?.destroy(); held.delete("/font.ttf"); }
    });
    await t.test("required font timeout cannot produce a screenshot", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`${base}/required`, { waitUntil: "domcontentloaded" });
        const destination = path.join(output, "timeout.png");
        await assert.rejects(captureAccountSurface(page, destination, { timeout: 300 }), /FONT_READINESS_TIMEOUT/);
        await assert.rejects(access(destination), /ENOENT/);
      } finally { await context.close(); held.get("/font.ttf")?.destroy(); held.delete("/font.ttf"); }
    });
    await t.test("invalid required font cannot produce a screenshot", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`${base}/required`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => [...document.fonts].some(face => face.status === "loading"));
        held.get("/font.ttf").writeHead(200, { "Content-Type": "font/ttf" });
        held.get("/font.ttf").end("invalid font bytes");
        const destination = path.join(output, "invalid.png");
        await assert.rejects(captureAccountSurface(page, destination));
        await assert.rejects(access(destination), /ENOENT/);
      } finally { await context.close(); held.delete("/font.ttf"); }
    });
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
