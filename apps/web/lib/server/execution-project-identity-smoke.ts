import assert from "node:assert/strict";
import { getAddress } from "viem";
import {
  createProjectIdentityAuthorityReader,
  parseProjectIdentityAuthoritySnapshot,
  requireProjectIdentityExecutionAdmitted
} from "./project-identity-admission";

async function main() {
  const established = getAddress(`0x${"1".repeat(40)}`);
  const ordinary = getAddress(`0x${"2".repeat(40)}`);
  const conflict = getAddress(`0x${"3".repeat(40)}`);
  const snapshot = parseProjectIdentityAuthoritySnapshot([{
    id: "established", name: "DeFi Traded Fund", symbol: "dtf", platforms: { robinhood: established }
  }]);
  const queued: Array<() => Promise<void>> = [];
  let freshReads = 0;
  const ordinaryCandidate = { address: ordinary, verifiedIdentity: { address: ordinary, name: "Ordinary", symbol: "ORD" } };
  const dependencies = { snapshot, readKnownIdentity: async () => null, revalidate: async () => { freshReads++; } };
  await requireProjectIdentityExecutionAdmitted([ordinaryCandidate], work => queued.push(work), dependencies);
  assert.equal(freshReads, 0, "fresh project intelligence must not precede quote submission");
  assert.equal(queued.length, 1);
  await requireProjectIdentityExecutionAdmitted([ordinaryCandidate], work => queued.push(work), dependencies);
  assert.equal(queued.length, 1, "quote/verify/authorize coalesce revalidation");
  await queued[0]();
  assert.equal(freshReads, 1);
  const conflictingCandidate = { address: conflict, verifiedIdentity: { address: conflict, name: "Down to Finance", symbol: "DTF" } };
  await assert.rejects(requireProjectIdentityExecutionAdmitted([conflictingCandidate], () => assert.fail("conflict cannot schedule execution"), {
    snapshot,
    readKnownIdentity: async address => address === established ? { address, name: "DeFi Traded Fund", symbol: "DTF" } : null
  }), /Not admitted/);
  await assert.rejects(requireProjectIdentityExecutionAdmitted([conflictingCandidate], () => {}, {
    snapshot: { status: "unavailable", entries: [] }
  }), /Not admitted/, "intelligence outage cannot erase positive quarantine");
  let registryReads = 0;
  const reader = createProjectIdentityAuthorityReader({ fetch: async () => {
    registryReads++;
    return Response.json([{ id: "established", name: "DeFi Traded Fund", symbol: "dtf", platforms: { robinhood: established } }]);
  } });
  assert.equal(reader.peek().status, "unavailable");
  assert.equal(registryReads, 0, "cached authority inspection cannot cause network IO");
  await reader();
  assert.equal(reader.peek().status, "ready");
  assert.equal(registryReads, 1);
  console.log("Execution project identity: network-free known authority, deferred coalescing, positive conflict/outage controls PASS");
}
void main();
