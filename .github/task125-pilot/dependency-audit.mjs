import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const req = createRequire(path.resolve('apps/web/package.json'));
const semver = req('next/dist/compiled/semver');
const run = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['audit', '--prod', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, shell: false });
assert(!run.error, 'Dependency advisory service could not be reached');
const audit = JSON.parse(run.stdout);
assert(audit.advisories || audit.vulnerabilities, 'Unrecognized advisory report');
fs.writeFileSync('task125-artifact/DEPENDENCY_AUDIT_RAW.json', JSON.stringify(audit));
const packages = new Map();
for (const name of ['API_METAFILE.json', 'CLIENT_METAFILE.json']) {
  const meta = JSON.parse(fs.readFileSync('task125-artifact/' + name));
  const included = new Set(Object.values(meta.outputs).flatMap(output => Object.entries(output.inputs ?? {}).filter(([, v]) => v.bytesInOutput > 0).map(([k]) => k)));
  for (const input of included) {
    if (!input.includes('node_modules')) continue;
    let dir = path.dirname(path.resolve(input));
    while (dir.includes('node_modules')) {
      const file = path.join(dir, 'package.json');
      if (fs.existsSync(file)) { const p = JSON.parse(fs.readFileSync(file)); if (p.name && p.version) packages.set(p.name + '@' + p.version, { name: p.name, version: p.version }); break; }
      dir = path.dirname(dir);
    }
  }
}
const affected = [];
for (const issue of Object.values(audit.advisories ?? {})) {
  for (const p of packages.values()) if (p.name === issue.module_name && semver.satisfies(p.version, issue.vulnerable_versions)) {
    affected.push({ package: p.name, version: p.version, severity: issue.severity, title: issue.title, url: issue.url, patched: issue.patched_versions });
  }
}
for (const issue of Object.values(audit.vulnerabilities ?? {})) {
  for (const p of packages.values()) if (p.name === issue.name && semver.satisfies(p.version, issue.range)) affected.push({ package: p.name, version: p.version, severity: issue.severity, range: issue.range, fixAvailable: issue.fixAvailable });
}
const blocking = affected.filter(x => ['critical', 'high'].includes(x.severity));
fs.writeFileSync('task125-artifact/RELEASE_DEPENDENCY_AUDIT.json', JSON.stringify({ result: blocking.length ? 'FAIL' : 'PASS',
  fullRepositoryAuditExitCode: run.status, releasePackages: [...packages.values()], affected, blocking,
  scope: 'Positive emitted bytes in both exact release artifacts; full repository raw report retained' }, null, 2));
assert.equal(blocking.length, 0, 'High/critical advisory affects emitted release code; inspect RELEASE_DEPENDENCY_AUDIT.json');
console.log(JSON.stringify({ result: 'PASS', releasePackages: packages.size, blocking: 0, otherAdvisories: affected.length }));
