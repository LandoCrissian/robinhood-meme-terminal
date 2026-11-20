import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkWebsiteSource, inspectLinuxArtifacts } from "./website-preflight.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const financialActivationKeys = ["RMT_CURVE_PRODUCTION_TRADING", "RMT_CURVE_PRODUCTION_CLAIMS",
  "RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE", "RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE_SHA256"];
export function checkFinancialActivation(env = {}) {
  const present = financialActivationKeys.filter(key => !!env[key]);
  assert.equal(present.length, 0, "Financial activation is not authorized for artifact preparation");
  return { financialFlags: "ALL_UNSET", preparationIsActivationApproval: false };
}
export function checkFinancialArtifacts(artifacts, edge) {
  for (const route of ["/api/launchpad/production-lifecycle/route", "/api/launchpad/production-earnings/route"]) {
    assert.ok(artifacts.appRoutes.includes(route), "Missing production financial route: " + route);
    assert.ok(edge.routes.some(entry => entry.function === "launch-creation-limit" && entry.path === route.slice(0, -6)), "Missing existing native financial rate rule: " + route);
  }
  assert.equal(artifacts.edge.nativeRules.length, 2);
  return { routes: "BOTH_NEXT_SERVER_ROUTES", edgeRules: "EXISTING_TWO_ONLY", deployment: "NOT_AUTHORIZED", execution: "BLOCKED_NO_BROADCAST" };
}
async function main() {
  const { values } = parseArgs({ options: { artifacts: { type: "boolean", default: false }, output: { type: "string" }, python: { type: "string", default: "python3" } } });
  const financial = checkFinancialActivation(process.env);
  const source = checkWebsiteSource({ toml: await readFile(join(root, "netlify.toml"), "utf8"),
    packageManager: JSON.parse(await readFile(join(root, "package.json"))).packageManager,
    nextVersion: JSON.parse(await readFile(join(root, "apps/launch-website/package.json"))).dependencies.next, env: process.env });
  assert.equal(source.verification, "passed", "Retained original publication preflight failed");
  let artifact;
  if (values.artifacts) {
    const built = await inspectLinuxArtifacts(root, values.python);
    const edge = JSON.parse(await readFile(join(root, "apps/launch-website/.netlify/edge-functions-dist/manifest.json"), "utf8"));
    artifact = { ...checkFinancialArtifacts(built, edge), evidence: built };
  }
  const report = { schemaVersion: 1, scope: "TASK092_ADDITIVE_FINANCIAL_ARTIFACT_PREFLIGHT", observedAt: new Date().toISOString(),
    source, financial, ...(artifact && { artifact }), sourceVerification: "SEPARATE_OWNER_GATE",
    secretHandling: "Existing static marker, archive and native dependency checks run unchanged", financialAuthorization: false };
  if (values.output) { const path = resolve(values.output); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + "\n"); }
  console.log(JSON.stringify({ result: "PASS", artifacts: values.artifacts, financialFlags: financial.financialFlags,
    producerSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"), financialAuthorization: false }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
