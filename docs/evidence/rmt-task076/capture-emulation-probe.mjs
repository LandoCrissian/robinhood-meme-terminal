import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw Error('Supply an absolute, unused output path; retained evidence is never overwritten.');
const { devices, chromium, webkit } = require('playwright');
const report = { schemaVersion: 1, scope: 'LOCAL_BROWSER_EMULATION_TOOL_PROBE_NOT_PHYSICAL_DEVICE',
  playwrightVersion: require('playwright/package.json').version, observedAt: new Date().toISOString(), cases: [] };
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const fullPage of [true, false]) {
      const context = await browser.newContext(devices['iPhone 13']);
      try {
        const page = await context.newPage();
        await page.setContent('<meta name="viewport" content="width=device-width"><div style="height:4000px">Synthetic capture probe</div>');
        const observe = () => page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches,
          touch: navigator.maxTouchPoints, width: innerWidth, height: innerHeight }));
        const before = await observe();
        await page.screenshot({ fullPage });
        const after = await observe();
        await page.setViewportSize({ width: 390, height: 844 });
        const afterResize = await observe();
        report.cases.push({ browser: engine.name(), browserVersion: browser.version(), fullPage, before, after, afterResize });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
