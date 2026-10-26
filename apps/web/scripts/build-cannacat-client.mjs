import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const baselinePanelCommit = process.argv.includes('--acceptance-baseline') ? 'af597d2d8ccf0c4db05e993ac5dd4bbf32171399' : null;
const fixtureOnly = process.argv.includes('--acceptance') || Boolean(baselinePanelCommit);
if (fixtureOnly && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Fixture output is disposable cloud CI only.');
const baselinePanelSource = baselinePanelCommit ? execFileSync('git', ['show', `${baselinePanelCommit}:apps/web/lib/embed/cannacat-panel.tsx`], { encoding: 'utf8' }) : null;
const outdir = path.resolve(baselinePanelCommit ? 'cannacat-sdk-baseline' : fixtureOnly ? 'cannacat-sdk-fixture' : 'cannacat-sdk');
await mkdir(outdir, { recursive: true });
const result = await build({
  entryPoints: { 'cannacat-sdk': 'lib/embed/cannacat-client.ts', 'cannacat-panel': 'lib/embed/cannacat-panel.tsx' }, outdir,
  splitting: true, chunkNames: 'chunks/[name]-[hash]', outExtension: { '.js': '.mjs' },
  platform: 'browser', format: 'esm', target: 'es2022', bundle: true, jsx: 'automatic',
  minify: true, sourcemap: false, metafile: true, legalComments: 'eof',
  plugins: [...(baselinePanelSource ? [{ name: 'pinned-before-layout-source', setup(build) {
    build.onLoad({ filter: /[\\/]lib[\\/]embed[\\/]cannacat-panel\.tsx$/ }, (args) => ({ contents: baselinePanelSource, loader: 'tsx', resolveDir: path.dirname(args.path) }));
  } }] : []), { name: 'on-site-original-legal-documents', setup(build) {
    build.onResolve({ filter: /^\.\.\/legal-shell$/ }, (args) => {
      if (!/[\\/]app[\\/](terms|risks|privacy)[\\/]page\.tsx$/.test(args.importer)) return;
      return { path: path.resolve('lib/embed/cannacat-legal-shell.tsx') };
    });
  } }, ...(fixtureOnly ? [{ name: 'synthetic-wallet-boundary', setup(build) {
    build.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: path.resolve('lib/testing/cannacat-privy-fixture.tsx') }));
  } }] : [])],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_RMT_NETWORK': '"mainnet"', 'process.env.NEXT_PUBLIC_FACTORY_START_BLOCK': 'undefined' }
});
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const members = [];
for (const file of Object.keys(result.metafile.inputs).filter((name) => !name.includes('node_modules')).sort()) {
  const bytes = baselinePanelSource && file.replaceAll('\\', '/') === 'lib/embed/cannacat-panel.tsx' ? Buffer.from(baselinePanelSource) : await readFile(file);
  members.push({ path: file, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const bytes = await readFile(path.join(outdir, 'cannacat-sdk.mjs'));
const outputs = [];
for (const file of Object.keys(result.metafile.outputs).sort()) {
  const contents = await readFile(file);
  outputs.push({ path: path.relative(outdir, file).replaceAll('\\', '/'), bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
}
await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify({
  schema: 1, version: 'rmt-cannacat-embed-v1', fixtureOnly, repository: 'LandoCrissian/robinhood-meme-terminal',
  commit: sha, artifact: 'cannacat-sdk.mjs', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
  ...(baselinePanelCommit ? { baselinePanelCommit, baselinePanelSha256: createHash('sha256').update(baselinePanelSource).digest('hex') } : {}),
  sourceMembers: members, outputs
}, null, 2) + '\n');
console.log(JSON.stringify({ commit: sha, bytes: bytes.length, sourceMembers: members.length }));
