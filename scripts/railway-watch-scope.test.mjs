import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const config = read("apps/indexer/railway.json");
const baseline = read("docs/architecture/evidence/2026-09-30/railway-watch-baseline.json").services.indexer;
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: fileURLToPath(root), encoding: "utf8",
}).split("\0").filter(Boolean);

function watched(file) {
  return config.build.watchPatterns.some((pattern) => {
    assert.ok(!/[!\[\]?]/.test(pattern), "Unsupported watch pattern: " + pattern);
    if (pattern.endsWith("/**")) return file.startsWith(pattern.slice(0, -2));
    assert.ok(!pattern.includes("*"), "Unsupported watch pattern: " + pattern);
    return file === pattern;
  });
}

test("the surviving indexer watches its source and each dependency input", () => {
  const inputs = [
    "apps/indexer/package.json", "apps/indexer/tsconfig.json", "apps/indexer/railway.json",
    "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml",
  ];
  for (const file of [...inputs, ...tracked.filter((file) => file.startsWith("apps/indexer/src/"))]) {
    assert.ok(watched(file), "Indexer misses " + file);
  }
  assert.deepEqual(read("apps/indexer/tsconfig.json").include, ["src/**/*.ts"]);
  const { dependencies, devDependencies } = read("apps/indexer/package.json");
  assert.ok(Object.values({ ...dependencies, ...devDependencies }).every((version) => !version.startsWith("workspace:")),
    "Account for any new workspace dependency in Railway watch patterns");
});

test("website, docs and local examples do not trigger a Railway worker deploy", () => {
  for (const file of ["apps/indexer/README.md", "apps/indexer/.env.example", "docs/ARCHITECTURE.md",
    "apps/launch-website/app/page.tsx", "netlify.toml"]) {
    assert.equal(watched(file), false, "Indexer unexpectedly watches " + file);
  }
});

test("the worker build pins its lockfile and preserves startup, health endpoint and restart policy", () => {
  const { watchPatterns: priorPatterns, ...priorBuild } = baseline.build;
  const { watchPatterns: currentPatterns, ...currentBuild } = config.build;
  assert.ok(!priorPatterns.includes("pnpm-lock.yaml"));
  assert.ok(currentPatterns.includes("pnpm-lock.yaml"));
  // Preserve the historical evidence; Task066 deliberately strengthens only
  // installation reproducibility. Every other build/deployment field stays exact.
  assert.equal(priorBuild.buildCommand, "pnpm install --no-frozen-lockfile && pnpm --filter indexer build");
  assert.deepEqual(currentBuild, {
    ...priorBuild,
    buildCommand: "pnpm install --frozen-lockfile && pnpm --filter indexer build",
  });
  assert.deepEqual(config.deploy, baseline.deploy);
});
