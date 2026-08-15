#!/usr/bin/env node

import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const sourceRoots = [
  "packages/agent-core/src",
  "apps/agent-engine/src",
  "apps/rmt-mcp/src",
];
const packageRoots = [
  "packages/agent-core",
  "apps/agent-engine",
  "apps/rmt-mcp",
];
const failures = [];
const warnings = [];

const toPosix = (value) => value.split(path.sep).join("/");
const relativeToRoot = (value) => toPosix(path.relative(repoRoot, value));

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const absolute = path.resolve(repoRoot, directory);
  if (!(await exists(absolute))) return [];
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...await walk(relativeToRoot(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

const sourceFiles = (await Promise.all(sourceRoots.map(walk)))
  .flat()
  .filter((filePath) => filePath.endsWith(".ts"))
  .sort();

for (const filePath of sourceFiles) {
  const metadata = await stat(filePath);
  if (metadata.size === 0) failures.push(`${relativeToRoot(filePath)} is an empty source file`);
}

const missingPackageManifests = [];
for (const packageRoot of packageRoots) {
  const manifest = path.resolve(repoRoot, packageRoot, "package.json");
  if (!(await exists(manifest))) missingPackageManifests.push(`${packageRoot}/package.json`);
}
if (missingPackageManifests.length > 0) {
  warnings.push(`source-only package ownership remains unresolved: ${missingPackageManifests.join(", ")}`);
}

const compatibilityBarrels = [];
for (const filePath of sourceFiles) {
  if (path.basename(filePath) === "index.ts" || filePath.endsWith("smoke.ts")) continue;
  const content = await readFile(filePath, "utf8");
  const meaningfulLines = content
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
  if (meaningfulLines.length > 0 && meaningfulLines.every((line) => /^export\s+(?:\*|\{)/.test(line))) {
    compatibilityBarrels.push(relativeToRoot(filePath));
  }
}

const mcpIndexPath = path.resolve(repoRoot, "apps/rmt-mcp/src/index.ts");
const mcpIndex = await readFile(mcpIndexPath, "utf8");
for (const requiredExport of ["./tool-contract.ts", "./career-tool.ts", "./read-registry.ts"]) {
  if (!mcpIndex.includes(requiredExport)) failures.push(`apps/rmt-mcp/src/index.ts does not export ${requiredExport}`);
}

const allowedMcpPublicModels = new Set(["public.ts"]);
for (const filePath of sourceFiles.filter((candidate) => candidate.includes(`${path.sep}apps${path.sep}rmt-mcp${path.sep}src${path.sep}`))) {
  const content = await readFile(filePath, "utf8");
  for (const match of content.matchAll(/from\s+["']\.\.\/\.\.\/agent-engine\/src\/([^"']+)["']/g)) {
    const importedModel = match[1];
    if (!allowedMcpPublicModels.has(importedModel)) {
      failures.push(`${relativeToRoot(filePath)} imports non-public Agent Engine source ${importedModel}`);
    }
  }
}

const authorityPatterns = [
  ["private-key account construction", /\bprivateKeyToAccount\b/],
  ["wallet-client construction", /\bcreateWalletClient\b/],
  ["transaction submission", /\bsendTransaction\s*\(/],
  ["raw transaction submission", /\bsendRawTransaction\s*\(|eth_sendRawTransaction/],
  ["contract write", /\bwriteContract\s*\(/],
  ["transaction signing", /\bsignTransaction\s*\(/],
  ["transaction broadcast", /\bbroadcastTransaction\s*\(/],
  ["wallet/private-key library import", /from\s+["'](?:viem\/accounts|ethers|@ethersproject\/wallet)["']/],
];
const runtimeFiles = sourceFiles.filter((filePath) => !filePath.endsWith("smoke.ts"));
for (const filePath of runtimeFiles) {
  const content = await readFile(filePath, "utf8");
  for (const [label, pattern] of authorityPatterns) {
    if (pattern.test(content)) failures.push(`${relativeToRoot(filePath)} contains prohibited ${label}`);
  }
  if (filePath.includes(`${path.sep}apps${path.sep}rmt-mcp${path.sep}`)) {
    if (/\bcreateServer\s*\(|\.listen\s*\(|\bWebSocketServer\b/.test(content)) {
      failures.push(`${relativeToRoot(filePath)} contains an admitted MCP network-listener primitive`);
    }
  }
}

const smokeFiles = sourceFiles.filter((filePath) => path.basename(filePath) === "smoke.ts" || filePath.endsWith("-smoke.ts"));
const smokeSet = new Set(smokeFiles.map(relativeToRoot));
const referencedSmokes = new Set();
const referenceFiles = [
  path.resolve(repoRoot, "package.json"),
  ...(await walk(".github/workflows")).filter((filePath) => /\.ya?ml$/.test(filePath)),
  ...sourceFiles,
];
for (const referenceFile of referenceFiles) {
  const content = await readFile(referenceFile, "utf8");
  if (referenceFile.endsWith(".ts")) {
    for (const match of content.matchAll(/["']([^"']*smoke(?:-v2)?\.ts)["']/g)) {
      const specifier = match[1];
      const resolved = specifier.startsWith(".")
        ? path.resolve(path.dirname(referenceFile), specifier)
        : path.resolve(repoRoot, specifier);
      const relative = relativeToRoot(resolved);
      if (smokeSet.has(relative)) referencedSmokes.add(relative);
    }
  } else {
    for (const match of content.matchAll(/(?:apps|packages)\/[A-Za-z0-9_.\/-]*smoke(?:-v2)?\.ts/g)) {
      const relative = toPosix(match[0]);
      if (smokeSet.has(relative)) referencedSmokes.add(relative);
    }
  }
}
const unreferencedSmokes = [...smokeSet].filter((filePath) => !referencedSmokes.has(filePath)).sort();
if (unreferencedSmokes.length > 0) {
  warnings.push(`smoke files without a direct workflow/runner reference: ${unreferencedSmokes.join(", ")}`);
}

for (const warning of warnings) console.warn(`::warning::${warning}`);

console.log(JSON.stringify({
  sourceFileCount: sourceFiles.length,
  smokeFileCount: smokeFiles.length,
  compatibilityBarrels,
  missingPackageManifests,
  unreferencedSmokes,
  prohibitedAuthorityFindings: failures.filter((failure) => failure.includes("prohibited") || failure.includes("network-listener")),
}, null, 2));

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exitCode = 1;
} else {
  console.log("agent/Arena branch quality audit: ok");
}
