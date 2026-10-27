import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import { pathToFileURL } from 'node:url';
// The official library used by Netlify Build/CLI. Avoid the unrelated interactive
// CLI installer whose registry dependency failed; do not alter application deps.
const tool = process.env.TASK120_PACKAGER;
assert(tool, 'Missing isolated official packaging tool path');
const { zipFunctions } = await import(pathToFileURL(path.join(tool, 'node_modules/@netlify/zip-it-and-ship-it/dist/main.js')));
const root = path.resolve('task120-artifact');
const results = await zipFunctions(path.join(root, 'source-functions'), path.join(root, 'functions'), {
  archiveFormat: 'zip', manifest: path.join(root, 'functions/manifest.json'), parallelLimit: 1,
  config: { '*': { nodeVersion: '22', nodeBundler: 'esbuild' } },
});
assert.equal(results.length, 1);
assert.equal(results[0].name, 'cannacat');
assert.equal(results[0].runtimeAPIVersion, 2, 'Must use the modern Request/Response runtime');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'functions/manifest.json')));
assert.equal(manifest.functions.length, 1);
assert(manifest.functions[0].trafficRules, 'Native rate-limit rule was not extracted');
assert(manifest.functions[0].routes?.length, 'Custom API route was not extracted');
fs.copyFileSync(path.join(tool, 'package-lock.json'), path.join(root, 'PACKAGER_PACKAGE_LOCK.json'));
fs.writeFileSync(path.join(root, 'PACKAGING_EVIDENCE.json'), JSON.stringify({ tool: '@netlify/zip-it-and-ship-it@16.5.1', results, nativeRateLimitExtracted: true, modernRuntime: true, walletSignatures: 0, fundedTrades: 0 }, null, 2) + '\n');
console.log(JSON.stringify({ result: 'PASS', functionCount: 1, modernRuntime: true, nativeRateLimitExtracted: true }));
