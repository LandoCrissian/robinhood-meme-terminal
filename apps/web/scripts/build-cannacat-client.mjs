import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const outdir = path.resolve('cannacat-sdk');
await mkdir(outdir, { recursive: true });
const result = await build({
  entryPoints: { 'cannacat-sdk': 'lib/embed/cannacat-client.ts', 'cannacat-panel': 'lib/embed/cannacat-panel.tsx' }, outdir,
  splitting: true, chunkNames: 'chunks/[name]-[hash]', outExtension: { '.js': '.mjs' },
  platform: 'browser', format: 'esm', target: 'es2022', bundle: true,
  minify: true, sourcemap: false, metafile: true, legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_RMT_NETWORK': '"mainnet"', 'process.env.NEXT_PUBLIC_FACTORY_START_BLOCK': 'undefined' }
});
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const members = [];
for (const file of Object.keys(result.metafile.inputs).filter((name) => !name.includes('node_modules')).sort()) {
  const bytes = await readFile(file);
  members.push({ path: file, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const bytes = await readFile(path.join(outdir, 'cannacat-sdk.mjs'));
const outputs = [];
for (const file of Object.keys(result.metafile.outputs).sort()) {
  const contents = await readFile(file);
  outputs.push({ path: path.relative(outdir, file).replaceAll('\\', '/'), bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
}
await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify({
  schema: 1, version: 'rmt-cannacat-embed-v1', repository: 'LandoCrissian/robinhood-meme-terminal',
  commit: sha, artifact: 'cannacat-sdk.mjs', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
  sourceMembers: members, outputs
}, null, 2) + '\n');
console.log(JSON.stringify({ commit: sha, bytes: bytes.length, sourceMembers: members.length }));
