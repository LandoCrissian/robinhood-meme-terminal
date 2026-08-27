import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, type Address } from "viem";
import {
  applyProjectIdentityDirectoryAdmission,
  createProjectIdentityAuthorityReader,
  evaluateProjectIdentityAdmission,
  parseProjectIdentityAuthoritySnapshot,
  projectIdentityAdmissionErrorResponse,
  requireProjectIdentityDirectoryAdmitted,
  type ProjectTokenIdentity
} from "./project-identity-admission";
import { readVNextMarketDirectoryRequest } from "./vnext-market-directory-route";
import { VNEXT_MARKET_DIRECTORY_PAGE_SIZE, visibleVNextMarketDirectoryMarkets } from "../vnext/market-directory";

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
  assert.equal(parseProjectIdentityAuthoritySnapshot([]).status, "unavailable", "zero Robinhood bindings must not look authoritative");
  assert.equal(parseProjectIdentityAuthoritySnapshot([{
    id: "wrong-platform",
    name: "Wrong Platform",
    symbol: "WRONG",
    platforms: { "robinhood-chain": ESTABLISHED }
  }]).status, "unavailable", "a changed platform key must fail authority readiness");
  assert.equal(parseProjectIdentityAuthoritySnapshot([{
    id: "malformed-platform",
    name: "Malformed Platform",
    symbol: "BAD",
    platforms: { robinhood: { address: ESTABLISHED } }
  }]).status, "unavailable", "malformed platform data must fail authority readiness");

  assert.equal((await evaluateProjectIdentityAdmission({ address: ESTABLISHED }, registry, readIdentity)).status, "admitted");
  assert.equal((await evaluateProjectIdentityAdmission({ address: CONFLICTING }, registry, readIdentity)).status, "conflicting-project-identity");
  assert.equal((await evaluateProjectIdentityAdmission({ address: ORDINARY }, registry, readIdentity)).status, "admitted", "a symbol collision without a materially confusable project name must remain admitted");

  const identityExtension = getAddress("0x1100000000000000000000000000000000000011");
  identities.set(identityExtension.toLowerCase(), { address: identityExtension, name: "DeFi Traded Fund Official", symbol: "DTF" });
  assert.equal((await evaluateProjectIdentityAdmission({ address: identityExtension }, registry, readIdentity)).status, "conflicting-project-identity", "a bounded identity-name extension with the exact confusable symbol must be evaluated as a positive conflict");

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

  let batchCalls = 0;
  let logicalIdentityReads = 0;
  const batched = await applyProjectIdentityDirectoryAdmission([
    { address: ESTABLISHED },
    { address: CONFLICTING },
    { address: ORDINARY }
  ], {
    readAuthority: async () => registry,
    readIdentities: async (addresses) => {
      batchCalls += 1;
      logicalIdentityReads += new Set(addresses.map((address) => address.toLowerCase())).size;
      return new Map(addresses.flatMap((address) => {
        const identity = identities.get(address.toLowerCase());
        return identity ? [[address.toLowerCase(), identity] as const] : [];
      }));
    },
    readIdentity
  });
  assert.deepEqual(batched.admitted.map((candidate) => candidate.address), [ESTABLISHED, ORDINARY]);
  assert.equal(batchCalls, 2, "candidate and established identity work must use two bounded phases, not one request group per candidate");
  assert.equal(logicalIdentityReads, 3, "only non-bound candidate identities and the materially matched established identity are needed");

  let authorityNow = 1_000;
  let authorityFetchCalls = 0;
  const failureReader = createProjectIdentityAuthorityReader({
    now: () => authorityNow,
    fetch: async () => {
      authorityFetchCalls += 1;
      return new Response("rate limited", { status: 429 });
    }
  });
  assert.equal((await failureReader()).status, "unavailable");
  assert.equal((await failureReader()).status, "unavailable");
  assert.equal(authorityFetchCalls, 1, "authority failures must be negatively cached during bounded backoff");
  authorityNow += 15_001;
  assert.equal((await failureReader()).status, "unavailable");
  assert.equal(authorityFetchCalls, 2, "authority fetch may retry after bounded backoff");

  let recoveryFetchCalls = 0;
  let recoveryNow = 10_000;
  const recoveryReader = createProjectIdentityAuthorityReader({
    now: () => recoveryNow,
    fetch: async () => {
      recoveryFetchCalls += 1;
      if (recoveryFetchCalls === 2) return new Response("unavailable", { status: 503 });
      return Response.json([{
        id: "defi-traded-fund",
        name: "DeFi Traded Fund",
        symbol: "dtf",
        platforms: { robinhood: ESTABLISHED }
      }]);
    }
  });
  assert.equal((await recoveryReader()).status, "ready");
  recoveryNow += 5 * 60_000 + 1;
  const lastKnown = await recoveryReader();
  assert.equal(lastKnown.status, "ready", "an expired verified authority snapshot must remain available during refresh failure");
  assert.equal(lastKnown.status === "ready" ? lastKnown.freshness : undefined, "last-known", "stale authority must be labeled last-known");
  const backoffSnapshot = await recoveryReader();
  assert.equal(backoffSnapshot.status, "ready");
  assert.equal(backoffSnapshot.status === "ready" ? backoffSnapshot.freshness : undefined, "last-known");
  assert.equal(recoveryFetchCalls, 2, "failed refresh must enter backoff rather than waterfall");
  recoveryNow += 15_001;
  assert.equal((await recoveryReader()).status, "ready", "authority must recover after bounded backoff");
  await assert.rejects(
    requireProjectIdentityDirectoryAdmitted([{ address: CONFLICTING }], {
      readAuthority: async () => registry,
      readIdentity
    }),
    /Not admitted to the RMT directory/
  );
  await assert.rejects(
    requireProjectIdentityDirectoryAdmitted([{ address: CONFLICTING }], {
      readAuthority: async () => ({ status: "unavailable", entries: [] }),
      readIdentity
    }),
    /Not admitted to the RMT directory/,
    "a cached positive quarantine must survive a temporary authority outage"
  );
  const conflictResponse = projectIdentityAdmissionErrorResponse(
    await requireProjectIdentityDirectoryAdmitted([{ address: CONFLICTING }], {
      readAuthority: async () => registry,
      readIdentity
    }).catch((cause) => cause)
  );
  assert.equal(conflictResponse?.status, 409);
  assert.deepEqual(await conflictResponse?.json(), {
    error: "Not admitted to the RMT directory.",
    directoryAdmission: "not_admitted"
  });

  const boundaryMarkets = Array.from({ length: VNEXT_MARKET_DIRECTORY_PAGE_SIZE + 1 }, (_, index) => ({
    address: getAddress(`0x${(index + 1).toString(16).padStart(40, "0")}`),
    name: `Asset ${index + 1}`,
    symbol: `A${index + 1}`
  }));
  const quarantinedBoundaryAddress = boundaryMarkets[VNEXT_MARKET_DIRECTORY_PAGE_SIZE - 1]!.address;
  const boundaryResult = await readVNextMarketDirectoryRequest(
    "https://example.test/api/vnext/market-directory",
    { RMT_CANONICAL_BROWSE_ENABLED: "true" },
    {
      readCanonical: async () => ({
        status: 200,
        body: {
          canonical: true,
          coverage: "complete",
          nextCursor: "truthful_next_cursor",
          updatedAt: new Date(0).toISOString(),
          markets: boundaryMarkets
        }
      }) as never,
      readLegacy: async () => ({ status: 503, body: { error: "unused" } }) as never,
      admitProjectIdentities: async (candidates) => candidates.filter((candidate) => candidate.address !== quarantinedBoundaryAddress)
    }
  );
  assert.equal(boundaryResult.status, 200);
  const boundaryBody = boundaryResult.body as { markets?: typeof boundaryMarkets; nextCursor?: string | null };
  const visibleBoundary = visibleVNextMarketDirectoryMarkets((boundaryBody.markets ?? []) as never);
  assert.equal(visibleBoundary.length, VNEXT_MARKET_DIRECTORY_PAGE_SIZE, "a quarantined candidate must not consume a visible result slot");
  assert.equal(visibleBoundary.some((market) => market.address === quarantinedBoundaryAddress), false);
  assert.equal(boundaryBody.nextCursor, "truthful_next_cursor", "filtering must preserve the canonical inventory cursor");

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
  const combinedAdmission = universalSearch.indexOf("admitProjectIdentities(matchedCandidates");
  const combinedLimit = universalSearch.indexOf(".slice(0, MAXIMUM_RESULTS)", combinedAdmission);
  assert.ok(
    universalSearch.indexOf("[...canonicalMatches, ...providerCandidates]") < combinedAdmission,
    "canonical and supplemental candidates must be combined before quarantine"
  );
  assert.ok(combinedAdmission >= 0 && combinedAdmission < combinedLimit, "quarantine must happen before result limits");
  assert.match(canonicalDirectory, /excludeKnownPositiveProjectIdentityQuarantines/);
  assert.match(providerDirectory, /directoryAdmission: "not_admitted"/);
  assert.match(providerDirectory, /applyProjectIdentityDirectoryAdmission/);
  assert.match(directoryHook, /canonicalPayload\?\.status === "not_admitted"/);
  assert.match(directoryHook, /marketPayload\?\.directoryAdmission === "not_admitted"/);
  assert.match(presentation, /Not admitted to the RMT directory/);
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
