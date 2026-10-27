import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), base = '43c2b800593cd56b871d4556d32875f49d86a5c4';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const req = createRequire(path.join(root, 'apps/web/package.json'));
const { build } = createRequire(req.resolve('tsx'))('esbuild');
const out = path.join(root, 'task125-artifact'); fs.mkdirSync(out, { recursive: true });
const preserved = ['apps/web/lib/vnext', 'apps/web/lib/server/zero-x-shared-quota.ts', 'apps/web/lib/server/settlement-trace-archive'];
for (const directory of preserved) assert.equal(git('diff', '--name-only', base, 'HEAD', '--', directory), '', `Frozen engine changed: ${directory}`);
for (const operation of ['verify', 'authorize']) {
  const file = `apps/web/app/api/vnext/${operation}/route.ts`;
  const before = execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
  const expected = before.replace('requireAuthenticatedTradeWallet, tradeIdentityErrorResponse', 'requireAuthenticatedTradeWallet, tradeIdentityErrorResponse, tradeSessionBinding')
    .replace('sessionToken: request.headers.get("privy-id-token") ?? ""', 'sessionToken: await tradeSessionBinding(request)');
  assert.equal(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), expected, 'Only authentication commitment binding may change');
}
for (const operation of ['quotes', 'native-settlement-trace']) assert.equal(git('diff', '--name-only', base, 'HEAD', '--', `apps/web/app/api/vnext/${operation}/route.ts`), '');
const identityPlugin = { name: 'explicit-wallet-session-identity-boundary', setup(b) {
  b.onResolve({ filter: /(?:^|\/)rmt-trade-identity(?:\.ts)?$/ }, () => ({ path: path.join(root, 'apps/web/lib/server/wallet-session-identity.ts') }));
} };
const options = { entryPoints: ['.github/task125-pilot/cannacat.mts'], outfile: path.join(out, 'source-functions/cannacat.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false, metafile: true, treeShaking: true,
  banner: { js: "import { createRequire as __rmtCreateRequire } from 'node:module'; const require = __rmtCreateRequire(import.meta.url);" }, plugins: [identityPlugin] };
const api = await build(options), replay = await build({ ...options, write: false });
assert.equal(sha(fs.readFileSync(options.outfile)), sha(replay.outputFiles[0].contents));
assert(!Object.keys(api.metafile.inputs).some(x => /@privy-io|privy-identity|rmt-trade-identity|node_modules\/(?:next|firebase|react)\//.test(x)), 'Legacy identity/runtime entered pilot');
assert(Object.keys(api.metafile.inputs).some(x => x.endsWith('zero-x-shared-quota.ts')));
fs.writeFileSync(path.join(out, 'API_METAFILE.json'), JSON.stringify(api.metafile));
const sdkDir = path.join(out, 'sdk');
const client = await build({ entryPoints: { 'cannacat-panel': 'apps/web/lib/embed/cannacat-panel.tsx', 'cannacat-sdk': 'apps/web/lib/embed/cannacat-client.ts' },
  outdir: sdkDir, outExtension: { '.js': '.mjs' }, chunkNames: 'chunks/rabby-[hash]', bundle: true, splitting: true,
  platform: 'browser', target: 'es2022', format: 'esm', sourcemap: false, metafile: true, minify: true,
  // Standalone SDK has no Next.js environment injection. Only explicit PUBLIC
  // constants are compiled; never serialize process.env from the build host.
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': JSON.stringify({ NODE_ENV: 'production',
    NEXT_PUBLIC_RMT_NETWORK: 'mainnet', NEXT_PUBLIC_RMT_RPC_URL: 'https://rpc.mainnet.chain.robinhood.com/' }), global: 'globalThis' } });
assert(!Object.keys(client.metafile.inputs).some(x => /@privy-io|privy-identity/.test(x)), 'Privy entered browser artifact');
assert(Object.keys(client.metafile.inputs).some(x => x.includes('@rabby-wallet/rabbykit')), 'Official RabbyKit missing');
const commit = git('rev-parse', 'HEAD');
const sourceMembers = Object.keys(client.metafile.inputs).filter(x => !x.includes('node_modules')).map(file => ({ path: file, sha256: sha(fs.readFileSync(file)) }));
const outputs = Object.keys(client.metafile.outputs).map(file => ({ path: path.relative(sdkDir, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file)) }));
fs.writeFileSync(path.join(sdkDir, 'manifest.json'), JSON.stringify({ schema: 1, repository: 'LandoCrissian/robinhood-meme-terminal',
  commit, version: 'rmt-cannacat-embed-v1', fixtureOnly: false, sourceMembers, outputs }, null, 2));
fs.writeFileSync(path.join(out, 'CLIENT_METAFILE.json'), JSON.stringify(client.metafile));
fs.mkdirSync(path.join(out, 'public'), { recursive: true });
fs.writeFileSync(path.join(out, 'public/index.html'), '<!doctype html><title>Task125 isolated API</title><meta name="robots" content="noindex,nofollow"><p>Isolated wallet-session API. No production mint or trading interface.</p>');
fs.writeFileSync(path.join(out, 'BUILD_EVIDENCE.json'), JSON.stringify({ base, commit, apiSha256: sha(fs.readFileSync(options.outfile)),
  enginePreserved: true, explicitAuthReplacement: 'wallet-session-identity.ts', privyApiModules: 0, privyClientModules: 0,
  provider: 'zero-x-swap', chain: 4663, feeBps: 25, databaseRequired: false, sourceMembers, outputs }, null, 2));
console.log(JSON.stringify({ result: 'PASS', commit, privyModules: 0, outputs: outputs.length }));
