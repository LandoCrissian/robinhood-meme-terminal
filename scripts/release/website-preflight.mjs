import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const guardCommand = "node -e \"console.error('This Netlify configuration is approved only for preview builds.'); process.exit(1)\"";
const activationKeys = ["RMT_PROFILES_MODE", "RMT_PROFILES_ACTIVATION_APPROVAL", "RMT_CURVE_PRODUCTION_EXECUTION",
  "RMT_CURVE_PRODUCTION_PREPARATION", "RMT_CURVE_PRODUCTION_RELEASE", "RMT_CURVE_FIXTURE", "RMT_MOBILE_REVIEW_FIXTURE",
  "RMT_CURVE_FIXTURE_DEPLOYMENT", "RMT_CURVE_FIXTURE_INDEXER", "RMT_CURVE_FIXTURE_READ_KEY", "RMT_CURVE_FIXTURE_RPC", "RMT_CURVE_FIXTURE_SITE_ORIGIN",
  "FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** This checks the known release configuration; it never grants publication or execution. */
export function checkWebsiteSource({ toml, packageManager, nextVersion, env = {} }) {
  const lines = toml.replaceAll("\r\n", "\n").split("\n");
  const sections = lines.flatMap((line, index) => line.trim() === "[context.production]" ? [index] : []);
  const following = sections.length === 1 ? lines.slice(sections[0] + 1) : [];
  const end = following.findIndex((line) => line.trim().startsWith("["));
  const section = (end < 0 ? following : following.slice(0, end)).join("\n");
  const assignment = section.match(/^[ \t]*command[ \t]*=[ \t]*("(?:[^"\\]|\\.)*")[ \t]*$/m);
  let command;
  try { command = assignment && JSON.parse(assignment[1]); } catch { /* Invalid config fails closed. */ }
  const activeNames = activationKeys.filter((key) => Boolean(env[key]));
  const publicSensitiveNames = Object.keys(env).filter((key) => /^(?:NEXT_PUBLIC_|PUBLIC_)/.test(key)
    && /(?:SECRET|PRIVATE_KEY|SERVICE_ACCOUNT|PASSWORD|DATABASE_URL|INDEXER_READ_TOKEN)/.test(key) && env[key]);
  const endpointPresent = Boolean(env.RMT_LAUNCH_HISTORY_INDEXER_URL), readCredentialPresent = Boolean(env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN);
  let validReadOrigin = !endpointPresent;
  if (endpointPresent) try { const url = new URL(env.RMT_LAUNCH_HISTORY_INDEXER_URL); validReadOrigin = url.protocol === "https:"
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; } catch { /* Closed below. */ }
  const checks = {
    productionGuardRetained: command === guardCommand,
    pinnedPackageManager: packageManager === "pnpm@10.12.1",
    approvedNextVersion: nextVersion === "15.5.29",
    activationClosed: activeNames.length === 0,
    noPublicAdministrativeCredentials: publicSensitiveNames.length === 0,
    readApiConfigurationConsistent: endpointPresent === readCredentialPresent && validReadOrigin,
  };
  return { checks, activeNames, publicSensitiveNames, verification: Object.values(checks).every(Boolean) ? "passed" : "failed",
    readApi: { endpointPresent, readCredentialPresent, mode: endpointPresent && readCredentialPresent ? "configured-not-authenticated-by-this-probe" : "snapshot-only",
      publicationRequirement: "Explicitly preserve the existing deploy-scoped server-only Railway origin/read credential. Site-level enumeration does not prove runtime absence or continuity; do not print values." },
    publication: "BLOCKED_OWNER_APPROVAL", execution: "BLOCKED_NO_BROADCAST",
    laterStages: { ownerCreation: "Separate approved-account adapter and canonical publication/operational acceptance required",
      generalTradingAndClaims: "No production adapter is enabled; fixture-only execution is not a production release switch" },
    productionBuildBoundary: "Normal production builds remain guarded. Separate owner approval may authorize publication of the exact verified prebuilt Linux artifact; changing the production build command requires a reviewed configuration change and fresh build. Neither action enables application execution." };
}

async function boundedFiles(directory, limit = 5000) {
  const result = [];
  async function walk(path) {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name), stat = await lstat(file);
      assert.ok(!stat.isSymbolicLink(), "Static publication may not contain links outside the asset tree");
      if (stat.isDirectory()) await walk(file);
      else { assert.ok(stat.isFile()); result.push(file); assert.ok(result.length <= limit, "Static tree exceeds review bound"); }
    }
  }
  await walk(directory);
  return result;
}

export function checkFunctionManifest(manifest) {
  assert.equal(manifest.system?.platform, "linux", "This acceptance requires an actual Linux build");
  const handler = manifest.functions?.find((entry) => entry.name === "___netlify-server-handler");
  assert.equal(manifest.functions?.length, 1);
  assert.equal(handler?.generator, "@netlify/plugin-nextjs@5.16.8");
  assert.equal(handler?.runtimeVersion, "nodejs22.x");
  assert.equal(handler?.invocationMode, "stream");
  assert.ok(handler.routes?.some((route) => route.pattern === "/*" && route.prefer_static === true));
  return { generator: handler.generator, runtime: handler.runtimeVersion, routes: handler.routes, platform: manifest.system.platform };
}

export function checkEdgeManifest(manifest) {
  const config = manifest.function_config ?? {};
  assert.equal(config["___netlify-edge-handler-middleware"]?.generator, "@netlify/plugin-nextjs@5.16.8");
  const rules = Object.entries(config).filter(([, entry]) => entry.traffic_rules);
  assert.equal(rules.length, 2, "The existing plan permits exactly these two native rules");
  for (const [name, budget] of [["launch-creation-limit", 12], ["launch-discovery-limit", 120]]) {
    const action = config[name]?.traffic_rules?.action;
    assert.equal(action?.type, "rate_limit");
    assert.deepEqual(action.config.rate_limit_config, { window_limit: budget, window_size: 60, algorithm: "sliding_window" });
    assert.deepEqual(action.config.aggregate.keys.map((key) => key.type).sort(), ["domain", "ip"]);
  }
  for (const [name, path] of [["launch-creation-limit", "/api/account/nonce"], ["launch-creation-limit", "/api/launchpad/production-creation"],
    ["launch-discovery-limit", "/api/launchpad/new-engine"], ["launch-discovery-limit", "/api/account/session"]]) {
    assert.ok(manifest.routes.some((route) => route.function === name && route.path === path), "Missing bounded route: " + path);
  }
  return { functions: Object.keys(config).sort(), nativeRules: rules.map(([name]) => name).sort(),
    enforcement: "Manifest verified; live Netlify enforcement remains a separate hosted acceptance" };
}

export async function inspectLinuxArtifacts(workspace, python = "python3") {
  const app = join(workspace, "apps/launch-website"), artifacts = join(app, ".netlify");
  const functions = checkFunctionManifest(JSON.parse(await readFile(join(artifacts, "functions/manifest.json"), "utf8")));
  const edge = checkEdgeManifest(JSON.parse(await readFile(join(artifacts, "edge-functions-dist/manifest.json"), "utf8")));
  const staticRoot = join(artifacts, "static"), files = await boundedFiles(staticRoot);
  const staticFiles = [];
  for (const file of files) {
    const name = relative(staticRoot, file).replaceAll("\\", "/");
    assert.ok(!name.split("/").some((segment) => /^(?:\.env(?:\..*)?|\.git|server|node_modules|package\.json|.*\.pem|.*\.key)$/.test(segment)),
      "Server/private file reached static publication: " + name);
    const bytes = await readFile(file);
    const marker = process.env.RMT_WEBSITE_PREVIEW_SECRET_MARKER;
    assert.ok(!marker || !bytes.includes(Buffer.from(marker)), "Server-only marker reached a static asset");
    staticFiles.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  assert.ok(staticFiles.some(({ path }) => path.startsWith("_next/static/") && path.endsWith(".js")));
  const zip = join(artifacts, "functions/___netlify-server-handler.zip");
  const archive = JSON.parse(execFileSync(python, [join(root, "scripts/release/website-archive.py"), zip], { encoding: "utf8", timeout: 60_000 }));
  const paths = JSON.parse(await readFile(join(app, ".next/server/app-paths-manifest.json"), "utf8"));
  for (const route of ["/page", "/create-token/page", "/my-launches/page", "/wallet/page", "/account/profile/page", "/u/[username]/page",
    "/api/artwork/upload/route", "/api/artwork/[cid]/[file]/route", "/api/account/session/route", "/api/account/verify/route", "/api/launchpad/production-creation/route", "/launches/[token]/page"]) {
    assert.ok(paths[route], "Required route missing from Linux build: " + route);
  }
  return { functions, edge, staticFiles, archive, appRoutes: Object.keys(paths).sort(),
    sourceArtifacts: { functionManifestSha256: digest(await readFile(join(artifacts, "functions/manifest.json"))),
      edgeManifestSha256: digest(await readFile(join(artifacts, "edge-functions-dist/manifest.json"))) } };
}

async function main() {
  const { values } = parseArgs({ options: { artifacts: { type: "boolean", default: false }, output: { type: "string" }, python: { type: "string", default: "python3" } } });
  const source = checkWebsiteSource({ toml: await readFile(join(root, "netlify.toml"), "utf8"),
    packageManager: JSON.parse(await readFile(join(root, "package.json"))).packageManager,
    nextVersion: JSON.parse(await readFile(join(root, "apps/launch-website/package.json"))).dependencies.next, env: process.env });
  const report = { schemaVersion: 1, sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    recordedAt: new Date().toISOString(), source, ...(values.artifacts && { artifacts: await inspectLinuxArtifacts(root, values.python) }),
    deployment: "Not attempted; no Netlify authentication or deploy operation is part of this preflight" };
  if (values.output) { const output = resolve(values.output); await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
  console.log(JSON.stringify({ sourceCommit: report.sourceCommit, verification: source.verification, publication: source.publication,
    execution: source.execution, artifacts: values.artifacts ? "Linux adapter, archive, native modules, routes and edge rules verified" : "not requested" }));
  assert.equal(source.verification, "passed", "Website publication preflight failed; publication remains blocked");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
