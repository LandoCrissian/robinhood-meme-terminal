import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const control = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(control, '../..');
const frozen = '5ee50aa9a776dfa70cc2708ba7fa57394c0b229d';
const frozenTrees = {
  packages: 'b23a245d1748d88cc27ccb0d4317b3c507c36591',
  'pnpm-lock.yaml': 'e9dced36dfb805506e126b024c2da952e6040fd3',
  'package.json': '95167f1422cabba0198d4f9afee5e1911c138af7',
};
for (const [member, expected] of Object.entries(frozenTrees)) {
  const actual = execFileSync('git', ['rev-parse', `HEAD:${member}`], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(actual, expected, `Frozen source tree/blob changed: ${member}`);
}
const approvedClient = JSON.parse(fs.readFileSync(path.join(control, 'REVIEWED_CLIENT_INPUTS.json')));
const delta = execFileSync('git', ['diff', '--name-only', frozen, 'HEAD', '--', 'apps/web', 'packages', 'pnpm-lock.yaml', 'package.json'], {cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean).sort();
assert.deepEqual(delta, approvedClient.map(x=>x.path).sort(), 'Unexpected execution or application changes');
for(const member of approvedClient) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,member.path))).digest('hex'),member.sha256,'Reviewed client input changed');
const modified = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'apps/web', 'packages', 'pnpm-lock.yaml', 'package.json'], {cwd:repo,encoding:'utf8'}).trim();
assert.equal(modified,'','Uncommitted application changes');
const requireWeb = createRequire(path.join(repo, 'apps/web/package.json'));
const requireTsx = createRequire(requireWeb.resolve('tsx'));
const { build } = requireTsx('esbuild');
const out = path.join(repo, 'task120-artifact');
fs.mkdirSync(path.join(out, 'source-functions'), { recursive: true });
fs.mkdirSync(path.join(out, 'public'), { recursive: true });
const result = await build({
  entryPoints: [path.join(control, 'cannacat.mts')], outfile: path.join(out, 'source-functions/cannacat.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false, metafile: true,
  banner: { js: "import { createRequire as __rmtCreateRequire } from 'node:module'; const require = __rmtCreateRequire(import.meta.url);" },
  absWorkingDir: repo, treeShaking: true,
});
async function buildReplay(){
const repeated = await build({
  write:false,
  entryPoints: [path.join(control, 'cannacat.mts')], outfile: path.join(out, 'source-functions/cannacat.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false, metafile: true,
  banner: { js: "import { createRequire as __rmtCreateRequire } from 'node:module'; const require = __rmtCreateRequire(import.meta.url);" },
  absWorkingDir: repo, treeShaking: true,
});
return repeated.outputFiles[0].contents;
}
const compiledSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, 'source-functions/cannacat.mjs'))).digest('hex');
// Canonical server sources remain byte-identical to 5ee50aa; the reviewed hosting adapter changed.
const replay = await buildReplay();
assert.equal(crypto.createHash('sha256').update(replay).digest('hex'), compiledSha256, 'New hosting artifact must replay exactly');
const inputs = Object.keys(result.metafile.inputs);
assert(!inputs.some(x => /(?:^|\/)node_modules\/(?:next|firebase|firebase-admin|react)(?:\/|$)/.test(x)), 'Full terminal/runtime dependency entered the API bundle');
assert(inputs.some(x => x.endsWith('cannacat-embed-boundary.ts')));
for (const operation of ['quotes', 'verify', 'authorize', 'native-settlement-trace']) assert(inputs.some(x => x.endsWith(`/api/vnext/${operation}/route.ts`)));
assert(inputs.some(x => x.includes('settlement-trace-archive/4663/') && x.endsWith('a522.json')), 'Historical recovery evidence missing');
const sourceMembers = inputs.filter(x => !x.includes('node_modules')).sort().map(file => ({ path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.resolve(repo, file))).digest('hex') }));
const report = { frozenSource: frozen, adapterCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), node: process.version, sourceMembers, inputModules: inputs.length, databaseRequired: false, nextServerRequired: false, walletSignatures: 0, fundedTrades: 0 };
fs.writeFileSync(path.join(out, 'BUILD_EVIDENCE.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'BUNDLE_METAFILE.json'), JSON.stringify(result.metafile, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'public/index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>CannaCat API pilot</title><h1>Isolated CannaCat API pilot</h1><p>Non-production. No wallet signing or trading interface is provided here.</p></html>\n');
fs.writeFileSync(path.join(out, 'public/_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src \'none\'; base-uri \'none\'; frame-ancestors \'none\'\n');
console.log(JSON.stringify({ frozenSource: frozen, adapterCommit: report.adapterCommit, sourceMembers: sourceMembers.length, inputModules: inputs.length, bundleBytes: fs.statSync(path.join(out, 'source-functions/cannacat.mjs')).size }));
