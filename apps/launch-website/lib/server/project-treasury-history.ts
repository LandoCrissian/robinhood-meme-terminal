import type { Hex } from "viem";
import { projectTreasurySignatures } from "../../../../packages/launchpad-common/project-treasury-runtime.mjs";
import { projectTreasuryProfile, treasuryAddress, treasuryHash, type ProjectTreasuryEvent, type ProjectTreasuryPoint, type ProjectTreasuryProof } from "../project-treasury";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const names = new Set(projectTreasurySignatures.flatMap(signature => /^event (\w+)\(/.exec(signature)?.[1] ?? []));
const point = (p: ProjectTreasuryPoint) => p && /^[1-9][0-9]{0,15}$/.test(p.blockNumber)
  && treasuryHash(p.blockHash) && typeof p.timestamp === "string" && Number.isFinite(Date.parse(p.timestamp));
function requireEvidence(value: unknown): asserts value { if (!value) throw Error("Indexed treasury history is unavailable or noncanonical"); }
type Header = { number: bigint | null; hash: Hex | null; timestamp: bigint };
type HeaderReader = (height: bigint) => Promise<Header>;

/** Authentication authorizes a response; it does not establish chain inclusion.
 * Cross-check the birth and every bounded event header before labeling history
 * indexed. A stale or orphaned worker response never replaces live balances. */
export async function validateIndexedTreasuryHistory(payload: unknown, proof: ProjectTreasuryProof, head: bigint, readHeader: HeaderReader) {
  const data = payload as { schemaVersion: number; chainId: number; profile: string; treasuryFactory: string; checkpoint: ProjectTreasuryPoint;
    treasuries: Array<Omit<ProjectTreasuryProof, "schemaVersion" | "chainId" | "profile" | "treasuryFactory" | "coreFactory" | "factoryRuntimeHash">>;
    events: Array<ProjectTreasuryEvent & { treasury: string }> };
  requireEvidence(data && data.schemaVersion === 1 && data.chainId === 31337 && data.profile === projectTreasuryProfile
    && treasuryAddress(data.treasuryFactory) && same(data.treasuryFactory, proof.treasuryFactory) && point(data.checkpoint)
    && BigInt(data.checkpoint.blockNumber) <= head && BigInt(data.checkpoint.blockNumber) >= BigInt(proof.deployment.blockNumber)
    && Array.isArray(data.treasuries) && data.treasuries.length === 1 && Array.isArray(data.events) && data.events.length <= 100);
  const birth = data.treasuries[0];
  requireEvidence(birth && treasuryAddress(birth.treasury) && same(birth.treasury, proof.treasury)
    && same(birth.creator, proof.creator) && same(birth.controller, proof.controller) && same(birth.intentId, proof.intentId)
    && same(birth.runtimeHash, proof.runtimeHash) && birth.treasuryShareBps === proof.treasuryShareBps
    && point(birth.deployment) && birth.deployment.blockNumber === proof.deployment.blockNumber
    && same(birth.deployment.blockHash, proof.deployment.blockHash) && birth.deployment.timestamp === proof.deployment.timestamp
    && same(birth.deployment.transactionHash, proof.deployment.transactionHash) && birth.deployment.logIndex === proof.deployment.logIndex);
  const points = new Map<string, ProjectTreasuryPoint>(), identities = new Set<string>();
  const add = (p: ProjectTreasuryPoint) => { const prior = points.get(p.blockNumber);
    requireEvidence(!prior || same(prior.blockHash, p.blockHash) && prior.timestamp === p.timestamp); points.set(p.blockNumber, p); };
  add(data.checkpoint); add(proof.deployment);
  for (const event of data.events) {
    requireEvidence(point(event) && treasuryAddress(event.treasury) && same(event.treasury, proof.treasury) && names.has(event.event)
      && treasuryHash(event.transactionHash) && Number.isSafeInteger(event.logIndex) && event.logIndex >= 0
      && BigInt(event.blockNumber) >= BigInt(proof.deployment.blockNumber) && BigInt(event.blockNumber) <= BigInt(data.checkpoint.blockNumber)
      && (event.asset === undefined || /^0x[0-9a-f]{40}$/i.test(event.asset))
      && (event.amountWei === undefined || /^(?:0|[1-9][0-9]{0,77})$/.test(event.amountWei) && BigInt(event.amountWei) < 2n ** 256n)
      && (event.source === undefined || /^0x[0-9a-f]{64}$/i.test(event.source)));
    const key = `${event.transactionHash.toLowerCase()}:${event.logIndex}`; requireEvidence(!identities.has(key)); identities.add(key); add(event);
  }
  const bounded = [...points.values()]; requireEvidence(bounded.length <= 102);
  for (let offset = 0; offset < bounded.length; offset += 8) await Promise.all(bounded.slice(offset, offset + 8).map(async expected => {
    const header = await readHeader(BigInt(expected.blockNumber));
    requireEvidence(header.number === BigInt(expected.blockNumber) && header.hash && same(header.hash, expected.blockHash)
      && new Date(Number(header.timestamp) * 1000).toISOString() === expected.timestamp);
  }));
  return { events: data.events as ProjectTreasuryEvent[], history: { indexed: true, status: "ready" as const, checkpoint: data.checkpoint } };
}
