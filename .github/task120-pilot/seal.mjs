import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const root = path.resolve('task120-artifact');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(path.join(dir, x.name)) : [path.join(dir, x.name)]); }
const files = walk(root).sort().map(file => { const bytes = fs.readFileSync(file); return { path: path.relative(root, file).replaceAll(path.sep, '/'), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; });
const manifest = JSON.stringify({ schemaVersion: 1, frozenRmt: '5ee50aa9a776dfa70cc2708ba7fa57394c0b229d', productionSafe: false, files }, null, 2) + '\n';
fs.writeFileSync(path.join(root, 'ARTIFACT_MANIFEST.json'), manifest);
fs.writeFileSync(path.join(root, 'ARTIFACT_MANIFEST_SHA256.txt'), crypto.createHash('sha256').update(manifest).digest('hex') + '\n');
console.log(JSON.stringify({ files: files.length, bytes: files.reduce((sum,x) => sum+x.bytes,0), manifestSha256: crypto.createHash('sha256').update(manifest).digest('hex') }));
