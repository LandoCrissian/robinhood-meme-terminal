import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, type Address } from "viem";
import {
  applyProjectIdentityDirectoryAdmission,
  evaluateProjectIdentityAdmission,
  parseProjectIdentityAuthoritySnapshot,
  projectIdentityAdmissionErrorResponse,
  requireProjectIdentityDirectoryAdmitted,
  type ProjectTokenIdentity
} from "./project-identity-admission";

const ESTABLISHED = getAddress("0x5Edb417509a869b1D8222dEa05257B8c8Ba00361");
const CONFLICTING = getAddress("0xeE5576Fa1Bcaa380e591D01245f406f3f384eb01");
const ORDINARY = getAddress("0x1000000000000000000000000000000000000001");
const registry = parseProjectIdentityAuthoritySnapshot([{
  id: "defi-traded-fund",
  name: "DeFi Traded Fund",
  symbol: "dtf",
  platforms: { robinhood: ESTABLISHED }
}]);

const identities = new Map<string, ProjectTokenIdentity>([
  [ESTABLISHED.toLowerCase(), { address: ESTABLISHED, name: "DeFi Traded Fund", symbol: "DTF" }],
  [CONFLICTING.toLowerCase(), { address: CONFLICTING, name: "Down to Finance", symbol: "DTF" }],
  [ORDINARY.toLowerCase(), { address: ORDINARY, name: "Different Totally Unrelated", symbol: "DTF" }]
]);
const readIdentity = async (address: Address) => identities.get(address.toLowerCase()) ?? null;

async function main() {
  assert.equal((await evaluateProjectIdentityAdmission({ address: ESTABLISHED }, registry, readIdentity)).status, "admitted");
  assert.equal((await evaluateProjectIdentityAdmission({ address: CONFLICTING }, registry, readIdentity)).status, "conflicting-project-identity");
  assert.equal((await evaluateProjectIdentityAdmission({ address: ORDINARY }, registry, readIdentity)).status, "admitted", "a symbol collision without a materially confusable project name must remain admitted");

  const sameNameDifferentSymbol = getAddress("0x2000000000000000000000000000000000000002");
  identities.set(sameNameDifferentSymbol.toLowerCase(), { address: sameNameDifferentSymbol, name: "DeFi Traded Fund", symbol: "OTHER" });
  assert.equal((await evaluateProjectIdentityAdmission({ address: sameNameDifferentSymbol }, registry, readIdentity)).status, "admitted", "a name collision by itself must remain admitted");

  const launchpadControl = getAddress("0x3000000000000000000000000000000000000003");
  identities.set(launchpadControl.toLowerCase(), { address: launchpadControl, name: "Current Launch Asset", symbol: "CURVE" });
  assert.equal((await evaluateProjectIdentityAdmission({ address: launchpadControl }, registry, readIdentity)).status, "admitted", "verified launchpad origin is not a quarantine trigger");

  const providerFakeIdentity = getAddress("0x4000000000000000000000000000000000000004");
  identities.set(providerFakeIdentity.toLowerCase(), { address: providerFakeIdentity, name: "Honest Onchain Asset", symbol: "HONEST" });
  assert.equal((await evaluateProjectIdentityAdmission({
    address: providerFakeIdentity,
    verifiedIdentity: identities.get(providerFakeIdentity.toLowerCase())
  }, registry, readIdentity)).status, "admitted", "provider names, socials, and DEX metadata are not project authority");

  const unavailable = await applyProjectIdentityDirectoryAdmission([{ address: CONFLICTING }], {
    readAuthority: async () => ({ status: "unavailable", entries: [] }),
    readIdentity
  });
  assert.equal(unavailable.admitted.length, 1, "unavailable project evidence must not censor an asset");
  assert.equal(unavailable.quarantined.length, 0);

  const filtered = await applyProjectIdentityDirectoryAdmission([
    { address: ESTABLISHED },
    { address: CONFLICTING },
    { address: ORDINARY }
  ], { readAuthority: async () => registry, readIdentity });
  assert.deepEqual(filtered.admitted.map((candidate) => candidate.address), [ESTABLISHED, ORDINARY]);
  assert.deepEqual(filtered.quarantined.map(({ candidate }) => candidate.address), [CONFLICTING]);
  await assert.rejects(
    requireProjectIdentityDirectoryAdmitted([{ address: CONFLICTING }], {
      readAuthority: async () => registry,
      readIdentity
    }),
    /Not admitted to the RMT directory/
  );
  await requireProjectIdentityDirectoryAdmitted([{ address: CONFLICTING }], {
    readAuthority: async () => ({ status: "unavailable", entries: [] }),
    readIdentity
  });
  const conflictResponse = projectIdentityAdmissionErrorResponse(
    await requireProjectIdentityDirectoryAdmitted([{ address: CONFLICTING }], {
      readAuthority: async () => registry,
      readIdentity
    }).catch((cause) => cause)
  );
  assert.equal(conflictResponse?.status, 451);
  assert.deepEqual(await conflictResponse?.json(), { error: "Not admitted to the RMT directory." });

  const implementation = readFileSync(new URL("./project-identity-admission.ts", import.meta.url), "utf8");
  const universalSearch = readFileSync(new URL("./vnext-universal-market-search.ts", import.meta.url), "utf8");
  const canonicalDirectory = readFileSync(new URL("./vnext-market-directory-route.ts", import.meta.url), "utf8");
  const providerDirectory = readFileSync(new URL("../../app/api/markets/external/route.ts", import.meta.url), "utf8");
  const directoryHook = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
  const presentation = readFileSync(new URL("../../app/vnext/terminal-presentations.tsx", import.meta.url), "utf8");
  const quoteRoute = readFileSync(new URL("../../app/api/vnext/quotes/route.ts", import.meta.url), "utf8");
  const verifyRoute = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
  const authorizeRoute = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
  for (const diagnosticAddress of [ESTABLISHED, CONFLICTING]) {
    assert.equal(implementation.toLowerCase().includes(diagnosticAddress.toLowerCase()), false, "release controls must not become runtime address policy");
  }
  assert.doesNotMatch(implementation, /dexscreener|blockscout|twitter|telegram|verified source/i, "non-authoritative metadata must not be promoted into project identity authority");
  assert.match(universalSearch, /applyProjectIdentityDirectoryAdmission/);
  assert.ok(universalSearch.indexOf("admitProjectIdentities(matchedCandidates") < universalSearch.indexOf(".slice(0, MAXIMUM_RESULTS)"), "quarantine must happen before result limits");
  assert.match(canonicalDirectory, /applyProjectIdentityDirectoryAdmission/);
  assert.match(providerDirectory, /directoryAdmission: "not_admitted"/);
  assert.match(providerDirectory, /applyProjectIdentityDirectoryAdmission/);
  assert.match(directoryHook, /canonicalPayload\?\.status === "not_admitted"/);
  assert.match(directoryHook, /marketPayload\?\.directoryAdmission === "not_admitted"/);
  assert.match(presentation, /Not admitted to the RMT directory\./);
  for (const route of [quoteRoute, verifyRoute, authorizeRoute]) {
    assert.match(route, /requireProjectIdentityDirectoryAdmitted/);
    assert.match(route, /projectIdentityAdmissionErrorResponse/);
  }
  assert.ok(quoteRoute.indexOf("requireProjectIdentityDirectoryAdmitted") < quoteRoute.indexOf("quoteRobinhoodVNextExecution({"));
  assert.ok(verifyRoute.indexOf("requireProjectIdentityDirectoryAdmitted") < verifyRoute.indexOf("verifyRobinhoodVNextExecution(parsed.data.provider"));
  assert.ok(authorizeRoute.indexOf("requireProjectIdentityDirectoryAdmitted") < authorizeRoute.indexOf("prepareRobinhoodVNextAuthorization(parsed.data.provider"));

  console.log("Project identity authority, positive-conflict quarantine, uncertainty admission, and no-blacklist controls passed.");
}

void main();
