import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vnextAppDirectory = fileURLToPath(new URL("../../app/vnext/", import.meta.url));
const rootAppDirectory = dirname(vnextAppDirectory);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const vnextSources = sourceFiles(vnextAppDirectory).map((path) => ({
  path,
  source: readFileSync(path, "utf8"),
}));

for (const { path, source } of vnextSources) {
  assert.doesNotMatch(source, /["'`]\/portfolio(?:["'`/?#])/, `${path} must not leave VNext for the legacy portfolio.`);
  assert.doesNotMatch(source, /["'`]\/market\//, `${path} must use the named asset-workspace compatibility boundary.`);
  assert.doesNotMatch(source, /["'`]\/(?:profile|launch)(?:["'`/?#])/, `${path} must not promote a paused product route.`);
}

const allowedSharedImports = new Set([
  "../../lib/external-market",
  "../../lib/external-ohlcv",
  "../../lib/external-trades",
  "../../lib/token-risk-evidence",
  "../../lib/trade-quote-client",
  "../../lib/use-external-market-stream",
  "../../lib/use-token-risk-evidence",
  "../../lib/use-wallet-constellation",
  "../fund-wallet-button",
  "../rmt-identity",
  "../wallet-button",
  "../wallet-transfer-dialog",
]);
for (const { path, source } of vnextSources) {
  const relativeImports = [...source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map((match) => match[1]);
  const unexpected = relativeImports.filter((specifier) =>
    !specifier.startsWith("./")
    && !specifier.startsWith("../../lib/vnext/")
    && !allowedSharedImports.has(specifier)
  );
  assert.deepEqual(unexpected, [], `${path} introduced an unclassified VNext compatibility import.`);
}

const vnextLayout = readFileSync(join(vnextAppDirectory, "layout.tsx"), "utf8");
const vnextCssImports = [...vnextLayout.matchAll(/^import\s+["'](.+\.css)["'];$/gm)].map((match) => match[1]);
assert.deepEqual(vnextCssImports, ["./vnext-terminal.css"]);

const rootLayout = readFileSync(join(rootAppDirectory, "layout.tsx"), "utf8");
const globalCssImports = [...rootLayout.matchAll(/^import\s+["'](.+\.css)["'];$/gm)].map((match) => match[1]);
assert.ok(globalCssImports.length > 0);
assert.ok(!globalCssImports.includes("./vnext/vnext-terminal.css"));
for (const stylesheet of globalCssImports) {
  const source = readFileSync(join(rootAppDirectory, stylesheet.replace(/^\.\//, "")), "utf8");
  assert.doesNotMatch(source, /\.rmtVnext|\.vn[A-Z]/, `${stylesheet} must not style inside the VNext ownership boundary.`);
}

console.log("VNext ownership boundary smoke passed.");
