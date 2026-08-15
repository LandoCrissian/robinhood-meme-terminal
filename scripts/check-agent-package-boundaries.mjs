import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  {
    name: "@rmt/agent-core",
    root: path.join(repositoryRoot, "packages/agent-core"),
    dependencies: [],
    exports: ["."],
  },
  {
    name: "@rmt/agent-engine",
    root: path.join(repositoryRoot, "apps/agent-engine"),
    dependencies: ["@rmt/agent-core"],
    exports: [".", "./public"],
  },
  {
    name: "@rmt/rmt-mcp",
    root: path.join(repositoryRoot, "apps/rmt-mcp"),
    dependencies: ["@rmt/agent-core", "@rmt/agent-engine"],
    exports: ["."],
  },
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  }));
  return nested.flat();
}

function importedSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function owningPackage(resolvedPath) {
  return packages.find((candidate) => resolvedPath === candidate.root || resolvedPath.startsWith(`${candidate.root}${path.sep}`));
}

function validateImport(owner, file, specifier) {
  if (specifier.startsWith("node:")) return;
  if (specifier.startsWith("@rmt/")) {
    const dependency = packages.find((candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`));
    assert(dependency, `${path.relative(repositoryRoot, file)} imports unknown RMT package ${specifier}`);
    if (dependency.name === owner.name) return;
    assert(owner.dependencies.includes(dependency.name), `${owner.name} may not depend on ${dependency.name}`);
    if (owner.name === "@rmt/rmt-mcp" && dependency.name === "@rmt/agent-engine") {
      assert.equal(specifier, "@rmt/agent-engine/public", "RMT MCP may import only the Agent Engine public export");
    }
    return;
  }
  assert(specifier.startsWith("."), `${owner.name} source may not import undeclared package ${specifier}`);
  const resolvedPath = path.resolve(path.dirname(file), specifier);
  const dependency = owningPackage(resolvedPath);
  assert(dependency, `${path.relative(repositoryRoot, file)} imports outside the admitted Agent packages: ${specifier}`);
  if (dependency.name === owner.name) return;
  assert(owner.dependencies.includes(dependency.name), `${owner.name} may not depend on ${dependency.name}`);
  if (owner.name === "@rmt/rmt-mcp" && dependency.name === "@rmt/agent-engine") {
    assert.equal(resolvedPath, path.join(dependency.root, "src/public.ts"), "RMT MCP may import only apps/agent-engine/src/public.ts");
  }
}

for (const owner of packages) {
  const manifest = JSON.parse(await readFile(path.join(owner.root, "package.json"), "utf8"));
  assert.equal(manifest.name, owner.name, `${owner.name} manifest name mismatch`);
  assert.equal(manifest.private, true, `${owner.name} must remain private`);
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), owner.dependencies, `${owner.name} dependency direction mismatch`);
  for (const dependency of owner.dependencies) {
    assert.equal(manifest.dependencies[dependency], "workspace:*", `${owner.name} must bind ${dependency} through the workspace`);
  }
  assert.deepEqual(Object.keys(manifest.exports ?? {}).sort(), owner.exports.sort(), `${owner.name} export surface mismatch`);
  for (const file of await sourceFiles(path.join(owner.root, "src"))) {
    const source = await readFile(file, "utf8");
    for (const specifier of importedSpecifiers(source)) validateImport(owner, file, specifier);
  }
}

console.log("Agent package dependency direction and public MCP boundary passed");
