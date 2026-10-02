import { writeFile } from "node:fs/promises";

async function bounded(promise, milliseconds, reason) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(reason)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// FontFaceSet.ready also waits for the document's load/layout environment. The
// account fixture can have a resolved system-font surface while an unrelated
// subresource keeps that promise pending. Wait for the actual rendered fonts;
// do not bypass font loading or change the application's typography.
export async function captureAccountSurface(page, destination, { timeout = 30_000 } = {}) {
  const started = Date.now();
  const readiness = page.evaluate(async () => {
    const required = new Map();
    const collect = (element, text) => {
      if (!text.trim() || !element.getClientRects().length) return;
      const style = getComputedStyle(element);
      if (style.visibility !== "visible" || style.display === "none") return;
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      required.set(font, (required.get(font) ?? "") + text);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) collect(walker.currentNode.parentElement, walker.currentNode.textContent ?? "");
    for (const element of document.querySelectorAll("input,textarea")) collect(element, element.value || element.placeholder);
    if (!required.size) throw new Error("FONT_SURFACE_EMPTY");
    const fonts = await Promise.all([...required].map(async ([font, text]) => {
      const faces = await document.fonts.load(font, text);
      if (!document.fonts.check(font, text) || faces.some(face => face.status !== "loaded")) throw new Error("FONT_RESOURCE_UNRESOLVED");
      return { font, source: faces.length ? "WEB_FONT" : "SYSTEM_FONT_STACK", faces: faces.map(face => ({ family: face.family, status: face.status })) };
    }));
    // Reflow and paint with the resolved fonts before asking Chromium to capture.
    document.documentElement.getBoundingClientRect();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { fonts, documentState: document.readyState, fontSetState: document.fonts.status };
  });
  const evidence = await bounded(readiness, timeout, "FONT_READINESS_TIMEOUT");
  const readinessMs = Date.now() - started;
  const session = await page.context().newCDPSession(page);
  try {
    // Native capture has no additional document-wide font/lifecycle wait. All
    // required surface fonts above have actually loaded, including web fonts.
    await bounded((async () => {
      const { cssContentSize } = await session.send("Page.getLayoutMetrics");
      const { data } = await session.send("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 }
      });
      await writeFile(destination, Buffer.from(data, "base64"));
    })(), Math.max(1, timeout - (Date.now() - started)), "SCREENSHOT_CAPTURE_TIMEOUT");
  } finally { await session.detach(); }
  return { ...evidence, readinessMs, totalMs: Date.now() - started };
}
