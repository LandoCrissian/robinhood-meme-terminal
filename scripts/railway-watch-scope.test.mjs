import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const services = ["indexer", "market-indexer", "external-origin-indexer", "nft-indexer", "nft-marketplace-indexer"];
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const configs = Object.fromEntries(services.map((name) => [name, json(`apps/${name}/railway.json`)]));
const baseline = json("docs/architecture/evidence/2026-09-30/railway-watch-baseline.json");

// The checked-in patterns deliberately use only exact paths and recursive
// directory suffixes, a subset of Railway's gitignore-style watch syntax.
function matches(patterns, file) {
  return patterns.some((pattern) => {
    assert.ok(!/[!\[\]?]/.test(pattern), `Unsupported test pattern: ${pattern}`);
    if (pattern.endsWith("/**")) return file.startsWith(pattern.slice(0, -2));
    assert.ok(!pattern.includes("*"), `Unsupported test pattern: ${pattern}`);
    return file === pattern;
  });
}
const triggered = (file) => services.filter((name) => matches(configs[name].build.watchPatterns, file));

for (const name of services) {
  const patterns = configs[name].build.watchPatterns;
  test(`${name}: production source, build config and root dependency inputs trigger`, () => {
    for (const file of [`apps/${name}/src/index.ts`, `apps/${name}/src/schema.ts`, `apps/${name}/package.json`, `apps/${name}/tsconfig.json`, `apps/${name}/railway.json`, "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
      assert.ok(matches(patterns, file), `${name} misses ${file}`);
    }
    assert.deepEqual(json(`apps/${name}/tsconfig.json`).include, ["src/**/*.ts"]);
    for (const file of tracked.filter((file) => file.startsWith(`apps/${name}/src/`))) {
      assert.ok(matches(patterns, file), `${name} misses tracked source ${file}`);
    }
  });
  test(`${name}: local docs and env examples no longer deploy`, () => {
    for (const file of [`apps/${name}/README.md`, `apps/${name}/.env.example`]) {
      assert.ok(matches(baseline.services[name].build.watchPatterns, file), `Expected former broad scope for ${file}`);
      assert.equal(matches(patterns, file), false);
    }
  });
  test(`${name}: unrelated web, docs and worker sources do not deploy`, () => {
    for (const file of ["apps/web/app/vnext/vnext-terminal.css", "apps/web/app/page.tsx", "docs/architecture/example.md", ...services.filter((other) => other !== name).map((other) => `apps/${other}/src/index.ts`)]) {
      assert.equal(matches(patterns, file), false, `${file} unexpectedly triggers ${name}`);
    }
  });
  test(`${name}: build/deploy commands, healthcheck and policy are unchanged`, () => {
    const { watchPatterns: before, ...beforeBuild } = baseline.services[name].build;
    const { watchPatterns: after, ...afterBuild } = configs[name].build;
    assert.deepEqual(afterBuild, beforeBuild);
    assert.deepEqual(configs[name].deploy, baseline.services[name].deploy);
  });
  test(`${name}: declared workspace dependencies and all their exports remain covered`, () => {
    const visited = new Set();
    function visit(path) {
      if (visited.has(path)) return;
      visited.add(path);
      const manifest = json(`${path}/package.json`);
      for (const [dependency, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
        if (!version.startsWith("workspace:")) continue;
        const candidate = tracked.filter((file) => /^(packages|apps)\/[^/]+\/package.json$/.test(file)).find((file) => json(file).name === dependency);
        assert.ok(candidate, `Unresolved workspace dependency ${dependency}`);
        const directory = candidate.slice(0, -"/package.json".length);
        assert.ok(matches(patterns, candidate), `${name} misses dependency manifest ${candidate}`);
        // This service imports only a standalone shared TYPE. Its plain Node
        // build emits no shared runtime import; unrelated NFT modules are not
        // build inputs. The exact interface and manifest still trigger it.
        if(name === "market-indexer" && dependency === "@rmt/shared") {
          const imports=tracked.filter(file=>file.startsWith('apps/market-indexer/src/')&&file.endsWith('.ts'))
            .flatMap(file=>[...readFileSync(resolve(root,file),'utf8').matchAll(/import\s+(type\s+)?[^;]*?from\s+["'](@rmt\/shared[^"']*)["']/g)]);
          assert.ok(imports.length>0);
          assert.ok(imports.every(imported=>imported[1] && imported[2]==='@rmt/shared/launch-intelligence'));
          assert.ok(matches(patterns, 'packages/shared/src/launch-intelligence.ts'));
          continue;
        }
        for (const file of tracked.filter((file) => file.startsWith(`${directory}/src/`))) {
          assert.ok(matches(patterns, file), `${name} misses workspace source ${file}`);
        }
        for (const target of Object.values(json(candidate).exports ?? {})) {
          assert.equal(typeof target, "string", "Review watch coverage when export shape changes");
          assert.ok(matches(patterns, `${directory}/${target.replace(/^\.\//, "")}`));
        }
        visit(directory);
      }
    }
    visit(`apps/${name}`);
  });
}

test("base misses main-indexer lockfile; corrected scope includes it", () => {
  assert.equal(matches(baseline.services.indexer.build.watchPatterns, "pnpm-lock.yaml"), false);
  assert.ok(matches(configs.indexer.build.watchPatterns, "pnpm-lock.yaml"));
});
test("shared NFT source triggers exactly its two runtime consumers, shared manifest covers all consumers", () => {
  assert.deepEqual(triggered("packages/shared/src/nft/activity-domain.ts"), ["nft-indexer", "nft-marketplace-indexer"]);
  assert.deepEqual(triggered("packages/shared/package.json"), ["market-indexer", "nft-indexer", "nft-marketplace-indexer"]);
  assert.deepEqual(triggered("packages/shared/src/launch-intelligence.ts"), ["market-indexer", "nft-indexer", "nft-marketplace-indexer"]);
  assert.deepEqual(triggered("packages/shared/README.md"), []);
});
test("root dependency changes still trigger every worker", () => {
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) assert.deepEqual(triggered(file), services);
});
test("test-only fixture and external shadow changes do not deploy", () => {
  assert.deepEqual(triggered("apps/market-indexer/fixtures/cold-directory-coverage.json"), []);
  assert.deepEqual(triggered("apps/external-origin-indexer/shadow/bow-replay-smoke.ts"), []);
  assert.deepEqual(triggered("apps/external-origin-indexer/tsconfig.shadow.json"), []);
});
